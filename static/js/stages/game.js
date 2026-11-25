// ============================================================
// game.js - 3-1 라운드 시작 / 구현 시작 (ROUND_START, START_STREAMING)
// ============================================================
import { state } from "../core/state.js?v=8";
import { showScreen, setText } from "./screens.js?v=8";
import { DEFAULT_WIDTH, DEFAULT_HEIGHT } from "../media/webcam.js?v=8";
import {
  beginStreaming,
  stopStreaming,
  startCountdownUI,
  DEFAULT_PLAY_SECONDS,
  DEFAULT_FPS,
} from "../media/streaming.js?v=8";
import { resetMaskedTiles, syncMaskedTiles, setTopicFrameImage } from "../media/masked.js?v=8";
import { cancelRoundEndAck } from "./result.js?v=8";
import { renderRoomUsers } from "./lobby.js?v=8";

export const PREPARE_COUNTDOWN_SEC = 3; // 준비 카운트다운 (UI 표시용, 실제 시작은 START_STREAMING 기준)

// 양의 정수면 그대로, 아니면 기본값
const posInt = (v, fallback) => (Number.isInteger(v) && v > 0 ? v : fallback);

// 3-1. [서버 ➔ 전체] 라운드 시작 및 주제 전달 (ROUND_START)
// payload: { currentRound, totalRounds, topic }
export function handleRoundStart(payload) {
  if (!payload) return;

  // 이전 라운드의 타이머/결과 Ack/영상 정리
  stopStreaming();
  cancelRoundEndAck();

  const { currentRound, totalRounds, topic } = payload;
  if (currentRound === 1) {
    // 새 게임의 첫 라운드 시작 시 이전 점수 초기화
    state.totalScores = {};
    state.lastScoredRound = 0;
  }

  state.gameState = "IN_GAME";
  state.roundPhase = "TOPIC_SHOW";
  if (Number.isInteger(currentRound)) state.currentRound = currentRound;
  if (Number.isInteger(totalRounds)) state.gameOptions.totalRounds = totalRounds;
  state.topic = topic ?? "";
  state.topicFrameImageBase64 = null;
  state.roundScores = {};
  renderRoomUsers(); // 게임 시작(IN_GAME) 전환 직후 플레이어 목록에 0점부터 실시간 점수 표시

  console.log(
    `[라운드 시작] ${state.currentRound}/${state.gameOptions.totalRounds} - 제시어: ${state.topic}`
  );

  showScreen("game");
  setText("statusMessage", "제시어를 확인하고 그림자 포즈를 준비하세요!");
  resetMaskedTiles();
  renderRoundInfo();
  startCountdownUI(PREPARE_COUNTDOWN_SEC, "준비");
}

// 3-1-1. [서버 ➔ 전체] 구현 시작 및 영상 전송 사양 전달 (START_STREAMING)
// payload: { currentRound, playTimeSeconds, targetFps, width, height, topicFrameImageBase64 }
// 수신 즉시 SEND_FRAME 송신 시작
export function handleStartStreaming(payload) {
  if (!payload) return;

  // 서버가 준 사양 사용 (값이 비정상이면 기본값)
  const round = Number.isInteger(payload.currentRound)
    ? payload.currentRound
    : state.currentRound;
  const playTimeSeconds = posInt(
    payload.playTimeSeconds,
    state.gameOptions.playTimeSeconds || DEFAULT_PLAY_SECONDS
  );
  const targetFps = posInt(payload.targetFps, DEFAULT_FPS);
  const width = posInt(payload.width, DEFAULT_WIDTH);
  const height = posInt(payload.height, DEFAULT_HEIGHT);

  state.gameState = "IN_GAME";
  state.roundPhase = "STREAMING";
  state.currentRound = round;
  state.gameOptions.playTimeSeconds = playTimeSeconds;

  showScreen("game");
  setText("statusMessage", "실시간 그림자 마스킹 측정 중...");
  setTopicFrameImage(payload.topicFrameImageBase64 ?? null);
  syncMaskedTiles();
  renderRoundInfo();

  return beginStreaming({ round, playTimeSeconds, targetFps, width, height });
}

// 라운드 / 제시어 표시 (#roundDisplay, #topicDisplay)
export function renderRoundInfo() {
  setText(
    "roundDisplay",
    `ROUND ${state.currentRound} / ${state.gameOptions.totalRounds}`
  );
  setText("topicDisplay", state.topic || "—");
}
