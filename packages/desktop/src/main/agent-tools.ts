// Stellavault Desktop — Agent toolset (SP-C, Design Ref: §4, §6).
//
// The second-brain agent's TOOLS. Each tool calls @stellavault/core IN-PROCESS using the
// main-process vault singletons (searchEngine/store/decayEngine/embedder + vaultPath) — NO
// MCP HTTP hop (which would expose the unauthenticated create-knowledge-node/link writes).
//
// Security invariants:
//  - The model sees ONLY AGENT_TOOL_SCHEMAS; the dispatcher is a FIXED switch (unknown name
//    → {error} — never executed). runAgentLoop also gates on AGENT_VALID_NAMES (defence in
//    depth). The renderer can NEVER name a tool — tool calls come only from the main model
//    stream.
//  - Any tool that touches the filesystem calls assertInsideVault ITSELF (path-safety is
//    per-call opt-in). `../` traversal collapses → throw → {error}, never an arbitrary read.
//  - The single WRITE tool (log_decision) is gated by the loop's human-confirm step BEFORE
//    the dispatcher runs it; after the write, deps.afterWrite re-asserts the path, indexes,
//    and bumps the FS/graph cache versions (the same bookkeeping every vault IPC write does).
//  - v1 scope: 4 read + 1 confirm-gated write. get_related (id-based core API) and the other
//    16 MCP tools are deferred — keeping the toolset small avoids overwhelming gemma4:e4b.

