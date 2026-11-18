// ============================================================
// socket.js - 웹소켓 코어 (연결 / 메시지 전송 / 자동 재접속)
// 백엔드가 WebSocketDisconnect 이벤트로 연결 상태를 감지하므로 별도 PING/PONG 하트비트는 사용하지 않음
// ============================================================
import { state, getSavedUuid, backupSessionOnUnload } from "./state.js";

// ---------- 설정 ----------
// [1. 기본 주소 동적 생성]
// 0.0.0.0 오류를 방지하기 위해 접속 중인 주소(예: localhost:8000)를 그대로 따라갑니다.
const DEFAULT_WS_PROTOCOL = location.protocol === "https:" ? "wss:" : "ws:";
const DEFAULT_BACKEND_WS = `${DEFAULT_WS_PROTOCOL}//${location.host || "localhost:8000"}/ws`;

// [2. 주소 형식 보정]
// 사용자가 http:// 로 입력해도 웹소켓 규격(ws://)으로 자동 변환합니다.
function normalizeWsUrl(url) {
  if (!url) return DEFAULT_BACKEND_WS;
  if (url.startsWith("http://")) return "ws://" + url.slice("http://".length);
  if (url.startsWith("https://")) return "wss://" + url.slice("https://".length);
  return url;
}

// [3. 최종 접속 주소 결정]
// 주소창 뒤에 ?ws=... 가 붙어있으면 그 주소를 우선 연결하고, 없으면 기본 주소로 연결합니다.
function resolveWsUrl() {
  const override = new URLSearchParams(location.search).get("ws");
  if (override) return normalizeWsUrl(override);
  return DEFAULT_BACKEND_WS;
}

const WS_URL = resolveWsUrl();
const RECONNECT_DELAY_MS = 1000;         // 연결 끊김 후 재시도 간격
const INITIAL_RECONNECT_WAIT_MS = 150;   // 새로고침 시 이전 소켓 종료(WebSocketDisconnect)를 서버가 먼저 처리하도록 짧은 지연

// 용량이 큰 프레임 메시지는 콘솔 로그에서 제외 (10fps라 로그가 폭주함)
const NO_LOG_TYPES = new Set(["SEND_FRAME", "BROADCAST_MASKED_STREAM"]);

let socket = null;
let messageHandler = null; // 서버 메시지 라우터 (재접속 때 재사용)
let reconnectTimer = null;
let reconnectReqTimer = null;
let autoReconnect = true;  // false면 연결이 끊겨도 재접속하지 않음 (게임 종료 화면 유지 시)
let reconnectFailRetries = 0; // F5 직후 서버가 아직 이전 소켓 끊김을 감지 못했을 때 재시도 횟수
let lockedBadgeText = null;   // 입장 거부(방 정원 초과 등) 사유 배지 문구 (onclose가 덮어쓰지 않도록 보존)

// 소켓 상태 UI 배지 업데이트 (#wsStatusBadge)
export function updateConnectionBadge(statusText, stateClass) {
  const badge = document.getElementById("wsStatusBadge");
  if (!badge) return;
  badge.textContent = statusText;
  badge.dataset.state = stateClass;
}

// 페이지 새로고침(F5) 또는 탭 닫기 시 기존 소켓을 즉시 닫아 백엔드에서 WebSocketDisconnect가 즉시 발생하도록 처리
function handlePageUnload() {
  backupSessionOnUnload();
  autoReconnect = false;
  clearTimeout(reconnectTimer);
  clearTimeout(reconnectReqTimer);
  if (socket) {
    try {
      socket.onclose = null;
      socket.onerror = null;
      socket.close(1000, "page_unload");
    } catch {
      // 무시
    }
    socket = null;
  }
}

window.addEventListener("pagehide", handlePageUnload);
window.addEventListener("beforeunload", handlePageUnload);

// ============================================================
// 메시지 전송 및 상태 확인
// ============================================================

export function isSocketOpen() {
  return !!socket && socket.readyState === WebSocket.OPEN;
}

// 모든 메시지는 { type, senderUuid, payload } 표준 포맷
// senderUuid 생략 시 내 UUID, 최초 입장(JOIN_REQ)은 null을 직접 전달
// 전송 성공 여부를 true/false로 반환
export function sendMessage(type, payload = {}, senderUuid = state.myUuid) {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    // 프레임은 10fps라 경고가 폭주하므로 제외
    if (!NO_LOG_TYPES.has(type)) console.warn(`전송 실패(연결 없음): ${type}`);
    return false;
  }

  const message = { type, senderUuid, payload };
  socket.send(JSON.stringify(message));

  if (!NO_LOG_TYPES.has(type)) console.log("[송신]", message);
  return true;
}

// 전송 대기 중인 데이터가 limitBytes를 넘으면 true (프레임 누적 지연 방지용)
export function isSendBacklogged(limitBytes = 256 * 1024) {
  return !!socket && socket.bufferedAmount > limitBytes;
}

// RECONNECT_REQ 패킷 전송 헬퍼
export function sendReconnectRequest(uuid) {
  const targetUuid = uuid || state.myUuid || getSavedUuid();
  if (!targetUuid) return false;
  state.myUuid = targetUuid; // 응답 전 도착하는 브로드캐스트에서도 내 UUID를 식별하도록 선반영
  return sendMessage("RECONNECT_REQ", { prevUuid: targetUuid }, targetUuid);
}

