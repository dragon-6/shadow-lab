// ============================================================
// lobby.js - 대기실 로직 (닉네임/옵션 조건 검증, 미적용 강조, 임팩트 알림창)
// ============================================================
<<<<<<< HEAD
import { state, setMyAuthInfo, setMyNickname } from "../core/state.js?v=7";
import { sendMessage } from "../core/socket.js?v=7";
import { syncMaskedTiles } from "../media/masked.js?v=7";
import { formatScore } from "./screens.js?v=7";
=======
import { state, setMyAuthInfo, setMyNickname } from "../core/state.js?v=6";
import { sendMessage } from "../core/socket.js?v=6";
import { syncMaskedTiles } from "../media/masked.js?v=6";
import { formatScore } from "./screens.js?v=6";
>>>>>>> da122f35b6280cf0ebd1721cbeedc983280daf6b

const MAX_PLAYERS = 4;
const START_LOCK_MS = 2000;
const MIN_NICK_LEN = 2;
const MAX_NICK_LEN = 12;
const MIN_ROUNDS = 1;
const MAX_ROUNDS = 10;
const MIN_PLAY_SECONDS = 5;
const MAX_PLAY_SECONDS = 60;

let startLocked = false;
let hintNotice = null;
let hintTimer = null;
let pendingNickToast = false;
let pendingOptionToast = false;
let hasReceivedInitialOptions = false;
let lastRangeAlertAt = 0;

/**
 * 화면 상단 중앙에 강력한 임팩트 토스트 알림창을 표시
 */
export function showImpactToast(message, type = "info", durationMs = 2800) {
  let container = document.getElementById("impactToastContainer");
  if (!container) {
    container = document.createElement("div");
    container.id = "impactToastContainer";
    document.body.appendChild(container);
  }

  const icons = {
    success: "✅",
    error: "🚨",
    warn: "⚡",
    info: "🔔",
  };

  while (container.children.length >= 2) {
    container.firstElementChild.remove();
  }

  const toast = document.createElement("div");
  toast.className = "impact-toast";
  toast.dataset.type = type;
  toast.textContent = `${icons[type] || "🔔"} ${message}`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add("is-leaving");
    setTimeout(() => toast.remove(), 220);
  }, durationMs);
}

// 안내 문구(#startHint) 표시 + 필요 시 상단 임팩트 토스트 동시 출력
export function showHintNotice(message, ms = 4000, toastType = null) {
  hintNotice = message;
  clearTimeout(hintTimer);
  if (ms > 0) {
    hintTimer = setTimeout(() => {
      hintNotice = null;
      updateHostControls();
    }, ms);
  }
  updateHostControls();

  if (toastType && message) {
    showImpactToast(message, toastType);
  }
}

// ② [클라이언트 ➔ 서버] 닉네임 설정 요청 (자동 보정 없이 조건 위반 시 즉시 경고 알림창)
export function requestSetNickname(rawNickname) {
  const nickInput = document.getElementById("nicknameInput");

  if (!state.myUuid) {
    showImpactToast("서버 연결 대기 중입니다. 잠시 후 다시 시도해주세요.", "error");
    return false;
  }

  const value = typeof rawNickname === "string" ? rawNickname : "";

  // 1. 빈 값 체크
  if (!value || value.trim().length === 0) {
    if (nickInput) nickInput.dataset.invalid = "true";
    showImpactToast("닉네임을 입력해주세요! (공백만 입력할 수 없습니다)", "error");
    return false;
  }

  // 2. 공백 포함 여부 체크 (자동 제거하지 않고 경고)
  if (/\s/.test(value)) {
    if (nickInput) nickInput.dataset.invalid = "true";
    showImpactToast("닉네임에는 띄어쓰기(공백)를 포함할 수 없습니다!", "error");
    return false;
  }

  // 3. 길이 조건 체크 (2~12자)
  if (value.length < MIN_NICK_LEN || value.length > MAX_NICK_LEN) {
    if (nickInput) nickInput.dataset.invalid = "true";
    showImpactToast(
      `닉네임은 ${MIN_NICK_LEN}~${MAX_NICK_LEN}자 사이여야 합니다! (현재 ${value.length}자)`,
      "error",
    );
    return false;
  }

  // 4. 특수문자 제한 체크 (한글, 영문, 숫자, _, - 만 허용)
  if (!/^[가-힣a-zA-Z0-9_-]+$/.test(value)) {
    if (nickInput) nickInput.dataset.invalid = "true";
    showImpactToast("닉네임에는 특수문자나 초성/모음 단독 문자를 사용할 수 없습니다!", "error");
    return false;
  }

  // 5. 방 안의 다른 유저와 중복 닉네임인지 체크
  const duplicate = state.users.some(
    (u) => u.uuid !== state.myUuid && u.nickname && u.nickname === value,
  );
  if (duplicate) {
    if (nickInput) nickInput.dataset.invalid = "true";
    showImpactToast(`이미 사용 중인 닉네임입니다: [${value}]`, "error");
    return false;
  }

  if (nickInput) delete nickInput.dataset.invalid;

  if (sendMessage("SET_NICKNAME", { nickname: value })) {
    setMyNickname(value);
    pendingNickToast = true;
    return true;
  } else {
    showImpactToast("서버와 연결되어 있지 않아 닉네임을 설정할 수 없습니다.", "error");
    return false;
  }
}

