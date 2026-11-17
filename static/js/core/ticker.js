// ============================================================
// ticker.js - 백그라운드 탭에서도 느려지지 않는 주기 타이머 (프레임 송신 루프용)
// ============================================================

// 주기 타이머 시작, 정지 함수를 반환
// 백그라운드 탭에서는 일반 타이머가 1초(길게 숨기면 1분)에 1번으로 느려져
// 프레임 누락이 날 수 있어, 영향을 덜 받는 Web Worker 타이머를 쓰고
// 불가능하면 일반 타이머로 대체
export function startTicker(callback, ms) {
  const useTimer = () => {
    const id = setInterval(callback, ms);
    return () => clearInterval(id);
  };

  if (typeof Worker === "undefined") return useTimer();

  try {
    const url = URL.createObjectURL(
      new Blob([`setInterval(() => postMessage(0), ${ms});`], { type: "text/javascript" })
    );
    const worker = new Worker(url);
    let stopFallback = null;

    worker.onmessage = () => callback();
    worker.onerror = () => {
      worker.terminate(); // 워커 실행에 실패하면 일반 타이머로 전환
      stopFallback ??= useTimer();
    };

    return () => {
      worker.terminate();
      URL.revokeObjectURL(url);
      stopFallback?.();
    };
  } catch {
    return useTimer();
  }
}
