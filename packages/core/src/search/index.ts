// Design Ref: §4.2 — createSearchEngine

import type { Embedder } from '../indexer/embedder.js';
import type { VectorStore } from '../store/types.js';
import type { SearchResult, SearchOptions } from '../types/search.js';
import { searchBm25 } from './bm25.js';
import { searchSemantic } from './semantic.js';
import { rrfFusion } from './rrf.js';

export { rrfFusion } from './rrf.js';
export { createAdaptiveSearch } from './adaptive.js';
export type { SearchContext, AdaptiveSearchEngine } from './adaptive.js';

export interface SearchEngine {
  search(options: SearchOptions): Promise<SearchResult[]>;
}

export function createSearchEngine(deps: {
  store: VectorStore;
  embedder: Embedder;
  rrfK?: number;
}): SearchEngine {
  const { store, embedder, rrfK = 60 } = deps;
  const FETCH_LIMIT = 30; // 각 검색에서 가져올 후보 수

  return {
    async search(options: SearchOptions): Promise<SearchResult[]> {
      const { query, limit = 10, threshold = 0.0, tags } = options;

      // 병렬로 BM25 + Semantic 검색
      const [bm25Results, semanticResults] = await Promise.all([
        searchBm25(store, query, FETCH_LIMIT),
        searchSemantic(store, embedder, query, FETCH_LIMIT),
      ]);

      // RRF Fusion
      const fused = rrfFusion(semanticResults, bm25Results, rrfK, limit * 2);

      // 청크+문서 조회 + 필터링
      const results: SearchResult[] = [];
      for (const scored of fused) {
        if (scored.score < threshold) continue;

        const chunk = await store.getChunk(scored.chunkId);
        if (!chunk) continue;

        const document = await store.getDocument(chunk.documentId);
        if (!document) continue;

        // 태그 필터
        if (tags && tags.length > 0) {
          const docTags = new Set(document.tags);
          if (!tags.some(t => docTags.has(t))) continue;
        }

        results.push({
          chunk,
          document,
          score: scored.score,
          highlights: extractHighlights(chunk.content, query),
        });

        if (results.length >= limit) break;
      }

      return results;
    },
  };
}

function extractHighlights(content: string, query: string): string[] {
  const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 1);
  const lines = content.split('\n');
  const highlights: string[] = [];

  for (const line of lines) {
    const lower = line.toLowerCase();
    if (words.some(w => lower.includes(w))) {
      highlights.push(line.trim());
      if (highlights.length >= 3) break;
    }
  }

  return highlights;
}
