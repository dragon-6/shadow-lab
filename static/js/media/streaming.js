// ============================================================
// streaming.js - 영상 송신 루프 (3-2 ① SEND_FRAME) + 카운트다운
// ============================================================
import { sendMessage, isSendBacklogged } from "../core/socket.js?v=6";
import { initWebcam, captureFrameBase64 } from "./webcam.js?v=6";
import { setText } from "../stages/screens.js?v=6";
import { startTicker } from "../core/ticker.js?v=6";

// 서버가 사양을 주지 않을 때 쓰는 기본값 (규격: 20초, 10fps)
export const DEFAULT_PLAY_SECONDS = 20;
export const DEFAULT_FPS = 10;

let stopFrameTicker = null; // 프레임 송신 반복 타이머 정지 함수
let countdownTimer = null;  // 화면 카운트다운 타이머
let streamSession = 0;      // 스트리밍 세션 번호 (await 중 취소된 요청 무효화용)

// 스트리밍 중 시각 표시 토글 (#localVideoCard에 data-streaming 표시)
function setStreamingIndicator(active) {
  const card = document.getElementById("localVideoCard");
  if (card) card.dataset.streaming = active ? "true" : "false";
}

// 영상 송신 시작: 제한시간 동안 targetFps 간격으로 SEND_FRAME 전송
export async function beginStreaming({ round, playTimeSeconds, targetFps, width, height }) {
  stopStreaming();
  const session = streamSession; // 이 요청의 세션 번호

  // ★ 핵심 수정: 웹캠 보안 정책(HTTP 접속)이나 카메라 권한 문제로 카메라가 열리지 않더라도
  // 라운드 제한시간(남은 시간) 카운트다운과 진행 바는 즉시 화면에 표시되어야 함!
  startCountdownUI(playTimeSeconds, "남은 시간", 5);

  // 새로고침 등으로 스트림이 끊겼을 수 있어 확보
  const ready = await initWebcam();

  // 대기하는 사이 새 라운드/중단이 있었다면 이 요청은 버림 (타이머 중복 방지)
  if (session !== streamSession) return;
  if (!ready) {
    console.warn("웹캠이 준비되지 않아 SEND_FRAME 송신 없이 타이머 및 타 유저 화면 수신만 진행합니다.");
    setText(
      "statusMessage",
      "카메라가 보안 정책(HTTP) 또는 장치 문제로 비활성화되어 내 영상 송신 없이 진행합니다."
    );
    // 주의: 여기서 stopStreaming()을 호출하면 카운트다운 타이머까지 사라지므로 절대 호출하지 않음!
    return;
  }

  const intervalMs = Math.round(1000 / targetFps); // 10fps -> 100ms
  console.log(
    `[스트리밍 시작] 라운드 ${round}, ${playTimeSeconds}초, ${targetFps}fps, ${width}x${height}`
  );

  setStreamingIndicator(true);

  // 종료 시각은 경과 시간으로 판단 (백그라운드 탭에서 setTimeout이 늦어져도 정확)
  const endAt = performance.now() + playTimeSeconds * 1000;

  // 첫 프레임 즉시 전송 후 반복
  sendSingleFrame(round, width, height);
  stopFrameTicker = startTicker(() => {
    if (session !== streamSession) return; // 이미 중단된 세션
    if (performance.now() >= endAt) {
      stopStreaming(); // 제한시간이 지나면 송신 중단
      console.log(`[스트리밍 종료] ${playTimeSeconds}초 완료`);
      return;
    }
    sendSingleFrame(round, width, height);
  }, intervalMs);
}

// 3-2 ① [클라이언트 ➔ 서버] 웹캠 프레임 송신 (SEND_FRAME)
function sendSingleFrame(round, width, height) {
  // 전송 대기 데이터가 쌓였으면 이번 프레임은 건너뜀 (지연 누적 방지)
  if (isSendBacklogged()) return;

  const imageBase64 = captureFrameBase64(width, height);
  if (!imageBase64) return; // 비디오 첫 프레임 준비 전

  sendMessage("SEND_FRAME", { currentRound: round, imageBase64 });
}

// 송신/타이머/카운트다운 일괄 정지 (라운드 전환, 제한시간 종료, 결과 수신, 세션 초기화 시)
export function stopStreaming() {
  streamSession++; // 진행 중이던 시작 요청 무효화

  stopFrameTicker?.();
  stopFrameTicker = null;
  setStreamingIndicator(false);
  clearCountdownUI();
}

// 카운트다운 표시 (#countdownDisplay + #countdownProgressBar)
// urgentAt: 남은 초가 이 값 이하이면 빨간 경고 표시 (0이면 경고 없음)
// 종료 시각 기준으로 남은 시간을 계산하므로 타이머가 늦어도 오차가 쌓이지 않음
export function startCountdownUI(seconds, label = "", urgentAt = 0) {
  clearCountdownUI();

  const el = document.getElementById("countdownDisplay");
  const bar = document.getElementById("countdownProgressBar");
  if (!el) return;

  const safeSeconds = Math.max(Number(seconds) || 0, 1);
  const totalMs = safeSeconds * 1000;
  const deadline = performance.now() + totalMs;

  const render = () => {
    const leftMs = deadline - performance.now();
    const remaining = Math.ceil(leftMs / 1000);
    if (remaining <= 0) {
      clearCountdownUI();
      return;
    }
    el.textContent = label ? `${label}: ${remaining}초` : `${remaining}초`;
    el.dataset.urgent = urgentAt > 0 && remaining <= urgentAt ? "true" : "false";
    if (bar) bar.style.width = `${Math.max(0, Math.min(100, (leftMs / totalMs) * 100))}%`;
  };

  render();
  countdownTimer = setInterval(render, 200);
}

// 카운트다운 정지 + 표시 지우기
function clearCountdownUI() {
  clearInterval(countdownTimer);
  countdownTimer = null;
  setText("countdownDisplay", "");
  const el = document.getElementById("countdownDisplay");
  if (el) delete el.dataset.urgent;
  const bar = document.getElementById("countdownProgressBar");
  if (bar) bar.style.width = "0%";
}
