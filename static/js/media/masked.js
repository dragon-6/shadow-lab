// ============================================================
// masked.js - 3-2 ② 마스킹 영상 표시 (BROADCAST_MASKED_STREAM)
// #maskedStreamList 안에 유저별 타일(마스킹 영상 + 제시어 프레임 오버레이 + 닉네임)을 표시
// ============================================================
import { state } from "../core/state.js?v=7";

const tiles = new Map(); // uuid -> { wrap, stage, img, topicOverlay, label }

// Base64 이미지 문자열 정규화 (data:image/... 접두사가 없으면 PNG Data URL로 보정)
function normalizeImageDataUrl(raw) {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("data:image/")) return trimmed;
  return `data:image/png;base64,${trimmed}`;
}

// [서버 ➔ 전체] START_STREAMING의 topicFrameImageBase64 설정 및 모든 타일에 오버레이 적용
export function setTopicFrameImage(topicFrameImageBase64) {
  const normalized = normalizeImageDataUrl(topicFrameImageBase64);
  state.topicFrameImageBase64 = normalized;
  tiles.forEach((tile) => applyTopicFrame(tile));
}

// [서버 ➔ 전체] 마스킹된 프레임 수신: targetUuid 유저의 타일 이미지를 교체
export function handleMaskedStream(payload) {
  if (!payload) return;
  const { targetUuid, maskedImageBase64 } = payload;
  if (!targetUuid || typeof maskedImageBase64 !== "string") return;
  const normalized = normalizeImageDataUrl(maskedImageBase64);
  if (!normalized) return;

  const tile = getTile(targetUuid);
  if (tile) {
    tile.img.src = normalized;
    tile.wrap.classList.add("has-frame");
  }
}

// 유저 목록 기준으로 타일 생성/삭제 + 닉네임·접속 상태 라벨·제시어 프레임 갱신
// (게임 중에만 동작: 유저 목록이 바뀔 때마다 호출됨)
export function syncMaskedTiles() {
  if (state.gameState !== "IN_GAME") return;

  const ids = new Set(state.users.map((u) => u.uuid));

  // 방에서 빠진 유저의 타일 제거
  for (const [uuid, tile] of tiles) {
    if (!ids.has(uuid)) {
      tile.wrap.remove();
      tiles.delete(uuid);
    }
  }

  // 남은 유저는 타일 보장 + 라벨/오버레이 갱신
  ids.forEach((uuid) => {
    const tile = getTile(uuid);
    if (tile) {
      tile.label.textContent = labelText(uuid);
      const user = state.users.find((u) => u.uuid === uuid);
      tile.wrap.classList.toggle("is-disconnected", user?.isConnected === false);
      tile.wrap.classList.toggle("is-me", uuid === state.myUuid);
      applyTopicFrame(tile);
    }
  });
}

// 새 라운드 시작: 이전 영상 지우고 타일 다시 준비
export function resetMaskedTiles() {
  tiles.forEach((tile) => tile.wrap.remove());
  tiles.clear();
  syncMaskedTiles();
}

// ---------- 내부 함수 ----------

function applyTopicFrame(tile) {
  if (!tile || !tile.topicOverlay) return;
  if (state.topicFrameImageBase64) {
    if (tile.topicOverlay.src !== state.topicFrameImageBase64) {
      tile.topicOverlay.src = state.topicFrameImageBase64;
    }
    tile.wrap.classList.add("has-topic-frame");
  } else {
    tile.topicOverlay.removeAttribute("src");
    tile.wrap.classList.remove("has-topic-frame");
  }
}

function getTile(uuid) {
  return tiles.get(uuid) ?? createTile(uuid);
}

function createTile(uuid) {
  const listEl = document.getElementById("maskedStreamList");
  if (!listEl) return null; // HTML에 컨테이너가 없으면 표시 안 함

  const wrap = document.createElement("div");
  wrap.className = "masked-tile";
  if (uuid === state.myUuid) wrap.classList.add("is-me");
  wrap.dataset.uuid = uuid;

  // 마스킹 영상과 제시어 프레임(topicFrameImageBase64)을 겹쳐 그리는 컨테이너
  const stage = document.createElement("div");
  stage.className = "masked-stage";

  const img = document.createElement("img");
  img.className = "masked-frame";
  img.alt = "";

  const topicOverlay = document.createElement("img");
  topicOverlay.className = "topic-frame-overlay";
  topicOverlay.alt = "";

  stage.append(img, topicOverlay);

  const label = document.createElement("div");
  label.className = "masked-label";
  label.textContent = labelText(uuid);

  wrap.append(stage, label);
  listEl.appendChild(wrap);

  const tile = { wrap, stage, img, topicOverlay, label };
  tiles.set(uuid, tile);
  applyTopicFrame(tile);
  return tile;
}

// 타일 라벨: 닉네임 + (나) + (연결 끊김)
function labelText(uuid) {
  const user = state.users.find((u) => u.uuid === uuid);
  const name = user?.nickname || "이름 없음";
  const me = uuid === state.myUuid ? " (나)" : "";
  const conn = user?.isConnected === false ? " (연결 끊김)" : "";
  return `${name}${me}${conn}`;
}
