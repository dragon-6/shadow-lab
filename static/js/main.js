// ============================================================
// main.js - 프론트엔드 진입점(Entry Point) 및 웹소켓 메시지 라우터
// ------------------------------------------------------------
// [역할]
// 1. 서버로부터 수신한 웹소켓 메시지(type)를 분석하여 각 담당 모듈로 전달
// 2. 백엔드 통합 에러(ERROR) 코드별 예외 처리 및 재접속/재입장 제어
// 3. 브라우저 초기 로드 시 버튼 클릭 등 UI 이벤트 리스너 등록
// ============================================================

import {
  state,
  setMyAuthInfo,
  clearMyAuthInfo,
  getSavedNickname,
} from "./core/state.js";
import {
  connectWebSocket,
  sendMessage,
  retryReconnectOnFail,
  disableAutoReconnect,
  resetReconnectRetries,
  updateConnectionBadge,
} from "./core/socket.js";
import { restoreFromReconnect } from "./core/restore.js";
import { handleCheckWebcamReq, initWebcam } from "./media/webcam.js";
import { stopStreaming } from "./media/streaming.js";
import { handleMaskedStream, resetMaskedTiles } from "./media/masked.js";
import { showScreen } from "./stages/screens.js";
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
} from "./stages/lobby.js";
import { handleRoundStart, handleStartStreaming } from "./stages/game.js";
import {
  handleFrameReceivedWait,
  handleRoundResult,
  cancelRoundEndAck,
} from "./stages/result.js";
import { handleGameOver, playAgain } from "./stages/gameover.js";

let rejoinPending = false; // 신규 입장(JOIN_REQ) 응답 대기 중 (중복 JOIN_REQ로 유령 유저가 생기는 것 방지)
let lastDeniedLogAt = 0;   // DENIED 로그 도배 방지 (프레임 송신 중 연속 수신 대비)

/**
 * [세션 초기화 헬퍼 함수]
 * 최초 입장(CONNECTED) 또는 재접속 성공(RECONNECT_SUCCESS) 시 호출됩니다.
 * 서버가 발급해준 내 UUID와 방장 권한(isHost)을 저장하고 UI를 갱신합니다.
 */
function startSession(payload) {
  if (!payload) return;

  // 백엔드 필드명이 myUuid 또는 uuid 중 어떤 것으로 오더라도 호환 처리
  const uuid = payload.myUuid || payload.uuid;
  const isHost =
    typeof payload.isHost === "boolean" ? payload.isHost : state.isHost;

  // 전역 상태(state) 및 sessionStorage에 내 인증 정보 저장
  setMyAuthInfo(uuid, isHost);
  console.log(`UUID: ${state.myUuid}, 방장 여부: ${state.isHost}`);

  // 방장 여부에 따라 옵션 입력칸 및 게임 시작 버튼 활성화 상태 갱신
  updateHostControls();
}

/**
 * [서버 수신 메시지 중앙 라우터]
 * socket.js에서 웹소켓 메시지를 받을 때마다 이 함수가 호출됩니다.
 * data 형식: { type: "메시지타입", senderUuid: "SERVER", payload: { ... } }
 */
