import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { exportToolDef, handleExport } from '../src/mcp/tools/export.js';
import { createDetectGapsTool } from '../src/mcp/tools/detect-gaps.js';
import { createAskTool } from '../src/mcp/tools/ask.js';
import { createGenerateDraftTool } from '../src/mcp/tools/generate-draft.js';
import { createAgenticGraphTools } from '../src/mcp/tools/agentic-graph.js';
import type { VectorStore } from '../src/store/types.js';
import type { SearchEngine } from '../src/search/index.js';
import type { Document } from '../src/types/document.js';
import { writeFileSync, existsSync, unlinkSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const mockDoc: Document = {
  id: 'doc1', filePath: 'test.md', title: 'Test Document',
  content: 'Test content about knowledge management and graph theory',
  frontmatter: {}, tags: ['test', 'knowledge'],
  lastModified: '2026-01-01', contentHash: 'abc',
};

function createMockStore(): VectorStore {
  return {
    getDocument: async (id: string) => id === 'doc1' ? mockDoc : null,
    getChunk: async () => null,
    getTopics: async () => [{ topic: 'test', count: 5, recentDocuments: [] }],
    getStats: async () => ({ documentCount: 1, chunkCount: 3, dbSizeBytes: 512, lastIndexed: '2026-01-01' }),
    initialize: async () => {},
    close: async () => {},
    upsertDocument: async () => {},
    upsertChunks: async () => {},
    deleteByDocumentId: async () => {},
    searchSemantic: async () => [],
    searchKeyword: async () => [],
    getAllDocuments: async () => [mockDoc],
    getAllDocumentHashes: async () => new Map(),
    getDocumentEmbeddings: async () => new Map(),
  } as VectorStore;
}

function createMockSearchEngine(): SearchEngine {
  return {
    search: async ({ query, limit }) => [{
      chunk: { id: 'doc1#0', documentId: 'doc1', content: 'knowledge management content', heading: '', startLine: 1, endLine: 3, tokenCount: 5 },
      document: mockDoc,
      score: 0.9,
      highlights: [],
    }].slice(0, limit ?? 5),
  };
}

// ─── Export Tool ─────────────────────────────────────────
describe('export tool', () => {
  const testDir = join(tmpdir(), 'sv-test-export-' + Date.now());

  beforeEach(() => mkdirSync(testDir, { recursive: true }));
  afterEach(() => { try { rmSync(testDir, { recursive: true }); } catch {} });

  it('schema 유효', () => {
    expect(exportToolDef.name).toBe('export');
    expect(exportToolDef.inputSchema.required).toContain('outputPath');
  });

  it('JSON 내보내기 성공', async () => {
    const store = createMockStore();
    const outPath = join(process.cwd(), `test-export-${Date.now()}.json`);
    try {
      const result = await handleExport(store, { outputPath: outPath });
      expect(result.exported).toBe(1);
      expect(result.format).toBe('json');
      expect(existsSync(outPath)).toBe(true);
    } finally {
      try { unlinkSync(outPath); } catch {}
    }
  });

  it('CSV 내보내기 성공', async () => {
    const store = createMockStore();
    const outPath = join(process.cwd(), `test-export-${Date.now()}.csv`);
    try {
      const result = await handleExport(store, { outputPath: outPath, format: 'csv' });
      expect(result.exported).toBe(1);
      expect(result.format).toBe('csv');
    } finally {
      try { unlinkSync(outPath); } catch {}
    }
  });

  it('경로 검증 — vault 외부 경로 거부', async () => {
    const store = createMockStore();
    await expect(handleExport(store, { outputPath: '/etc/passwd' }))
      .rejects.toThrow('Export path must be within');
  });
});

// ─── Detect Gaps Tool ────────────────────────────────────
describe('detect-gaps tool', () => {
  it('schema 유효', () => {
    const tool = createDetectGapsTool(createMockStore());
    expect(tool.name).toBe('detect-gaps');
    expect(tool.inputSchema.properties.minSeverity).toBeDefined();
  });

  it('핸들러 실행 — content 반환', async () => {
    const store = createMockStore();
    // Mock getAllDocuments to return enough for gap detection
    (store as any).getAllDocuments = async () => [mockDoc];
    (store as any).searchSemantic = async () => [];

    const tool = createDetectGapsTool(store);
    const result = await tool.handler({});
    expect(result.content).toBeDefined();
    expect(result.content[0].type).toBe('text');
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toHaveProperty('totalClusters');
    expect(parsed).toHaveProperty('totalGaps');
    expect(parsed).toHaveProperty('suggestion');
  });
});

// ─── Ask Tool ────────────────────────────────────────────
describe('ask tool', () => {
  it('schema 유효', () => {
    const tool = createAskTool(createMockSearchEngine(), '/tmp');
    expect(tool.name).toBe('ask');
    expect(tool.inputSchema.required).toContain('question');
  });

  it('입력 크기 제한 — 2000자 초과 거부', async () => {
    const tool = createAskTool(createMockSearchEngine(), '/tmp');
    const longQuestion = 'x'.repeat(2001);
    const result = await tool.handler({ question: longQuestion });
    expect(result).toHaveProperty('isError', true);
  });

  it('빈 질문 거부', async () => {
    const tool = createAskTool(createMockSearchEngine(), '/tmp');
    const result = await tool.handler({ question: '' });
    expect(result).toHaveProperty('isError', true);
  });
});

// ─── Generate Draft Tool ─────────────────────────────────
describe('generate-draft tool', () => {
  it('schema 유효', () => {
    const tool = createGenerateDraftTool(createMockSearchEngine(), '/tmp');
    expect(tool.name).toBe('generate-draft');
    expect(tool.inputSchema.properties.topic).toBeDefined();
    expect(tool.inputSchema.properties.format).toBeDefined();
  });

  it('입력 크기 제한 — 2000자 초과 거부', async () => {
    const tool = createGenerateDraftTool(createMockSearchEngine(), '/tmp');
    const longTopic = 'x'.repeat(2001);
    const result = await tool.handler({ topic: longTopic });
    expect(result).toHaveProperty('isError', true);
  });
});

// ─── Agentic Graph Tools ─────────────────────────────────
describe('agentic-graph tools', () => {
  it('create-knowledge-node — 타이틀 200자 초과 거부', async () => {
    const store = createMockStore();
    const embedder = { initialize: async () => {}, embed: async () => new Float32Array(384) } as any;
    const tools = createAgenticGraphTools(store, embedder, tmpdir());
    const nodeTool = tools.find(t => t.name === 'create-knowledge-node')!;

    const result = await nodeTool.handler({
      title: 'x'.repeat(201),
      content: 'test',
    });
    expect(result.content[0].text).toContain('Error');
  });

  it('create-knowledge-node — 콘텐츠 50KB 초과 거부', async () => {
    const store = createMockStore();
    const embedder = { initialize: async () => {}, embed: async () => new Float32Array(384) } as any;
    const tools = createAgenticGraphTools(store, embedder, tmpdir());
    const nodeTool = tools.find(t => t.name === 'create-knowledge-node')!;

    const result = await nodeTool.handler({
      title: 'Test',
      content: 'x'.repeat(50001),
    });
    expect(result.content[0].text).toContain('Error');
  });
});
