import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createSqliteVecStore } from '../src/store/sqlite-vec.js';
import { createSearchEngine } from '../src/search/index.js';
import { createApiServer } from '../src/api/server.js';
import type { VectorStore } from '../src/store/types.js';

const DIMS = 4;
const PORT = 13334;
let store: VectorStore;

beforeAll(async () => {
  store = createSqliteVecStore(':memory:', DIMS);
  await store.initialize();
  await store.upsertDocument({
    id: 'doc1', filePath: 'test.md', title: 'Test',
    content: 'Content', frontmatter: {}, tags: ['test'],
    lastModified: '2026-01-01', contentHash: 'h1',
  });
  await store.upsertChunks([{
    id: 'doc1#0', documentId: 'doc1', content: 'Content',
    heading: 'Test', startLine: 1, endLine: 1, tokenCount: 2,
    embedding: [1, 0, 0, 0],
  }]);

  const embedder = {
    dimensions: DIMS, modelName: 'test',
    initialize: async () => {},
    embed: async () => [0.5, 0.5, 0.5, 0.5],
    embedBatch: async (t: string[]) => t.map(() => [0.5, 0.5, 0.5, 0.5]),
  };
  const searchEngine = createSearchEngine({ store, embedder });
  const server = createApiServer({ store, searchEngine, port: PORT });
  await server.start();
});

afterAll(async () => { await store.close(); });

describe('GET /api/profile-card', () => {
  it('SVG 반환', async () => {
    const res = await fetch(`http://127.0.0.1:${PORT}/api/profile-card`);
    expect(res.ok).toBe(true);
    expect(res.headers.get('content-type')).toContain('image/svg+xml');
    const text = await res.text();
    expect(text).toContain('<svg');
    expect(text).toContain('</svg>');
  });

  it('문서 수 포함', async () => {
    const res = await fetch(`http://127.0.0.1:${PORT}/api/profile-card`);
    const text = await res.text();
    expect(text).toContain('1 docs');
  });

  it('mode=folder 지원', async () => {
    const res = await fetch(`http://127.0.0.1:${PORT}/api/profile-card?mode=folder`);
    expect(res.ok).toBe(true);
    const text = await res.text();
    expect(text).toContain('<svg');
  });
});