function handleServerMessage(data) {
  const { type, payload } = data;
  const safePayload = payload || {};

  switch (type) {
    // ==========================================================
    // 1. 모이는 단계 (대기실 입장 및 준비)
    // ==========================================================

    // ①-2. 최초 입장 완료: 서버로부터 새 UUID와 방장 여부를 발급받음
    case "CONNECTED": {
      rejoinPending = false;
      resetReconnectRetries();
      startSession(safePayload);

      // 만약 재입장 전에 쓰던 닉네임이 남아있다면 서버에 자동으로 닉네임 등록 요청
      const savedNick = state.nickname || getSavedNickname();
      if (savedNick) {
        const nickEl = document.getElementById("nicknameInput");
        if (nickEl && !nickEl.value) nickEl.value = savedNick;
        requestSetNickname(savedNick);
      }
      break;
    }

    // ③ 방 유저 목록 동기화 (신규 입장, 닉네임 변경, 타 유저 연결 끊김/복구 시)
    case "ROOM_USERS_UPDATE":
    case "USER_DISCONNECTED":
    case "USER_RECONNECTED":
      handleRoomUsersUpdate(safePayload);
      break;

    // 방장이 변경한 게임 옵션(라운드 수, 제한 시간)을 전체 유저 화면에 동기화
    case "GAME_OPTIONS_UPDATED":
      handleGameOptionsUpdated(safePayload);
      break;

    // ④ 서버의 웹캠 준비 확인 요청 ➔ 웹캠 권한 획득 후 ⑤ CHECK_WEBCAM_RES 자동 응답
    case "CHECK_WEBCAM_REQ":
      handleCheckWebcamReq().then(updateHostControls);
      break;

    // ==========================================================
    // 2 & 3. 게임 진행 단계 (인게임 루프)
    // ==========================================================

    // 3-1. 라운드 시작: 제시어(topic)와 현재 라운드 표시 및 카운트다운 시작
    case "ROUND_START":
      handleRoundStart(safePayload);
      break;

    // 3-1-1 & 3-2 ① 구현 시작: 20초간 10fps(320x240)로 웹캠 프레임(SEND_FRAME) 전송 시작
    case "START_STREAMING":
      handleStartStreaming(safePayload);
      break;

    // 3-2 ② 서버가 OpenCV로 마스킹한 참가자들의 흑백 실루엣 영상을 실시간 렌더링
    case "BROADCAST_MASKED_STREAM":
      handleMaskedStream(safePayload);
      break;

    // 3-3 ① 20초 프레임 전송 완료: 송신을 중단하고 "OpenCV 분석 중" 대기 문구 표시
    case "FRAME_RECEIVED_WAIT":
      handleFrameReceivedWait(safePayload);
      break;

    // 3-3 ② & 3-4. 라운드 점수(0~5점) 발표 ➔ 4초 연출 후 자동으로 ROUND_END_ACK 응답
    case "ROUND_RESULT":
      handleRoundResult(safePayload);
      break;

    // ==========================================================
    // 4. 게임 종료 단계
    // ==========================================================

    // 모든 라운드 종료: 최종 순위 및 누적 점수 화면 출력
    case "GAME_OVER":
      handleGameOver(safePayload);
      break;

    // ==========================================================
    // 5. 예외 처리 (재접속 복구 및 통합 ERROR 처리)
    // ==========================================================

    // 10초 유예 시간 내 재접속 성공: 끊기기 직전의 게임 화면/점수/타이머 상태로 즉시 복구
    case "RECONNECT_SUCCESS":
      rejoinPending = false;
      resetReconnectRetries(); // 재시도 횟수 초기화 (다음 끊김 때도 재시도 2회 보장)
      startSession(safePayload);
      handleRoomUsersUpdate(safePayload);
      handleGameOptionsUpdated(safePayload);
      // 새로고침 등으로 꺼진 웹캠을 다시 켠 뒤 인게임 스트리밍/화면 복구 진행
      initWebcam().then((ready) => {
        state.webcamReady = ready;
        updateHostControls();
        restoreFromReconnect(safePayload);
      });
      break;

    // [통합 에러 처리] 기존 RECONNECT_FAIL 폐지 후 모든 서버 에러를 ERROR 타입으로 수신
    case "ERROR": {
      // 서버가 code, errorCode, reason 중 어떤 키로 에러 코드를 보내든 안전하게 추출
      const errorCode =
        safePayload.code || safePayload.errorCode || safePayload.reason;
      const serverMsg = safePayload.message || "";

      switch (errorCode) {
        // ------------------------------------------------------
        // [에러 그룹 1] 재접속 실패 및 세션/인증 만료
        // - EXPIRED_SESSION   : 10초 유예시간 초과 또는 존재하지 않는 UUID
        // - PREV_UUID_IS_NONE : 재접속 요청(RECONNECT_REQ) 시 prevUuid 누락
        // - UNAUTHORIZED      : 등록되지 않았거나 만료된 senderUuid로 요청
        // ------------------------------------------------------
        case "EXPIRED_SESSION":
        case "PREV_UUID_IS_NONE":
        case "UNAUTHORIZED": {
          // 이미 신규 입장 요청을 보낸 상태면 중복 에러(프레임 연속 전송분 등)는 무시
          if (rejoinPending) break;

          // 새로고침(F5) 직후 서버가 이전 소켓 종료를 아직 처리 중일 수 있으므로 최대 2회 재시도
          if (retryReconnectOnFail()) break;

          console.warn(
            `[에러] 세션 만료/재접속 실패 (${errorCode}) -> 기존 닉네임 유지 후 신규 입장`,
          );

          // 예약된 RECONNECT_REQ 재시도가 뒤늦게 만료된 UUID를 되살리지 못하게 정리
          resetReconnectRetries();
          rejoinPending = true;

          // 닉네임은 보존하면서 만료된 UUID 정보만 초기화
          const prevNick = getSavedNickname();
          clearMyAuthInfo(true);

          // 진행 중이던 스트리밍, 타이머, 이전 유저 화면 타일 모두 정리
          stopStreaming();
          cancelRoundEndAck();
          resetMaskedTiles();

          // 대기실 화면으로 전환 및 입력창에 기존 닉네임 복원
          const nickEl = document.getElementById("nicknameInput");
          if (nickEl) nickEl.value = prevNick || "";
          showScreen("lobby");
          renderRoomUsers();
          renderGameOptions();
          updateHostControls();

          // 완전 신규 입장 요청(JOIN_REQ) 전송 -> 이후 CONNECTED 수신 시 자동 닉네임 등록됨
          sendMessage("JOIN_REQ", {}, null);
          break;
        }

        // ------------------------------------------------------
        // [에러 그룹 2] 방 입장 불가 (정원 초과 / 게임 이미 진행 중)
        // - ROOM_FULL        : 방 정원(4명) 초과
        // - GAME_IN_PROGRESS : 이미 게임이 진행 중일 때 입장 시도
        // ------------------------------------------------------
        case "ROOM_FULL":
        case "GAME_IN_PROGRESS": {
          const defaultMsg =
            errorCode === "ROOM_FULL"
              ? "방 정원(4명)이 초과되어 입장할 수 없습니다."
              : "이미 게임이 진행 중이어서 입장할 수 없습니다.";
          const displayMsg = serverMsg || defaultMsg;

          console.warn(`[입장 불가] ${errorCode}: ${displayMsg}`);

          rejoinPending = false;
          const badgeText =
            errorCode === "ROOM_FULL" ? "방 정원 초과" : "게임 진행 중";

          // 입장이 거부되었으므로 소켓이 끊겨도 무한 재접속하지 않도록 자동 재연결 중단
          // (배지 문구는 서버가 소켓을 닫아도 유지)
          disableAutoReconnect(badgeText);
          updateConnectionBadge(badgeText, "offline");

          // 대기실 하단 힌트 영역에 입장 불가 사유를 계속 표시 (0 = 자동으로 사라지지 않음)
          showHintNotice(displayMsg, 0);
          break;
        }

        // ------------------------------------------------------
        // [에러 그룹 3] 대기실 조작 및 권한/단계 거부
        // - NOT_READY      : 인원 부족(2인 미만) 또는 미준비 유저 존재 시 시작 시도
        // - NOT_PERMISSION : 방장이 아닌 유저가 옵션 변경 또는 게임 시작 시도
        // - DENIED         : 비정상적인 입력값 또는 현재 게임 진행 단계에 맞지 않는 요청
        // ------------------------------------------------------
        case "NOT_READY":
        case "NOT_PERMISSION":
        case "DENIED": {
          const defaultMsg =
            errorCode === "NOT_READY"
              ? "아직 모든 플레이어가 준비되지 않았거나 인원이 부족합니다 (최소 2명)."
              : errorCode === "NOT_PERMISSION"
                ? "방장만 게임 옵션을 변경하거나 시작할 수 있습니다."
                : "현재 단계에서 수행할 수 없는 요청이거나 잘못된 입력값입니다.";
          const displayMsg = serverMsg || defaultMsg;

          // 게임 중 SEND_FRAME 등에 DENIED가 연달아 올 수 있어 로그는 1초에 1번만
          const now = Date.now();
          if (now - lastDeniedLogAt > 1000) {
            console.warn(`[요청 거부] ${errorCode}: ${displayMsg}`);
            lastDeniedLogAt = now;
          }

          // 대기실이 아닐 때(인게임 등)는 대기실 UI를 건드리지 않음
          if (state.gameState !== "IN_LOBBY") break;

          // 잘못 변경된 UI 입력값을 서버 기준 최신 옵션 및 권한 상태로 되돌림
          renderGameOptions();

          // 대기실 안내 문구에 거부 사유를 4초간 표시 (updateHostControls가 바로 덮어쓰지 않음)
          showHintNotice(displayMsg);
          break;
        }

        // ------------------------------------------------------
        // [에러 그룹 4] 통신 규격 및 메시지 형식 오류 (디버깅용)
        // - INVALID_FORMAT : 잘못된 JSON 구조 또는 필수 필드 형식 오류
        // - UNKNOWN_TYPE   : 서버에 정의되지 않은 메시지 type 전송
        // ------------------------------------------------------
        case "INVALID_FORMAT":
        case "UNKNOWN_TYPE":
        default:
          console.error(
            `[서버 에러 수신] 코드: ${errorCode || "UNKNOWN"}`,
            safePayload,
          );
          break;
      }
      break;
    }

    // 5-② 서버 하트비트 응답 (연결 유지 확인용이므로 별도 동작 없음)
    case "PONG":
      break;

    default:
      console.log("미정의 메시지 타입 수신:", type, safePayload);
      break;
  }
}

