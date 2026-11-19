// ============================================================
// state.js - 클라이언트 전역 상태 (모든 모듈이 공유)
// ============================================================

// 재접속용 UUID 저장 (새로고침/네트워크 끊김/탭 재열기 후 RECONNECT_REQ의 prevUuid로 사용)
// 1순위: sessionStorage (탭마다 분리되어 한 브라우저 멀티 탭 테스트 지원)
// 2순위: 탭이 닫히거나 새로고침될 때 localStorage에 단기(15초) 백업하여 탭을 닫았다 다시 열어도 재접속 지원
const UUID_KEY = "myUuid";
const NICK_KEY = "myNickname";
const CLOSED_SESSION_KEY = "shadowLab_closedSession";
const CLOSED_SESSION_TTL_MS = 15000; // 서버 재접속 유예시간(10초)을 커버하는 15초

// 저장소 접근이 막힌 환경(시크릿/보안 설정)에서도 앱이 죽지 않도록 감싼 래퍼
const sessionStore = {
  getItem: (k) => { try { return sessionStorage.getItem(k); } catch { return null; } },
  setItem: (k, v) => { try { sessionStorage.setItem(k, v); } catch { /* 무시 */ } },
  removeItem: (k) => { try { sessionStorage.removeItem(k); } catch { /* 무시 */ } },
};

const localStore = {
  getItem: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  setItem: (k, v) => { try { localStorage.setItem(k, v); } catch { /* 무시 */ } },
  removeItem: (k) => { try { localStorage.removeItem(k); } catch { /* 무시 */ } },
};

export const state = {
  myUuid: null,
  isHost: false,
  nickname: sessionStore.getItem(NICK_KEY) || null,
  webcamReady: false,          // 내 웹캠 준비 완료 여부
  webcamFallbackMode: false,   // 보안 정책(HTTP) 등으로 카메라 없이 진행하는 모드 여부
  users: [], // 방 안의 유저 목록 [{ uuid, nickname, isHost, isConnected? }]
  gameOptions: {
    totalRounds: 5,
    playTimeSeconds: 20,
  },

  // 인게임 상태 (RECONNECT_SUCCESS의 gameState / roundPhase 규격과 동일)
  gameState: "IN_LOBBY", // IN_LOBBY | IN_GAME | GAME_OVER
  roundPhase: "WAITING", // WAITING | TOPIC_SHOW | STREAMING | RESULT
  currentRound: 0,
  topic: "",

  // 점수
  roundScores: {},    // 이번 라운드 점수 { uuid: 점수 }
  totalScores: {},    // 누적 점수 { uuid: 점수 }
  lastScoredRound: 0, // 누적에 반영한 마지막 라운드 (중복 합산 방지)
  rankings: [],       // 최종 순위 [{ rank, uuid, nickname, score }]
};

// CONNECTED / RECONNECT_SUCCESS 수신 시 내 정보 및 UUID 저장
export function setMyAuthInfo(uuid, isHost) {
  state.myUuid = uuid;
  state.isHost = isHost;
  if (uuid) {
    sessionStore.setItem(UUID_KEY, uuid);
    localStore.removeItem(CLOSED_SESSION_KEY);
  }
}

// 닉네임 저장 동기화
export function setMyNickname(nickname) {
  state.nickname = nickname;
  if (nickname) sessionStore.setItem(NICK_KEY, nickname);
}

// 저장된 닉네임 조회 (재입장 시 자동 복원용)
export function getSavedNickname() {
  return state.nickname || sessionStore.getItem(NICK_KEY) || null;
}

// 페이지 새로고침/닫기 직전에 호출: 탭을 닫았다가 15초 내 다시 열었을 때도 재접속 가능하도록 백업
export function backupSessionOnUnload() {
  const uuid = state.myUuid || sessionStore.getItem(UUID_KEY);
  if (!uuid) return;
  localStore.setItem(
    CLOSED_SESSION_KEY,
    JSON.stringify({
      uuid,
      nickname: state.nickname || sessionStore.getItem(NICK_KEY) || null,
      closedAt: Date.now(),
    })
  );
}

// 게임 종료 후 '다시 하기' 클릭 시: 기존 ID(myUuid)와 닉네임, 유저 목록은 그대로 유지하고 인게임 점수/라운드 상태만 초기화
export function resetGameForReplay() {
  state.gameState = "IN_LOBBY";
  state.roundPhase = "WAITING";
  state.currentRound = 0;
  state.topic = "";
  state.roundScores = {};
  state.totalScores = {};
  state.lastScoredRound = 0;
  state.rankings = [];
}

// EXPIRED_SESSION / UNAUTHORIZED 등으로 세션을 초기화할 때 호출 (기존 닉네임은 보존하여 재입장 시 자동 재설정 가능하도록 유지)
export function clearMyAuthInfo(preserveNickname = true) {
  const prevNickname = preserveNickname ? getSavedNickname() : null;
  state.myUuid = null;
  state.isHost = false;
  state.nickname = prevNickname;
  state.webcamReady = false;
  state.webcamFallbackMode = false;
  state.users = [];
  state.gameState = "IN_LOBBY";
  state.roundPhase = "WAITING";
  state.currentRound = 0;
  state.topic = "";
  state.roundScores = {};
  state.totalScores = {};
  state.lastScoredRound = 0;
  state.rankings = [];
  state.gameOptions = { totalRounds: 5, playTimeSeconds: 20 }; // 새 방은 기본 옵션부터
  sessionStore.removeItem(UUID_KEY);
  if (!preserveNickname) {
    sessionStore.removeItem(NICK_KEY);
  }
  localStore.removeItem(CLOSED_SESSION_KEY);
}

// 재접속용으로 저장해둔 UUID 조회 (없으면 null -> 최초 입장)
export function getSavedUuid() {
  // 1. 현재 탭의 sessionStorage 확인 (새로고침 및 일시적 네트워크 끊김)
  const sessionUuid = sessionStore.getItem(UUID_KEY);
  if (sessionUuid) {
    localStore.removeItem(CLOSED_SESSION_KEY);
    return sessionUuid;
  }

  // 2. 탭을 닫았다가 유예시간 내에 새로 연 경우 localStorage 단기 백업 확인
  const rawClosed = localStore.getItem(CLOSED_SESSION_KEY);
  if (!rawClosed) return null;

  try {
    const parsed = JSON.parse(rawClosed);
    localStore.removeItem(CLOSED_SESSION_KEY); // 한 번만 소비 (다른 멀티 탭과 충돌 방지)
    if (
      parsed &&
      parsed.uuid &&
      Date.now() - Number(parsed.closedAt || 0) <= CLOSED_SESSION_TTL_MS
    ) {
      sessionStore.setItem(UUID_KEY, parsed.uuid);
      if (parsed.nickname) {
        state.nickname = parsed.nickname;
        sessionStore.setItem(NICK_KEY, parsed.nickname);
      }
      return parsed.uuid;
    }
  } catch {
    localStore.removeItem(CLOSED_SESSION_KEY);
  }
  return null;
}

// uuid -> 닉네임 (유저 목록에 없으면 "이름 없음")
export function nicknameOf(uuid) {
  const user = state.users.find((u) => u.uuid === uuid);
  return user?.nickname || "이름 없음";
}
