// Design Ref: §4.1 — MCP Server (stdio + SSE)

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
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
import type { DecayEngine } from '../intelligence/decay-engine.js';

export interface McpServerOptions {
  store: VectorStore;
  searchEngine: SearchEngine;
  vaultPath?: string;
  decayEngine?: DecayEngine;
}

export function createMcpServer(options: McpServerOptions) {
  const { store, searchEngine, vaultPath = '', decayEngine } = options;

  const server = new Server(
    { name: 'evan-knowledge-hub', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  // List tools
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      searchToolDef, getDocumentToolDef, listTopicsToolDef, getRelatedToolDef,
      generateClaudeMdToolDef, createSnapshotToolDef, loadSnapshotToolDef,
      logDecisionToolDef, findDecisionsToolDef, exportToolDef,
      ...(decayEngine ? [getDecayStatusToolDef, getMorningBriefToolDef] : []),
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
    server,
  };
}