// F5 직후 서버가 이전 연결의 WebSocketDisconnect를 처리하기 전에 RECONNECT_REQ가 먼저 도착해 ERROR(EXPIRED_SESSION 등)가 난 경우 재시도
export function retryReconnectOnFail() {
  const savedUuid = state.myUuid || getSavedUuid();
  if (!savedUuid || reconnectFailRetries >= 2) {
    reconnectFailRetries = 0;
    return false;
  }
  reconnectFailRetries += 1;
  console.warn(`[재접속 재시도 ${reconnectFailRetries}/2] 350ms 후 RECONNECT_REQ 재전송 (${savedUuid})`);
  clearTimeout(reconnectReqTimer);
  reconnectReqTimer = setTimeout(() => {
    sendReconnectRequest(savedUuid);
  }, 350);
  return true;
}

export function resetReconnectRetries() {
  reconnectFailRetries = 0;
  clearTimeout(reconnectReqTimer);
}

// ============================================================
// 연결 관리
// ============================================================

// onMessage: 서버 메시지를 받을 라우터 콜백 (main.js의 handleServerMessage)
export function connectWebSocket(onMessage) {
  if (onMessage) messageHandler = onMessage;

  // 이미 연결 중이거나 연결된 상태면 중복 생성 방지
  if (
    socket &&
    (socket.readyState === WebSocket.OPEN ||
      socket.readyState === WebSocket.CONNECTING)
  ) {
    return;
  }

  updateConnectionBadge("서버 연결 중...", "connecting");
  socket = new WebSocket(WS_URL);

  // 연결 직후 분기 (규격 5장 재접속):
  //   저장된 UUID 있음 -> RECONNECT_REQ (senderUuid, prevUuid 모두 기존 UUID)
  //   저장된 UUID 없음 -> JOIN_REQ (senderUuid는 null)
  // 서버 응답: RECONNECT_SUCCESS(복구) / ERROR(EXPIRED_SESSION 등 -> 신규 입장) -> main.js에서 처리
  socket.onopen = () => {
    console.log("웹소켓 연결 성공:", WS_URL);
    updateConnectionBadge("연구소 서버 연결됨", "online");

    const savedUuid = state.myUuid || getSavedUuid();
    if (savedUuid) {
      state.myUuid = savedUuid;
      reconnectFailRetries = 0;
      clearTimeout(reconnectReqTimer);
      // 새로고침 직후 이전 소켓의 WebSocketDisconnect가 서버에서 먼저 처리되도록 짧은 지연 후 전송
      reconnectReqTimer = setTimeout(() => {
        sendReconnectRequest(savedUuid);
      }, INITIAL_RECONNECT_WAIT_MS);
    } else {
      sendMessage("JOIN_REQ", {}, null); // 최초 입장은 senderUuid가 반드시 null
    }
  };

  // 서버 메시지 수신 -> 라우터로 전달
  socket.onmessage = (event) => {
    let data;
    try {
      data = JSON.parse(event.data);
    } catch (e) {
      console.error("JSON 파싱 실패:", event.data);
      return;
    }

    if (!NO_LOG_TYPES.has(data.type)) console.log("[수신]", data);
    messageHandler?.(data);
  };

  // 연결 종료(WebSocketDisconnect): 자동 재접속 시도
  socket.onclose = () => {
    console.log("웹소켓 연결 종료");
    clearTimeout(reconnectReqTimer);
    updateConnectionBadge(
      lockedBadgeText ?? (autoReconnect ? "연결 끊김 · 재접속 시도 중..." : "게임 종료됨"),
      "offline"
    );
    scheduleReconnect();
  };

  // 에러 뒤에는 onclose가 이어서 호출되므로 로그만 남김
  socket.onerror = (error) => {
    console.error("웹소켓 에러:", error);
  };
}

// 게임이 끝난 뒤에는 서버가 세션을 정리할 수 있으므로, 결과 화면에서 연결이 끊겨도 강제 화면 전환하지 않음
// badgeText: 입장 거부처럼 종료 사유를 배지에 계속 보여줘야 할 때 전달 (소켓이 닫혀도 유지)
export function disableAutoReconnect(badgeText = null) {
  autoReconnect = false;
  lockedBadgeText = badgeText;
  clearTimeout(reconnectTimer);
  clearTimeout(reconnectReqTimer);
}

// 다시 새 게임이 시작되거나 세션이 복구될 때 자동 재접속 활성화
export function enableAutoReconnect() {
  autoReconnect = true;
  lockedBadgeText = null;
}

// 소켓이 닫혀 있을 때 즉시 재연결 시도 (다시 하기 클릭 시 사용)
export function ensureConnected() {
  enableAutoReconnect();
  if (!isSocketOpen()) {
    connectWebSocket(messageHandler);
  }
}

// 일정 시간 뒤 재연결 (서버 유예시간 10초 안에 RECONNECT_REQ가 도달하도록 1초 간격)
function scheduleReconnect() {
  if (!autoReconnect) return;
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(
    () => connectWebSocket(messageHandler),
    RECONNECT_DELAY_MS
  );
}
