// ============================================================
// gameover.js - 4. 게임 종료 단계 (GAME_OVER): 최종 순위 / 승리 표시
// ============================================================
import { state, nicknameOf, resetGameForReplay } from "../core/state.js";
import { disableAutoReconnect, ensureConnected } from "../core/socket.js";
import { stopStreaming } from "../media/streaming.js";
import { resetMaskedTiles } from "../media/masked.js";
import { handleCheckWebcamReq } from "../media/webcam.js";
import { renderRoomUsers, renderGameOptions, updateHostControls, requestSetNickname } from "./lobby.js";
import { cancelRoundEndAck } from "./result.js";
import { showScreen, setText, formatScore } from "./screens.js";

// 4. [서버 ➔ 전체] 게임 최종 결과 (GAME_OVER)
// payload: { finalScores: { uuid: 점수 }, rankings: [{ rank, uuid, nickname, score }] }
export function handleGameOver(payload) {
  if (!payload) return;

  const hasRankings = Array.isArray(payload.rankings) && payload.rankings.length > 0;
  showGameOver(hasRankings ? payload.rankings : buildRankings(payload.finalScores ?? {}));
}

// 재접속 시 이미 끝난 게임: 누적 점수로 순위를 직접 계산해 표시
export function restoreGameOver(scores) {
  showGameOver(buildRankings(scores));
}

// 다시 하기: 기존 ID(myUuid)와 닉네임을 그대로 유지한 채 대기실로 복귀 (새 ID 생성 및 닉네임 재입력 방지)
export function playAgain() {
  stopStreaming();
  cancelRoundEndAck();
  resetGameForReplay();
  resetMaskedTiles();

  // 기존 닉네임을 입력창에 그대로 유지
  const nickInput = document.getElementById("nicknameInput");
  if (nickInput && state.nickname) {
    nickInput.value = state.nickname;
  }

  // 소켓 연결이 유지되어 있으면 그대로 사용하고, 끊어져 있다면 기존 UUID로 재연결
  ensureConnected();

  // 서버 측에서 새 게임을 위해 닉네임/웹캠 상태 확인이 필요한 경우를 대비해 동기화
  if (state.myUuid && state.nickname) {
    const meInRoom = state.users.find((u) => u.uuid === state.myUuid);
    if (!meInRoom || !meInRoom.nickname) {
      requestSetNickname(state.nickname);
    }
  }
  handleCheckWebcamReq().then(updateHostControls);

  renderRoomUsers();
  renderGameOptions();
  updateHostControls();
  showScreen("lobby");
}

// ---------- 내부 함수 ----------

function showGameOver(rankings) {
  stopStreaming();
  cancelRoundEndAck();
  disableAutoReconnect(); // 게임이 끝났으므로 결과 화면을 보는 동안에는 강제 전환 방지

  state.gameState = "GAME_OVER";
  state.rankings = rankings;

  renderRankings();
  showScreen("gameover");
}

// 점수 높은 순 정렬 + 동점은 같은 순위
function buildRankings(scores) {
  const entries = Object.entries(scores ?? {});
  const source =
    entries.length > 0
      ? entries
      : state.users.map((u) => [u.uuid, 0]);
  const sorted = source
    .map(([uuid, score]) => ({ uuid, nickname: nicknameOf(uuid), score: Number(score) || 0 }))
    .sort((a, b) => b.score - a.score);

  let prevScore = null;
  let prevRank = 0;
  return sorted.map((r, i) => {
    const rank = r.score === prevScore ? prevRank : i + 1;
    prevScore = r.score;
    prevRank = rank;
    return { rank, ...r };
  });
}

// 순위 목록 (#rankingList) + 내 결과 (#myResult)
function renderRankings() {
  const listEl = document.getElementById("rankingList");
  if (listEl) {
    listEl.innerHTML = "";
    state.rankings.forEach((r) => {
      const me = r.uuid === state.myUuid ? " (나)" : "";
      const li = document.createElement("li");
      li.className = `ranking-item rank-${r.rank}`;
      if (r.uuid === state.myUuid) li.classList.add("is-me");
      li.textContent = `${r.rank}위  ${r.nickname || nicknameOf(r.uuid)}${me} — ${formatScore(r.score)}점`;
      listEl.appendChild(li);
    });
  }

  const mine = state.rankings.find((r) => r.uuid === state.myUuid);
  if (!mine) setText("myResult", "");
  else setText("myResult", mine.rank === 1 ? "🏆 최종 우승! 수석 그림자 마스터" : `최종 순위 ${mine.rank}위`);
}
