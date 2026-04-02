import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createSqliteVecStore } from '../src/store/sqlite-vec.js';
import { createSearchEngine } from '../src/search/index.js';
import { createApiServer } from '../src/api/server.js';
import type { VectorStore } from '../src/store/types.js';
import type { Embedder } from '../src/indexer/embedder.js';

const DIMS = 4;
let store: VectorStore;
let server: ReturnType<typeof createApiServer>;
const PORT = 13333; // 테스트용 포트

function mockEmbedder(): Embedder {
  return {
    dimensions: DIMS, modelName: 'test',
    initialize: async () => {},
    embed: async () => [0.5, 0.5, 0.5, 0.5],
    embedBatch: async (texts) => texts.map(() => [0.5, 0.5, 0.5, 0.5]),
  };
}

beforeAll(async () => {
  store = createSqliteVecStore(':memory:', DIMS);
  await store.initialize();

  await store.upsertDocument({
    id: 'doc1', filePath: 'test.md', title: 'Test Doc',
    content: 'OAuth authentication patterns', frontmatter: {}, tags: ['auth'],
    lastModified: '2026-01-01', contentHash: 'h1',
  });
  await store.upsertChunks([{
    id: 'doc1#0', documentId: 'doc1', content: 'OAuth authentication patterns',
    heading: 'Auth', startLine: 1, endLine: 1, tokenCount: 3,
    embedding: [1, 0, 0, 0],
  }]);

  const embedder = mockEmbedder();
  const searchEngine = createSearchEngine({ store, embedder });
  server = createApiServer({ store, searchEngine, port: PORT });
  await server.start();
});

afterAll(async () => { await store.close(); });

describe('API Routes', () => {
  it('GET /api/stats', async () => {
    const res = await fetch(`http://127.0.0.1:${PORT}/api/stats`);
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data.documentCount).toBe(1);
    expect(data.chunkCount).toBe(1);
  });

  it('GET /api/graph', async () => {
    const res = await fetch(`http://127.0.0.1:${PORT}/api/graph`);
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data.data.nodes.length).toBe(1);
    expect(data.data.stats.nodeCount).toBe(1);
  });

  it('GET /api/graph?mode=folder', async () => {
    const res = await fetch(`http://127.0.0.1:${PORT}/api/graph?mode=folder`);
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data.data.clusters.length).toBeGreaterThan(0);
  });

  it('GET /api/search?q=OAuth', async () => {
    const res = await fetch(`http://127.0.0.1:${PORT}/api/search?q=OAuth`);
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data.query).toBe('OAuth');
    expect(data.results.length).toBeGreaterThan(0);
    expect(data.results[0].documentId).toBe('doc1');
  });

  it('GET /api/search 빈 쿼리', async () => {
    const res = await fetch(`http://127.0.0.1:${PORT}/api/search?q=`);
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data.results).toEqual([]);
  });

  it('GET /api/document/:id 존재', async () => {
    const res = await fetch(`http://127.0.0.1:${PORT}/api/document/doc1`);
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data.title).toBe('Test Doc');
    expect(data.content).toContain('OAuth');
    expect(data.related).toBeDefined();
  });

  it('GET /api/document/:id 미존재 → 404', async () => {
    const res = await fetch(`http://127.0.0.1:${PORT}/api/document/nonexistent`);
    expect(res.status).toBe(404);
  });
});
