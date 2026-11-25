// ============================================================
// webcam.js - 웹캠 준비 확인 / 스트림 관리 / 프레임 캡처(320x240 JPEG Base64)
// ============================================================
<<<<<<< HEAD
import { state } from "../core/state.js?v=7";
import { sendMessage } from "../core/socket.js?v=7";
=======
<<<<<<< HEAD
import { state } from "../core/state.js?v=7";
import { sendMessage } from "../core/socket.js?v=7";
=======
import { state } from "../core/state.js?v=6";
import { sendMessage } from "../core/socket.js?v=6";
>>>>>>> da122f35b6280cf0ebd1721cbeedc983280daf6b
>>>>>>> a1b9681b36005b68743e0e845402071d999e6be6

// 기본 해상도 및 JPEG 압축 품질
export const DEFAULT_WIDTH = 320;
export const DEFAULT_HEIGHT = 240;
const JPEG_QUALITY = 0.7;

let mediaStream = null;
let pendingInit = null; // 진행 중인 초기화 Promise (권한 팝업 중복 요청 방지)

// 캡처 전용 숨김 <video>와 오프스크린 <canvas> (매 프레임 DOM 생성 방지 / 모든 브라우저 호환)
let captureVideo = null;
let captureCanvas = null;
let captureCtx = null;

// 카메라 상태 배지 UI 갱신 (#camStatusBadge)
function updateCamBadge(text, stateClass) {
  const el = document.getElementById("camStatusBadge");
  if (!el) return;
  el.textContent = text;
  el.dataset.state = stateClass;
}

// ④ CHECK_WEBCAM_REQ 수신 시 호출 -> ⑤ CHECK_WEBCAM_RES 응답
export async function handleCheckWebcamReq() {
  const ready = await initWebcam();
  // 보안 정책(HTTP) 등으로 카메라가 안 열리는 환경에서도 게임 진행이 막히지 않도록 응답
  sendMessage("CHECK_WEBCAM_RES", { webcamReady: ready || state.webcamFallbackMode });
}

// 웹캠 스트림 확보 (성공 여부 반환, state.webcamReady도 함께 갱신)
export async function initWebcam() {
  // 이미 살아있는 스트림이면 재사용 (미리보기 연결도 재보장)
  if (mediaStream?.active) {
    const videoEl = document.getElementById("localVideo");
    if (videoEl && videoEl.srcObject !== mediaStream) {
      videoEl.srcObject = mediaStream;
      videoEl.play().catch(() => {});
    }
    state.webcamReady = true;
    state.webcamFallbackMode = false;
    updateCamBadge("CAM READY · 320×240", "ready");
    return true;
  }

  // 이미 요청 중이면 같은 요청을 공유 (스트림이 2개 생기는 것 방지)
  pendingInit ??= openCamera().finally(() => {
    pendingInit = null;
  });
  return pendingInit;
}

