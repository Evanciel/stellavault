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

import { readFileSync, writeFileSync, statSync, existsSync, mkdirSync } from 'node:fs';
import { isAbsolute, join, dirname } from 'node:path';
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
  // plan-act-reflect read tools (injected by index.ts — they reuse pipelines it already runs).
  // get_related is filePath-keyed (the model never sees the internal doc id); gaps/learning-path
  // are whole-vault. All return filePath/title only — never an internal id.
  getRelatedByPath?: (filePath: string, limit: number) => Promise<unknown>;
  detectGaps?: () => Promise<unknown>;
  learningPath?: (limit: number) => Promise<unknown>;
  // Agent MEMORY (P1, Design Ref §3.2, §5) — a READ surface over the off-vault durable user
  // model. Returns title/text/provenance only (never a secret, never a vault path). Injected
  // by index.ts → memory-store.recallMemory.
  memoryRecall?: (query: string, k?: number) => Promise<unknown> | unknown;
  // Agent MEMORY self-edit (P2, §3.3, §5) — force-confirm WRITE backends. Injected ONLY at the
  // chat:send site (NOT distill, §6 INT-2): an unattended ingest loop must never write durable
  // memory. The force-confirm gate (chat-engine) ensures these only run after user approval.
  memoryAppend?: (text: string) => Promise<unknown> | unknown;
  memoryReplace?: (id: string, oldStr: string, newStr: string) => Promise<unknown> | unknown;
}

