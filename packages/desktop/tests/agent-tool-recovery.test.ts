// Tool self-recovery (hermes absorb) — the agent's misses hand back material to recover with:
//  - search_vault matching nothing retries its longest terms (honestly labelled `note`)
//  - file-keyed tools (read/append/link/get_related) probe didYouMean titles on a bad path
//  - create_note on a duplicate title returns the existing filePath + an append_note hint
// All probes are read-only, bounded, and surface title/filePath only (same trust as search).
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('@stellavault/core', () => ({
  handleLogDecision: vi.fn(async () => ({ saved: 'x', fileName: 'x' })),
  handleFindDecisions: vi.fn(async () => ({ decisions: [], total: 0 })),
}));

import { buildExecuteAgentTool } from '../src/main/agent-tools.js';

let vault: string;
beforeAll(() => {
  vault = mkdtempSync(join(tmpdir(), 'sv-agent-recovery-'));
  writeFileSync(join(vault, 'real-note.md'), '# Real\n\nbody', 'utf-8');
});
afterAll(() => { try { rmSync(vault, { recursive: true, force: true }); } catch { /* */ } });

const HIT = { document: { id: '1', title: 'PDCA Workflow', filePath: 'pdca-workflow.md', content: 'c' }, chunk: { content: 's' }, score: 0.9 };

function makeDeps(searchImpl: (q: { query: string; limit: number }) => Promise<any[]>, over: any = {}) {
  return {
    searchEngine: { search: vi.fn(searchImpl) },
    store: { getTopics: vi.fn(async () => []) },
    decayEngine: { recordAccess: vi.fn(async () => {}) },
    vaultPath: vault,
    coreReady: () => true,
    afterWrite: vi.fn(async () => {}),
    ...over,
  };
}

describe('search_vault — relaxed-term recovery', () => {
  it('a multi-term query with no hits retries its longest terms and labels the result honestly', async () => {
    const search = vi.fn(async ({ query }: any) =>
      query === 'PDCA 워크플로우 회고 템플릿' ? [] : [HIT]);
    const exec = buildExecuteAgentTool(makeDeps(search) as any);
    const r: any = await exec('search_vault', { query: 'PDCA 워크플로우 회고 템플릿' });
    expect(r.results).toHaveLength(1);
    expect(r.results[0].filePath).toBe('pdca-workflow.md');
    expect(r.note).toContain('no notes matched the full query');
    // full query first, then term probes (2 longest terms)
    expect(search.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('a single-term query with no hits stays an honest empty result (nothing to relax)', async () => {
    const exec = buildExecuteAgentTool(makeDeps(async () => []) as any);
    const r: any = await exec('search_vault', { query: 'zzz없는말' });
    expect(r).toEqual({ results: [] });
  });

  it('relaxed probe dedupes across terms and never throws when the probe itself fails', async () => {
    let n = 0;
    const search = vi.fn(async () => { n += 1; if (n === 1) return []; if (n === 2) return [HIT]; throw new Error('probe down'); });
    const exec = buildExecuteAgentTool(makeDeps(search) as any);
    const r: any = await exec('search_vault', { query: 'first second' });
    expect(r.results).toHaveLength(1); // second probe threw → best-effort, first probe's hit kept
  });
});

describe('file-keyed misses — didYouMean probes', () => {
  it('read_note on a missing path returns didYouMean titles + the search-path hint', async () => {
    const exec = buildExecuteAgentTool(makeDeps(async () => [HIT]) as any);
    const r: any = await exec('read_note', { filePath: 'pdca_workflow_v2.md' });
    expect(r.error).toMatch(/not found/);
    expect(r.didYouMean).toEqual([{ title: 'PDCA Workflow', filePath: 'pdca-workflow.md' }]);
    expect(r.hint).toContain('search_vault');
  });

  it('read_note traversal keeps failing closed — hint yes, probe results still fine', async () => {
    const exec = buildExecuteAgentTool(makeDeps(async () => [HIT]) as any);
    const r: any = await exec('read_note', { filePath: '../../etc/passwd' });
    expect(r.error).toMatch(/outside the vault/);
    expect(r.didYouMean).toBeUndefined(); // traversal is refused BEFORE any probe
  });

  it('append_note and link_note misses probe too; a real note still works untouched', async () => {
    const exec = buildExecuteAgentTool(makeDeps(async () => [HIT]) as any);
    const missA: any = await exec('append_note', { filePath: 'nope.md', content: 'x' });
    expect(missA.error).toMatch(/not found/);
    expect(missA.didYouMean?.[0]?.filePath).toBe('pdca-workflow.md');
    const missL: any = await exec('link_note', { filePath: 'nope.md', targetTitle: 'T' });
    expect(missL.error).toMatch(/not found/);
    expect(missL.didYouMean?.[0]?.filePath).toBe('pdca-workflow.md');
    const okA: any = await exec('append_note', { filePath: 'real-note.md', content: 'more' });
    expect(okA.ok).toBe(true);
  });

  it('get_related index-miss probes; probe failure degrades to the plain error', async () => {
    const exec = buildExecuteAgentTool(makeDeps(async () => [HIT], {
      getRelatedByPath: vi.fn(async () => { throw new Error('not indexed'); }),
    }) as any);
    const r: any = await exec('get_related', { filePath: 'ghost.md' });
    expect(r.error).toMatch(/not found in index/);
    expect(r.didYouMean).toHaveLength(1);

    const execDown = buildExecuteAgentTool(makeDeps(async () => { throw new Error('down'); }, {
      getRelatedByPath: vi.fn(async () => { throw new Error('not indexed'); }),
    }) as any);
    const r2: any = await execDown('get_related', { filePath: 'ghost.md' });
    expect(r2.error).toMatch(/not found in index/);
    expect(r2.didYouMean).toBeUndefined();
  });
});

describe('create_note — duplicate-title pivot', () => {
  it('returns the existing note path + append hint so the model pivots in one step', async () => {
    const exec = buildExecuteAgentTool(makeDeps(async () => []) as any);
    const first: any = await exec('create_note', { title: 'Same Title', content: 'a' });
    expect(first.ok).toBe(true);
    const dup: any = await exec('create_note', { title: 'Same Title', content: 'b' });
    expect(dup.error).toMatch(/already exists/);
    expect(dup.filePath).toBe(first.filePath);
    expect(dup.hint).toContain('append_note');
  });
});
