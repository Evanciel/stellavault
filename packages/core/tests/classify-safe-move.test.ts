import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, existsSync, rmSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { safeMove } from '../src/intelligence/classify/safe-move.js';

let vault: string;
beforeEach(() => { vault = mkdtempSync(join(tmpdir(), 'sv-vault-')); });
afterEach(() => { rmSync(vault, { recursive: true, force: true }); });

describe('safeMove', () => {
  it('moves a file inside the vault, auto-creating dest dirs', () => {
    mkdirSync(join(vault, '00_Inbox'), { recursive: true });
    const from = join(vault, '00_Inbox', 'note.md');
    writeFileSync(from, 'hello');
    const r = safeMove(vault, from, join(vault, '_permanent', 'ml', 'note.md'));
    expect(r.moved).toBe(true);
    expect(existsSync(from)).toBe(false);
    expect(readFileSync(r.finalPath, 'utf8')).toBe('hello');
  });

  it('NEVER overwrites — a name collision gets a numeric suffix; existing file untouched', () => {
    mkdirSync(join(vault, 'a'), { recursive: true });
    mkdirSync(join(vault, 'b'), { recursive: true });
    writeFileSync(join(vault, 'a', 'n.md'), 'src');
    writeFileSync(join(vault, 'b', 'n.md'), 'EXISTING');
    const r = safeMove(vault, join(vault, 'a', 'n.md'), join(vault, 'b', 'n.md'));
    expect(r.moved).toBe(true);
    expect(r.finalPath.endsWith('n-2.md')).toBe(true);
    expect(readFileSync(join(vault, 'b', 'n.md'), 'utf8')).toBe('EXISTING'); // untouched
    expect(readFileSync(r.finalPath, 'utf8')).toBe('src');
  });

  it('refuses to move OUTSIDE the vault (traversal) — source left untouched', () => {
    const from = join(vault, 'n.md');
    writeFileSync(from, 'x');
    const r = safeMove(vault, from, join(vault, '..', 'escape.md'));
    expect(r.moved).toBe(false);
    expect(r.error).toBe('outside-vault');
    expect(existsSync(from)).toBe(true);
  });

  it('refuses a source outside the vault', () => {
    const outside = mkdtempSync(join(tmpdir(), 'sv-out-'));
    try {
      const from = join(outside, 'n.md');
      writeFileSync(from, 'x');
      const r = safeMove(vault, from, join(vault, 'n.md'));
      expect(r.moved).toBe(false);
      expect(r.error).toBe('outside-vault');
      expect(existsSync(from)).toBe(true);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('missing source → error, no throw', () => {
    const r = safeMove(vault, join(vault, 'nope.md'), join(vault, 'x.md'));
    expect(r.moved).toBe(false);
    expect(r.error).toBe('missing-source');
  });

  it('same source and dest → no-op error', () => {
    const p = join(vault, 'n.md');
    writeFileSync(p, 'x');
    const r = safeMove(vault, p, p);
    expect(r.error).toBe('same-path');
    expect(existsSync(p)).toBe(true);
  });
});
