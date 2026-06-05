// B3 §5.2 — FSRS recency integration + per-query weight override (with a real store).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createSqliteVecStore } from '../src/store/sqlite-vec.js';
import { createSearchEngine } from '../src/search/index.js';
import { DecayEngine } from '../src/intelligence/decay-engine.js';
import type { VectorStore } from '../src/store/types.js';
import type { Embedder } from '../src/indexer/embedder.js';

const DIMS = 4;
const EMB = [0.5, 0.5, 0.5, 0.5];

function mockEmbedder(): Embedder {
  const v = (t: string) => [t.length % 3 / 3, t.length % 5 / 5, t.length % 7 / 7, t.length % 11 / 11];
  return { modelName: 'test-mock', dimensions: DIMS, embed: async (t) => v(t), embedBatch: async (ts) => ts.map(v) };
}

let store: VectorStore;
beforeEach(async () => {
  store = createSqliteVecStore(':memory:', DIMS);
  await store.initialize();
});
afterEach(async () => {
  await store.close();
});

// Two docs with content-identical chunks → equal RRF base; only recency/entity differs.
async function addDoc(id: string, entities: string[] = []) {
  await store.upsertDocument({
    id, filePath: `${id}.md`, title: id, content: 'c', frontmatter: {},
    tags: [], lastModified: '2026-01-01', contentHash: id,
  });
  await store.upsertChunks([{
    id: `${id}#0`, documentId: id, content: 'report draft', heading: '',
    startLine: 0, endLine: 1, tokenCount: 2, embedding: EMB, entities,
  }]);
}

function setDecay(documentId: string, stability: number, lastAccessIso: string) {
  const db = store.getDb() as any;
  db.prepare(
    'INSERT OR REPLACE INTO decay_state (document_id, stability, difficulty, last_access, retrievability, updated_at) VALUES (?,?,?,?,?,?)'
  ).run(documentId, stability, 5, lastAccessIso, 1.0, lastAccessIso);
}

describe('FSRS recency signal in fused search (B3)', () => {
  it('7. promotes a high-R doc over a content-identical low-R doc; no effect without the engine', async () => {
    await addDoc('hi');
    await addDoc('lo');
    const decay = new DecayEngine(store.getDb() as any); // ensures decay_state table
    const now = Date.now();
    setDecay('hi', 7, new Date(now).toISOString());                     // elapsed≈0 → R≈1.0 → ×1.1
    setDecay('lo', 7, new Date(now - 400 * 86400000).toISOString());    // 400d → R≈0.14 → ×~0.93

    const withDecay = await createSearchEngine({ store, embedder: mockEmbedder(), getDecayEngine: () => decay })
      .search({ query: 'report draft', limit: 10 });
    const hiW = withDecay.find((r) => r.chunk.id === 'hi#0')!;
    const loW = withDecay.find((r) => r.chunk.id === 'lo#0')!;
    expect(hiW).toBeDefined();
    expect(loW).toBeDefined();
    expect(hiW.score).toBeGreaterThan(loW.score); // recency wins on equal base
    expect(withDecay.findIndex((r) => r.chunk.id === 'hi#0'))
      .toBeLessThan(withDecay.findIndex((r) => r.chunk.id === 'lo#0'));

    const noDecay = await createSearchEngine({ store, embedder: mockEmbedder() })
      .search({ query: 'report draft', limit: 10 });
    const hiN = noDecay.find((r) => r.chunk.id === 'hi#0')!;
    const loN = noDecay.find((r) => r.chunk.id === 'lo#0')!;
    // Isolate the recency effect: high-R boosted above baseline, low-R demoted below it.
    expect(hiW.score).toBeGreaterThan(hiN.score);
    expect(loW.score).toBeLessThan(loN.score);
  });

  it('8. a document without a decay_state row participates normally (neutral)', async () => {
    await addDoc('has');
    await addDoc('none');
    const decay = new DecayEngine(store.getDb() as any);
    setDecay('has', 7, new Date().toISOString()); // only 'has' has a row

    const res = await createSearchEngine({ store, embedder: mockEmbedder(), getDecayEngine: () => decay })
      .search({ query: 'report draft', limit: 10 });
    expect(res.find((r) => r.chunk.id === 'none#0')).toBeDefined(); // included, no crash
  });

  it('9. getRetrievabilityForDocs handles empty and unknown ids without throwing', async () => {
    const decay = new DecayEngine(store.getDb() as any);
    expect((await decay.getRetrievabilityForDocs([])).size).toBe(0);
    expect((await decay.getRetrievabilityForDocs(['does-not-exist'])).size).toBe(0);
  });
});

describe('per-query signalWeights override (B3)', () => {
  it('10. mutes entity for that call only, leaving later calls unaffected', async () => {
    await store.upsertDocument({
      id: 'doc', filePath: 'doc.md', title: 'Doc', content: 'c', frontmatter: {},
      tags: [], lastModified: '2026-01-01', contentHash: 'doc',
    });
    await store.upsertChunks([
      { id: 'doc#x', documentId: 'doc', content: 'report draft', heading: '', startLine: 0, endLine: 1, tokenCount: 2, embedding: EMB, entities: ['acme corp'] },
      { id: 'doc#y', documentId: 'doc', content: 'report draft', heading: '', startLine: 0, endLine: 1, tokenCount: 2, embedding: EMB, entities: [] },
    ]);
    const engine = createSearchEngine({ store, embedder: mockEmbedder() }); // no decay

    const def = await engine.search({ query: 'Acme Corp report', limit: 10 });
    expect(def.findIndex((r) => r.chunk.id === 'doc#x'))
      .toBeLessThan(def.findIndex((r) => r.chunk.id === 'doc#y')); // entity lifts x

    const muted = await engine.search({ query: 'Acme Corp report', limit: 10, signalWeights: { entity: 0 } });
    const xm = muted.find((r) => r.chunk.id === 'doc#x')!;
    const ym = muted.find((r) => r.chunk.id === 'doc#y')!;
    expect(xm.score).toBeCloseTo(ym.score); // entity muted → identical base

    const again = await engine.search({ query: 'Acme Corp report', limit: 10 });
    expect(again.findIndex((r) => r.chunk.id === 'doc#x'))
      .toBeLessThan(again.findIndex((r) => r.chunk.id === 'doc#y')); // override was per-call
  });
});
