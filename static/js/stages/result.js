// ============================================================
// result.js - 3-3 결과 대기 / 라운드 점수, 3-4 라운드 종료 Ack
// ============================================================
<<<<<<< HEAD
import { state, nicknameOf } from "../core/state.js?v=7";
import { sendMessage } from "../core/socket.js?v=7";
import { stopStreaming } from "../media/streaming.js?v=7";
import { showScreen, setText, formatScore } from "./screens.js?v=7";
import { renderRoomUsers } from "./lobby.js?v=7";
=======
import { state, nicknameOf } from "../core/state.js?v=6";
import { sendMessage } from "../core/socket.js?v=6";
import { stopStreaming } from "../media/streaming.js?v=6";
import { showScreen, setText, formatScore } from "./screens.js?v=6";
import { renderRoomUsers } from "./lobby.js?v=6";
>>>>>>> da122f35b6280cf0ebd1721cbeedc983280daf6b

const RESULT_DISPLAY_MS = 4000; // 결과 화면을 보여준 뒤 Ack를 보내는 시간
const ACK_RETRY_MS = 1000;      // 연결 끊김으로 Ack 전송에 실패했을 때 재시도 간격
const ACK_MAX_RETRY = 10;

let ackTimer = null;

// 3-3 ① [서버 ➔ 클라이언트] 프레임 수신 완료 및 대기 안내 (FRAME_RECEIVED_WAIT)
export function handleFrameReceivedWait(payload) {
  stopStreaming(); // 서버가 수신을 마쳤으므로 남은 프레임 송신 중단
  state.roundPhase = "WAITING";
  setText("statusMessage", payload?.message || "영상 수신 완료. OpenCV 분석 진행 중입니다.");
}

// 3-3 ② [서버 ➔ 전체] 라운드 결과 및 점수 (ROUND_RESULT)
// payload: { currentRound, roundScores: { uuid: 점수 } }
export function handleRoundResult(payload) {
  if (!payload || typeof payload.roundScores !== "object" || !payload.roundScores) {
    console.warn("유효하지 않은 ROUND_RESULT:", payload);
    return;
  }

  stopStreaming();
  const round = Number.isInteger(payload.currentRound)
    ? payload.currentRound
    : state.currentRound;

  state.roundPhase = "RESULT";
  state.roundScores = payload.roundScores;
  addToTotals(round, payload.roundScores);
  renderRoomUsers(); // 플레이어 목록의 실시간 누적 점수 즉시 갱신

  showRoundResult(round);
}

// 결과 화면 표시 + 연출 시간이 지나면 ROUND_END_ACK 전송 (재접속 복구에서도 사용)
export function showRoundResult(round) {
  renderRoundResult(round);
  showScreen("result");
  setText("resultStatus", "라운드 분석 결과를 확인하고 있습니다...");
  scheduleRoundEndAck(round);
}

// 예약된 Ack 취소 (다음 라운드 시작, 세션 초기화 등)
export function cancelRoundEndAck() {
  clearTimeout(ackTimer);
  ackTimer = null;
}

// ---------- 내부 함수 ----------

// 3-4 [클라이언트 ➔ 서버] 라운드 결과 연출 완료 알림 (ROUND_END_ACK)
// 연결이 끊겨 전송에 실패하면 잠시 후 재시도
function scheduleRoundEndAck(round, delay = RESULT_DISPLAY_MS, retries = ACK_MAX_RETRY) {
  cancelRoundEndAck();
  ackTimer = setTimeout(() => {
    ackTimer = null;
    if (sendMessage("ROUND_END_ACK", { currentRound: round })) {
      setText("resultStatus", "다른 연구원의 확인 신호(ACK)를 기다리는 중...");
    } else if (retries > 0) {
      scheduleRoundEndAck(round, ACK_RETRY_MS, retries - 1);
    }
  }, delay);
}

// 라운드 점수를 누적 점수에 합산 (같은 라운드가 다시 와도 이중 합산하지 않음)
function addToTotals(round, scores) {
  if (round <= state.lastScoredRound) return;
  for (const [uuid, score] of Object.entries(scores)) {
    state.totalScores[uuid] = (state.totalScores[uuid] ?? 0) + (Number(score) || 0);
  }
  state.lastScoredRound = round;
}

// 결과 목록 렌더링 (#roundResultTitle, #roundResultList)
function renderRoundResult(round) {
  setText("roundResultTitle", `ROUND ${round} / ${state.gameOptions.totalRounds} 유사도 분석 결과`);

  const listEl = document.getElementById("roundResultList");
  if (!listEl) return;

  // 이번 라운드 점수(없으면 누적 점수) 높은 순
  const sortKey = (uuid) => state.roundScores[uuid] ?? state.totalScores[uuid] ?? 0;
  const scoreKeys = [...Object.keys(state.roundScores), ...Object.keys(state.totalScores)];
  const baseUuids = scoreKeys.length > 0 ? scoreKeys : state.users.map((u) => u.uuid);
  const uuids = [...new Set(baseUuids)].sort((a, b) => sortKey(b) - sortKey(a));

  const topScore = uuids.length ? sortKey(uuids[0]) : 0;

  listEl.innerHTML = "";
  uuids.forEach((uuid) => {
    const roundScore = state.roundScores[uuid];
    const parts = [];
    if (roundScore !== undefined) parts.push(`이번 라운드 +${formatScore(roundScore)}점`);
    parts.push(`누적 ${formatScore(state.totalScores[uuid] ?? 0)}점`);

    const me = uuid === state.myUuid ? " (나)" : "";
    const li = document.createElement("li");
    li.className = "score-item";
    if (uuid === state.myUuid) li.classList.add("is-me");
    if (topScore > 0 && sortKey(uuid) === topScore) li.classList.add("is-top"); // 동점은 모두 1위 강조
    li.textContent = `${nicknameOf(uuid)}${me} — ${parts.join("  ·  ")}`;
    listEl.appendChild(li);
  });
}
