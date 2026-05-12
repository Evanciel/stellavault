// Design Ref: docs/01-plan/features/federation-security-v2.plan.md §2
// Plan SC: §5 — verifySignature must NOT take a secretKey argument
//
// Federation node identity (Ed25519).
//
// v1 used `publicKey = sha256(secretKey)` as a fake asymmetric scheme, which
// meant verifySignature had to receive the secret key. v2 generates a real
// Ed25519 keypair; verifySignature only needs the public key.
//
// On-disk identity files from v1 (no `version` / non-ed25519 algorithm) are
// automatically backed up to `identity.v1.bak.json` and replaced. Federation
// has zero production users today, so no compatibility shim is shipped.

import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  sign,
  verify,
} from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface NodeIdentity {
  /** First 16 hex chars of sha256(publicKey). Public, deterministic from publicKey. */
  peerId: string;
  /** Ed25519 public key in SPKI DER form. Safe to share. */
  publicKey: Buffer;
  /** Ed25519 private key in PKCS#8 DER form. Never share, never log. */
  secretKey: Buffer;
  displayName: string;
  createdAt: string;
}

const IDENTITY_DIR = join(homedir(), '.stellavault', 'federation');
const IDENTITY_FILE = join(IDENTITY_DIR, 'identity.json');
const IDENTITY_VERSION = 2;
const IDENTITY_ALGORITHM = 'ed25519';

function derivePeerId(publicKey: Buffer): string {
  return createHash('sha256').update(publicKey).digest('hex').slice(0, 16);
}

/**
 * In-memory Ed25519 identity generator that does NOT touch disk. Useful for
 * tests that need many fresh identities without juggling HOME paths.
 */
export function generateEphemeralIdentity(displayName?: string): NodeIdentity {
  return generateIdentity(displayName);
}

function generateIdentity(displayName?: string): NodeIdentity {
  const { publicKey: pkObj, privateKey: skObj } = generateKeyPairSync('ed25519');
  const publicKey = pkObj.export({ type: 'spki', format: 'der' }) as Buffer;
  const secretKey = skObj.export({ type: 'pkcs8', format: 'der' }) as Buffer;
  const peerId = derivePeerId(publicKey);

  return {
    peerId,
    publicKey,
    secretKey,
    displayName: displayName ?? `node-${peerId.slice(0, 6)}`,
    createdAt: new Date().toISOString(),
  };
}

function persistIdentity(identity: NodeIdentity): void {
  mkdirSync(IDENTITY_DIR, { recursive: true });
  const content = JSON.stringify(
    {
      version: IDENTITY_VERSION,
      algorithm: IDENTITY_ALGORITHM,
      peerId: identity.peerId,
      publicKey: identity.publicKey.toString('hex'),
      secretKey: identity.secretKey.toString('hex'),
      displayName: identity.displayName,
      createdAt: identity.createdAt,
    },
    null,
    2,
  );
  writeFileSync(IDENTITY_FILE, content, { encoding: 'utf-8', mode: 0o600 });
  try {
    chmodSync(IDENTITY_FILE, 0o600);
  } catch {
    /* Windows ACL doesn't always honor POSIX modes; best-effort */
  }
}

export function getOrCreateIdentity(displayName?: string): NodeIdentity {
  if (existsSync(IDENTITY_FILE)) {
    const raw = JSON.parse(readFileSync(IDENTITY_FILE, 'utf-8')) as Record<string, unknown>;

    const isV2 = raw.version === IDENTITY_VERSION && raw.algorithm === IDENTITY_ALGORITHM;
    if (isV2) {
      return {
        peerId: String(raw.peerId),
        publicKey: Buffer.from(String(raw.publicKey), 'hex'),
        secretKey: Buffer.from(String(raw.secretKey), 'hex'),
        displayName: String(raw.displayName),
        createdAt: String(raw.createdAt),
      };
    }

    // v1 → v2 auto-migration: HMAC keys cannot be reused as Ed25519. Back up the
    // old file and mint a fresh keypair. Peers will need to re-pair, but
    // federation is pre-product so this is acceptable.
    const bakPath = IDENTITY_FILE.replace(/\.json$/, '.v1.bak.json');
    writeFileSync(bakPath, JSON.stringify(raw, null, 2), { encoding: 'utf-8', mode: 0o600 });
    console.warn(`[federation] Identity migrated to v2 (Ed25519). v1 backup: ${bakPath}`);
  }

  const identity = generateIdentity(displayName);
  persistIdentity(identity);
  return identity;
}

/** Detached Ed25519 signature over `message`. Returns 64-byte signature. */
export function signMessage(secretKeyDer: Buffer, message: Buffer): Buffer {
  const keyObj = createPrivateKey({ key: secretKeyDer, format: 'der', type: 'pkcs8' });
  return sign(null, message, keyObj);
}

/**
 * Verifies an Ed25519 signature. Note the signature change vs v1: there is no
 * `secretKey` parameter. A verifier only needs the signer's public key.
 */
export function verifySignature(publicKeyDer: Buffer, message: Buffer, signature: Buffer): boolean {
  try {
    const keyObj = createPublicKey({ key: publicKeyDer, format: 'der', type: 'spki' });
    return verify(null, message, keyObj, signature);
  } catch {
    // Malformed key or signature buffers: treat as verification failure rather
    // than throwing — callers should reject the message either way.
    return false;
  }
}

/** 32 random bytes for use as a handshake challenge. */
export function createChallenge(): Buffer {
  return randomBytes(32);
}

/** Signs a challenge with the local secret key. */
export function respondToChallenge(secretKey: Buffer, challenge: Buffer): Buffer {
  return signMessage(secretKey, challenge);
}

/**
 * Verifies that `response` is `peer`'s signature over `challenge`. This proves
 * the peer controls the secret key that corresponds to `peerPublicKey`.
 */
export function verifyChallenge(
  peerPublicKey: Buffer,
  challenge: Buffer,
  response: Buffer,
): boolean {
  return verifySignature(peerPublicKey, challenge, response);
}

/** Recompute peerId from a public key. Useful for verifying inbound handshakes. */
export function peerIdFromPublicKey(publicKey: Buffer): string {
  return derivePeerId(publicKey);
}
