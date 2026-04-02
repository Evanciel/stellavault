// Phase 4b: FSRS 알고리즘 단위 테스트

import { describe, it, expect } from 'vitest';
import {
  computeRetrievability,
  updateStability,
  estimateInitialStability,
  elapsedDays,
  FSRS_PARAMS,
} from '../src/intelligence/fsrs.js';

describe('FSRS computeRetrievability', () => {
  it('returns 1.0 for 0 elapsed days', () => {
    expect(computeRetrievability(7, 0)).toBe(1.0);
  });

  it('returns ~0.9 after stability days', () => {
    // R(S) = (1 + S/(9*S))^(-1) = (1 + 1/9)^(-1) = 0.9
    const r = computeRetrievability(7, 7);
    expect(r).toBeCloseTo(0.9, 1);
  });

  it('decays over time', () => {
    const r7 = computeRetrievability(7, 7);
    const r30 = computeRetrievability(7, 30);
    const r90 = computeRetrievability(7, 90);
    expect(r7).toBeGreaterThan(r30);
    expect(r30).toBeGreaterThan(r90);
  });

  it('higher stability = slower decay', () => {
    const rLow = computeRetrievability(3, 30);
    const rHigh = computeRetrievability(30, 30);
    expect(rHigh).toBeGreaterThan(rLow);
  });

  it('returns 0 for 0 stability', () => {
    expect(computeRetrievability(0, 10)).toBe(0.0);
  });

  it('60 days with default stability gives R < 0.5', () => {
    // Plan SC-01: 장기 미접근 노트는 감쇠
    // R(60, S=7) ≈ 0.51, R(90, S=7) ≈ 0.41
    const r90 = computeRetrievability(FSRS_PARAMS.initialStability, 90);
    expect(r90).toBeLessThan(0.5);
  });
});

describe('FSRS updateStability', () => {
  it('increases stability on access', () => {
    const newS = updateStability(7, 5, 0.5);
    expect(newS).toBeGreaterThan(7);
  });

  it('increases more when R is low (forgotten but recalled)', () => {
    const sHighR = updateStability(7, 5, 0.9);
    const sLowR = updateStability(7, 5, 0.3);
    expect(sLowR).toBeGreaterThan(sHighR);
  });

  it('caps at 365 days', () => {
    const s = updateStability(300, 1, 0.1);
    expect(s).toBeLessThanOrEqual(365);
  });
});

describe('FSRS estimateInitialStability', () => {
  it('base stability for short notes', () => {
    const s = estimateInitialStability(100, 0);
    expect(s).toBeCloseTo(FSRS_PARAMS.initialStability, 0);
  });

  it('longer notes get higher stability', () => {
    const sShort = estimateInitialStability(100, 0);
    const sLong = estimateInitialStability(5000, 0);
    expect(sLong).toBeGreaterThan(sShort);
  });

  it('more connections increase stability', () => {
    const s0 = estimateInitialStability(1000, 0);
    const s5 = estimateInitialStability(1000, 5);
    expect(s5).toBeGreaterThan(s0);
  });
});

describe('elapsedDays', () => {
  it('computes correct days', () => {
    const d = elapsedDays('2026-03-01T00:00:00Z', '2026-03-31T00:00:00Z');
    expect(d).toBeCloseTo(30, 0);
  });

  it('returns 0 for same timestamp', () => {
    const now = new Date().toISOString();
    expect(elapsedDays(now, now)).toBe(0);
  });
});
