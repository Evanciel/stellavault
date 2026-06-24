// Agent toolset dispatcher tests (SP-C). @stellavault/core's decision handlers are
// mocked (avoid loading the heavy core barrel); path-safety + FS use a REAL temp vault
// so the read_note traversal guard is exercised against the real assertInsideVault.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const logDecision = vi.fn(async (vp: string, _args: any) => ({ saved: join(vp, 'decisions', '2026-01-01-x.md'), fileName: '2026-01-01-x.md' }));
const findDecisions = vi.fn(async (_vp: string, _args: any) => ({ decisions: [{ file: 'd.md', content: 'c', score: 1 }], total: 1 }));
vi.mock('@stellavault/core', () => ({
  handleLogDecision: (vp: string, args: any) => logDecision(vp, args),
  handleFindDecisions: (vp: string, args: any) => findDecisions(vp, args),
}));

import {
  buildExecuteAgentTool, isAgentWriteTool, extractAgentCitations, AGENT_VALID_NAMES, AGENT_TOOL_SCHEMAS,
} from '../src/main/agent-tools.js';

let vault: string;
beforeAll(() => {
  vault = mkdtempSync(join(tmpdir(), 'sv-agent-tools-'));
  writeFileSync(join(vault, 'note.md'), '# Note\n\nhello world', 'utf-8');
});
afterAll(() => { try { rmSync(vault, { recursive: true, force: true }); } catch { /* */ } });

function makeDeps(over: any = {}) {
  return {
    searchEngine: { search: vi.fn(async () => [{ document: { id: '1', title: 'MCP', filePath: 'mcp.md', content: 'about mcp' }, chunk: { content: 'snippet text' }, score: 0.912 }]) },
    store: { getTopics: vi.fn(async () => [{ topic: 'mcp', count: 3 }]) },
    decayEngine: { recordAccess: vi.fn(async () => {}) },
    vaultPath: vault,
    coreReady: () => true,
    afterWrite: vi.fn(async () => {}),
    ...over,
  };
}

describe('agent-tools — toolset metadata', () => {
  it('exposes the 11 tools (7 read + 4 write) and marks the writes correctly', () => {
    expect([...AGENT_VALID_NAMES].sort()).toEqual([
      'append_note', 'create_note', 'detect_gaps', 'find_decisions', 'get_related', 'learning_path',
      'link_note', 'list_topics', 'log_decision', 'read_note', 'search_vault',
    ]);
    // 12 schemas = 11 dispatched tools + set_plan (a loop-local CONTROL tool advertised to the
    // model but intentionally NOT in AGENT_VALID_NAMES — runAgentLoop intercepts it).
    expect(AGENT_TOOL_SCHEMAS).toHaveLength(12);
    expect(AGENT_VALID_NAMES.has('set_plan')).toBe(false);
    expect((AGENT_TOOL_SCHEMAS as any[]).some((s) => s.function?.name === 'set_plan')).toBe(true);
    for (const w of ['log_decision', 'create_note', 'append_note', 'link_note']) expect(isAgentWriteTool(w)).toBe(true);
    for (const r of ['search_vault', 'read_note', 'list_topics', 'find_decisions', 'get_related', 'detect_gaps', 'learning_path']) expect(isAgentWriteTool(r)).toBe(false);
  });
});

describe('agent-tools — plan-act-reflect read tools (part B)', () => {
  it('get_related delegates to the injected helper; returns related notes with NO internal id', async () => {
    const getRelatedByPath = vi.fn(async () => [{ title: 'Rel', filePath: 'rel.md', score: 0.9, tags: ['x'] }]);
    const exec = buildExecuteAgentTool(makeDeps({ getRelatedByPath }) as any);
    const r: any = await exec('get_related', { filePath: 'note.md' });
    expect(getRelatedByPath).toHaveBeenCalledWith('note.md', 5);
    expect(r.related[0]).toMatchObject({ title: 'Rel', filePath: 'rel.md' });
    expect(JSON.stringify(r)).not.toMatch(/"id"/); // never leaks an internal doc id
  });
  it('get_related: missing filePath → error, no call', async () => {
    const getRelatedByPath = vi.fn();
    const exec = buildExecuteAgentTool(makeDeps({ getRelatedByPath }) as any);
    expect((await exec('get_related', {}) as any).error).toMatch(/required/);
    expect(getRelatedByPath).not.toHaveBeenCalled();
  });
  it('detect_gaps + learning_path delegate to injected helpers', async () => {
    const detectGaps = vi.fn(async () => ({ totalGaps: 1, gaps: [{ between: ['a', 'b'], suggestedTopic: 't', severity: 'low' }] }));
    const learningPath = vi.fn(async () => ({ items: [{ title: 'N', filePath: 'n.md', reason: 'due' }] }));
    const exec = buildExecuteAgentTool(makeDeps({ detectGaps, learningPath }) as any);
    expect((await exec('detect_gaps', {}) as any).totalGaps).toBe(1);
    const lp: any = await exec('learning_path', { limit: 5 });
    expect(learningPath).toHaveBeenCalledWith(5);
    expect(lp.items[0]).toMatchObject({ title: 'N', filePath: 'n.md' });
  });
});

