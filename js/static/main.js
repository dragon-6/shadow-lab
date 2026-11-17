// ============================================================
// main.js - 진입점 / 서버 메시지 라우터
// 서버 메시지를 타입별로 각 모듈에 분기하고, UI 이벤트를 연결한다.
// ============================================================
import { state, setMyAuthInfo, clearMyAuthInfo, getSavedUuid, getSavedNickname } from "./core/state.js";
import {
  connectWebSocket,
  sendMessage,
  enableAutoReconnect,
  retryReconnectOnFail,
  resetReconnectRetries,
} from "./core/socket.js";
import {
  requestSetNickname,
  handleRoomUsersUpdate,
  requestUpdateGameOptions,
  handleGameOptionsUpdated,
  requestGameStart,
  renderRoomUsers,
  renderGameOptions,
  updateHostControls,
} from "./stages/lobby.js";
import { handleCheckWebcamReq } from "./media/webcam.js";
import { handleRoundStart, handleStartStreaming } from "./stages/game.js";
import { stopStreaming } from "./media/streaming.js";
import { handleMaskedStream, resetMaskedTiles } from "./media/masked.js";
import {
  handleFrameReceivedWait,
  handleRoundResult,
  cancelRoundEndAck,
} from "./stages/result.js";
import { handleGameOver, playAgain } from "./stages/gameover.js";
import { restoreFromReconnect } from "./core/restore.js";
import { showScreen } from "./stages/screens.js";

// UUID 저장 + 방장 컨트롤 갱신 (CONNECTED / RECONNECT_SUCCESS 공통)
function startSession(payload = {}, fallbackUuid = null) {
  // UUID가 없으면 이후 모든 통신이 불가능하므로 이전 값으로 보완, 그래도 없으면 중단
  const uuid =
    payload.myUuid ||
    payload.uuid ||
    payload.userUuid ||
    fallbackUuid ||
    state.myUuid ||
    getSavedUuid();

  if (!uuid) {
    console.error("서버 응답에 myUuid가 없습니다:", payload);
    return false;
  }

  resetReconnectRetries();
  enableAutoReconnect();
  const isHost = typeof payload.isHost === "boolean" ? payload.isHost : state.isHost;
  setMyAuthInfo(uuid, isHost);
  console.log(`UUID: ${state.myUuid}, 방장 여부: ${state.isHost}`);
  renderRoomUsers(); // ROOM_USERS_UPDATE가 CONNECTED보다 먼저 온 경우 "(나)" 표시 보정
  updateHostControls();
  return true;
}

