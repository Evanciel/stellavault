import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createSqliteVecStore } from '../src/store/sqlite-vec.js';
import { createSearchEngine } from '../src/search/index.js';
import type { VectorStore } from '../src/store/types.js';
import type { Embedder } from '../src/indexer/embedder.js';

const DIMS = 4;
function mockEmbedder(): Embedder {
  const v = (t: string) => [t.length % 3 / 3, t.length % 5 / 5, t.length % 7 / 7, t.length % 11 / 11];
  return {
    modelName: 'test-mock',
    dimensions: DIMS,
    embed: async (t: string) => v(t),
    embedBatch: async (ts: string[]) => ts.map(v),
  };
}

let store: VectorStore;
beforeEach(async () => {
  store = createSqliteVecStore(':memory:', DIMS);
  await store.initialize();
});
afterEach(async () => {
  await store.close();
});

describe('store.searchEntities', () => {
  beforeEach(async () => {
    await store.upsertDocument({
      id: 'd1', filePath: 'a.md', title: 'A', content: 'a', frontmatter: {},
      tags: [], lastModified: '2026-01-01', contentHash: 'h1',
    });
    await store.upsertChunks([
      { id: 'd1#0', documentId: 'd1', content: 'x', heading: '', startLine: 0, endLine: 1, tokenCount: 1, embedding: [0.1, 0.1, 0.1, 0.1], entities: ['quantum ledger', 'acme corp'] },
      { id: 'd1#1', documentId: 'd1', content: 'y', heading: '', startLine: 0, endLine: 1, tokenCount: 1, embedding: [0.2, 0.2, 0.2, 0.2], entities: ['acme corp'] },
    ]);
  });

  it('ranks chunks by number of matching entities', async () => {
    const r = await store.searchEntities(['quantum ledger', 'acme corp'], 10);
    expect(r[0].chunkId).toBe('d1#0'); // 2 matches
    expect(r[0].score).toBe(2);
    expect(r.map(x => x.chunkId)).toContain('d1#1'); // 1 match
  });

  it('returns [] for no matches', async () => {
    expect(await store.searchEntities(['nonexistent'], 10)).toEqual([]);
  });

  it('returns [] for empty input', async () => {
    expect(await store.searchEntities([], 10)).toEqual([]);
  });

  it('clears stale entities on re-index (FK cascade)', async () => {
    await store.upsertChunks([
      { id: 'd1#0', documentId: 'd1', content: 'x', heading: '', startLine: 0, endLine: 1, tokenCount: 1, embedding: [0.1, 0.1, 0.1, 0.1], entities: ['new entity'] },
    ]);
    expect(await store.searchEntities(['quantum ledger'], 10)).toEqual([]);
  });
});

describe('fuzzy entity matching (B2.1)', () => {
  beforeEach(async () => {
    await store.upsertDocument({
      id: 'd1', filePath: 'a.md', title: 'A', content: 'a', frontmatter: {},
      tags: [], lastModified: '2026-01-01', contentHash: 'h1',
    });
  });

  it('matches a query phrase against a longer stored entity (substring, no reindex)', async () => {
    await store.upsertChunks([
      { id: 'd1#0', documentId: 'd1', content: 'x', heading: '', startLine: 0, endLine: 1, tokenCount: 1, embedding: [0.1, 0.1, 0.1, 0.1], entities: ['ai destiny (운명 프리즘)'] },
    ]);
    // "운명 프리즘" is NOT an exact stored entity, only a substring of the stored one.
    const r = await store.searchEntities(['운명 프리즘'], 10);
    expect(r.map(x => x.chunkId)).toContain('d1#0');
  });

  it('ranks an exact match above a fuzzy-only superset match', async () => {
    await store.upsertChunks([
      { id: 'exact', documentId: 'd1', content: 'x', heading: '', startLine: 0, endLine: 1, tokenCount: 1, embedding: [0.1, 0.1, 0.1, 0.1], entities: ['quantum ledger'] },
      { id: 'fuzzy', documentId: 'd1', content: 'y', heading: '', startLine: 0, endLine: 1, tokenCount: 1, embedding: [0.2, 0.2, 0.2, 0.2], entities: ['the quantum ledger system'] },
    ]);
    const r = await store.searchEntities(['quantum ledger'], 10);
    const ei = r.findIndex(x => x.chunkId === 'exact');
    const fi = r.findIndex(x => x.chunkId === 'fuzzy');
    expect(ei).toBeGreaterThanOrEqual(0);
    expect(fi).toBeGreaterThanOrEqual(0);
    expect(ei).toBeLessThan(fi); // exact (1.0) ranks above fuzzy-only (0.4)
  });

  it('keeps short/common tokens exact-only (no fuzzy noise)', async () => {
    await store.upsertChunks([
      { id: 'd1#0', documentId: 'd1', content: 'x', heading: '', startLine: 0, endLine: 1, tokenCount: 1, embedding: [0.1, 0.1, 0.1, 0.1], entities: ['ai destiny (운명 프리즘)'] },
    ]);
    // 'ai' (len 2) is not fuzzy-eligible → exact-only → must NOT match the longer entity.
    expect(await store.searchEntities(['ai'], 10)).toEqual([]);
  });
});

describe('entity signal in fused search', () => {
  it('boosts an otherwise-identical chunk that matches an entity', async () => {
    await store.upsertDocument({
      id: 'doc', filePath: 'doc.md', title: 'Doc', content: 'c', frontmatter: {},
      tags: [], lastModified: '2026-01-01', contentHash: 'hh',
    });
    // X and Y are identical (same content + same embedding); only X carries the
    // entity. Everything else equal → the entity signal alone must lift X over Y.
    const emb = [0.5, 0.5, 0.5, 0.5];
    await store.upsertChunks([
      { id: 'doc#x', documentId: 'doc', content: 'report draft', heading: '', startLine: 0, endLine: 1, tokenCount: 2, embedding: emb, entities: ['acme corp'] },
      { id: 'doc#y', documentId: 'doc', content: 'report draft', heading: '', startLine: 0, endLine: 1, tokenCount: 2, embedding: emb, entities: [] },
    ]);

    const engine = createSearchEngine({ store, embedder: mockEmbedder() });
    const results = await engine.search({ query: 'Acme Corp report', limit: 10 });

    const xi = results.findIndex(r => r.chunk.id === 'doc#x');
    const yi = results.findIndex(r => r.chunk.id === 'doc#y');
    expect(xi).toBeGreaterThanOrEqual(0);
    expect(yi).toBeGreaterThanOrEqual(0);
    expect(xi).toBeLessThan(yi); // entity-matching chunk ranks higher
  });
});