// ③ [서버 ➔ 전체] 방 안의 유저 목록 동기화
export function handleRoomUsersUpdate(payload) {
  const usersList = payload?.users ?? payload?.roomUsers ?? payload?.userList;
  if (!Array.isArray(usersList)) {
    console.warn("유효하지 않은 유저 목록 데이터:", payload);
    return;
  }

  state.users = usersList;

  const me = state.users.find((u) => u.uuid === state.myUuid);
  if (me) {
    if (typeof me.isHost === "boolean") {
      setMyAuthInfo(state.myUuid, me.isHost);
    }
    if (me.nickname) {
      setMyNickname(me.nickname);
      const nickInput = document.getElementById("nicknameInput");
      if (nickInput && document.activeElement !== nickInput) {
        nickInput.value = me.nickname;
      }
      if (pendingNickToast) {
        pendingNickToast = false;
        showImpactToast(`닉네임 [${me.nickname}] 설정 완료!`, "success");
      }
    }
  }

  renderRoomUsers();
  updateHostControls();
  syncMaskedTiles();
}

// [방장 ➔ 서버] 게임 옵션 변경 요청 (자동 보정 제거 -> 범위 밖이면 경고 알림창 출력 후 거부)
export function requestUpdateGameOptions(rawRounds, rawSeconds) {
  if (!state.myUuid) {
    showImpactToast("서버 연결 대기 중입니다.", "error");
    return false;
  }

  if (!state.isHost) {
    showImpactToast("방장만 게임 옵션을 변경할 수 있습니다!", "error");
    renderGameOptions();
    return false;
  }

  const roundEl = document.getElementById("roundInput");
  const timeEl = document.getElementById("timeInput");
  const roundStr = roundEl ? roundEl.value.trim() : String(rawRounds ?? "");
  const timeStr = timeEl ? timeEl.value.trim() : String(rawSeconds ?? "");

  const totalRounds = Number(roundStr);
  const playTimeSeconds = Number(timeStr);

  // 1. 정수 여부 확인
  if (!roundStr || !Number.isInteger(totalRounds)) {
    if (roundEl) roundEl.dataset.invalid = "true";
    showImpactToast("라운드 수는 정수로 입력해주세요! (1~10)", "error");
    return false;
  }

  if (!timeStr || !Number.isInteger(playTimeSeconds)) {
    if (timeEl) timeEl.dataset.invalid = "true";
    showImpactToast("제한 시간은 정수로 입력해주세요! (5~60초)", "error");
    return false;
  }

  // 2. 라운드 조건 범위(1~10) 확인 - 자동 보정하지 않고 즉시 경고!
  if (totalRounds < MIN_ROUNDS || totalRounds > MAX_ROUNDS) {
    if (roundEl) roundEl.dataset.invalid = "true";
    showImpactToast(
      `라운드 수는 ${MIN_ROUNDS}~${MAX_ROUNDS} 사이로 설정해야 합니다! (입력값: ${totalRounds})`,
      "error",
    );
    return false;
  }

  // 3. 제한 시간 조건 범위(5~60) 확인 - 자동 보정하지 않고 즉시 경고!
  if (playTimeSeconds < MIN_PLAY_SECONDS || playTimeSeconds > MAX_PLAY_SECONDS) {
    if (timeEl) timeEl.dataset.invalid = "true";
    showImpactToast(
      `제한 시간은 ${MIN_PLAY_SECONDS}~${MAX_PLAY_SECONDS}초 사이로 설정해야 합니다! (입력값: ${playTimeSeconds}초)`,
      "error",
    );
    return false;
  }

  if (roundEl) delete roundEl.dataset.invalid;
  if (timeEl) delete timeEl.dataset.invalid;

  // 이미 적용된 서버 옵션과 같을 때
  if (
    totalRounds === state.gameOptions.totalRounds &&
    playTimeSeconds === state.gameOptions.playTimeSeconds
  ) {
    syncOptionDirtyState(false);
    showImpactToast(
      `현재 적용된 옵션(${totalRounds}라운드 · ${playTimeSeconds}초)과 동일합니다.`,
      "info",
    );
    return false;
  }

  if (sendMessage("UPDATE_GAME_OPTIONS", { totalRounds, playTimeSeconds })) {
    pendingOptionToast = true;
    return true;
  } else {
    showImpactToast("서버 연결이 끊겨 옵션 변경에 실패했습니다.", "error");
    return false;
  }
}

