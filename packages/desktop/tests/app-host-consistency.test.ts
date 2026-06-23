import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { APP_VAULT_RE } from '../src/renderer/lib/sanitize.js';

// SP1 app://vault host-pin — END-TO-END CONSISTENCY LOCK.
//
// The host-pin is enforced in TWO layers that MUST agree (canonical policy:
// case-sensitive host 'vault'):
//   1. renderer: sanitize.ts enforceAppHost() via APP_VAULT_RE (fail-closed —
//      any a[href]/img[src] app: URL not matching app://vault/… is dropped).
//   2. main:     index.ts registerAssetProtocol → `url.hostname !== 'vault'` → 404.
//
// This file fails CI if the two ever drift (e.g. a refactor lowercases one side
// but not the other, making app://VAULT a valid alias on one layer only). Do NOT
// loosen the host-pin to make this pass — fix the divergence instead.
describe('app://vault host-pin — renderer/main consistency (case-sensitive)', () => {
  it('renderer APP_VAULT_RE accepts the canonical app://vault form', () => {
    expect(APP_VAULT_RE.test('app://vault/notes/x.png')).toBe(true);
    expect(APP_VAULT_RE.test('app://vault')).toBe(true);
    expect(APP_VAULT_RE.test('app://vault/')).toBe(true);
  });

  it('renderer APP_VAULT_RE rejects wrong-case / wrong-host / opaque app: forms', () => {
    expect(APP_VAULT_RE.test('app://VAULT/x.png')).toBe(false); // wrong case
    expect(APP_VAULT_RE.test('app://Vault/x')).toBe(false);
    expect(APP_VAULT_RE.test('app://evil-host/x')).toBe(false);
    expect(APP_VAULT_RE.test('app://vault.evil.com/x')).toBe(false);
    expect(APP_VAULT_RE.test('app://vault-evil/x')).toBe(false); // sibling-prefix
    expect(APP_VAULT_RE.test('app:vault/x')).toBe(false);        // opaque, no //
    expect(APP_VAULT_RE.test('app:///x')).toBe(false);
  });

  it('main asset handler is case-sensitive: new URL() preserves a custom-scheme host case', () => {
    // The main handler rejects via `url.hostname !== 'vault'`. The WHATWG URL parser
    // does NOT lowercase a non-special-scheme host, so app://VAULT has hostname
    // 'VAULT' (≠ 'vault') → 404, agreeing with the renderer drop above.
    expect(new URL('app://vault/x').hostname).toBe('vault');
    expect(new URL('app://VAULT/x').hostname).toBe('VAULT');
    expect(new URL('app://VAULT/x').hostname).not.toBe('vault');
  });

  it('main index.ts still pins the host case-sensitively (structural lock)', () => {
    const mainSrc = readFileSync(join(__dirname, '..', 'src', 'main', 'index.ts'), 'utf-8');
    // A refactor that removes/loosens this (e.g. lowercasing the hostname) fails
    // here, forcing a matching change to the renderer's APP_VAULT_RE (and this test).
    expect(mainSrc).toContain("url.hostname !== 'vault'");
    expect(mainSrc).not.toMatch(/hostname[^\n]*toLowerCase/);
  });

  it('the two layers AGREE: both REJECT app://VAULT and both ACCEPT app://vault', () => {
    const rendererRejectsWrongCase = !APP_VAULT_RE.test('app://VAULT/x');
    const mainRejectsWrongCase = new URL('app://VAULT/x').hostname !== 'vault';
    expect(rendererRejectsWrongCase && mainRejectsWrongCase).toBe(true);

    const rendererAcceptsCanonical = APP_VAULT_RE.test('app://vault/x');
    const mainAcceptsCanonical = new URL('app://vault/x').hostname === 'vault';
    expect(rendererAcceptsCanonical && mainAcceptsCanonical).toBe(true);
  });
});