// OpenAI function-format schemas — the ONLY tools the model is told about.
export const AGENT_TOOL_SCHEMAS: unknown[] = [
  // set_plan is a loop-local CONTROL tool — intentionally NOT in AGENT_VALID_NAMES /
  // AGENT_WRITE_NAMES / the dispatcher (no vault side effect); runAgentLoop intercepts it and
  // surfaces the plan as a live checklist. It IS advertised here so the model knows to call it.
  {
    type: 'function',
    function: {
      name: 'set_plan',
      description: 'Declare or update your step-by-step plan. Call ONCE near the start with 2-6 short steps, then call again ONLY to update `done` (count of finished steps). Write-free; does not change the vault.',
      parameters: {
        type: 'object',
        properties: {
          steps: { type: 'array', items: { type: 'string' }, description: '2-6 short imperative steps' },
          done: { type: 'number', description: 'how many steps are finished (0 at first)' },
        },
        required: ['steps'],
      },
    },
  },
  // invoke_skill (P3) is a loop-local CONTROL tool like set_plan — intentionally NOT in
  // AGENT_VALID_NAMES / AGENT_WRITE_NAMES / the dispatcher. runAgentLoop intercepts it, loads the
  // named skill's (Steps-only, scanned, capped) body, and pushes it as a role:'tool' ack. The
  // body is INERT text (declarative-never-eval) — the recipe's writes must re-fire through the
  // real confirm-gated WRITE tools. Available skill NAMES are listed in the system prompt catalogue.
  {
    type: 'function',
    function: {
      name: 'invoke_skill',
      description: "Load the step-by-step recipe for one of your Available Skills (listed in your context). Pass the skill's exact name. The steps are GUIDANCE — you still call the real tools to do the work; never assume a step ran on its own.",
      parameters: {
        type: 'object',
        properties: { name: { type: 'string', description: 'the exact name of a skill from your Available Skills list' } },
        required: ['name'],
      },
    },
  },
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
      name: 'get_related',
      description: 'Find notes related to a given note (semantically similar). Pass the filePath of a note from a search result.',
      parameters: {
        type: 'object',
        properties: { filePath: { type: 'string', description: 'filePath of a note (from search_vault)' }, limit: { type: 'number' } },
        required: ['filePath'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'detect_gaps',
      description: 'Find weakly-connected clusters in the vault — knowledge that exists but should be linked. No arguments.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'learning_path',
      description: "Get the user's prioritised review queue (notes most due for review by spaced-repetition decay).",
      parameters: { type: 'object', properties: { limit: { type: 'number' } } },
    },
  },
  {
    type: 'function',
    function: {
      name: 'recall_memory',
      description: "Recall durable facts you've learned about THIS user (their preferences, environment, ongoing projects) — your long-term memory, separate from their notes. Call this when the answer depends on who the user is or how they work. Returns short facts only.",
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'what to recall (e.g. "preferences", "hardware", a project name)' },
          k: { type: 'number', description: 'max facts to return (default 8)' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'core_memory_append',
      description: "Save a NEW durable fact about the user to your long-term memory (a preference, their environment, an ongoing project). Use when the user tells you something worth remembering across conversations. This WRITES to memory and ALWAYS requires the user to approve it. Keep each fact short and atomic. NEVER store secrets/keys.",
      parameters: {
        type: 'object',
        properties: { text: { type: 'string', description: 'one short durable fact about the user' } },
        required: ['text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'core_memory_replace',
      description: "Correct an existing durable fact in your long-term memory. Pass the block `id` (from recall_memory), the exact `old` substring to change, and the `new` text. ALWAYS requires user approval. `old` must appear EXACTLY ONCE in that fact.",
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'the memory block id to correct' },
          old: { type: 'string', description: 'the exact existing substring to replace (must match once)' },
          new: { type: 'string', description: 'the replacement text' },
        },
        required: ['id', 'old', 'new'],
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
  {
    type: 'function',
    function: {
      name: 'create_note',
      description: "Create a NEW markdown note in the vault (the second brain). WRITES a file and requires the user to approve it. Use [[Other Note]] wiki-links in the content to connect it to existing notes.",
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          content: { type: 'string', description: 'markdown body (may contain [[wiki-links]])' },
          folder: { type: 'string', description: 'vault subfolder (default Inbox)' },
          tags: { type: 'array', items: { type: 'string' } },
        },
        required: ['title', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'append_note',
      description: 'Append markdown content to the END of an existing note. WRITES the file and requires the user to approve it.',
      parameters: {
        type: 'object',
        properties: {
          filePath: { type: 'string', description: 'path of an existing note (from a search result)' },
          content: { type: 'string' },
        },
        required: ['filePath', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'link_note',
      description: 'Connect a note to another by inserting a [[Target Title]] wiki-link into it (creates a graph edge). WRITES the file and requires approval.',
      parameters: {
        type: 'object',
        properties: {
          filePath: { type: 'string', description: 'the note to add the link to' },
          targetTitle: { type: 'string', description: 'the exact title of the note to link to' },
        },
        required: ['filePath', 'targetTitle'],
      },
    },
  },
];

export const AGENT_VALID_NAMES = new Set<string>([
  'search_vault', 'read_note', 'list_topics', 'find_decisions',
  'get_related', 'detect_gaps', 'learning_path', 'recall_memory',
  'log_decision', 'create_note', 'append_note', 'link_note',
  'core_memory_append', 'core_memory_replace',
]);
const AGENT_WRITE_NAMES = new Set<string>([
  'log_decision', 'create_note', 'append_note', 'link_note',
  'core_memory_append', 'core_memory_replace',
]);
// Force-confirm WRITE tools (§3.3 / §7-1): durable memory writes feed the system prompt and are
// invisible in the file tree, so they ALWAYS require user approval — never the frictionless
// auto-apply the vault writes get. The agent loop fail-closes them when no approver is wired.
const AGENT_FORCE_CONFIRM_NAMES = new Set<string>(['core_memory_append', 'core_memory_replace']);

export function isAgentWriteTool(name: string): boolean {
  return AGENT_WRITE_NAMES.has(name);
}

export function isAgentForceConfirmTool(name: string): boolean {
  return AGENT_FORCE_CONFIRM_NAMES.has(name);
}

const MAX_READ_BYTES = 256 * 1024; // a single note read is bounded (huge/binary → error)
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const slugify = (title: string): string =>
  title.replace(/[^a-zA-Z가-힣0-9\s-]/g, '').replace(/\s+/g, '-').slice(0, 60) || 'note';
// Models (gemma4:e4b) sometimes emit literal "\n"/"\t" in a note's content arg instead of
// real newlines. For markdown notes that's almost always meant as a line break — normalize
// so the saved note is properly formatted, not a single line of escape sequences.
const normalizeNoteContent = (s: string): string =>
  s.replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n').replace(/\\t/g, '\t');
/** Resolve an absolute-or-vault-relative path and assert it stays inside the vault. */
function resolveInVault(vaultPath: string, filePath: string): string {
  const candidate = isAbsolute(filePath) ? filePath : join(vaultPath, filePath);
  return assertInsideVault(vaultPath, candidate); // throws on traversal
}

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
      // ── plan-act-reflect read tools (injected helpers; filePath/title only, no internal id) ──
      case 'get_related': {
        const filePath = str(args.filePath);
        if (!filePath) return { error: 'filePath is required' };
        if (!deps.getRelatedByPath) return { error: 'related-notes unavailable' };
        try { return { related: await deps.getRelatedByPath(filePath, Math.min(Number(args.limit) || 5, 10)) }; }
        catch { return { error: 'note not found in index' }; }
      }
      case 'detect_gaps': {
        if (!deps.detectGaps) return { gaps: [] };
        try { return await deps.detectGaps(); } catch { return { totalGaps: 0, gaps: [] }; }
      }
      case 'learning_path': {
        if (!deps.learningPath) return { items: [] };
        try { return await deps.learningPath(Math.min(Number(args.limit) || 10, 30)); } catch { return { items: [] }; }
      }
      // ── Agent MEMORY (P1, §3.2/§5) — READ over the off-vault durable user model ──
      case 'recall_memory': {
        if (!deps.memoryRecall) return { memories: [] };
        try { return await deps.memoryRecall(str(args.query), num(args.k)); }
        catch { return { memories: [] }; }
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
      // ── Agent MEMORY self-edit (P2, §3.3) — force-confirm WRITE → off-vault blocks.json ──
      case 'core_memory_append': {
        if (!deps.memoryAppend) return { error: 'memory write unavailable here' };
        const text = str(args.text);
        if (!text) return { error: 'text is required' };
        try { return await deps.memoryAppend(text); }
        catch (err) { return { error: (err as Error)?.message ?? 'failed to save memory' }; }
      }
      case 'core_memory_replace': {
        if (!deps.memoryReplace) return { error: 'memory write unavailable here' };
        const id = str(args.id);
        const oldStr = str(args.old);
        if (!id || !oldStr) return { error: 'id and old are required' };
        try { return await deps.memoryReplace(id, oldStr, str(args.new)); }
        catch (err) { return { error: (err as Error)?.message ?? 'failed to update memory' }; }
      }
      // ── Knowledge-building writes (SP-G, Living Knowledge Graph §9) — all confirm-gated ──
      case 'create_note': {
        const title = str(args.title);
        const content = normalizeNoteContent(str(args.content));
        if (!title || !content) return { error: 'title and content are required' };
        const rel = join(str(args.folder) || 'Inbox', `${slugify(title)}.md`);
        let safe: string;
        try { safe = assertInsideVault(deps.vaultPath, join(deps.vaultPath, rel)); }
        catch { return { error: 'target folder is outside the vault' }; }
        if (existsSync(safe)) return { error: 'a note with that title already exists' };
        const tags = Array.isArray(args.tags) ? (args.tags as unknown[]).map(String) : [];
        const md = [
          '---',
          `title: "${title.replace(/"/g, "'")}"`,
          tags.length ? `tags: [${tags.join(', ')}]` : '',
          `created: ${new Date().toISOString().slice(0, 10)}`,
          '---', '', content,
        ].filter(Boolean).join('\n');
        try {
          mkdirSync(dirname(safe), { recursive: true });
          writeFileSync(safe, md, 'utf-8');
        } catch (err) { return { error: (err as Error)?.message ?? 'failed to create note' }; }
        try { await deps.afterWrite(safe); } catch { /* index best-effort */ }
        return { ok: true, filePath: rel };
      }
      case 'append_note': {
        const content = normalizeNoteContent(str(args.content));
        if (!str(args.filePath) || !content) return { error: 'filePath and content are required' };
        let safe: string;
        try { safe = resolveInVault(deps.vaultPath, str(args.filePath)); }
        catch { return { error: 'path is outside the vault' }; }
        if (!existsSync(safe)) return { error: 'note not found' };
        try {
          const cur = readFileSync(safe, 'utf-8');
          writeFileSync(safe, `${cur.replace(/\s*$/, '')}\n\n${content}\n`, 'utf-8');
        } catch (err) { return { error: (err as Error)?.message ?? 'failed to append' }; }
        try { await deps.afterWrite(safe); } catch { /* */ }
        return { ok: true };
      }
      case 'link_note': {
        const target = str(args.targetTitle);
        if (!str(args.filePath) || !target) return { error: 'filePath and targetTitle are required' };
        let safe: string;
        try { safe = resolveInVault(deps.vaultPath, str(args.filePath)); }
        catch { return { error: 'path is outside the vault' }; }
        if (!existsSync(safe)) return { error: 'note not found' };
        const wiki = `[[${target}]]`;
        try {
          const cur = readFileSync(safe, 'utf-8');
          if (cur.includes(wiki)) return { ok: true, note: 'link already present' };
          writeFileSync(safe, `${cur.replace(/\s*$/, '')}\n\n관련: ${wiki}\n`, 'utf-8');
        } catch (err) { return { error: (err as Error)?.message ?? 'failed to link' }; }
        try { await deps.afterWrite(safe); } catch { /* */ }
        return { ok: true, linked: target };
      }
      default:
        return { error: `unknown tool: ${name}` };
    }
  };
}

/** The toolset object runAgentLoop consumes (schemas + name set + write predicate + citations). */
export function buildAgentToolset(opts?: { loadSkill?: (name: string) => string | undefined; hasSkills?: boolean }) {
  // P3 (review #4): advertise invoke_skill ONLY when ≥1 skill is promoted. With no skills it is a
  // dead slot that just crowds gemma4:e4b's small toolset (§5 ceiling spirit). The static
  // AGENT_TOOL_SCHEMAS is unchanged; we filter the per-request advertised copy.
  const schemas = opts?.hasSkills
    ? AGENT_TOOL_SCHEMAS
    : AGENT_TOOL_SCHEMAS.filter((s) => (s as { function?: { name?: string } })?.function?.name !== 'invoke_skill');
  return {
    schemas,
    validNames: AGENT_VALID_NAMES,
    isWrite: isAgentWriteTool,
    forceConfirm: isAgentForceConfirmTool, // P2: core_memory_* always confirm (fail-closed w/o approver)
    // P3: invoke_skill (a CONTROL tool) loads a skill body through this injected resolver. index.ts
    // provides it (vault-relative + provenance gate + scan); absent → invoke_skill acks "not found".
    loadSkill: opts?.loadSkill,
    extractCitations: extractAgentCitations,
  };
}
