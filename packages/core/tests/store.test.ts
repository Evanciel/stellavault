import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createSqliteVecStore } from '../src/store/sqlite-vec.js';
import type { VectorStore } from '../src/store/types.js';

let store: VectorStore;

beforeEach(async () => {
  store = createSqliteVecStore(':memory:', 4); // 4차원 (테스트용)
  await store.initialize();
});

afterEach(async () => {
  await store.close();
});

describe('VectorStore', () => {
  it('초기 상태 비어있음', async () => {
    const stats = await store.getStats();
    expect(stats.documentCount).toBe(0);
    expect(stats.chunkCount).toBe(0);
  });

  it('document + chunk upsert 및 조회', async () => {
    await store.upsertDocument({
      id: 'doc1', filePath: 'test.md', title: 'Test', content: 'Hello',
      frontmatter: {}, tags: ['test'], lastModified: '2026-01-01', contentHash: 'abc',
    });
    await store.upsertChunks([{
      id: 'doc1#0', documentId: 'doc1', content: 'Hello world',
      heading: 'Test', startLine: 1, endLine: 2, tokenCount: 3,
      embedding: [0.1, 0.2, 0.3, 0.4],
    }]);

    const doc = await store.getDocument('doc1');
    expect(doc).not.toBeNull();
    expect(doc!.title).toBe('Test');

    const chunk = await store.getChunk('doc1#0');
    expect(chunk).not.toBeNull();
    expect(chunk!.content).toBe('Hello world');

    const stats = await store.getStats();
    expect(stats.documentCount).toBe(1);
    expect(stats.chunkCount).toBe(1);
  });

  it('semantic search', async () => {
    await store.upsertDocument({
      id: 'doc1', filePath: 'a.md', title: 'A', content: 'A',
      frontmatter: {}, tags: [], lastModified: '2026-01-01', contentHash: 'a',
    });
    await store.upsertChunks([{
      id: 'doc1#0', documentId: 'doc1', content: 'Content A',
      heading: 'A', startLine: 1, endLine: 1, tokenCount: 2,
      embedding: [1.0, 0.0, 0.0, 0.0],
    }]);

    const results = await store.searchSemantic([1.0, 0.0, 0.0, 0.0], 5);
    expect(results.length).toBe(1);
    expect(results[0].chunkId).toBe('doc1#0');
    expect(results[0].score).toBeGreaterThan(0);
  });

  it('deleteByDocumentId', async () => {
    await store.upsertDocument({
      id: 'doc1', filePath: 'a.md', title: 'A', content: 'A',
      frontmatter: {}, tags: [], lastModified: '2026-01-01', contentHash: 'a',
    });
    await store.upsertChunks([{
      id: 'doc1#0', documentId: 'doc1', content: 'Content',
      heading: 'A', startLine: 1, endLine: 1, tokenCount: 1,
      embedding: [0.1, 0.2, 0.3, 0.4],
    }]);

    await store.deleteByDocumentId('doc1');
    expect(await store.getDocument('doc1')).toBeNull();
    const stats = await store.getStats();
    expect(stats.chunkCount).toBe(0);
  });
});
