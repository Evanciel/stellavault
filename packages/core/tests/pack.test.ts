import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createSqliteVecStore } from '../src/store/sqlite-vec.js';
import { createSearchEngine } from '../src/search/index.js';
import { createPack, exportPack, importPack } from '../src/pack/index.js';
import type { VectorStore } from '../src/store/types.js';
import type { Embedder } from '../src/indexer/embedder.js';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { existsSync, unlinkSync } from 'node:fs';

const DIMS = 4;
let store: VectorStore;
let embedder: Embedder;

function mockEmbedder(): Embedder {
  return {
    dimensions: DIMS, modelName: 'test-model',
    initialize: async () => {},
    embed: async (text) => {
      const h = text.length;
      return [h % 3 / 3, h % 5 / 5, h % 7 / 7, h % 11 / 11];
    },
    embedBatch: async (texts) => texts.map(t => {
      const h = t.length;
      return [h % 3 / 3, h % 5 / 5, h % 7 / 7, h % 11 / 11];
    }),
  };
}

beforeEach(async () => {
  store = createSqliteVecStore(':memory:', DIMS);
  await store.initialize();
  embedder = mockEmbedder();

  await store.upsertDocument({
    id: 'doc1', filePath: '08_Patterns/auth.md', title: 'Auth Pattern',
    content: 'OAuth patterns for authentication. Contact admin@test.com',
    frontmatter: {}, tags: ['auth'], lastModified: '2026-01-01', contentHash: 'h1',
  });
  await store.upsertChunks([{
    id: 'doc1#0', documentId: 'doc1',
    content: 'OAuth patterns for authentication. Contact admin@test.com',
    heading: 'Auth Pattern', startLine: 1, endLine: 1, tokenCount: 8,
    embedding: [0.5, 0.5, 0.5, 0.5],
  }]);
});

afterEach(async () => { await store.close(); });

describe('Knowledge Pack', () => {
  it('검색 기반 팩 생성', async () => {
    const searchEngine = createSearchEngine({ store, embedder });
    const { pack, piiReport } = await createPack(store, searchEngine, embedder, {
      name: 'auth-patterns',
      fromSearch: 'OAuth',
    });

    expect(pack.name).toBe('auth-patterns');
    expect(pack.chunks.length).toBeGreaterThan(0);
    expect(pack.embeddingModel).toBe('test-model');
    expect(pack.schemaVersion).toBe('1.0');
  });

  it('PII 자동 마스킹', async () => {
    const searchEngine = createSearchEngine({ store, embedder });
    const { pack, piiReport } = await createPack(store, searchEngine, embedder, {
      name: 'test-pii',
      fromSearch: 'OAuth',
    });

    // 이메일이 마스킹되어야 함
    for (const chunk of pack.chunks) {
      expect(chunk.content).not.toContain('admin@test.com');
    }
    expect(piiReport.redactedCount).toBeGreaterThan(0);
  });

  it('내보내기 + 가져오기 라운드트립', async () => {
    const searchEngine = createSearchEngine({ store, embedder });
    const { pack } = await createPack(store, searchEngine, embedder, {
      name: 'roundtrip-test',
      fromSearch: 'OAuth',
    });

    const tmpPath = join(tmpdir(), 'test-roundtrip.sv-pack');
    exportPack(pack, tmpPath);
    expect(existsSync(tmpPath)).toBe(true);

    // 새 store에 import
    const store2 = createSqliteVecStore(':memory:', DIMS);
    await store2.initialize();

    const result = await importPack(store2, embedder, tmpPath);
    expect(result.imported).toBeGreaterThan(0);
    expect(result.modelMismatch).toBe(false);

    // import된 청크 검색 가능
    const stats = await store2.getStats();
    expect(stats.chunkCount).toBeGreaterThan(0);

    await store2.close();
    try { unlinkSync(tmpPath); } catch {}
  });

  it('모델 불일치 시 재임베딩', async () => {
    const searchEngine = createSearchEngine({ store, embedder });
    const { pack } = await createPack(store, searchEngine, embedder, {
      name: 'mismatch-test',
      fromSearch: 'OAuth',
    });

    const tmpPath = join(tmpdir(), 'test-mismatch.sv-pack');
    exportPack(pack, tmpPath);

    // 다른 모델명의 embedder로 import
    const otherEmbedder = { ...mockEmbedder(), modelName: 'other-model' };
    const store2 = createSqliteVecStore(':memory:', DIMS);
    await store2.initialize();

    const result = await importPack(store2, otherEmbedder, tmpPath);
    expect(result.modelMismatch).toBe(true);
    expect(result.reEmbedded).toBeGreaterThan(0);

    await store2.close();
    try { unlinkSync(tmpPath); } catch {}
  });
});
