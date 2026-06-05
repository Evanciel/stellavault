// Upgrade B2 — entity-linking search signal.
// Extracts candidate entities from the query and finds chunks that share them.
// Defensive: returns [] if the store predates searchEntities() (no regression).

import type { ScoredChunk } from '../types/chunk.js';
import type { VectorStore } from '../store/types.js';
import { extractQueryTerms, expandWithAliases } from '../indexer/entity-extractor.js';

export async function searchEntities(
  store: VectorStore,
  query: string,
  limit: number,
  aliasIndex?: Map<string, string[]>,
): Promise<ScoredChunk[]> {
  if (typeof (store as Partial<VectorStore>).searchEntities !== 'function') return [];
  const terms = extractQueryTerms(query);
  if (terms.length === 0) return [];
  // B2.2 — alias/synonym terms (e.g. "jarvis" from a "자비스" query) are matched
  // EXACT-only, never fuzzy-broadened (which would match "jarvis agent core", etc.).
  const aliasExact = expandWithAliases(terms, aliasIndex).filter(t => !terms.includes(t));
  return store.searchEntities(terms, limit, aliasExact);
}
