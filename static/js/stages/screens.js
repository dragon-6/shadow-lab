// ============================================================
// screens.js - 화면 전환 / 공용 DOM 헬퍼
// HTML에 #screen-lobby, #screen-game, #screen-result, #screen-gameover 가 있으면 동작
// ============================================================

const SCREENS = ["lobby", "game", "result", "gameover"];

const PHASE_LABELS = {
  lobby: "STAGE 01 · 실험 대기실",
  game: "STAGE 02 · 그림자 구현 실험",
  result: "STAGE 03 · 유사도 분석 결과",
  gameover: "STAGE 04 · 최종 연구 보고서",
};

// 지정한 화면만 보이고 나머지는 숨김
export function showScreen(name) {
  SCREENS.forEach((s) => {
    const el = document.getElementById(`screen-${s}`);
    if (el) el.hidden = s !== name;
  });

  const phaseEl = document.getElementById("phaseBadge");
  if (phaseEl && PHASE_LABELS[name]) {
    phaseEl.textContent = PHASE_LABELS[name];
  }
}

// id 요소의 텍스트 변경 (요소가 없으면 무시)
export function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

// 점수 표시용: 소수 둘째 자리까지 반올림 후 불필요한 0 제거 (4.5 / 3.75 / 22)
// (부동소수점 누적 오차 0.30000000000000004 같은 값도 깔끔하게 표시)
export function formatScore(n) {
  const v = Math.round((Number(n) || 0) * 100) / 100;
  return String(v);
}