import { readFileSync, statSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { handleLogDecision, handleFindDecisions } from '@stellavault/core';
import { assertInsideVault } from './path-safety.js';
import type { ChatCitation } from '../shared/ipc-types.js';

/** Runtime deps the tools call — injected by the main handler (SP-D) from its singletons. */
export interface AgentToolDeps {
  searchEngine: any;
  store: any;
  decayEngine: any;
  vaultPath: string;
  coreReady: () => boolean;
  /** Post-write bookkeeping owned by index.ts: re-assert path + indexFiles + bump caches. */
  afterWrite: (savedPath: string) => Promise<void> | void;
}

// OpenAI function-format schemas — the ONLY tools the model is told about.
export const AGENT_TOOL_SCHEMAS: unknown[] = [
  {
    type: 'function',
    function: {
      name: 'search_vault',
      description: "Search the user's knowledge vault (their second brain) for notes relevant to a query. Returns note titles, file paths, and short snippets — use read_note to get full content.",
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'what to search for' },
          limit: { type: 'number', description: 'max results (default 8)' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_note',
      description: 'Read the full markdown content of one note by its filePath (as returned by search_vault).',
      parameters: {
        type: 'object',
        properties: { filePath: { type: 'string', description: 'vault-relative or absolute path from a search result' } },
        required: ['filePath'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_topics',
      description: 'List the tags/topics across the vault with their note counts.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'find_decisions',
      description: "Search the user's decision journal for past decisions matching a query.",
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'log_decision',
      description: "Record a NEW decision in the vault's decision journal. This WRITES a file to the vault and REQUIRES the user to approve it before it runs.",
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          decision: { type: 'string' },
          reasoning: { type: 'string' },
          context: { type: 'string' },
          alternatives: { type: 'array', items: { type: 'string' } },
          project: { type: 'string' },
        },
        required: ['title', 'decision', 'reasoning'],
      },
    },
  },
];

export const AGENT_VALID_NAMES = new Set<string>(['search_vault', 'read_note', 'list_topics', 'find_decisions', 'log_decision']);
const AGENT_WRITE_NAMES = new Set<string>(['log_decision']);

export function isAgentWriteTool(name: string): boolean {
  return AGENT_WRITE_NAMES.has(name);
}

const MAX_READ_BYTES = 256 * 1024; // a single note read is bounded (huge/binary → error)
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

function mapSearchHits(results: any[]): Array<{ title: string; filePath: string; snippet: string; score: number }> {
  return (results ?? []).map((r: any) => ({
    title: r?.document?.title ?? '',
    filePath: r?.document?.filePath ?? '',
    snippet: String(r?.chunk?.content ?? r?.document?.content ?? '').slice(0, 200),
    score: Math.round((Number(r?.score) || 0) * 1000) / 1000,
  }));
}

/** Citations surfaced to the user's bubble from a tool result (search hits → clickable notes). */
export function extractAgentCitations(name: string, result: unknown): ChatCitation[] {
  if (name !== 'search_vault') return [];
  const hits = (result as any)?.results;
  if (!Array.isArray(hits)) return [];
  return hits
    .filter((h) => h?.filePath)
    .slice(0, 8)
    .map((h) => ({ title: String(h.title || h.filePath), filePath: String(h.filePath) }));
}

/** Build the in-process dispatcher. FIXED switch — unknown names never execute. */
export function buildExecuteAgentTool(deps: AgentToolDeps): (name: string, args: Record<string, unknown>) => Promise<unknown> {
  return async (name, args) => {
    if (!deps.coreReady()) return { error: 'index not ready — try again in a moment' };
    switch (name) {
      case 'search_vault': {
        const query = str(args.query);
        if (!query) return { error: 'query is required' };
        const results = await deps.searchEngine.search({ query, limit: num(args.limit) ?? 8 });
        const hits = mapSearchHits(results);
        // Replicate the MCP server's access side-effect (decay stability) — fire-and-forget.
        for (const r of (results ?? []).slice(0, 3)) {
          const id = r?.document?.id;
          if (id) void deps.decayEngine?.recordAccess?.({ documentId: id, type: 'mcp_query', timestamp: new Date().toISOString() }).catch(() => {});
        }
        return { results: hits };
      }
      case 'read_note': {
        const filePath = str(args.filePath);
        if (!filePath) return { error: 'filePath is required' };
        let safe: string;
        try {
          // The model echoes a filePath from a search result (absolute) — but tolerate a
          // vault-relative path too. assertInsideVault resolves via CWD, so resolve a
          // relative path against the vault FIRST; traversal still collapses outside → throw.
          const candidate = isAbsolute(filePath) ? filePath : join(deps.vaultPath, filePath);
          safe = assertInsideVault(deps.vaultPath, candidate); // throws on traversal
        } catch {
          return { error: 'path is outside the vault' };
        }
        try {
          const size = statSync(safe).size;
          if (size > MAX_READ_BYTES) return { error: 'note too large to read inline' };
          const content = readFileSync(safe, 'utf-8');
          if (content.includes('\u0000')) return { error: 'binary file' };
          return { filePath, content };
        } catch {
          return { error: 'note not found or unreadable' };
        }
      }
      case 'list_topics': {
        if (typeof deps.store.getTopics !== 'function') return { topics: [] };
        const topics = await deps.store.getTopics();
        return { topics };
      }
      case 'find_decisions': {
        const query = str(args.query);
        if (!query) return { error: 'query is required' };
        return await handleFindDecisions(deps.vaultPath, { query });
      }
      case 'log_decision': {
        const title = str(args.title);
        const decision = str(args.decision);
        const reasoning = str(args.reasoning);
        if (!title || !decision || !reasoning) return { error: 'title, decision and reasoning are required' };
        let saved: { saved: string; fileName: string };
        try {
          saved = await handleLogDecision(deps.vaultPath, {
            title, decision, reasoning,
            context: str(args.context) || undefined,
            alternatives: Array.isArray(args.alternatives) ? args.alternatives.map(String) : undefined,
            project: str(args.project) || undefined,
          });
        } catch (err) {
          return { error: (err as Error)?.message ?? 'failed to write decision' };
        }
        // index.ts bookkeeping: re-assert path + indexFiles + bump FS/graph caches.
        try { await deps.afterWrite(saved.saved); } catch { /* indexing best-effort */ }
        return { ok: true, fileName: saved.fileName };
      }
      default:
        return { error: `unknown tool: ${name}` };
    }
  };
}

/** The toolset object runAgentLoop consumes (schemas + name set + write predicate + citations). */
export function buildAgentToolset() {
  return {
    schemas: AGENT_TOOL_SCHEMAS,
    validNames: AGENT_VALID_NAMES,
    isWrite: isAgentWriteTool,
    extractCitations: extractAgentCitations,
  };
}
