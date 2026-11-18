// ============================================================
// lobby.js - 대기실 로직 (닉네임, 유저 목록, 게임 옵션, 게임 시작)
// ============================================================
import { state, setMyAuthInfo, setMyNickname } from "../core/state.js";
import { sendMessage } from "../core/socket.js";
import { syncMaskedTiles } from "../media/masked.js";

// 게임 시작 가능 인원 (규격: 2~4인 / 혼자 테스트할 때는 MIN_PLAYERS를 1로)
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 4;
const START_LOCK_MS = 2000; // 시작 요청 후 중복 클릭 방지 시간
const MAX_ROUNDS = 20;        // 옵션 상한 (index.html 입력칸 max와 동일)
const MAX_PLAY_SECONDS = 120;

let startLocked = false;
let hintNotice = null;  // 서버 거부 사유 등 임시 안내 문구 (updateHostControls가 덮어쓰지 않도록 보존)
let hintTimer = null;

// 안내 문구(#startHint)를 ms 동안 유지 (0이면 다음 방 입장 전까지 유지)
export function showHintNotice(message, ms = 4000) {
  hintNotice = message;
  clearTimeout(hintTimer);
  if (ms > 0) {
    hintTimer = setTimeout(() => {
      hintNotice = null;
      updateHostControls();
    }, ms);
  }
  updateHostControls();
}

// ② [클라이언트 ➔ 서버] 닉네임 설정 요청 (SET_NICKNAME)
export function requestSetNickname(nickname) {
  if (!state.myUuid) {
    console.error("아직 UUID를 발급받지 못했습니다. (CONNECTED 대기 중)");
    return;
  }

  const trimmed = nickname ? nickname.trim() : "";
  if (!trimmed) {
    console.warn("유효한 닉네임을 입력해주세요.");
    return;
  }

  // 전송에 성공했을 때만 상태에 반영
  if (sendMessage("SET_NICKNAME", { nickname: trimmed })) {
    setMyNickname(trimmed);
  }
}

// ③ [서버 ➔ 전체] 방 안의 유저 목록 동기화 (ROOM_USERS_UPDATE 등)
export function handleRoomUsersUpdate(payload) {
  const usersList = payload?.users ?? payload?.roomUsers ?? payload?.userList;
  if (!Array.isArray(usersList)) {
    console.warn("유효하지 않은 유저 목록 데이터:", payload);
    return;
  }

  state.users = usersList;

  // 서버 기준 내 방장 여부 및 닉네임 동기화 (방장 위임 및 새로고침 재접속 대비)
  const me = state.users.find((u) => u.uuid === state.myUuid);
  if (me) {
    if (typeof me.isHost === "boolean") {
      setMyAuthInfo(state.myUuid, me.isHost);
    }
    if (me.nickname) {
      setMyNickname(me.nickname);
      const nickInput = document.getElementById("nicknameInput");
      if (nickInput && nickInput.value !== me.nickname) {
        nickInput.value = me.nickname;
      }
    }
  }

  console.log("[유저 목록 동기화 완료]:", state.users);
  renderRoomUsers();
  updateHostControls(); // 방장 여부 / 인원 변화에 따라 컨트롤 갱신
  syncMaskedTiles(); // 게임 중이면 접속 상태 변화를 영상 타일 라벨에 반영
}

// [방장 ➔ 서버] 게임 옵션 변경 요청 (UPDATE_GAME_OPTIONS)
export function requestUpdateGameOptions(totalRounds, playTimeSeconds) {
  if (!state.myUuid) {
    console.error("아직 UUID를 발급받지 못했습니다.");
    return;
  }

  // 방장이 아니면 전송하지 않고 입력칸을 원래 값으로 복구
  if (!state.isHost) {
    console.warn("방장만 게임 옵션을 변경할 수 있습니다.");
    renderGameOptions();
    return;
  }

  // 정수만 허용 (빈 입력은 NaN -> JSON에서 null로 바뀌어 서버 오류 유발)
  if (!Number.isInteger(totalRounds) || !Number.isInteger(playTimeSeconds)) {
    console.warn("라운드 수와 구현 시간은 정수여야 합니다.");
    renderGameOptions();
    return;
  }

  // 직접 타이핑하면 HTML min/max가 적용되지 않으므로 범위(1~상한)로 보정해서 전송
  const rounds = Math.min(Math.max(totalRounds, 1), MAX_ROUNDS);
  const seconds = Math.min(Math.max(playTimeSeconds, 1), MAX_PLAY_SECONDS);
  const roundEl = document.getElementById("roundInput");
  const timeEl = document.getElementById("timeInput");
  if (roundEl) roundEl.value = rounds;
  if (timeEl) timeEl.value = seconds;

  sendMessage("UPDATE_GAME_OPTIONS", { totalRounds: rounds, playTimeSeconds: seconds });
}

// [서버 ➔ 전체] 게임 옵션 변경 동기화 (GAME_OPTIONS_UPDATED)
// RECONNECT_SUCCESS(totalRounds만 존재)도 재사용하므로 있는 값만 반영
export function handleGameOptionsUpdated(payload) {
  if (!payload) return;

  const totalRounds = payload.totalRounds ?? payload.gameOptions?.totalRounds;
  const playTimeSeconds = payload.playTimeSeconds ?? payload.gameOptions?.playTimeSeconds;

  if (Number.isInteger(totalRounds)) {
    state.gameOptions.totalRounds = totalRounds;
  }
  if (Number.isInteger(playTimeSeconds)) {
    state.gameOptions.playTimeSeconds = playTimeSeconds;
  }

  console.log("[게임 옵션 동기화 완료]:", state.gameOptions);
  renderGameOptions();
}