// [서버 ➔ 전체] 게임 옵션 변경 동기화 (GAME_OPTIONS_UPDATED)
export function handleGameOptionsUpdated(payload, isInitialSync = false) {
  if (!payload) return;

  const totalRounds = payload.totalRounds ?? payload.gameOptions?.totalRounds;
  const playTimeSeconds = payload.playTimeSeconds ?? payload.gameOptions?.playTimeSeconds;

  const prevRounds = state.gameOptions.totalRounds;
  const prevSeconds = state.gameOptions.playTimeSeconds;

  if (Number.isInteger(totalRounds)) {
    state.gameOptions.totalRounds = totalRounds;
  }
  if (Number.isInteger(playTimeSeconds)) {
    state.gameOptions.playTimeSeconds = playTimeSeconds;
  }

  renderGameOptions();

  if (isInitialSync) {
    hasReceivedInitialOptions = true;
    return;
  }

  const changed =
    prevRounds !== state.gameOptions.totalRounds ||
    prevSeconds !== state.gameOptions.playTimeSeconds;

  if (pendingOptionToast) {
    pendingOptionToast = false;
    showImpactToast(
      `게임 옵션 적용 완료! (${state.gameOptions.totalRounds}라운드 · ${state.gameOptions.playTimeSeconds}초)`,
      "success",
    );
  } else if (hasReceivedInitialOptions && changed) {
    showImpactToast(
      `방장이 게임 옵션을 변경했습니다! (${state.gameOptions.totalRounds}라운드 · ${state.gameOptions.playTimeSeconds}초)`,
      "warn",
    );
  }
  hasReceivedInitialOptions = true;
}

/**
 * 방장이 옵션 숫자를 바꿨을 때:
 * 1) 조건 범위(라운드 1~10, 시간 5~60)를 벗어나면 빨간 경고(data-invalid) + 알림창 표시
 * 2) 아직 '적용' 버튼을 누르지 않았으면 노란 강조(data-dirty="true") + '적용 필요!' 버튼 활성화
 */
export function syncOptionDirtyState(showToastOnInvalid = true) {
  const roundEl = document.getElementById("roundInput");
  const timeEl = document.getElementById("timeInput");
  const btnEl = document.getElementById("optionSubmitBtn");
  if (!roundEl || !timeEl) return;

  if (!state.isHost) {
    delete roundEl.dataset.dirty;
    delete timeEl.dataset.dirty;
    delete roundEl.dataset.invalid;
    delete timeEl.dataset.invalid;
    if (btnEl) {
      delete btnEl.dataset.dirty;
      btnEl.textContent = "적용";
    }
    return;
  }

  const rStr = roundEl.value.trim();
  const tStr = timeEl.value.trim();
  const rVal = Number(rStr);
  const tVal = Number(tStr);

  const roundInvalid =
    !rStr || !Number.isInteger(rVal) || rVal < MIN_ROUNDS || rVal > MAX_ROUNDS;
  const timeInvalid =
    !tStr || !Number.isInteger(tVal) || tVal < MIN_PLAY_SECONDS || tVal > MAX_PLAY_SECONDS;

  if (roundInvalid) {
    roundEl.dataset.invalid = "true";
    delete roundEl.dataset.dirty;
  } else {
    delete roundEl.dataset.invalid;
  }

  if (timeInvalid) {
    timeEl.dataset.invalid = "true";
    delete timeEl.dataset.dirty;
  } else {
    delete timeEl.dataset.invalid;
  }

  // 조건 밖 숫자를 입력했을 때 즉시 경고 토스트 출력 (도배 방지를 위해 0.6초 쿨타임)
  const now = Date.now();
  if (showToastOnInvalid && (roundInvalid || timeInvalid) && now - lastRangeAlertAt > 600) {
    lastRangeAlertAt = now;
    if (roundInvalid) {
      showImpactToast(`라운드는 ${MIN_ROUNDS}~${MAX_ROUNDS} 사이만 가능합니다!`, "error");
    } else if (timeInvalid) {
      showImpactToast(`제한 시간은 ${MIN_PLAY_SECONDS}~${MAX_PLAY_SECONDS}초 사이만 가능합니다!`, "error");
    }
  }

  const roundDirty = !roundInvalid && rVal !== state.gameOptions.totalRounds;
  const timeDirty = !timeInvalid && tVal !== state.gameOptions.playTimeSeconds;
  const anyDirty = roundDirty || timeDirty || roundInvalid || timeInvalid;

  if (roundDirty) roundEl.dataset.dirty = "true";
  else delete roundEl.dataset.dirty;

  if (timeDirty) timeEl.dataset.dirty = "true";
  else delete timeEl.dataset.dirty;

  if (btnEl) {
    if (anyDirty) {
      btnEl.dataset.dirty = "true";
      btnEl.textContent = "적용 필요!";
    } else {
      delete btnEl.dataset.dirty;
      btnEl.textContent = "적용";
    }
  }
}

