// ============================================================
// gameover.js - 4. 게임 종료 단계 (GAME_OVER): 최종 순위 / 승리 표시
// ============================================================
import { state, nicknameOf, resetGameForReplay } from "../core/state.js?v=8";
import { disableAutoReconnect, ensureConnected } from "../core/socket.js?v=8";
import { stopStreaming } from "../media/streaming.js?v=8";
import { resetMaskedTiles } from "../media/masked.js?v=8";
import { handleCheckWebcamReq } from "../media/webcam.js?v=8";
import { renderRoomUsers, renderGameOptions, updateHostControls, requestSetNickname } from "./lobby.js?v=8";
import { cancelRoundEndAck } from "./result.js?v=8";
import { showScreen, setText, formatScore } from "./screens.js?v=8";

const RANK_TITLES = {
  1: "수석 그림자 연구원",
  2: "차석 그림자 연구원",
  3: "그냥 그림자 연구원",
  4: "실험체",
};

function getRankTitle(rank) {
  return RANK_TITLES[rank] || "실험체";
}

// 4. [서버 ➔ 전체] 게임 최종 결과 (GAME_OVER)
// payload: { finalScores: { uuid: 점수 }, rankings: [{ rank, uuid, nickname, score }] }
export function handleGameOver(payload) {
  if (!payload) return;

  const hasRankings = Array.isArray(payload.rankings) && payload.rankings.length > 0;
  const rankings = hasRankings ? payload.rankings : buildRankings(payload.finalScores ?? {});

  // 최종 점수를 누적 점수 상태에도 동기화하여 좌측 플레이어 목록 점수 갱신
  if (payload.finalScores && typeof payload.finalScores === "object") {
    for (const [uuid, score] of Object.entries(payload.finalScores)) {
      state.totalScores[uuid] = Number(score) || 0;
    }
  } else {
    rankings.forEach((r) => {
      if (r.uuid) state.totalScores[r.uuid] = Number(r.score) || 0;
    });
  }

  showGameOver(rankings);
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

  renderRoomUsers();
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
      const title = getRankTitle(r.rank);
      const li = document.createElement("li");
      li.className = `ranking-item rank-${r.rank}`;
      if (r.uuid === state.myUuid) li.classList.add("is-me");

      const leftSpan = document.createElement("span");
      leftSpan.className = "ranking-left";

      const nameSpan = document.createElement("span");
      nameSpan.textContent = `${r.rank}위  ${r.nickname || nicknameOf(r.uuid)}${me}`;

      const titleBadge = document.createElement("span");
      titleBadge.className = "ranking-title-badge";
      titleBadge.textContent = title;

      leftSpan.append(nameSpan, titleBadge);

      const scoreSpan = document.createElement("span");
      scoreSpan.className = "ranking-score";
      scoreSpan.textContent = `${formatScore(r.score)}점`;

      li.append(leftSpan, scoreSpan);
      listEl.appendChild(li);
    });
  }

  const mine = state.rankings.find((r) => r.uuid === state.myUuid);
  if (!mine) {
    setText("myResult", "");
  } else {
    const myTitle = getRankTitle(mine.rank);
    const prefix = mine.rank === 1 ? "👑 " : "";
    setText("myResult", `${prefix}${mine.rank}위 · ${myTitle}`);
  }
}
