// Agent toolset dispatcher tests (SP-C). @stellavault/core's decision handlers are
// mocked (avoid loading the heavy core barrel); path-safety + FS use a REAL temp vault
// so the read_note traversal guard is exercised against the real assertInsideVault.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
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
  it('exposes exactly the 5 v1 tools and marks log_decision as the only write', () => {
    expect([...AGENT_VALID_NAMES].sort()).toEqual(['find_decisions', 'list_topics', 'log_decision', 'read_note', 'search_vault']);
    expect(AGENT_TOOL_SCHEMAS).toHaveLength(5);
    expect(isAgentWriteTool('log_decision')).toBe(true);
    expect(isAgentWriteTool('search_vault')).toBe(false);
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
