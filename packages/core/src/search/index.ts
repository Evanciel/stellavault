// Design Ref: §4.2 — createSearchEngine

import type { Embedder } from '../indexer/embedder.js';
import type { VectorStore } from '../store/types.js';
import type { SearchResult, SearchOptions } from '../types/search.js';
import { searchBm25 } from './bm25.js';
import { searchSemantic } from './semantic.js';
import { searchEntities } from './entity.js';
import { rrfFusionN } from './rrf.js';
import type { ScoredChunk } from '../types/chunk.js';
import type { DecayEngine } from '../intelligence/decay-engine.js';

export { rrfFusion } from './rrf.js';
export { createAdaptiveSearch } from './adaptive.js';
export type { SearchContext, AdaptiveSearchEngine } from './adaptive.js';

export interface SearchEngine {
  search(options: SearchOptions): Promise<SearchResult[]>;
}

// Design Ref: B3 §1.2 / §1.3 — research-backed safe defaults.
export interface SignalWeights {
  semantic?: number;
  bm25?: number;
  entity?: number;
  /** Strength of the post-fusion FSRS recency multiplier (0 = off). */
  recency?: number;
}

export const DEFAULT_SIGNAL_WEIGHTS: Required<SignalWeights> = {
  semantic: 1.0,
  bm25: 1.0,
  entity: 1.5,   // B2.1: leading curated-graph signal. Per-doc cap in searchEntities
                 // prevents one large note flooding top-k. Tune via STELLAVAULT_W_ENTITY
                 // (e.g. 2.0 for aggressive project-name surfacing, 0.5 for conservative).
  recency: 0.2,  // ±10% bound on relevance
};

export function createSearchEngine(deps: {
  store: VectorStore;
  embedder: Embedder;
  rrfK?: number;
  /** Per-signal weights (config/env-supplied). Missing fields fall back to
   *  DEFAULT_SIGNAL_WEIGHTS — callers that omit this are unchanged except for the
   *  conservative entity=0.5 default. (B3 §3.2) */
  weights?: SignalWeights;
  /** Lazy accessor for the FSRS decay engine. Returns undefined until the store
   *  DB is initialized (lazy-init arch) or when recency is unavailable (e.g. the
   *  CLI fresh-process path) → recency cleanly disabled, weights still apply. (B3 §3.4) */
  getDecayEngine?: () => DecayEngine | undefined;
}): SearchEngine {
  const { store, embedder, rrfK = 60, getDecayEngine } = deps;
  const baseWeights = { ...DEFAULT_SIGNAL_WEIGHTS, ...deps.weights };
  const FETCH_LIMIT = 30; // 각 검색에서 가져올 후보 수

  return {
    async search(options: SearchOptions): Promise<SearchResult[]> {
      const { query, limit = 10, threshold = 0.0, tags, signalWeights } = options;

      // Per-query override merges over the engine/config default. (B3 §3.5)
      const w = { ...baseWeights, ...signalWeights };

      // 병렬로 BM25 + Semantic + Entity 검색
      const [bm25Results, semanticResults, entityResults] = await Promise.all([
        searchBm25(store, query, FETCH_LIMIT),
        searchSemantic(store, embedder, query, FETCH_LIMIT),
        searchEntities(store, query, FETCH_LIMIT),
      ]);

      // POSITIONAL: [semantic, bm25, entity] — the weights array MUST match this order.
      const lists = [semanticResults, bm25Results, entityResults];
      const weights = [w.semantic, w.bm25, w.entity];

      // FSRS recency map only when a decay engine is reachable (graceful skip). (B3 §3.3)
      const decay = getDecayEngine?.();
      const recencyScores = decay
        ? await buildRecencyMap(store, decay, lists)
        : undefined;

      // Weighted RRF Fusion (semantic + BM25 + entity) + bounded recency. (B2/B3)
      // Empty entity list → no-op. opts default → identical to pre-B3 equal weight.
      const fused = rrfFusionN(lists, rrfK, limit * 2, {
        weights,
        recencyScores,
        recencyWeight: recencyScores ? w.recency : 0,
      });

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

// Design Ref: B3 §3.2/§3.3 — map fused candidate chunkIds → FSRS retrievability via
// documentId. Read-only; missing decay_state rows are simply absent from the map
// (rrfFusionN then treats them as neutral R=0.5 → multiplier 1.0). Bounded by
// FETCH_LIMIT × number of signal lists (≤ ~90 candidates).
async function buildRecencyMap(
  store: VectorStore,
  decay: DecayEngine,
  lists: ScoredChunk[][],
): Promise<Map<string, number>> {
  const chunkIds = new Set<string>();
  for (const list of lists) for (const c of list) chunkIds.add(c.chunkId);
  if (chunkIds.size === 0) return new Map();

  const chunkDoc: Array<{ chunkId: string; documentId: string }> = [];
  const docIds = new Set<string>();
  for (const chunkId of chunkIds) {
    const chunk = await store.getChunk(chunkId);
    if (!chunk) continue;
    chunkDoc.push({ chunkId, documentId: chunk.documentId });
    docIds.add(chunk.documentId);
  }
  if (docIds.size === 0) return new Map();

  const rByDoc = await decay.getRetrievabilityForDocs([...docIds]);
  const map = new Map<string, number>();
  for (const { chunkId, documentId } of chunkDoc) {
    const r = rByDoc.get(documentId);
    if (r !== undefined) map.set(chunkId, r);
  }
  return map;
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
