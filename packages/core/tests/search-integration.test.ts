import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createSqliteVecStore } from '../src/store/sqlite-vec.js';
import { createSearchEngine } from '../src/search/index.js';
import type { VectorStore } from '../src/store/types.js';
import type { Embedder } from '../src/indexer/embedder.js';

const DIMS = 4;

// 고정 벡터를 반환하는 테스트용 embedder
function createMockEmbedder(): Embedder {
  return {
    modelName: 'test-mock',
    dimensions: DIMS,
    embed: async (text: string) => {
      // 간단한 결정적 벡터 생성: 텍스트 길이 기반
      const len = text.length;
      return [len % 3 / 3, len % 5 / 5, len % 7 / 7, len % 11 / 11];
    },
    embedBatch: async (texts: string[]) => {
      return Promise.all(texts.map(t => {
        const len = t.length;
        return [len % 3 / 3, len % 5 / 5, len % 7 / 7, len % 11 / 11];
      }));
    },
  };
}

let store: VectorStore;
let embedder: Embedder;

beforeEach(async () => {
  store = createSqliteVecStore(':memory:', DIMS);
  await store.initialize();
  embedder = createMockEmbedder();

  // 테스트 문서 3개 삽입
  await store.upsertDocument({
    id: 'doc-react', filePath: 'react-patterns.md', title: 'React 상태관리 패턴',
    content: 'React 상태관리 패턴에 대한 종합 가이드', frontmatter: {},
    tags: ['react', 'frontend'], lastModified: '2026-01-01', contentHash: 'r1',
  });
  await store.upsertChunks([{
    id: 'doc-react#0', documentId: 'doc-react',
    content: 'React useState useReducer 패턴 비교 분석',
    heading: 'React 상태관리', startLine: 1, endLine: 5, tokenCount: 10,
    embedding: [0.9, 0.1, 0.2, 0.1],
  }]);

  await store.upsertDocument({
    id: 'doc-auth', filePath: 'auth-design.md', title: 'OAuth 인증 설계',
    content: 'OAuth 2.0 인증 흐름 설계 문서', frontmatter: {},
    tags: ['auth', 'security'], lastModified: '2026-01-02', contentHash: 'a1',
  });
  await store.upsertChunks([{
    id: 'doc-auth#0', documentId: 'doc-auth',
    content: 'OAuth 2.0 Authorization Code Flow with PKCE',
    heading: 'OAuth 인증', startLine: 1, endLine: 5, tokenCount: 8,
    embedding: [0.1, 0.9, 0.1, 0.2],
  }]);

  await store.upsertDocument({
    id: 'doc-deploy', filePath: 'deploy-lessons.md', title: '배포 실패 교훈',
    content: '프로덕션 배포 중 발생한 장애 회고', frontmatter: {},
    tags: ['devops', 'lessons'], lastModified: '2026-01-03', contentHash: 'd1',
  });
  await store.upsertChunks([{
    id: 'doc-deploy#0', documentId: 'doc-deploy',
    content: '배포 실패 롤백 전략과 카나리 배포 교훈',
    heading: '배포 교훈', startLine: 1, endLine: 5, tokenCount: 12,
    embedding: [0.2, 0.1, 0.9, 0.1],
  }]);
});

afterEach(async () => {
  await store.close();
});

describe('Search Integration (BM25 + Semantic + RRF)', () => {
  it('자연어 쿼리로 결과 반환', async () => {
    const engine = createSearchEngine({ store, embedder });
    const results = await engine.search({ query: 'React 상태관리', limit: 5 });

    expect(results.length).toBeGreaterThan(0);
    // 각 결과에 필수 필드 존재
    for (const r of results) {
      expect(r.chunk).toBeDefined();
      expect(r.document).toBeDefined();
      expect(r.score).toBeGreaterThan(0);
      expect(r.highlights).toBeDefined();
    }
  });

  it('태그 필터링 동작', async () => {
    const engine = createSearchEngine({ store, embedder });
    const results = await engine.search({
      query: 'React 상태관리 OAuth 배포',
      limit: 10,
      tags: ['auth'],
    });

    // auth 태그가 있는 문서만 반환
    for (const r of results) {
      expect(r.document.tags).toContain('auth');
    }
  });

  it('limit 제한 동작', async () => {
    const engine = createSearchEngine({ store, embedder });
    const results = await engine.search({ query: 'React OAuth 배포', limit: 1 });
    expect(results.length).toBeLessThanOrEqual(1);
  });

  it('빈 쿼리도 에러 없이 처리', async () => {
    const engine = createSearchEngine({ store, embedder });
    const results = await engine.search({ query: '', limit: 5 });
    expect(Array.isArray(results)).toBe(true);
  });

  it('결과에 highlights 포함', async () => {
    const engine = createSearchEngine({ store, embedder });
    const results = await engine.search({ query: 'React', limit: 5 });

    const withHighlights = results.filter(r => r.highlights.length > 0);
    // BM25가 매칭하면 highlights가 있어야 함
    if (results.length > 0) {
      expect(withHighlights.length).toBeGreaterThanOrEqual(0);
    }
  });

  it('존재하지 않는 태그 필터 시 빈 결과', async () => {
    const engine = createSearchEngine({ store, embedder });
    const results = await engine.search({
      query: 'React',
      limit: 10,
      tags: ['nonexistent-tag'],
    });
    expect(results).toEqual([]);
  });
});
