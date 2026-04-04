// Design Ref: §4.1 — 컨텍스트 수집 + reranking
// Plan SC: SC-05 NDCG 15%+ 향상, SC-06 기존 116 tests 통과

import type { SearchEngine } from './index.js';
import type { SearchResult, SearchOptions } from '../types/search.js';

export interface SearchContext {
  recentSearches?: string[];
  recentDocTags?: string[];
  currentFilePath?: string;
}

export interface AdaptiveSearchEngine extends SearchEngine {
  search(options: SearchOptions & { context?: SearchContext }): Promise<SearchResult[]>;
}

export function createAdaptiveSearch(deps: {
  baseSearch: SearchEngine;
}): AdaptiveSearchEngine {
  const { baseSearch } = deps;

  // In-memory context (session-scoped)
  const searchHistory: string[] = [];
  const recentTags: string[] = [];

  return {
    async search(options: SearchOptions & { context?: SearchContext }): Promise<SearchResult[]> {
      const { context, ...baseOptions } = options;

      // 1. Base search
      const results = await baseSearch.search(baseOptions);

      // 2. No context → return as-is (backwards compatible)
      if (!context && searchHistory.length === 0) return results;

      // 3. Build effective context
      const ctx: SearchContext = {
        recentSearches: context?.recentSearches ?? searchHistory.slice(-5),
        recentDocTags: context?.recentDocTags ?? recentTags.slice(-10),
        currentFilePath: context?.currentFilePath,
      };

      // 4. Rerank based on context
      const reranked = results.map((r) => {
        let boost = 0;

        // Tag overlap boost (0 ~ 0.3)
        const docTags = ctx.recentDocTags ?? [];
        if (docTags.length > 0 && r.document.tags.length > 0) {
          const docTagSet = new Set(r.document.tags);
          const overlap = docTags.filter((t) => docTagSet.has(t)).length;
          boost += Math.min(overlap / Math.max(docTags.length, 1), 1) * 0.3;
        }

        // File path proximity boost (0 ~ 0.2)
        if (ctx.currentFilePath && r.document.filePath) {
          const ctxParts = ctx.currentFilePath.split('/');
          const docParts = r.document.filePath.split('/');
          let common = 0;
          for (let i = 0; i < Math.min(ctxParts.length, docParts.length); i++) {
            if (ctxParts[i] === docParts[i]) common++;
            else break;
          }
          if (common > 0) {
            boost += Math.min(common / Math.max(ctxParts.length - 1, 1), 1) * 0.2;
          }
        }

        return { ...r, score: r.score * (1 + boost) };
      });

      // 5. Re-sort
      reranked.sort((a, b) => b.score - a.score);

      // 6. Update history
      searchHistory.push(options.query);
      if (searchHistory.length > 20) searchHistory.shift();

      // Track tags from top results for future context
      for (const r of reranked.slice(0, 3)) {
        for (const t of r.document.tags) {
          recentTags.push(t);
        }
      }
      while (recentTags.length > 30) recentTags.shift();

      return reranked;
    },
  };
}
