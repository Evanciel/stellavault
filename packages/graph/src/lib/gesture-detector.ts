// Design Ref: §2.1 — 21 landmarks → 6 제스처 분류
// 3프레임 안정화 + confidence threshold

export type GestureType = 'rotate' | 'pan' | 'zoom' | 'select' | 'reset' | 'none';

export interface GestureResult {
  type: GestureType;
  confidence: number;
  position: { x: number; y: number };
  delta: { x: number; y: number };
  pinchDistance: number;
}

interface Landmark { x: number; y: number; z: number; }

// 손가락 끝 인덱스
const TIPS = [4, 8, 12, 16, 20]; // 엄지, 검지, 중지, 약지, 소지
const PIPS = [3, 6, 10, 14, 18]; // 각 손가락 두 번째 관절

// 이전 상태 (안정화용)
let prevPosition = { x: 0.5, y: 0.5 };
let gestureHistory: GestureType[] = [];
let positionHistory: Array<{ x: number; y: number }> = [];

export function detectGesture(landmarks: Landmark[]): GestureResult {
  if (!landmarks || landmarks.length < 21) {
    return { type: 'none', confidence: 0, position: prevPosition, delta: { x: 0, y: 0 }, pinchDistance: 1 };
  }

  // 손바닥 중심
  const palm = landmarks[9]; // 중지 MCP
  const position = { x: palm.x, y: palm.y };
  const delta = { x: position.x - prevPosition.x, y: position.y - prevPosition.y };

  // 핀치 거리 (엄지-검지)
  const pinchDistance = dist2D(landmarks[4], landmarks[8]);

  // 펼쳐진 손가락 수
  const extended = countExtended(landmarks);

  // 제스처 판별
  let type: GestureType = 'none';
  let confidence = 0.8;

  if (pinchDistance < 0.06) {
    type = 'zoom';
    confidence = 0.9;
  } else if (extended >= 4) {
    type = 'rotate';
    confidence = 0.85;
  } else if (extended === 0) {
    type = 'pan';
    confidence = 0.85;
  } else if (extended === 1 && isFingerExtended(landmarks, 1)) {
    type = 'select';
    confidence = 0.9;
  }

  // 흔들기 감지 (최근 10프레임 x 방향 전환 3회 이상)
  positionHistory.push({ ...position });
  if (positionHistory.length > 10) positionHistory.shift();
  if (isWaving(positionHistory)) {
    type = 'reset';
    confidence = 0.85;
  }

  // confidence < 0.7 무시 (Design §2.4)
  if (confidence < 0.7) {
    type = 'none';
    confidence = 0;
  }

  // 3프레임 안정화
  gestureHistory.push(type);
  if (gestureHistory.length > 3) gestureHistory.shift();
  const stable = gestureHistory.length === 3 && gestureHistory.every(g => g === type);

  prevPosition = position;

  return {
    type: stable ? type : 'none',
    confidence: stable ? confidence : 0,
    position,
    delta,
    pinchDistance,
  };
}

export function resetGestureState() {
  prevPosition = { x: 0.5, y: 0.5 };
  gestureHistory = [];
  positionHistory = [];
}

function countExtended(lm: Landmark[]): number {
  let count = 0;
  // 엄지: 팁이 IP보다 x 방향으로 멀면 펼침
  if (Math.abs(lm[4].x - lm[2].x) > 0.04) count++;
  // 나머지 4개: 팁이 PIP보다 y가 작으면 (위쪽) 펼침
  for (let i = 1; i < 5; i++) {
    if (lm[TIPS[i]].y < lm[PIPS[i]].y - 0.02) count++;
  }
  return count;
}

function isFingerExtended(lm: Landmark[], fingerIdx: number): boolean {
  return lm[TIPS[fingerIdx]].y < lm[PIPS[fingerIdx]].y - 0.02;
}

function dist2D(a: Landmark, b: Landmark): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

function isWaving(history: Array<{ x: number; y: number }>): boolean {
  if (history.length < 8) return false;
  let dirChanges = 0;
  for (let i = 2; i < history.length; i++) {
    const prev = history[i - 1].x - history[i - 2].x;
    const curr = history[i].x - history[i - 1].x;
    if (prev * curr < 0 && Math.abs(curr) > 0.005) dirChanges++;
  }
  return dirChanges >= 3;
}
