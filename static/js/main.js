// ============================================================
// main.js - 프론트엔드 진입점(Entry Point) 및 웹소켓 메시지 라우터
// ============================================================

import {
  state,
  setMyAuthInfo,
  clearMyAuthInfo,
  getSavedNickname,
} from "./core/state.js?v=8";
import {
  connectWebSocket,
  sendMessage,
  retryReconnectOnFail,
  disableAutoReconnect,
  resetReconnectRetries,
  updateConnectionBadge,
} from "./core/socket.js?v=8";
import { restoreFromReconnect } from "./core/restore.js?v=8";
import { handleCheckWebcamReq, initWebcam } from "./media/webcam.js?v=8";
import { stopStreaming } from "./media/streaming.js?v=8";
import { handleMaskedStream, resetMaskedTiles } from "./media/masked.js?v=8";
import { showScreen } from "./stages/screens.js?v=8";
import {
  requestSetNickname,
  handleRoomUsersUpdate,
  requestUpdateGameOptions,
  handleGameOptionsUpdated,
  requestGameStart,
  renderRoomUsers,
  renderGameOptions,
  updateHostControls,
  showHintNotice,
  syncOptionDirtyState,
} from "./stages/lobby.js?v=8";
import { handleRoundStart, handleStartStreaming } from "./stages/game.js?v=8";
import {
  handleFrameReceivedWait,
  handleRoundResult,
  cancelRoundEndAck,
} from "./stages/result.js?v=8";
import { handleGameOver, playAgain } from "./stages/gameover.js?v=8";

let rejoinPending = false;
let lastDeniedLogAt = 0;

function startSession(payload) {
  if (!payload) return;

  const uuid = payload.myUuid || payload.uuid;
  const isHost =
    typeof payload.isHost === "boolean" ? payload.isHost : state.isHost;

  setMyAuthInfo(uuid, isHost);
  console.log(`UUID: ${state.myUuid}, 방장 여부: ${state.isHost}`);
  updateHostControls();
}

function handleServerMessage(data) {
  const { type, payload } = data;
  const safePayload = payload || {};

  switch (type) {
    case "CONNECTED": {
      const wasRejoin = rejoinPending;
      rejoinPending = false;
      resetReconnectRetries();
      startSession(safePayload);

      // 세션 만료 후 자동 재입장한 경우에만 기존 닉네임을 복원하고,
      // 일반 접속 시에는 사용자가 직접 확인 버튼을 눌러 검증받도록 입력칸에만 채워둠
      const savedNick = state.nickname || getSavedNickname();
      if (savedNick) {
        const nickEl = document.getElementById("nicknameInput");
        if (nickEl && !nickEl.value) nickEl.value = savedNick;
        if (wasRejoin) {
          requestSetNickname(savedNick);
        }
      }
      break;
    }

    case "ROOM_USERS_UPDATE":
    case "USER_DISCONNECTED":
    case "USER_RECONNECTED":
      handleRoomUsersUpdate(safePayload);
      break;

    case "GAME_OPTIONS_UPDATED":
      handleGameOptionsUpdated(safePayload);
      break;

    case "CHECK_WEBCAM_REQ":
      handleCheckWebcamReq().then(updateHostControls);
      break;

    case "ROUND_START":
      handleRoundStart(safePayload);
      break;

    case "START_STREAMING":
      handleStartStreaming(safePayload);
      break;

    case "BROADCAST_MASKED_STREAM":
      handleMaskedStream(safePayload);
      break;

    case "FRAME_RECEIVED_WAIT":
      handleFrameReceivedWait(safePayload);
      break;

    case "ROUND_RESULT":
      handleRoundResult(safePayload);
      break;

    case "GAME_OVER":
      handleGameOver(safePayload);
      break;

    case "RECONNECT_SUCCESS":
      rejoinPending = false;
      resetReconnectRetries();
      startSession(safePayload);
      handleRoomUsersUpdate(safePayload);
      handleGameOptionsUpdated(safePayload, true);
      initWebcam().then((ready) => {
        state.webcamReady = ready;
        updateHostControls();
        restoreFromReconnect(safePayload);
      });
      break;

    case "ERROR": {
      const errorCode =
        safePayload.code || safePayload.errorCode || safePayload.reason;
      const serverMsg = safePayload.message || "";

      switch (errorCode) {
        case "EXPIRED_SESSION":
        case "PREV_UUID_IS_NONE":
        case "UNAUTHORIZED": {
          if (rejoinPending) break;
          if (retryReconnectOnFail()) break;

          console.warn(
            `[에러] 세션 만료/재접속 실패 (${errorCode}) -> 기존 닉네임 유지 후 신규 입장`,
          );

          resetReconnectRetries();
          rejoinPending = true;

          const prevNick = getSavedNickname();
          clearMyAuthInfo(true);

          stopStreaming();
          cancelRoundEndAck();
          resetMaskedTiles();

          const nickEl = document.getElementById("nicknameInput");
          if (nickEl) nickEl.value = prevNick || "";
          showScreen("lobby");
          renderRoomUsers();
          renderGameOptions();
          updateHostControls();

          sendMessage("JOIN_REQ", {}, null);
          break;
        }

        case "ROOM_FULL":
        case "GAME_IN_PROGRESS": {
          const defaultMsg =
            errorCode === "ROOM_FULL"
              ? "방 정원(4명)이 초과되어 입장할 수 없습니다."
              : "이미 게임이 진행 중이어서 입장할 수 없습니다.";
          const displayMsg = serverMsg || defaultMsg;

          rejoinPending = false;
          const badgeText =
            errorCode === "ROOM_FULL" ? "방 정원 초과" : "게임 진행 중";

          disableAutoReconnect(badgeText);
          updateConnectionBadge(badgeText, "offline");
          showHintNotice(displayMsg, 0, "error");
          break;
        }

        case "NOT_READY":
        case "NOT_PERMISSION":
        case "DENIED": {
          const defaultMsg =
            errorCode === "NOT_READY"
              ? "아직 모든 플레이어가 준비되지 않았거나 인원이 부족합니다 (최소 2명)."
              : errorCode === "NOT_PERMISSION"
                ? "방장만 게임 옵션을 변경하거나 시작할 수 있습니다."
                : "입력한 값이 조건에 맞지 않거나 현재 단계에서 수행할 수 없는 요청입니다.";
          const displayMsg = serverMsg || defaultMsg;

          const now = Date.now();
          if (now - lastDeniedLogAt > 1000) {
            console.warn(`[요청 거부] ${errorCode}: ${displayMsg}`);
            lastDeniedLogAt = now;
          }

          if (state.gameState !== "IN_LOBBY") break;

          renderGameOptions();
          showHintNotice(displayMsg, 4000, "error");
          break;
        }

        case "INVALID_FORMAT":
        case "UNKNOWN_TYPE":
        default:
          console.error(
            `[서버 에러 수신] 코드: ${errorCode || "UNKNOWN"}`,
            safePayload,
          );
          if (state.gameState === "IN_LOBBY") {
            showHintNotice(
              serverMsg || `요청 처리 중 오류가 발생했습니다 (${errorCode || "ERROR"})`,
              4000,
              "error",
            );
          }
          break;
      }
      break;
    }

    case "PONG":
      break;

    default:
      console.log("미정의 메시지 타입 수신:", type, safePayload);
      break;
  }
}

