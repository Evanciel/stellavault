// Design Ref: §6.2 — BM25 키워드 검색 (FTS5)

import type { VectorStore } from '../store/types.js';
import type { ScoredChunk } from '../types/chunk.js';

export async function searchBm25(
  store: VectorStore,
  query: string,
  limit: number,
): Promise<ScoredChunk[]> {
  // FTS5 쿼리 전처리: 특수문자 제거, 공백으로 OR 검색
  const sanitized = query.replace(/[^\w\s가-힣]/g, ' ').trim();
  if (!sanitized) return [];
  const ftsQuery = sanitized.split(/\s+/).join(' OR ');
  return store.searchKeyword(ftsQuery, limit);
}
