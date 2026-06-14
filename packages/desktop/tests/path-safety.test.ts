import { describe, it, expect } from 'vitest';
import { resolve, join, sep } from 'node:path';
import {
  assertInsideVault,
  sanitizeAssetName,
  assertAssetSize,
  ALLOWED_ASSET_EXT,
  MAX_ASSET_BYTES,
} from '../src/main/path-safety.js';

// T1-3: real unit tests for the security boundary. Imports the SAME pure helpers
// main/index.ts uses (no replication, no drift) — runnable without Electron.

const VAULT = resolve('/tmp/sv-vault');

describe('assertInsideVault', () => {
  it('allows the vault root itself', () => {
    expect(assertInsideVault(VAULT, VAULT)).toBe(VAULT);
  });

  it('allows a file directly inside the vault', () => {
    const inside = join(VAULT, 'note.md');
    expect(assertInsideVault(VAULT, inside)).toBe(resolve(inside));
  });

  it('allows a deeply nested file inside the vault', () => {
    const inside = join(VAULT, 'a', 'b', 'c', 'note.md');
    expect(assertInsideVault(VAULT, inside)).toBe(resolve(inside));
  });

  it('rejects an absolute path outside the vault', () => {
    expect(() => assertInsideVault(VAULT, resolve('/etc/passwd'))).toThrow(/Access denied/);
  });

  it('rejects a parent-directory file', () => {
    expect(() => assertInsideVault(VAULT, resolve('/tmp/secret.md'))).toThrow(/Access denied/);
  });

  it('rejects ../ traversal escaping the vault', () => {
    const evil = join(VAULT, '..', '..', 'etc', 'passwd');
    expect(() => assertInsideVault(VAULT, evil)).toThrow(/Access denied/);
  });

  it('rejects encoded-ish traversal that resolves outside', () => {
    const evil = join(VAULT, 'sub', '..', '..', 'outside.md');
    expect(() => assertInsideVault(VAULT, evil)).toThrow(/Access denied/);
  });

  it('rejects a sibling-prefix bypass (vault vs vault-evil)', () => {
    // The classic startsWith(vaultRoot) bug: VAULT + '-evil' shares the prefix
    // but is NOT inside the vault. The sep-suffixed check must catch this.
    const sibling = `${VAULT}-evil${sep}note.md`;
    expect(() => assertInsideVault(VAULT, sibling)).toThrow(/Access denied/);
  });

  it('traversal that climbs then re-enters the vault is allowed (resolves inside)', () => {
    const reentry = join(VAULT, 'sub', '..', 'note.md');
    expect(assertInsideVault(VAULT, reentry)).toBe(resolve(join(VAULT, 'note.md')));
  });
});

describe('sanitizeAssetName', () => {
  it('accepts every whitelisted extension', () => {
    for (const ext of ALLOWED_ASSET_EXT) {
      const r = sanitizeAssetName(`pic${ext}`);
      expect(r.ext).toBe(ext);
    }
  });

  it('lowercases the extension', () => {
    expect(sanitizeAssetName('PIC.PNG').ext).toBe('.png');
  });

  it('strips directory components from the filename', () => {
    const r = sanitizeAssetName('../../etc/evil.png');
    expect(r.base).toBe('evil');
    expect(r.ext).toBe('.png');
  });

  it('strips Windows-style directory components', () => {
    const r = sanitizeAssetName('C:\\Windows\\evil.png');
    // basename keeps the last segment; ":" and "\\" are sanitized to "_" if present.
    expect(r.base).not.toContain('\\');
    expect(r.ext).toBe('.png');
  });

  it('rejects an unsupported extension', () => {
    expect(() => sanitizeAssetName('malware.exe')).toThrow(/unsupported image type/);
  });

  it('rejects a missing extension', () => {
    expect(() => sanitizeAssetName('noext')).toThrow(/unsupported image type/);
  });

  it('sanitizes shell/path metacharacters in the base name', () => {
    const r = sanitizeAssetName('a/b;rm -rf$.png');
    expect(r.base).not.toMatch(/[;$/]/);
  });

  it('preserves CJK / accented characters in the base name', () => {
    const r = sanitizeAssetName('한글이미지.png');
    expect(r.base).toBe('한글이미지');
  });

  it('falls back to "image" for an empty / undefined name', () => {
    expect(sanitizeAssetName(undefined).base).toBe('image');
  });
});

describe('assertAssetSize', () => {
  it('rejects an empty payload', () => {
    expect(() => assertAssetSize(0)).toThrow(/empty/);
  });

  it('accepts a normal-sized payload', () => {
    expect(() => assertAssetSize(1024)).not.toThrow();
  });

  it('accepts a payload exactly at the cap', () => {
    expect(() => assertAssetSize(MAX_ASSET_BYTES)).not.toThrow();
  });

  it('rejects a payload over the 50MB cap', () => {
    expect(() => assertAssetSize(MAX_ASSET_BYTES + 1)).toThrow(/too large/);
  });
});
