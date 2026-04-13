import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { exportToolDef, handleExport } from '../src/mcp/tools/export.js';
import { createDetectGapsTool } from '../src/mcp/tools/detect-gaps.js';
import { createAskTool } from '../src/mcp/tools/ask.js';
import { createGenerateDraftTool } from '../src/mcp/tools/generate-draft.js';
import { createAgenticGraphTools } from '../src/mcp/tools/agentic-graph.js';
import { createSnapshotToolDef, loadSnapshotToolDef, handleCreateSnapshot, handleLoadSnapshot } from '../src/mcp/tools/snapshot.js';
import { logDecisionToolDef, findDecisionsToolDef, handleLogDecision, handleFindDecisions } from '../src/mcp/tools/decision-journal.js';
import { getDecayStatusToolDef, handleGetDecayStatus } from '../src/mcp/tools/decay.js';
import { getMorningBriefToolDef, handleGetMorningBrief } from '../src/mcp/tools/brief.js';
import { createLinkCodeTool } from '../src/mcp/tools/link-code.js';
import { createGetEvolutionTool } from '../src/mcp/tools/get-evolution.js';
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

// ─── Snapshot Tool ───────────────────────────────────────
describe('snapshot tool', () => {
  it('create-snapshot schema 유효', () => {
    expect(createSnapshotToolDef.name).toBe('create-snapshot');
    expect(createSnapshotToolDef.inputSchema.required).toContain('name');
    expect(createSnapshotToolDef.inputSchema.required).toContain('queries');
  });

  it('load-snapshot schema 유효', () => {
    expect(loadSnapshotToolDef.name).toBe('load-snapshot');
    expect(loadSnapshotToolDef.inputSchema.required).toContain('name');
  });

  it('create-snapshot 실행 — 결과 반환', async () => {
    const searchEngine = createMockSearchEngine();
    const result = await handleCreateSnapshot(searchEngine, {
      name: 'test-snap-' + Date.now(),
      queries: ['knowledge'],
    });
    expect(result).toHaveProperty('saved');
    expect(result).toHaveProperty('resultCount');
    expect(result.resultCount).toBeGreaterThanOrEqual(0);

    // cleanup
    try { const { unlinkSync } = await import('node:fs'); unlinkSync(result.saved); } catch {}
  });

  it('load-snapshot — 존재하지 않는 스냅샷', async () => {
    const result = await handleLoadSnapshot({ name: 'nonexistent-snap-999' });
    expect(result).toHaveProperty('error');
  });

  it('sanitizeName — 특수문자 제거 후 안전한 이름으로 변환', async () => {
    const result = await handleLoadSnapshot({ name: '../../../etc/passwd' });
    // sanitizeName strips special chars → "etcpasswd" → not found
    expect(result).toHaveProperty('error');
  });
});

// ─── Decision Journal Tool ───────────────────────────────
describe('decision-journal tool', () => {
  const testVault = join(tmpdir(), 'sv-test-decisions-' + Date.now());

  beforeEach(async () => {
    const { mkdirSync } = await import('node:fs');
    mkdirSync(testVault, { recursive: true });
  });
  afterEach(async () => {
    try { const { rmSync } = await import('node:fs'); rmSync(testVault, { recursive: true }); } catch {}
  });

  it('log-decision schema 유효', () => {
    expect(logDecisionToolDef.name).toBe('log-decision');
    expect(logDecisionToolDef.inputSchema.required).toContain('title');
    expect(logDecisionToolDef.inputSchema.required).toContain('decision');
    expect(logDecisionToolDef.inputSchema.required).toContain('reasoning');
  });

  it('find-decisions schema 유효', () => {
    expect(findDecisionsToolDef.name).toBe('find-decisions');
    expect(findDecisionsToolDef.inputSchema.required).toContain('query');
  });

  it('log-decision → find-decisions 라운드트립', async () => {
    const logResult = await handleLogDecision(testVault, {
      title: 'Choose Vitest over Jest',
      decision: 'Use Vitest for unit testing',
      reasoning: 'Better ESM support and faster execution',
      alternatives: ['Jest', 'Mocha'],
      project: 'stellavault',
    });
    expect(logResult).toHaveProperty('saved');
    expect(logResult).toHaveProperty('fileName');

    const findResult = await handleFindDecisions(testVault, { query: 'vitest' });
    expect(findResult.decisions.length).toBeGreaterThanOrEqual(1);
    expect(findResult.decisions[0].content).toContain('Vitest');
  });

  it('find-decisions — 빈 디렉토리', async () => {
    const emptyVault = join(tmpdir(), 'sv-empty-' + Date.now());
    const result = await handleFindDecisions(emptyVault, { query: 'anything' });
    expect(result).toHaveProperty('message', 'No decisions directory');
  });
});

