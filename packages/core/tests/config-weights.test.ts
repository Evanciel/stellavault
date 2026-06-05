// B3 §5.2 — config + env weight resolution.
import { describe, it, expect } from 'vitest';
import { writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig, resolveSearchWeights } from '../src/config.js';
import type { StellavaultConfig } from '../src/config.js';

const cfg = (
  weights?: { semantic?: number; bm25?: number; entity?: number },
  recencyWeight?: number,
): StellavaultConfig =>
  ({ search: { defaultLimit: 10, rrfK: 60, weights, recencyWeight } } as unknown as StellavaultConfig);

describe('search weight config (B3)', () => {
  it('11. defaults are weights {1,1,1.5} + recencyWeight 0.2', () => {
    // explicit config values pass through unchanged
    expect(resolveSearchWeights(cfg({ semantic: 1, bm25: 1, entity: 0.5 }, 0.2), {})).toEqual({
      semantic: 1, bm25: 1, entity: 0.5, recency: 0.2,
    });
    // missing config falls back to the built-in defaults (entity 1.5 since B2.1)
    expect(resolveSearchWeights(cfg(undefined, undefined), {})).toEqual({
      semantic: 1, bm25: 1, entity: 1.5, recency: 0.2,
    });
  });

  it('12. loadConfig deep-merges a partial search.weights override', () => {
    const p = join(tmpdir(), `sv-cfg-${process.pid}.json`);
    writeFileSync(p, JSON.stringify({ search: { weights: { entity: 0.3 } } }));
    try {
      const c = loadConfig(p);
      expect(c.search.weights).toEqual({ semantic: 1.0, bm25: 1.0, entity: 0.3 });
      expect(c.search.recencyWeight).toBe(0.2); // other search defaults preserved
      expect(c.search.rrfK).toBe(60);
    } finally {
      rmSync(p, { force: true });
    }
  });

  it('13. env overrides apply with finite/range guards', () => {
    const base = cfg({ semantic: 1, bm25: 1, entity: 0.5 }, 0.2);
    expect(resolveSearchWeights(base, { STELLAVAULT_RECENCY_WEIGHT: '0.4' }).recency).toBe(0.4);
    expect(resolveSearchWeights(base, { STELLAVAULT_RECENCY_WEIGHT: 'abc' }).recency).toBe(0.2); // invalid → fallback
    expect(resolveSearchWeights(base, { STELLAVAULT_RECENCY_WEIGHT: '5' }).recency).toBe(1);     // clamp >1 → 1
    expect(resolveSearchWeights(base, { STELLAVAULT_W_ENTITY: '0.8' }).entity).toBe(0.8);
    expect(resolveSearchWeights(base, { STELLAVAULT_W_ENTITY: '-1' }).entity).toBe(0.5);         // negative → fallback
    expect(resolveSearchWeights(base, { STELLAVAULT_W_ENTITY: '  ' }).entity).toBe(0.5);         // empty → fallback
  });
});
