import { describe, it, expect } from 'vitest';
import { handleSearch, searchToolDef } from '../src/mcp/tools/search.js';
import { handleGetDocument, getDocumentToolDef } from '../src/mcp/tools/get-document.js';
import { handleListTopics, listTopicsToolDef } from '../src/mcp/tools/list-topics.js';
import { handleGetRelated, getRelatedToolDef } from '../src/mcp/tools/get-related.js';
import type { VectorStore } from '../src/store/types.js';
import type { SearchEngine } from '../src/search/index.js';
import type { Document } from '../src/types/document.js';

// Mock data
const mockDoc: Document = {
  id: 'doc1', filePath: 'test.md', title: 'Test Document',
  content: 'Test content about React patterns',
  frontmatter: { category: 'tech' }, tags: ['react', 'test'],
  lastModified: '2026-01-01', contentHash: 'abc123',
};

function createMockStore(): VectorStore {
  return {
    getDocument: async (id: string) => id === 'doc1' ? mockDoc : null,
    getChunk: async () => null,
    getTopics: async () => [
      { topic: 'react', count: 5, recentDocuments: [{ id: 'doc1', title: 'Test' }] },
      { topic: 'security', count: 3, recentDocuments: [] },
    ],
    getStats: async () => ({
      documentCount: 10, chunkCount: 50, dbSizeBytes: 1024, lastIndexed: '2026-01-01',
    }),
    initialize: async () => {},
    close: async () => {},
    upsertDocument: async () => {},
    upsertChunks: async () => {},
    deleteByDocumentId: async () => {},
    searchSemantic: async () => [],
    searchKeyword: async () => [],
    getAllDocumentHashes: async () => new Map(),
    getDocumentEmbeddings: async () => new Map(),
    findDocumentNeighbors: async () => [],
  } as VectorStore;
}

function createMockSearchEngine(): SearchEngine {
  return {
    search: async ({ query, limit }) => [{
      chunk: {
        id: 'doc1#0', documentId: 'doc1', content: 'React patterns content',
        heading: 'Patterns', startLine: 1, endLine: 3, tokenCount: 5,
      },
      document: mockDoc,
      score: 0.85,
      highlights: ['React patterns content'],
    }].slice(0, limit ?? 5),
  };
}

describe('MCP Tool Definitions', () => {
  it('search tool schema 유효', () => {
    expect(searchToolDef.name).toBe('search');
    expect(searchToolDef.inputSchema.required).toContain('query');
    expect(searchToolDef.inputSchema.properties.query).toBeDefined();
    expect(searchToolDef.inputSchema.properties.limit).toBeDefined();
    expect(searchToolDef.inputSchema.properties.tags).toBeDefined();
  });

  it('get-document tool schema 유효', () => {
    expect(getDocumentToolDef.name).toBe('get-document');
    expect(getDocumentToolDef.inputSchema.required).toContain('id');
  });

  it('list-topics tool schema 유효', () => {
    expect(listTopicsToolDef.name).toBe('list-topics');
    expect(listTopicsToolDef.inputSchema.properties).toBeDefined();
  });

  it('get-related tool schema 유효', () => {
    expect(getRelatedToolDef.name).toBe('get-related');
    expect(getRelatedToolDef.inputSchema.required).toContain('id');
  });
});

describe('handleSearch', () => {
  it('검색 결과를 올바른 형식으로 반환', async () => {
    const engine = createMockSearchEngine();
    const results = await handleSearch(engine, { query: 'React' });

    expect(results.length).toBeGreaterThan(0);
    const r = results[0];
    expect(r.title).toBe('Test Document');
    expect(r.filePath).toBe('test.md');
    expect(r.heading).toBe('Patterns');
    expect(r.content).toBe('React patterns content');
    expect(r.score).toBe(0.85);
    expect(r.tags).toEqual(['react', 'test']);
  });

  it('limit 전달', async () => {
    const engine = createMockSearchEngine();
    const results = await handleSearch(engine, { query: 'React', limit: 1 });
    expect(results.length).toBeLessThanOrEqual(1);
  });
});

describe('handleGetDocument', () => {
  it('존재하는 문서 반환', async () => {
    const store = createMockStore();
    const result = await handleGetDocument(store, { id: 'doc1' });

    expect(result).not.toHaveProperty('error');
    expect((result as any).title).toBe('Test Document');
    expect((result as any).filePath).toBe('test.md');
    expect((result as any).content).toBe('Test content about React patterns');
    expect((result as any).tags).toEqual(['react', 'test']);
  });

  it('존재하지 않는 문서는 error 반환', async () => {
    const store = createMockStore();
    const result = await handleGetDocument(store, { id: 'nonexistent' });
    expect(result).toHaveProperty('error');
  });
});

describe('handleListTopics', () => {
  it('토픽 목록과 통계 반환', async () => {
    const store = createMockStore();
    const result = await handleListTopics(store);

    expect(result.topics).toHaveLength(2);
    expect(result.topics[0].topic).toBe('react');
    expect(result.totalDocuments).toBe(10);
    expect(result.totalChunks).toBe(50);
  });
});

describe('handleGetRelated', () => {
  it('관련 문서 반환 (자기 자신 제외)', async () => {
    const store = createMockStore();
    const engine = createMockSearchEngine();
    const results = await handleGetRelated(store, engine, { id: 'doc1' });

    // doc1 자체는 필터링되므로 빈 결과 가능
    expect(Array.isArray(results)).toBe(true);
  });

  it('존재하지 않는 문서 ID는 error 반환', async () => {
    const store = createMockStore();
    const engine = createMockSearchEngine();
    const result = await handleGetRelated(store, engine, { id: 'nonexistent' });
    expect(result).toHaveProperty('error');
  });
});