connectWebSocket(handleServerMessage);
document.addEventListener("webcam-lost", updateHostControls);

document.addEventListener("DOMContentLoaded", () => {
  showScreen("lobby");

  // [닉네임 설정] 확인 버튼 클릭 또는 엔터키 입력 시에만 검증 후 SET_NICKNAME 전송
  const nicknameBtn = document.getElementById("nicknameSubmitBtn");
  const nicknameInput = document.getElementById("nicknameInput");
  if (nicknameBtn && nicknameInput) {
    const submitNick = () => requestSetNickname(nicknameInput.value);
    nicknameBtn.addEventListener("click", submitNick);
    nicknameInput.addEventListener("input", () => {
      delete nicknameInput.dataset.invalid;
    });
    nicknameInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submitNick();
    });
  }

  // [방장 게임 옵션 설정]
  // 숫자를 바꿀 때는 절대 서버로 자동 전송하지 않고 미적용/범위초과 강조만 수행!
  // 오직 '적용' 버튼(#optionSubmitBtn)을 클릭했을 때만 검증 후 UPDATE_GAME_OPTIONS 전송
  const optionBtn = document.getElementById("optionSubmitBtn");
  const roundInput = document.getElementById("roundInput");
  const timeInput = document.getElementById("timeInput");
  if (roundInput && timeInput) {
    renderGameOptions();
    const submitOptions = () =>
      requestUpdateGameOptions(roundInput.value, timeInput.value);

    roundInput.addEventListener("input", () => syncOptionDirtyState(true));
    timeInput.addEventListener("input", () => syncOptionDirtyState(true));
    optionBtn?.addEventListener("click", submitOptions);
  }

  // [방장 게임 시작]
  const startBtn = document.getElementById("gameStartBtn");
  if (startBtn) {
    startBtn.addEventListener("click", () => {
      requestGameStart();
    });
  }

  // [게임 종료 화면]
  document.getElementById("playAgainBtn")?.addEventListener("click", playAgain);

  updateHostControls();
});