// 서버 수신 메시지 타입별 분기
function handleServerMessage(data) {
  const { type, payload, senderUuid } = data;
  if (!type) return;

  switch (type) {
    // ---------- 1. 모이는 단계 ----------
    // 최초 입장 성공: UUID 발급 (기존에 쓰던 닉네임이 있으면 자동 설정)
    case "CONNECTED": {
      if (!payload) break;
      if (!startSession(payload, senderUuid)) break;
      const savedNick = getSavedNickname();
      if (savedNick) {
        const nickEl = document.getElementById("nicknameInput");
        if (nickEl) nickEl.value = savedNick;
        requestSetNickname(savedNick);
      }
      break;
    }

    // 방 안의 유저 목록 동기화 (유저 입장 / 닉네임 변경 / 타 유저 일시 연결 끊김·재접속·이탈 모두 포함)
    case "ROOM_USERS_UPDATE":
      handleRoomUsersUpdate(payload);
      break;

    // 방장이 바꾼 게임 옵션 동기화
    case "GAME_OPTIONS_UPDATED":
      handleGameOptionsUpdated(payload);
      break;

    // 웹캠 준비 확인 요청 -> CHECK_WEBCAM_RES 응답
    case "CHECK_WEBCAM_REQ":
      handleCheckWebcamReq().then(updateHostControls);
      break;

    // ---------- 3. 게임 단계 ----------
    // 3-1. 라운드 시작 및 주제 전달
    case "ROUND_START":
      handleRoundStart(payload);
      break;

    // 3-1-1. 구현 시작 -> SEND_FRAME 송신 시작
    case "START_STREAMING":
      handleStartStreaming(payload);
      break;

    // 3-2 ②. 마스킹된 화면 브로드캐스트
    case "BROADCAST_MASKED_STREAM":
      handleMaskedStream(payload);
      break;

    // 3-3 ①. 프레임 수신 완료, 결과 대기
    case "FRAME_RECEIVED_WAIT":
      handleFrameReceivedWait(payload);
      break;

    // 3-3 ②. 라운드 결과 -> 연출 후 ROUND_END_ACK 송신
    case "ROUND_RESULT":
      handleRoundResult(payload);
      break;

    // ---------- 4. 게임 종료 ----------
    case "GAME_OVER":
      handleGameOver(payload);
      break;

    // ---------- 5. 재접속 ----------
    // 재접속 성공: UUID 복구 + 방 정보 동기화 + 진행 중이던 게임 화면 복구
    case "RECONNECT_SUCCESS": {
      const safePayload = payload || {};
      if (!startSession(safePayload, senderUuid)) break; // UUID/방장 여부 복구
      if (safePayload.users) handleRoomUsersUpdate(safePayload); // 유저 목록 (isConnected 포함)
      handleGameOptionsUpdated(safePayload);             // totalRounds 등 옵션 반영
      restoreFromReconnect(safePayload);                 // 라운드/단계/점수 기준 화면 복구
      // 대기실이거나 스트리밍 외 단계에서도 웹캠 준비 상태 및 서버 CHECK_WEBCAM_RES 동기화
      handleCheckWebcamReq().then(updateHostControls);
      break;
    }

    // 재접속 실패(유예시간 초과 등): 일시적 타이밍 이슈면 재시도 후 실패 시 재입장하되 기존 닉네임 유지
    case "RECONNECT_FAIL": {
      if (retryReconnectOnFail()) break;
      console.warn(`재접속 실패 (${payload?.reason}) -> 재입장 (기존 닉네임 유지)`);
      const prevNick = getSavedNickname();
      clearMyAuthInfo(true); // 닉네임은 보존
      stopStreaming();
      cancelRoundEndAck();
      resetMaskedTiles();
      const nickEl = document.getElementById("nicknameInput");
      if (nickEl) nickEl.value = prevNick || "";
      showScreen("lobby");
      renderRoomUsers();   // 남아있던 이전 유저 목록 DOM 초기화
      renderGameOptions(); // 이전 방 옵션이 남지 않도록 기본값 표시
      updateHostControls();
      sendMessage("JOIN_REQ", {}, null); // 재입장 요청 (CONNECTED 수신 시 기존 닉네임 자동 등록됨)
      break;
    }

    default:
      break;
  }
}

// UI 이벤트 연결 (해당 ID의 요소가 HTML에 있을 때만 동작)
function initUI() {
  showScreen("lobby"); // 처음에는 대기실 화면

  // 닉네임 설정 (버튼 클릭 + Enter 키 지원)
  const nicknameBtn = document.getElementById("nicknameSubmitBtn");
  const nicknameInput = document.getElementById("nicknameInput");
  if (nicknameBtn && nicknameInput) {
    if (state.nickname && !nicknameInput.value) {
      nicknameInput.value = state.nickname;
    }
    const submitNickname = () => requestSetNickname(nicknameInput.value);
    nicknameBtn.addEventListener("click", submitNickname);
    nicknameInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.isComposing) { // 한글 조합 중 Enter(글자 확정)는 제외
        e.preventDefault();
        submitNickname();
      }
    });
  }

  // 게임 옵션 (방장): 규격상 "변경 즉시 전송"이므로 change 이벤트로 바로 보냄
  const optionBtn = document.getElementById("optionSubmitBtn");
  const roundInput = document.getElementById("roundInput");
  const timeInput = document.getElementById("timeInput");
  if (roundInput && timeInput) {
    renderGameOptions(); // 기본값(5라운드, 20초) 표시

    const submitOptions = () =>
      requestUpdateGameOptions(
        parseInt(roundInput.value, 10),
        parseInt(timeInput.value, 10)
      );
    roundInput.addEventListener("change", submitOptions);
    timeInput.addEventListener("change", submitOptions);
    optionBtn?.addEventListener("click", submitOptions); // 수동 재전송용
  }

  // 게임 시작 (방장)
  document.getElementById("gameStartBtn")?.addEventListener("click", () => {
    requestGameStart();
  });

  // 게임 종료 후 다시 하기
  document.getElementById("playAgainBtn")?.addEventListener("click", playAgain);

  // 웹캠이 중간에 끊기면 시작 버튼 등 컨트롤 상태 갱신
  document.addEventListener("webcam-lost", updateHostControls);

  // 컨트롤 활성화 상태 초기화
  updateHostControls();
}

// 모듈 스크립트는 DOM 파싱 후 실행되지만, 혹시 모를 경우를 대비해 준비 상태를 확인
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initUI, { once: true });
} else {
  initUI();
}

// 웹소켓 연결 시작 (UI 준비 후)
connectWebSocket(handleServerMessage);