// 실제 getUserMedia 호출
async function openCamera() {
  // 미지원 브라우저, 또는 보안 컨텍스트 아님 (https 또는 localhost만 허용)
  if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== "function") {
    console.warn("웹캠 사용 불가: 미지원 브라우저이거나 https/localhost 보안 컨텍스트가 아닙니다.");
    state.webcamReady = false;
    state.webcamFallbackMode = true;
    updateCamBadge("CAM ERROR · 보안 컨텍스트 필요", "error");
    return false;
  }

  updateCamBadge("CAM · 권한 요청 중...", "pending");

  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: DEFAULT_WIDTH },
        height: { ideal: DEFAULT_HEIGHT },
      },
      audio: false,
    });

    // 카메라가 뽑히거나 다른 앱이 가져가면 준비 상태를 해제하고 UI에 알림
    const track = mediaStream.getVideoTracks()[0];
    const stream = mediaStream;
    track?.addEventListener("ended", () => {
      if (mediaStream !== stream) return; // 이미 새 스트림으로 교체됨
      console.warn("웹캠 트랙이 종료되었습니다.");
      state.webcamReady = false;
      updateCamBadge("CAM OFF · 연결 끊김", "error");
      document.dispatchEvent(new CustomEvent("webcam-lost")); // main.js가 버튼 상태 갱신
    });

    // 미리보기용 <video id="localVideo">가 HTML에 있으면 연결
    const videoEl = document.getElementById("localVideo");
    if (videoEl) {
      videoEl.srcObject = mediaStream;
      await videoEl.play().catch(() => {});
    }

    // HTML에 #localVideo가 없더라도 프레임 캡처가 가능하도록 내부 video 요소 준비
    await ensureCaptureVideo(mediaStream);

    const { width, height } = mediaStream.getVideoTracks()[0].getSettings();
    console.log(`웹캠 준비 완료 (${width}x${height})`);
    state.webcamReady = true;
    state.webcamFallbackMode = false;
    updateCamBadge(`CAM READY · ${width || DEFAULT_WIDTH}×${height || DEFAULT_HEIGHT}`, "ready");
    return true;
  } catch (err) {
    // err.name: NotAllowedError(권한 거부), NotFoundError(카메라 없음) 등
    console.error(`웹캠 획득 실패 (${err.name}):`, err);
    state.webcamReady = false;
    state.webcamFallbackMode = true;
    updateCamBadge(`CAM OFF · ${err.name}`, "error");
    return false;
  }
}

// 캡처 전용 <video> 요소에 스트림 연결 및 재생 보장
async function ensureCaptureVideo(stream) {
  if (!captureVideo) {
    captureVideo = document.createElement("video");
    captureVideo.muted = true;
    captureVideo.playsInline = true;
  }
  if (captureVideo.srcObject !== stream) {
    captureVideo.srcObject = stream;
    await captureVideo.play().catch(() => {});
  }
}

// 현재 웹캠 화면을 지정 해상도(기본 320x240)로 캡처해 data:image/jpeg;base64,... 반환
export function captureFrameBase64(width = DEFAULT_WIDTH, height = DEFAULT_HEIGHT) {
  if (!mediaStream?.active) return null;

  // HTML의 #localVideo가 재생 중이면 우선 사용, 아니면 내부 captureVideo 사용
  const domVideo = document.getElementById("localVideo");
  const sourceVideo =
    domVideo && domVideo.readyState >= 2 ? domVideo : captureVideo;

  if (!sourceVideo || sourceVideo.readyState < 2) {
    return null; // 아직 비디오 첫 프레임이 준비되지 않음
  }

  const vw = sourceVideo.videoWidth;
  const vh = sourceVideo.videoHeight;
  if (!vw || !vh) {
    return null; // 비디오 메타데이터 크기가 0이면 0으로 나누기(NaN) 방지
  }

  // 오프스크린 캔버스 1회 생성 후 재사용 (해상도 변경 시에만 크기 갱신)
  if (!captureCanvas) {
    captureCanvas = document.createElement("canvas");
    captureCtx = captureCanvas.getContext("2d");
  }
  if (captureCanvas.width !== width) captureCanvas.width = width;
  if (captureCanvas.height !== height) captureCanvas.height = height;

  // 비율을 유지한 채 중앙을 잘라서 그림 (16:9 웹캠이 4:3으로 찌그러지는 것 방지)
  const targetRatio = width / height;
  let sx = 0, sy = 0, sw = vw, sh = vh;
  if (vw / vh > targetRatio) {
    sw = vh * targetRatio; // 영상이 더 넓음 -> 좌우를 잘라냄
    sx = (vw - sw) / 2;
  } else {
    sh = vw / targetRatio; // 영상이 더 좁음 -> 위아래를 잘라냄
    sy = (vh - sh) / 2;
  }
  captureCtx.drawImage(sourceVideo, sx, sy, sw, sh, 0, 0, width, height);
  return captureCanvas.toDataURL("image/jpeg", JPEG_QUALITY);
}

// 스트림 getter
export function getMediaStream() {
  return mediaStream;
}
