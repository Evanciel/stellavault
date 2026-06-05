// Upgrade B2 — entity-linking search signal.
// Extracts candidate entities from the query and finds chunks that share them.
// Defensive: returns [] if the store predates searchEntities() (no regression).

import type { ScoredChunk } from '../types/chunk.js';
import type { VectorStore } from '../store/types.js';
import { extractQueryTerms } from '../indexer/entity-extractor.js';

export async function searchEntities(
  store: VectorStore,
  query: string,
  limit: number,
): Promise<ScoredChunk[]> {
  if (typeof (store as Partial<VectorStore>).searchEntities !== 'function') return [];
  const terms = extractQueryTerms(query);
  if (terms.length === 0) return [];
  return store.searchEntities(terms, limit);
}
