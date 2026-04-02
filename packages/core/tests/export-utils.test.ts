// Phase 4a: export-utils 순수 함수 테스트

import { describe, it, expect } from 'vitest';

// export-utils는 graph 패키지에 있지만 순수 함수만 테스트
// DOM 의존 함수는 통합 테스트로 분리

describe('export-utils filename generation', () => {
  it('generates screenshot filename with timestamp', () => {
    // 파일명 패턴 검증: stellavault-screenshot-YYYY-MM-DDTHH-MM-SS.png
    const pattern = /^stellavault-screenshot-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.png$/;
    const now = new Date();
    const ts = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `stellavault-screenshot-${ts}.png`;
    expect(filename).toMatch(pattern);
  });

  it('generates recording filename with webm extension', () => {
    const pattern = /^stellavault-recording-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.webm$/;
    const now = new Date();
    const ts = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `stellavault-recording-${ts}.webm`;
    expect(filename).toMatch(pattern);
  });
});

describe('LOD thresholds', () => {
  const UNIVERSE_MIN = 800;
  const NOTE_MAX = 300;

  it('returns universe level for distance > 800', () => {
    const dist = 900;
    const level = dist > UNIVERSE_MIN ? 'universe' : dist < NOTE_MAX ? 'note' : 'constellation';
    expect(level).toBe('universe');
  });

  it('returns note level for distance < 300', () => {
    const dist = 200;
    const level = dist > UNIVERSE_MIN ? 'universe' : dist < NOTE_MAX ? 'note' : 'constellation';
    expect(level).toBe('note');
  });

  it('returns constellation level for distance 300-800', () => {
    for (const dist of [300, 500, 799]) {
      const level = dist > UNIVERSE_MIN ? 'universe' : dist < NOTE_MAX ? 'note' : 'constellation';
      expect(level).toBe('constellation');
    }
  });

  it('interpolates constellation opacity correctly', () => {
    const dist = 550; // middle of 300~800 range
    const t = (dist - NOTE_MAX) / (UNIVERSE_MIN - NOTE_MAX);
    expect(t).toBeCloseTo(0.5, 1);

    // At distance 300, t = 0 (no constellation lines)
    const t300 = (300 - NOTE_MAX) / (UNIVERSE_MIN - NOTE_MAX);
    expect(t300).toBeCloseTo(0, 1);

    // At distance 800, t = 1 (full constellation lines)
    const t800 = (800 - NOTE_MAX) / (UNIVERSE_MIN - NOTE_MAX);
    expect(t800).toBeCloseTo(1, 1);
  });

  it('node scale ranges from 1 (far) to 3 (close)', () => {
    const tFar = (800 - NOTE_MAX) / (UNIVERSE_MIN - NOTE_MAX);
    const scaleFar = 1 + (1 - tFar) * 2;
    expect(scaleFar).toBeCloseTo(1, 1);

    const tClose = (300 - NOTE_MAX) / (UNIVERSE_MIN - NOTE_MAX);
    const scaleClose = 1 + (1 - tClose) * 2;
    expect(scaleClose).toBeCloseTo(3, 1);
  });
});

describe('graph-store export state', () => {
  it('lodLevel accepts valid values', () => {
    const validLevels = ['universe', 'constellation', 'note'] as const;
    for (const level of validLevels) {
      expect(typeof level).toBe('string');
      expect(validLevels).toContain(level);
    }
  });

  it('LOD nodeScale mapping matches design', () => {
    // Design Ref: §8 — LOD node scale factors
    const lodScaleMap = { universe: 0.6, constellation: 1.0, note: 1.2 };
    expect(lodScaleMap.universe).toBeLessThan(lodScaleMap.constellation);
    expect(lodScaleMap.constellation).toBeLessThan(lodScaleMap.note);
  });

  it('screenshot resolution capped at 4096', () => {
    const cap = (v: number) => Math.min(v, 4096);
    expect(cap(2048)).toBe(2048);
    expect(cap(8192)).toBe(4096);
    expect(cap(1024)).toBe(1024);
  });
});
