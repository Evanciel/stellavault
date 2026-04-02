// Design Ref: §6.2 — 시맨틱 벡터 검색

import type { Embedder } from '../indexer/embedder.js';
import type { VectorStore } from '../store/types.js';
import type { ScoredChunk } from '../types/chunk.js';

export async function searchSemantic(
  store: VectorStore,
  embedder: Embedder,
  query: string,
  limit: number,
): Promise<ScoredChunk[]> {
  const embedding = await embedder.embed(query);
  return store.searchSemantic(embedding, limit);
}
