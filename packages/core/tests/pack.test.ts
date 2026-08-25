import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createSqliteVecStore } from '../src/store/sqlite-vec.js';
import { createSearchEngine } from '../src/search/index.js';
import { createPack, exportPack, importPack } from '../src/pack/index.js';
import { packImportSucceeded } from '../src/pack/importer.js';
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

// 🔴 코덱스 7차 P1 — 팩 재가져오기가 <기존 팩을 껍데기로> 만들던 자리.
//
// upsertDocument 를 먼저 부르면 FK cascade 가 기존 팩의 청크를 날린다. 그 뒤
// 재임베딩이나 청크 저장이 실패하면 문서 행만 남아 그 팩이 검색에서 사라진다.
// → 문서 행을 <청크가 준비된 뒤에> 쓰고, 둘을 한 트랜잭션으로 쓴다.
describe('팩 재가져오기의 원자성 (코덱스 7차)', () => {
  it('★ 회귀: 재임베딩이 실패해도 기존 팩 청크가 살아 있다', async () => {
    const packPath = join(tmpdir(), `atomic-pack-${process.pid}.json`);
    const searchEngine = createSearchEngine({ store, embedder });
    const { pack } = await createPack(store, searchEngine, embedder, {
      name: 'atomic', fromSearch: 'OAuth',
    });
    exportPack(pack, packPath);
    try {
      await importPack(store, embedder, packPath);
      const before = await store.searchKeyword('OAuth', 20);
      expect(before.length).toBeGreaterThan(0);

      // 모델이 바뀌어 재임베딩이 필요한데, 그 임베더가 죽어 있다.
      const dead: Embedder = {
        ...embedder, modelName: 'other-model',
        embed: async () => { throw new Error('embedder down'); },
        embedBatch: async () => { throw new Error('embedder down'); },
      };
      await expect(importPack(store, dead, packPath)).rejects.toThrow();

      // 기존 팩이 껍데기가 되지 않았다.
      expect((await store.searchKeyword('OAuth', 20)).length).toBe(before.length);
    } finally {
      if (existsSync(packPath)) unlinkSync(packPath);
    }
  });
});

// 🔴 코덱스 8차 P2 — 차원이 어긋난 팩으로 <같은 이름의 정상 팩을 지우던> 자리.
//
// 재임베딩이 <성공>하면(예외 없음) 위 원자성 시험에 안 걸린다. 그런데 그 임베더가
// 다른 차원을 내면 청크가 전부 skipped 로 걸러져 chunks 가 빈 배열이 된다.
// 그 상태로 replaceDocument 를 부르면 문서 행이 다시 쓰이며 cascade 가
// <대체할 것도 없이> 기존 청크를 날린다 — 그리고 함수는 성공을 반환한다.
describe('청크가 0개면 기존 팩을 건드리지 않는다 (코덱스 8차)', () => {
  it('★ 회귀: 차원이 어긋난 재가져오기가 기존 팩을 지우지 않는다', async () => {
    const packPath = join(tmpdir(), `dim-pack-${process.pid}.json`);
    const searchEngine = createSearchEngine({ store, embedder });
    const { pack } = await createPack(store, searchEngine, embedder, {
      name: 'dims', fromSearch: 'OAuth',
    });
    exportPack(pack, packPath);
    try {
      await importPack(store, embedder, packPath);
      const before = await store.searchKeyword('OAuth', 20);
      expect(before.length).toBeGreaterThan(0);

      // 죽지 않는다 — <다른 차원>을 낼 뿐이다. 그래서 예외 기반 시험엔 안 걸린다.
      const wrongDims: Embedder = {
        ...embedder, modelName: 'other-model', dimensions: embedder.dimensions,
        embed: async () => new Array(embedder.dimensions + 1).fill(0.1),
        embedBatch: async (t: string[]) => t.map(() => new Array(embedder.dimensions + 1).fill(0.1)),
      };
      const r = await importPack(store, wrongDims, packPath);

      expect(r.imported).toBe(0);
      expect(r.skipped).toBeGreaterThan(0);
      // 기존 팩이 그대로다.
      expect((await store.searchKeyword('OAuth', 20)).length).toBe(before.length);
    } finally {
      if (existsSync(packPath)) unlinkSync(packPath);
    }
  });
});

// 🔴 팩 가져오기 1회분의 <성공 판정>. `packImportCommand` 안의 조건문으로 두었더니
//    실제 임베딩 모델을 내려받아야만 닿을 수 있어 변이가 살아남았다 (코덱스 13차 후속).
//
// ⚠️ 이 시험은 <core 안에> 있어야 한다. cli 쪽에 두면 `@stellavault/core` 가
//    <빌드 산출물>로 해석돼, core 소스를 바꿔도 시험이 안 움직인다 — 실제로
//    변이 R8 이 그렇게 살아남았다. ★재는 자리가 틀리면 초록은 아무 뜻이 없다.
describe('packImportSucceeded — 아무것도 안 썼으면 성공이 아니다', () => {
  it('★ imported 가 0 이면 false — importer 는 그때 기존 팩을 보존하며 아무것도 안 쓴다', () => {
    expect(packImportSucceeded({ imported: 0 })).toBe(false);
  });
  it('하나라도 가져왔으면 true — 가드가 전부를 막지 않는다', () => {
    expect(packImportSucceeded({ imported: 1 })).toBe(true);
  });
});
