import { describe, it, expect } from 'vitest';
import { searchBm25 } from '../src/search/bm25.js';
import type { VectorStore } from '../src/store/types.js';
import type { ScoredChunk } from '../src/types/chunk.js';

// FTS5 검색을 시뮬레이션하는 mock store
function createMockStore(keywordResults: ScoredChunk[] = []): VectorStore {
  return {
    searchKeyword: async (_query: string, _limit: number) => keywordResults,
    // 사용하지 않는 메서드 stub
    initialize: async () => {},
    close: async () => {},
    upsertDocument: async () => {},
    upsertChunks: async () => {},
    deleteByDocumentId: async () => {},
    getDocument: async () => null,
    getChunk: async () => null,
    searchSemantic: async () => [],
    getTopics: async () => [],
    getStats: async () => ({ documentCount: 0, chunkCount: 0, dbSizeBytes: 0, lastIndexed: null }),
    getAllDocumentHashes: async () => new Map(),
  } as VectorStore;
}

describe('searchBm25', () => {
  it('빈 쿼리는 빈 결과 반환', async () => {
    const store = createMockStore();
    const results = await searchBm25(store, '', 10);
    expect(results).toEqual([]);
  });

  it('특수문자만 있는 쿼리는 빈 결과 반환', async () => {
    const store = createMockStore();
    const results = await searchBm25(store, '!@#$%^&*()', 10);
    expect(results).toEqual([]);
  });

  it('일반 영문 쿼리 OR 조합 생성', async () => {
    let capturedQuery = '';
    const store = createMockStore();
    store.searchKeyword = async (query: string, _limit: number) => {
      capturedQuery = query;
      return [];
    };

    await searchBm25(store, 'React state management', 10);
    expect(capturedQuery).toBe('React OR state OR management');
  });

  it('한국어 쿼리 처리', async () => {
    let capturedQuery = '';
    const store = createMockStore();
    store.searchKeyword = async (query: string, _limit: number) => {
      capturedQuery = query;
      return [];
    };

    await searchBm25(store, '리액트 상태관리', 10);
    expect(capturedQuery).toBe('리액트 OR 상태관리');
  });

  it('특수문자 제거 후 정상 검색', async () => {
    let capturedQuery = '';
    const store = createMockStore();
    store.searchKeyword = async (query: string, _limit: number) => {
      capturedQuery = query;
      return [];
    };

    await searchBm25(store, 'OAuth2.0 인증/설계', 10);
    // 특수문자(., /) 제거 후 단어 추출
    expect(capturedQuery).toContain('OR');
    expect(capturedQuery).not.toContain('.');
    expect(capturedQuery).not.toContain('/');
  });

  it('결과를 그대로 반환', async () => {
    const mockResults: ScoredChunk[] = [
      { chunkId: 'doc1#0', score: 0.9 },
      { chunkId: 'doc2#1', score: 0.5 },
    ];
    const store = createMockStore(mockResults);
    const results = await searchBm25(store, 'test query', 10);
    expect(results).toEqual(mockResults);
    expect(results.length).toBe(2);
  });
});
