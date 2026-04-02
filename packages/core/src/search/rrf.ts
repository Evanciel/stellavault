// Design Ref: §6.2 — Reciprocal Rank Fusion (k=60)

import type { ScoredChunk } from '../types/chunk.js';

/**
 * RRF: 두 랭킹 리스트를 통합하여 최종 점수를 산출합니다.
 * score(d) = Σ 1/(k + rank_i) for each ranker i
 */
export function rrfFusion(
  listA: ScoredChunk[],
  listB: ScoredChunk[],
  k: number = 60,
  limit: number = 10,
): ScoredChunk[] {
  const scores = new Map<string, number>();

  for (let i = 0; i < listA.length; i++) {
    const id = listA[i].chunkId;
    scores.set(id, (scores.get(id) ?? 0) + 1 / (k + i + 1));
  }

  for (let i = 0; i < listB.length; i++) {
    const id = listB[i].chunkId;
    scores.set(id, (scores.get(id) ?? 0) + 1 / (k + i + 1));
  }

  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([chunkId, score]) => ({ chunkId, score }));
}
