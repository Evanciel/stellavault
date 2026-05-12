// Plan SC: docs/01-plan/features/federation-security-v2.plan.md §5 — every
// acceptance criterion for the Ed25519 identity rewrite.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';

import {
  createChallenge,
  getOrCreateIdentity,
  peerIdFromPublicKey,
  respondToChallenge,
  signMessage,
  verifyChallenge,
  verifySignature,
} from '../src/federation/identity.js';

// The module hard-codes `~/.stellavault/federation/identity.json`. Tests
// redirect HOME to a tmp dir so they cannot trash the developer's real key.
let tmpHome: string;
let originalHome: string | undefined;
let originalUserprofile: string | undefined;

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), 'stellavault-identity-'));
  originalHome = process.env.HOME;
  originalUserprofile = process.env.USERPROFILE;
  process.env.HOME = tmpHome;
  process.env.USERPROFILE = tmpHome;
  // node:os homedir() caches its result via SystemEnvironmentVariableTarget on
  // some platforms, but the federation module evaluates homedir() each call,
  // so resetting the env var is sufficient.
  vi.resetModules();
});

afterEach(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalUserprofile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = originalUserprofile;
  rmSync(tmpHome, { recursive: true, force: true });
});

describe('federation identity v2 — generation', () => {
  it('issues an Ed25519 keypair with a deterministic peerId', async () => {
    // Reimport with the patched HOME so identity.ts re-resolves homedir().
    const mod = await import('../src/federation/identity.js?fresh-1');
    const id = mod.getOrCreateIdentity('test-node');

    expect(id.peerId).toMatch(/^[0-9a-f]{16}$/);
    expect(id.publicKey.length).toBeGreaterThanOrEqual(32); // SPKI DER: 32B raw + 12B prefix
    expect(id.secretKey.length).toBeGreaterThanOrEqual(32);
    expect(id.displayName).toBe('test-node');

    // peerId is publicly derivable from publicKey
    const expected = createHash('sha256').update(id.publicKey).digest('hex').slice(0, 16);
    expect(id.peerId).toBe(expected);
    expect(mod.peerIdFromPublicKey(id.publicKey)).toBe(id.peerId);
  });

  it('returns the same identity on subsequent calls', async () => {
    const mod = await import('../src/federation/identity.js?fresh-2');
    const first = mod.getOrCreateIdentity('reuse');
    const second = mod.getOrCreateIdentity('ignored-second-call');
    expect(second.peerId).toBe(first.peerId);
    expect(second.publicKey.equals(first.publicKey)).toBe(true);
    expect(second.secretKey.equals(first.secretKey)).toBe(true);
    // displayName is set on first creation only
    expect(second.displayName).toBe('reuse');
  });

  it('persists v2 marker and hex-encoded keys', async () => {
    const mod = await import('../src/federation/identity.js?fresh-3');
    const id = mod.getOrCreateIdentity('persistence');

    const file = join(tmpHome, '.stellavault', 'federation', 'identity.json');
    expect(existsSync(file)).toBe(true);
    const raw = JSON.parse(readFileSync(file, 'utf-8'));
    expect(raw.version).toBe(2);
    expect(raw.algorithm).toBe('ed25519');
    expect(raw.publicKey).toBe(id.publicKey.toString('hex'));
    expect(raw.secretKey).toBe(id.secretKey.toString('hex'));
  });
});

