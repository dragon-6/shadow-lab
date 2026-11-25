// ============================================================
// restore.js - 재접속 성공(RECONNECT_SUCCESS) 시 진행 중이던 게임 상태/화면 복구
// ============================================================
import { state } from "./state.js";
import { showScreen, setText } from "../stages/screens.js";
import { DEFAULT_WIDTH, DEFAULT_HEIGHT } from "../media/webcam.js";
import { beginStreaming, stopStreaming, startCountdownUI, DEFAULT_FPS } from "../media/streaming.js";
import { syncMaskedTiles } from "../media/masked.js";
import { renderRoundInfo, PREPARE_COUNTDOWN_SEC } from "../stages/game.js";
import { showRoundResult, cancelRoundEndAck } from "../stages/result.js";
import { restoreGameOver } from "../stages/gameover.js";
import { renderRoomUsers } from "../stages/lobby.js";

// 서버에서 전달하는 게임 상태 문자열 정규화
function normalizeGameState(rawState, currentRound) {
  const s = String(rawState || "").toUpperCase();
  if (s === "IN_LOBBY" || s === "LOBBY" || s === "WAITING_ROOM") return "IN_LOBBY";
  if (s === "GAME_OVER" || s === "GAMEOVER" || s === "ENDED" || s === "FINISHED") return "GAME_OVER";
  if (
    s === "IN_GAME" ||
    s === "PLAYING" ||
    s === "GAME" ||
    s === "IN_PROGRESS" ||
    s === "ROUND_START" ||
    s === "TOPIC_SHOW" ||
    s === "STREAMING" ||
    s === "RESULT"
  ) {
    return "IN_GAME";
  }
  // gameState 필드가 생략되었더라도 currentRound가 1 이상이면 인게임으로 판단
  if (Number.isInteger(currentRound) && currentRound >= 1) return "IN_GAME";
  return "IN_LOBBY";
}

// 서버에서 전달하는 라운드 세부 단계(roundPhase) 정규화
// 백엔드가 roundPhase를 보내지 않는 경우 remainingSeconds 유무로 단계 자동 추론
function normalizeRoundPhase(rawPhase, rawGameState, remain) {
  const p = String(rawPhase || rawGameState || "").toUpperCase();
  if (p === "RESULT" || p === "ROUND_RESULT" || p === "SCORING") return "RESULT";
  if (p === "TOPIC_SHOW" || p === "PREPARE" || p === "READY" || p === "ROUND_START") return "TOPIC_SHOW";
  if (p === "STREAMING" || p === "PLAYING" || p === "RECORDING") return "STREAMING";
  // roundPhase가 명시되지 않았을 때 남은 시간(remainingSeconds)이 있으면 스트리밍 단계로 복구
  if (!rawPhase && remain > 0) return "STREAMING";
  if (p === "WAITING" || p === "FRAME_RECEIVED_WAIT") return "WAITING";
  return remain > 0 ? "STREAMING" : "WAITING";
}

// payload: RECONNECT_SUCCESS (유저 목록/옵션은 main.js에서 먼저 반영됨)
export function restoreFromReconnect(payload) {
  if (!payload) return;

  const rawGameState = payload.gameState ?? payload.currentGameState ?? payload.roomState ?? payload.state;
  const rawRoundPhase = payload.roundPhase ?? payload.phase ?? payload.currentPhase;
  const currentRound = payload.currentRound ?? payload.round;
  const totalRounds = payload.totalRounds ?? payload.maxRounds ?? payload.gameOptions?.totalRounds;
  const topic = payload.topic ?? payload.currentTopic ?? payload.word;
  const remainingSeconds =
    payload.remainingSeconds ?? payload.remainingTime ?? payload.leftSeconds ?? payload.playTimeSeconds;
  const accumulatedScores =
    payload.accumulatedScores ?? payload.totalScores ?? payload.scores ?? payload.currentScores;

  // 진행 중이던 타이머 정리 후 서버 기준 상태로 덮어쓰기
  stopStreaming();
  cancelRoundEndAck();

  const remain = Math.ceil(Number(remainingSeconds) || 0);

  if (Number.isInteger(currentRound)) state.currentRound = currentRound;
  if (Number.isInteger(totalRounds)) state.gameOptions.totalRounds = totalRounds;
  if (topic !== undefined && topic !== null) state.topic = String(topic);
  state.roundScores = payload.roundScores && typeof payload.roundScores === "object"
    ? { ...payload.roundScores }
    : {};

  state.gameState = normalizeGameState(rawGameState, state.currentRound);
  state.roundPhase = normalizeRoundPhase(rawRoundPhase, rawGameState, remain);

  if (accumulatedScores && typeof accumulatedScores === "object") {
    state.totalScores = { ...accumulatedScores };
    // 결과 단계면 이번 라운드까지 누적에 포함된 것으로 간주 (이중 합산 방지)
    state.lastScoredRound =
      state.roundPhase === "RESULT" ? state.currentRound : Math.max(state.currentRound - 1, 0);
    renderRoomUsers(); // 재접속 시 복구된 누적 점수를 플레이어 목록에 즉시 반영
  }

  console.log(
    `[재접속 복구] gameState=${state.gameState}, roundPhase=${state.roundPhase}, round=${state.currentRound}/${state.gameOptions.totalRounds}, remain=${remain}s`
  );

  // 대기실 / 이미 끝난 게임
  if (state.gameState === "IN_LOBBY") {
    showScreen("lobby");
    return;
  }
  if (state.gameState === "GAME_OVER") {
    restoreGameOver(state.totalScores);
    return;
  }

  // 진행 중인 게임: 라운드 정보 + 영상 타일 복구
  syncMaskedTiles();
  renderRoundInfo();

  // 결과 단계: 결과 화면 + Ack 재전송 (Ack를 못 보냈을 수 있음)
  if (state.roundPhase === "RESULT") {
    showRoundResult(state.currentRound || 1);
    return;
  }

  showScreen("game");
  setText("statusMessage", "");

  // 주제 확인 단계(TOPIC_SHOW) 복구
  if (state.roundPhase === "TOPIC_SHOW") {
    setText("statusMessage", "제시어를 확인하고 그림자 포즈를 준비하세요!");
    const prepSec = remain > 0 ? Math.min(remain, PREPARE_COUNTDOWN_SEC) : PREPARE_COUNTDOWN_SEC;
    startCountdownUI(prepSec, "준비");
    return;
  }

  // 구현 단계(STREAMING): 남은 시간만큼 카운트다운 표시 및 영상 송신 재개
  if (state.roundPhase === "STREAMING" && remain > 0) {
    setText("statusMessage", "실시간 그림자 마스킹 측정 중...");
    beginStreaming({
      round: state.currentRound || 1,
      playTimeSeconds: remain,
      targetFps: posIntOrDefault(payload.targetFps, DEFAULT_FPS),
      width: posIntOrDefault(payload.width, DEFAULT_WIDTH),
      height: posIntOrDefault(payload.height, DEFAULT_HEIGHT),
    });
  } else {
    setText("statusMessage", "영상 수신 완료. OpenCV 분석 진행 중입니다.");
  }
}

function posIntOrDefault(v, fallback) {
  return Number.isInteger(v) && v > 0 ? v : fallback;
}