/**
 * 게임을 시작할 수 없는 사유를 반환하는 함수 (시작 가능 상태면 null 반환)
 */
function getStartBlockReason() {
  if (!state.myUuid) return "서버 연결 대기 중";
  if (!state.isHost) return "방장만 게임을 시작할 수 있습니다";
  if (startLocked) return "시작 요청 처리 중";
  if (!state.webcamReady && !state.webcamFallbackMode) {
    return "내 웹캠이 준비되지 않았습니다";
  }
  return null;
}

// [방장 ➔ 서버] 게임 시작 요청 (GAME_START_REQ)
export function requestGameStart() {
  const reason = getStartBlockReason();
  if (reason) {
    showImpactToast(reason, "error");
    return false;
  }

  const roundEl = document.getElementById("roundInput");
  const timeEl = document.getElementById("timeInput");

  if (roundEl?.dataset.invalid === "true" || timeEl?.dataset.invalid === "true") {
    showImpactToast("옵션 값이 허용 범위를 벗어났습니다! 올바른 값으로 적용해주세요.", "error");
    return false;
  }

  if (roundEl?.dataset.dirty === "true" || timeEl?.dataset.dirty === "true") {
    showImpactToast(
      "변경한 옵션이 아직 적용되지 않았습니다! 먼저 [적용 필요!] 버튼을 눌러주세요.",
      "warn",
    );
    return false;
  }

  if (!sendMessage("GAME_START_REQ", {})) return false;

  startLocked = true;
  updateHostControls();
  setTimeout(() => {
    startLocked = false;
    updateHostControls();
  }, START_LOCK_MS);
  return true;
}

// 유저 목록 렌더링
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

    const nameSpan = document.createElement("span");
    nameSpan.className = "user-name";
    nameSpan.textContent = `${user.nickname || "이름 없음"}${hostBadge}${meBadge}${connBadge}`;

    li.append(nameSpan);

    // 게임 대기실(IN_LOBBY)에서는 점수를 숨기고, 게임 플레이 중(IN_GAME) 및 결과 화면에서만 점수 표시
    if (state.gameState !== "IN_LOBBY") {
      const score = state.totalScores[user.uuid] ?? user.score ?? 0;
      const scoreSpan = document.createElement("span");
      scoreSpan.className = "user-score";
      scoreSpan.textContent = `${formatScore(score)}점`;
      li.append(scoreSpan);
    }

    listEl.appendChild(li);
  });

  const countEl = document.getElementById("userCountBadge");
  if (countEl) {
    const connectedCount = state.users.filter((u) => u.isConnected !== false).length;
    countEl.textContent = `${connectedCount} / ${MAX_PLAYERS}명 접속 중`;
  }
}

// 옵션 입력칸을 현재 서버 적용 값으로 표시하고 미적용 강조 해제
export function renderGameOptions() {
  const roundEl = document.getElementById("roundInput");
  const timeEl = document.getElementById("timeInput");
  if (roundEl) roundEl.value = state.gameOptions.totalRounds;
  if (timeEl) timeEl.value = state.gameOptions.playTimeSeconds;
  syncOptionDirtyState(false);
}

// 방장 전용 컨트롤 활성화 상태 갱신
export function updateHostControls() {
  ["roundInput", "timeInput", "optionSubmitBtn"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.disabled = !state.isHost;
  });

  syncOptionDirtyState(false);

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

  const reason = getStartBlockReason();
  const startBtn = document.getElementById("gameStartBtn");
  const hintEl = document.getElementById("startHint");
  if (startBtn) startBtn.disabled = reason !== null;
  if (hintEl) {
    hintEl.textContent =
      hintNotice ?? reason ?? "모든 실험 준비가 완료되었습니다. 실험을 시작하세요!";
    hintEl.dataset.ready = hintNotice === null && reason === null ? "true" : "false";
  }
}
