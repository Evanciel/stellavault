// Design Ref: §4.1 — MCP Server (stdio + SSE)

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { VectorStore } from '../store/types.js';
import type { SearchEngine } from '../search/index.js';
import { searchToolDef, handleSearch } from './tools/search.js';
import { getDocumentToolDef, handleGetDocument } from './tools/get-document.js';
import { listTopicsToolDef, handleListTopics } from './tools/list-topics.js';
import { getRelatedToolDef, handleGetRelated } from './tools/get-related.js';
import { generateClaudeMdToolDef, handleGenerateClaudeMd } from './tools/generate-claude-md.js';
import { createSnapshotToolDef, loadSnapshotToolDef, handleCreateSnapshot, handleLoadSnapshot } from './tools/snapshot.js';
import { logDecisionToolDef, findDecisionsToolDef, handleLogDecision, handleFindDecisions } from './tools/decision-journal.js';
import { exportToolDef, handleExport } from './tools/export.js';
import { getDecayStatusToolDef, handleGetDecayStatus } from './tools/decay.js';
import { getMorningBriefToolDef, handleGetMorningBrief } from './tools/brief.js';
import { createLearningPathTool } from './tools/learning-path.js';
import { createDetectGapsTool } from './tools/detect-gaps.js';
import { createGetEvolutionTool } from './tools/get-evolution.js';
import { createLinkCodeTool } from './tools/link-code.js';
import { createAskTool } from './tools/ask.js';
import type { DecayEngine } from '../intelligence/decay-engine.js';

export interface McpServerOptions {
  store: VectorStore;
  searchEngine: SearchEngine;
  vaultPath?: string;
  decayEngine?: DecayEngine;
}

export function createMcpServer(options: McpServerOptions) {
  const { store, searchEngine, vaultPath = '', decayEngine } = options;

  const learningPathTool = createLearningPathTool(store);
  const detectGapsTool = createDetectGapsTool(store);
  const getEvolutionTool = createGetEvolutionTool(store);
  const linkCodeTool = createLinkCodeTool(searchEngine);
  const askTool = createAskTool(searchEngine, vaultPath);

  const server = new Server(
    { name: 'stellavault', version: '0.2.0' },
    { capabilities: { tools: {} } },
  );

  // List tools
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      searchToolDef, getDocumentToolDef, listTopicsToolDef, getRelatedToolDef,
      generateClaudeMdToolDef, createSnapshotToolDef, loadSnapshotToolDef,
      logDecisionToolDef, findDecisionsToolDef, exportToolDef,
      ...(decayEngine ? [getDecayStatusToolDef, getMorningBriefToolDef] : []),
      { name: learningPathTool.name, description: learningPathTool.description, inputSchema: learningPathTool.inputSchema },
      { name: detectGapsTool.name, description: detectGapsTool.description, inputSchema: detectGapsTool.inputSchema },
      { name: getEvolutionTool.name, description: getEvolutionTool.description, inputSchema: getEvolutionTool.inputSchema },
      { name: linkCodeTool.name, description: linkCodeTool.description, inputSchema: linkCodeTool.inputSchema },
      { name: askTool.name, description: askTool.description, inputSchema: askTool.inputSchema },
    ],
  }));

  // Call tool
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      let result: unknown;
      switch (name) {
        case 'search':
          result = await handleSearch(searchEngine, args as any);
          // MCP 검색 이벤트 기록
          if (decayEngine && result && typeof result === 'object' && 'results' in (result as any)) {
            const now = new Date().toISOString();
            for (const r of (result as any).results ?? []) {
              if (r.documentId) decayEngine.recordAccess({ documentId: r.documentId, type: 'mcp_query', timestamp: now }).catch(() => {});
            }
          }
          break;
        case 'get-document':
          result = await handleGetDocument(store, args as any);
          // MCP 문서 조회 이벤트 기록
          if (decayEngine && result && typeof result === 'object' && 'id' in (result as any)) {
            decayEngine.recordAccess({ documentId: (result as any).id, type: 'mcp_query', timestamp: new Date().toISOString() }).catch(() => {});
          }
          break;
        case 'list-topics':
          result = await handleListTopics(store);
          break;
        case 'get-related':
          result = await handleGetRelated(store, searchEngine, args as any);
          break;
        case 'generate-claude-md':
          result = await handleGenerateClaudeMd(searchEngine, store, args as any);
          break;
        case 'create-snapshot':
          result = await handleCreateSnapshot(searchEngine, args as any);
          break;
        case 'load-snapshot':
          result = await handleLoadSnapshot(args as any);
          break;
        case 'log-decision':
          result = await handleLogDecision(vaultPath, args as any);
          break;
        case 'find-decisions':
          result = await handleFindDecisions(vaultPath, args as any);
          break;
        case 'export':
          result = await handleExport(store, args as any);
          break;
        case 'get-decay-status':
          if (!decayEngine) { result = { error: 'Decay engine not available' }; break; }
          result = await handleGetDecayStatus(decayEngine, args as any);
          break;
        case 'get-morning-brief':
          if (!decayEngine) { result = { error: 'Decay engine not available' }; break; }
          result = await handleGetMorningBrief(decayEngine, store);
          break;
        case 'get-learning-path':
          result = await learningPathTool.handler(args as any);
          return result as any;
        case 'detect-gaps':
          result = await detectGapsTool.handler(args as any);
          return result as any;
        case 'get-evolution':
          result = await getEvolutionTool.handler(args as any);
          return result as any;
        case 'link-code':
          result = await linkCodeTool.handler(args as any);
          return result as any;
        case 'ask':
          result = await askTool.handler(args as any);
          return result as any;
        default:
          return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
      }
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true };
    }
  });

  return {
    async startStdio() {
      const transport = new StdioServerTransport();
      await server.connect(transport);
    },
    async startHttp(port: number = 3334) {
      const { createServer } = await import('node:http');
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => `sv-${Date.now()}` });
      await server.connect(transport);

      const httpServer = createServer(async (req, res) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
        await transport.handleRequest(req, res);
      });
      httpServer.listen(port, '127.0.0.1', () => {
        console.error(`🔌 MCP HTTP server running at http://127.0.0.1:${port}/mcp`);
      });
    },
    server,
  };
}