describe('agent-tools — dispatcher', () => {
  it('unknown tool → {error} (never executes)', async () => {
    const exec = buildExecuteAgentTool(makeDeps() as any);
    expect(await exec('rm_rf', {})).toEqual({ error: 'unknown tool: rm_rf' });
  });

  it('gated on coreReady — false → index-not-ready', async () => {
    const exec = buildExecuteAgentTool(makeDeps({ coreReady: () => false }) as any);
    expect((await exec('search_vault', { query: 'x' }) as any).error).toMatch(/index not ready/);
  });

  it('search_vault maps hits and citations are extractable', async () => {
    const exec = buildExecuteAgentTool(makeDeps() as any);
    const r: any = await exec('search_vault', { query: 'mcp' });
    expect(r.results[0]).toMatchObject({ title: 'MCP', filePath: 'mcp.md', snippet: 'snippet text' });
    expect(extractAgentCitations('search_vault', r)).toEqual([{ title: 'MCP', filePath: 'mcp.md' }]);
    expect(extractAgentCitations('read_note', r)).toEqual([]); // only search yields citations
  });

  it('read_note: traversal path is rejected by assertInsideVault', async () => {
    const exec = buildExecuteAgentTool(makeDeps() as any);
    const r: any = await exec('read_note', { filePath: '../../../../etc/passwd' });
    expect(r.error).toMatch(/outside the vault/);
  });

  it('read_note: a real in-vault note returns its content', async () => {
    const exec = buildExecuteAgentTool(makeDeps() as any);
    const r: any = await exec('read_note', { filePath: 'note.md' });
    expect(r.content).toContain('hello world');
  });

  it('list_topics returns the store topics', async () => {
    const exec = buildExecuteAgentTool(makeDeps() as any);
    expect(await exec('list_topics', {})).toEqual({ topics: [{ topic: 'mcp', count: 3 }] });
  });

  it('find_decisions delegates to core', async () => {
    const exec = buildExecuteAgentTool(makeDeps() as any);
    const r: any = await exec('find_decisions', { query: 'auth' });
    expect(r.total).toBe(1);
    expect(findDecisions).toHaveBeenCalledWith(vault, { query: 'auth' });
  });

  it('log_decision: writes via core then runs afterWrite (index/bump)', async () => {
    const deps = makeDeps();
    const exec = buildExecuteAgentTool(deps as any);
    const r: any = await exec('log_decision', { title: 'Use X', decision: 'X', reasoning: 'because' });
    expect(r.ok).toBe(true);
    expect(logDecision).toHaveBeenCalled();
    expect(deps.afterWrite).toHaveBeenCalledWith(join(vault, 'decisions', '2026-01-01-x.md'));
  });

  it('log_decision: missing required field → error, no write', async () => {
    const deps = makeDeps();
    const exec = buildExecuteAgentTool(deps as any);
    logDecision.mockClear();
    const r: any = await exec('log_decision', { title: 'only title' });
    expect(r.error).toMatch(/required/);
    expect(logDecision).not.toHaveBeenCalled();
    expect(deps.afterWrite).not.toHaveBeenCalled();
  });
});

describe('agent-tools — knowledge-building writes (SP-G)', () => {
  it('create_note writes a new file (frontmatter + body) and runs afterWrite', async () => {
    const deps = makeDeps();
    const exec = buildExecuteAgentTool(deps as any);
    const r: any = await exec('create_note', { title: 'Atomic Notes', content: 'one idea per note. [[Zettelkasten]]', folder: 'Inbox', tags: ['pkm'] });
    expect(r.ok).toBe(true);
    expect(r.filePath).toBe(join('Inbox', 'Atomic-Notes.md'));
    const written = readFileSync(join(vault, 'Inbox', 'Atomic-Notes.md'), 'utf-8');
    expect(written).toContain('title: "Atomic Notes"');
    expect(written).toContain('[[Zettelkasten]]');
    expect(deps.afterWrite).toHaveBeenCalled();
  });

  it('create_note normalizes literal \\n in content to real newlines', async () => {
    const exec = buildExecuteAgentTool(makeDeps() as any);
    await exec('create_note', { title: 'Escaped', content: 'line1\\nline2\\n\\n## Head', folder: 'Inbox' });
    const written = readFileSync(join(vault, 'Inbox', 'Escaped.md'), 'utf-8');
    expect(written).toContain('line1\nline2\n\n## Head'); // real newlines, not literal \n
    expect(written).not.toContain('line1\\nline2'); // the escape sequence is gone
  });

  it('create_note refuses to overwrite an existing title', async () => {
    const deps = makeDeps();
    const exec = buildExecuteAgentTool(deps as any);
    await exec('create_note', { title: 'Dup', content: 'x' });
    const r: any = await exec('create_note', { title: 'Dup', content: 'y' });
    expect(r.error).toMatch(/already exists/);
  });

  it('create_note: traversal folder is rejected', async () => {
    const exec = buildExecuteAgentTool(makeDeps() as any);
    const r: any = await exec('create_note', { title: 'Evil', content: 'x', folder: '../../../tmp' });
    expect(r.error).toMatch(/outside the vault/);
  });

  it('append_note appends to an existing note; missing note → error', async () => {
    const deps = makeDeps();
    const exec = buildExecuteAgentTool(deps as any);
    const ok: any = await exec('append_note', { filePath: 'note.md', content: 'appended line' });
    expect(ok.ok).toBe(true);
    expect(readFileSync(join(vault, 'note.md'), 'utf-8')).toContain('appended line');
    const miss: any = await exec('append_note', { filePath: 'nope.md', content: 'x' });
    expect(miss.error).toMatch(/not found/);
  });

  it('link_note inserts a [[wiki-link]] (idempotent) — creates a graph edge', async () => {
    const deps = makeDeps();
    const exec = buildExecuteAgentTool(deps as any);
    const r1: any = await exec('link_note', { filePath: 'note.md', targetTitle: 'Atomic Notes' });
    expect(r1.ok).toBe(true);
    expect(readFileSync(join(vault, 'note.md'), 'utf-8')).toContain('[[Atomic Notes]]');
    const r2: any = await exec('link_note', { filePath: 'note.md', targetTitle: 'Atomic Notes' });
    expect(r2.note).toMatch(/already present/); // idempotent
  });
});