// ============================================================
// 웹소켓 연결 시작 및 브라우저 이벤트 등록
// ============================================================

// 1. 페이지 로드 즉시 웹소켓 서버 연결 시작
connectWebSocket(handleServerMessage);

// 2. 웹캠이 뽑히거나 다른 앱에 점유되면 시작 버튼 등 상태 갱신 (webcam.js가 발행하는 이벤트)
// (탭 닫기/새로고침 시 UUID 백업은 socket.js의 pagehide 핸들러가 이미 처리)
document.addEventListener("webcam-lost", updateHostControls);

// 3. HTML DOM 요소가 모두 로드된 후 버튼/입력창 이벤트 연결
document.addEventListener("DOMContentLoaded", () => {
  // 첫 화면은 대기실(lobby)로 표시
  showScreen("lobby");

  // [닉네임 설정] 확인 버튼 클릭 또는 엔터키 입력 시 SET_NICKNAME 전송
  const nicknameBtn = document.getElementById("nicknameSubmitBtn");
  const nicknameInput = document.getElementById("nicknameInput");
  if (nicknameBtn && nicknameInput) {
    const submitNick = () => requestSetNickname(nicknameInput.value);
    nicknameBtn.addEventListener("click", submitNick);
    nicknameInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submitNick();
    });
  }

  // [방장 게임 옵션 설정] 라운드 수 / 제한시간 값 변경 즉시 UPDATE_GAME_OPTIONS 전송
  const optionBtn = document.getElementById("optionSubmitBtn");
  const roundInput = document.getElementById("roundInput");
  const timeInput = document.getElementById("timeInput");
  if (roundInput && timeInput) {
    renderGameOptions(); // 초기 기본값(5라운드, 20초) 표시
    const submitOptions = () =>
      requestUpdateGameOptions(
        parseInt(roundInput.value, 10),
        parseInt(timeInput.value, 10),
      );
    roundInput.addEventListener("change", submitOptions);
    timeInput.addEventListener("change", submitOptions);
    optionBtn?.addEventListener("click", submitOptions);
  }

  // [방장 게임 시작] 시작 버튼 클릭 시 GAME_START_REQ 전송
  const startBtn = document.getElementById("gameStartBtn");
  if (startBtn) {
    startBtn.addEventListener("click", () => {
      requestGameStart();
    });
  }

  // [게임 종료 화면] '대기실로 돌아가기' 버튼 클릭 시 초기화 후 재입장
  document.getElementById("playAgainBtn")?.addEventListener("click", playAgain);

  // 초기 방장 컨트롤 UI 비활성화/활성화 상태 반영
  updateHostControls();
});