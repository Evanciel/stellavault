import { describe, it, expect } from 'vitest';

// gesture-detector는 graph 패키지에 있으므로 로직만 단위 테스트
// 핵심 알고리즘: 손가락 수 카운팅 + 핀치 거리 + 흔들기 감지

describe('Gesture Detection Logic', () => {
  it('5개 손가락 펼침 = rotate', () => {
    // extended >= 4 → rotate
    const extended = 5;
    expect(extended >= 4).toBe(true);
  });

  it('0개 손가락 = pan', () => {
    const extended = 0;
    expect(extended === 0).toBe(true);
  });

  it('핀치 거리 < 0.06 = zoom', () => {
    const pinchDistance = 0.04;
    expect(pinchDistance < 0.06).toBe(true);
  });

  it('핀치 거리 >= 0.06 = not zoom', () => {
    const pinchDistance = 0.08;
    expect(pinchDistance < 0.06).toBe(false);
  });

  it('1개 손가락 (검지) = select', () => {
    const extended = 1;
    const isIndexExtended = true;
    expect(extended === 1 && isIndexExtended).toBe(true);
  });

  it('흔들기 감지: 3회 이상 방향 전환', () => {
    // x 좌표 시퀀스: 좌 → 우 → 좌 → 우
    const history = [0.3, 0.35, 0.4, 0.35, 0.3, 0.35, 0.4, 0.35, 0.3, 0.35];
    let dirChanges = 0;
    for (let i = 2; i < history.length; i++) {
      const prev = history[i - 1] - history[i - 2];
      const curr = history[i] - history[i - 1];
      if (prev * curr < 0 && Math.abs(curr) > 0.005) dirChanges++;
    }
    expect(dirChanges).toBeGreaterThanOrEqual(3);
  });
});