// ─── Decay Status Tool ───────────────────────────────────
describe('decay-status tool', () => {
  it('schema 유효', () => {
    expect(getDecayStatusToolDef.name).toBe('get-decay-status');
    expect(getDecayStatusToolDef.inputSchema.properties.threshold).toBeDefined();
    expect(getDecayStatusToolDef.inputSchema.properties.limit).toBeDefined();
  });

  it('핸들러 실행 — 결과 구조 검증', async () => {
    const mockDecayEngine = {
      getDecaying: async (threshold: number, limit: number) => [
        { documentId: 'doc1', title: 'Test', retrievability: 0.3, stability: 2.5, lastAccess: '2026-01-01' },
      ],
    };
    const result = await handleGetDecayStatus(mockDecayEngine as any, {});
    expect(result.count).toBe(1);
    expect(result.threshold).toBe(0.5);
    expect(result.notes[0].title).toBe('Test');
    expect(result.notes[0].retrievability).toBe(0.3);
    expect(result.tip).toContain('잊어가고');
  });

  it('건강한 상태 — 0개 감쇠', async () => {
    const mockDecayEngine = { getDecaying: async () => [] };
    const result = await handleGetDecayStatus(mockDecayEngine as any, { threshold: 0.3 });
    expect(result.count).toBe(0);
    expect(result.tip).toContain('건강한');
  });
});

// ─── Morning Brief Tool ──────────────────────────────────
describe('morning-brief tool', () => {
  it('schema 유효', () => {
    expect(getMorningBriefToolDef.name).toBe('get-morning-brief');
  });

  it('핸들러 실행 — 브리핑 구조 검증', async () => {
    const store = createMockStore();
    const mockDecayEngine = {
      computeAll: async () => ({
        totalDocuments: 10,
        decayingCount: 2,
        criticalCount: 1,
        averageR: 0.75,
        topDecaying: [
          { documentId: 'doc1', title: 'Decaying Note', retrievability: 0.3, daysSinceAccess: 14, stability: 2.0, lastAccess: '2026-01-01' },
        ],
        clusterHealth: [
          { label: 'React', avgR: 0.4, count: 5 },
        ],
      }),
    };
    const result = await handleGetMorningBrief(mockDecayEngine as any, store);
    expect(result.greeting).toContain('1개 노트');
    expect(result.summary.averageR).toBe(0.75);
    expect(result.summary.critical).toBe(1);
    expect(result.reviewSuggestions).toHaveLength(1);
    expect(result.reviewSuggestions[0].title).toBe('Decaying Note');
    expect(result.unhealthyClusters).toHaveLength(1);
    expect(result.tip).toContain('위험');
  });
});

// ─── Link Code Tool ──────────────────────────────────────
describe('link-code tool', () => {
  it('schema 유효', () => {
    const tool = createLinkCodeTool(createMockSearchEngine());
    expect(tool.name).toBe('link-code');
    expect(tool.inputSchema.required).toContain('filePath');
  });

  it('코드 파일 → 관련 노트 검색', async () => {
    const tool = createLinkCodeTool(createMockSearchEngine());
    const result = await tool.handler({ filePath: 'src/auth/middleware.ts' });
    expect(result.content[0].type).toBe('text');
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toHaveProperty('filePath', 'src/auth/middleware.ts');
    expect(parsed).toHaveProperty('extractedKeywords');
    expect(parsed).toHaveProperty('relatedNotes');
    expect(parsed).toHaveProperty('summary');
  });

  it('content 옵션으로 심층 검색', async () => {
    const tool = createLinkCodeTool(createMockSearchEngine());
    const result = await tool.handler({
      filePath: 'src/graph/renderer.ts',
      content: 'import { GraphNode } from "./types"; function renderGraph() { /* knowledge visualization */ }',
      limit: 3,
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.extractedKeywords.length).toBeGreaterThan(0);
  });
});

// ─── Get Evolution Tool ──────────────────────────────────
describe('get-evolution tool', () => {
  it('schema 유효', () => {
    const tool = createGetEvolutionTool(createMockStore());
    expect(tool.name).toBe('get-evolution');
    expect(tool.inputSchema.properties.topic).toBeDefined();
    expect(tool.inputSchema.properties.limit).toBeDefined();
  });

  it('전체 vault 진화 분석', async () => {
    const tool = createGetEvolutionTool(createMockStore());
    const result = await tool.handler({});
    expect(result.content[0].type).toBe('text');
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toHaveProperty('topic', 'all');
    expect(parsed).toHaveProperty('totalDocuments');
    expect(parsed).toHaveProperty('recentlyEvolved');
  });

  it('토픽 필터링', async () => {
    const tool = createGetEvolutionTool(createMockStore());
    const result = await tool.handler({ topic: 'test', limit: 5 });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.topic).toBe('test');
  });
});
