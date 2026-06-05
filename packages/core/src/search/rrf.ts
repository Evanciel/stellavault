// Design Ref: §6.2 — Reciprocal Rank Fusion (weighted, k=60)
// Design Ref: §B3.3.1 — per-signal weights + bounded recency multiplier
// Plan SC: SC-06 — existing rrf.test.ts / search-integration.test.ts stay green

import type { ScoredChunk } from '../types/chunk.js';

export interface RrfOptions {
  /** Per-list multipliers, positional. Missing/undefined → weight 1 for all
   *  (reproduces pre-B3 equal-weight behavior exactly). */
  weights?: number[];
  /** chunkId → FSRS retrievability R∈[0,1]. Absent entry → R treated as 0.5
   *  (multiplier 1.0, no penalty). Undefined map → recency disabled entirely. */
  recencyScores?: Map<string, number>;
  /** Strength of the recency multiplier. 0 → recency off. Default 0. */
  recencyWeight?: number;
}

/**
 * RRF: 두 랭킹 리스트를 통합하여 최종 점수를 산출합니다.
 * score(d) = Σ w_i · 1/(k + rank_i) for each ranker i
 */
/**
 * Generalized weighted RRF over N ranked lists. Empty lists contribute nothing, so
 * an absent signal (e.g. no entity matches) leaves the fusion unchanged. With
 * `opts = {}` (the default) every list weight is 1 and recency is off → identical
 * to the pre-B3 equal-weight fusion.
 */
export function rrfFusionN(
  lists: ScoredChunk[][],
  k: number = 60,
  limit: number = 10,
  opts: RrfOptions = {},
): ScoredChunk[] {
  const { weights, recencyScores, recencyWeight = 0 } = opts;
  const scores = new Map<string, number>();

  for (let li = 0; li < lists.length; li++) {
    const w = weights?.[li] ?? 1; // SC-06: undefined → 1 (no behavior change)
    const list = lists[li];
    for (let i = 0; i < list.length; i++) {
      const id = list[i].chunkId;
      scores.set(id, (scores.get(id) ?? 0) + w * (1 / (k + i + 1)));
    }
  }

  // Bounded recency modulation (post-fusion). Off when recencyWeight === 0 OR
  // recencyScores is undefined → byte-identical to pre-B3 output. Centered at
  // R = 0.5 so the median note is unchanged; ±(recencyWeight·0.5) bound.
  if (recencyWeight > 0 && recencyScores) {
    for (const [id, s] of scores) {
      const r = recencyScores.get(id) ?? 0.5; // missing → neutral
      scores.set(id, s * (1 + recencyWeight * (r - 0.5)));
    }
  }

  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([chunkId, score]) => ({ chunkId, score }));
}

/** Two-list RRF (semantic + BM25). Retained for backward compatibility. */
export function rrfFusion(
  listA: ScoredChunk[],
  listB: ScoredChunk[],
  k: number = 60,
  limit: number = 10,
): ScoredChunk[] {
  return rrfFusionN([listA, listB], k, limit);
}