describe('federation identity v2 — sign/verify', () => {
  it('round-trips a signature with only the public key for verification', async () => {
    const mod = await import('../src/federation/identity.js?fresh-4');
    const id = mod.getOrCreateIdentity();
    const message = Buffer.from('hello federation');

    const signature = mod.signMessage(id.secretKey, message);
    expect(signature.length).toBe(64); // Ed25519 detached signature

    // NOTE: verifySignature does not take a secretKey — that was the v1 bug.
    expect(mod.verifySignature(id.publicKey, message, signature)).toBe(true);
  });

  it('rejects signatures made with a different key', async () => {
    const mod = await import('../src/federation/identity.js?fresh-5a');
    const idA = mod.getOrCreateIdentity('A');

    // Generate a second identity by switching HOME so the file doesn't clash
    process.env.HOME = mkdtempSync(join(tmpdir(), 'stellavault-identity-B-'));
    process.env.USERPROFILE = process.env.HOME;
    const modB = await import('../src/federation/identity.js?fresh-5b');
    const idB = modB.getOrCreateIdentity('B');

    const message = Buffer.from('not yours to sign');
    const sigB = modB.signMessage(idB.secretKey, message);

    // Verify B's signature against A's public key → must fail
    expect(mod.verifySignature(idA.publicKey, message, sigB)).toBe(false);
    rmSync(process.env.HOME, { recursive: true, force: true });
  });

  it('rejects tampered messages', async () => {
    const mod = await import('../src/federation/identity.js?fresh-6');
    const id = mod.getOrCreateIdentity();
    const message = Buffer.from('original payload');
    const sig = mod.signMessage(id.secretKey, message);

    const tampered = Buffer.from('original payload!');
    expect(mod.verifySignature(id.publicKey, tampered, sig)).toBe(false);
  });

  it('returns false (does not throw) on malformed inputs', async () => {
    const mod = await import('../src/federation/identity.js?fresh-7');
    const id = mod.getOrCreateIdentity();
    const message = Buffer.from('x');
    const garbageSig = Buffer.from('not-a-signature');
    const garbageKey = Buffer.from('not-a-key');

    expect(mod.verifySignature(id.publicKey, message, garbageSig)).toBe(false);
    expect(mod.verifySignature(garbageKey, message, garbageSig)).toBe(false);
  });
});

describe('federation identity v2 — challenge/response', () => {
  it('creates challenges of 32 random bytes', async () => {
    const mod = await import('../src/federation/identity.js?fresh-8');
    const c1 = mod.createChallenge();
    const c2 = mod.createChallenge();
    expect(c1.length).toBe(32);
    expect(c2.length).toBe(32);
    expect(c1.equals(c2)).toBe(false); // random
  });

  it('completes a challenge-response round-trip', async () => {
    const mod = await import('../src/federation/identity.js?fresh-9');
    const id = mod.getOrCreateIdentity();
    const challenge = mod.createChallenge();
    const response = mod.respondToChallenge(id.secretKey, challenge);

    // Verifier only knows the peer's publicKey + challenge it sent
    expect(mod.verifyChallenge(id.publicKey, challenge, response)).toBe(true);
  });

  it('rejects a response to a different challenge (replay defence)', async () => {
    const mod = await import('../src/federation/identity.js?fresh-10');
    const id = mod.getOrCreateIdentity();
    const challenge1 = mod.createChallenge();
    const challenge2 = mod.createChallenge();
    const response1 = mod.respondToChallenge(id.secretKey, challenge1);

    expect(mod.verifyChallenge(id.publicKey, challenge2, response1)).toBe(false);
  });
});

describe('federation identity v2 — v1 migration', () => {
  it('backs up a v1 file and mints a fresh v2 keypair', async () => {
    const dir = join(tmpHome, '.stellavault', 'federation');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, 'identity.json');
    const v1 = {
      peerId: 'legacyabc1234567',
      publicKey: '00'.repeat(32), // v1 fake "publicKey"
      secretKey: '11'.repeat(32),
      displayName: 'legacy-node',
      createdAt: '2026-04-01T00:00:00.000Z',
    };
    writeFileSync(file, JSON.stringify(v1, null, 2), 'utf-8');

    const mod = await import('../src/federation/identity.js?fresh-11');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const id = mod.getOrCreateIdentity();

    // Migration warning emitted
    expect(warnSpy).toHaveBeenCalled();
    const warningText = warnSpy.mock.calls[0]?.[0];
    expect(typeof warningText === 'string' && warningText.includes('Identity migrated')).toBe(true);

    // v1 backup exists with the original contents
    const bak = join(dir, 'identity.v1.bak.json');
    expect(existsSync(bak)).toBe(true);
    expect(JSON.parse(readFileSync(bak, 'utf-8'))).toEqual(v1);

    // New v2 identity is real Ed25519 (peerId derives from publicKey)
    expect(id.peerId).not.toBe('legacyabc1234567');
    const recomputed = createHash('sha256').update(id.publicKey).digest('hex').slice(0, 16);
    expect(id.peerId).toBe(recomputed);

    // New file is v2
    const newRaw = JSON.parse(readFileSync(file, 'utf-8'));
    expect(newRaw.version).toBe(2);
    expect(newRaw.algorithm).toBe('ed25519');

    warnSpy.mockRestore();
  });
});