// ---------- 게임 시작 (2단계) ----------

// 게임을 시작할 수 없는 이유를 반환 (시작 가능하면 null)
// 요청 검증과 버튼 활성화가 같은 기준을 쓰도록 한곳에서 판단
function getStartBlockReason() {
  if (!state.myUuid) return "서버 연결 대기 중";
  if (!state.isHost) return "방장만 게임을 시작할 수 있습니다";
  if (startLocked) return "시작 요청 처리 중";

  // 접속 중인 유저 기준으로 검증 (규격: 2~4인, 모두 닉네임 설정 완료)
  const connected = state.users.filter((u) => u.isConnected !== false);
  if (connected.length < MIN_PLAYERS || connected.length > MAX_PLAYERS) {
    return `실험 인원은 ${MIN_PLAYERS}~${MAX_PLAYERS}명이어야 합니다 (현재 ${connected.length}명)`;
  }
  if (connected.some((u) => !u.nickname)) {
    return "닉네임 설정이 끝나지 않은 연구원이 있습니다";
  }
  if (!state.webcamReady && !state.webcamFallbackMode) {
    return "내 웹캠이 준비되지 않았습니다";
  }

  return null;
}

// [방장 ➔ 서버] 게임 시작 요청 (GAME_START_REQ) - 빈 payload
export function requestGameStart() {
  const reason = getStartBlockReason();
  if (reason) {
    console.warn(`게임을 시작할 수 없습니다: ${reason}`);
    return false;
  }

  if (!sendMessage("GAME_START_REQ", {})) return false;

  // 중복 전송 방지: 잠시 버튼 잠금
  startLocked = true;
  updateHostControls();
  setTimeout(() => {
    startLocked = false;
    updateHostControls();
  }, START_LOCK_MS);
  return true;
}

// ---------- DOM 렌더링 (해당 ID 요소가 HTML에 있을 때만 동작) ----------

// 유저 목록 (#userList)
export function renderRoomUsers() {
  const listEl = document.getElementById("userList");
  if (!listEl) return;

  listEl.innerHTML = "";
  state.users.forEach((user) => {
    const li = document.createElement("li");
    li.className = "user-item";
    if (user.uuid === state.myUuid) li.classList.add("is-me");
    if (user.isHost) li.classList.add("is-host");
    if (user.isConnected === false) li.classList.add("is-disconnected");

    const hostBadge = user.isHost ? " [방장]" : "";
    const meBadge = user.uuid === state.myUuid ? " (나)" : "";
    const connBadge = user.isConnected === false ? " (연결 끊김)" : "";
    li.textContent = `${user.nickname || "이름 없음"}${hostBadge}${meBadge}${connBadge}`;
    listEl.appendChild(li);
  });

  const countEl = document.getElementById("userCountBadge");
  if (countEl) {
    const connectedCount = state.users.filter((u) => u.isConnected !== false).length;
    countEl.textContent = `${connectedCount} / ${MAX_PLAYERS}명 접속 중`;
  }
}

// 옵션 입력칸 (#roundInput, #timeInput)을 현재 상태 값으로 표시
export function renderGameOptions() {
  const roundEl = document.getElementById("roundInput");
  const timeEl = document.getElementById("timeInput");
  if (roundEl) roundEl.value = state.gameOptions.totalRounds;
  if (timeEl) timeEl.value = state.gameOptions.playTimeSeconds;
}

// 방장 전용 컨트롤 활성화 상태 갱신
// 상태가 바뀌는 시점(유저 목록, 웹캠 준비, 방장 변경 등)마다 호출
export function updateHostControls() {
  // 옵션 입력칸/버튼: 방장일 때만
  ["roundInput", "timeInput", "optionSubmitBtn"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.disabled = !state.isHost;
  });

  // 내 역할 배지 표시 (#myRoleBadge)
  const roleEl = document.getElementById("myRoleBadge");
  if (roleEl) {
    if (!state.myUuid) {
      roleEl.textContent = "연결 대기";
      roleEl.dataset.role = "guest";
    } else if (state.isHost) {
      roleEl.textContent = "수석 연구원 (방장)";
      roleEl.dataset.role = "host";
    } else {
      roleEl.textContent = "일반 연구원";
      roleEl.dataset.role = "member";
    }
  }

  // 시작 버튼: 시작 조건을 모두 만족할 때만 활성화, 막힌 이유는 #startHint에 표시
  const reason = getStartBlockReason();
  const startBtn = document.getElementById("gameStartBtn");
  const hintEl = document.getElementById("startHint");
  if (startBtn) startBtn.disabled = reason !== null;
  if (hintEl) {
    hintEl.textContent = hintNotice ?? reason ?? "모든 실험 준비가 완료되었습니다. 실험을 시작하세요!";
    hintEl.dataset.ready = hintNotice === null && reason === null ? "true" : "false";
  }
}
