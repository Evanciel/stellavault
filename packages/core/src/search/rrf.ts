// Design Ref: §6.2 — Reciprocal Rank Fusion (k=60)

import type { ScoredChunk } from '../types/chunk.js';

/**
 * RRF: 두 랭킹 리스트를 통합하여 최종 점수를 산출합니다.
 * score(d) = Σ 1/(k + rank_i) for each ranker i
 */
/**
 * Generalized RRF over N ranked lists. Empty lists contribute nothing, so an
 * absent signal (e.g. no entity matches) leaves the fusion unchanged.
 */
export function rrfFusionN(
  lists: ScoredChunk[][],
  k: number = 60,
  limit: number = 10,
): ScoredChunk[] {
  const scores = new Map<string, number>();

  for (const list of lists) {
    for (let i = 0; i < list.length; i++) {
      const id = list[i].chunkId;
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + i + 1));
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
