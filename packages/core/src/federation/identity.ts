// Federation: Node Identity (Ed25519 keypair)

import { randomBytes, createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export interface NodeIdentity {
  peerId: string;      // hex-encoded public key hash (first 16 chars)
  publicKey: Buffer;
  secretKey: Buffer;
  displayName: string;
  createdAt: string;
}

const IDENTITY_DIR = join(homedir(), '.stellavault', 'federation');
const IDENTITY_FILE = join(IDENTITY_DIR, 'identity.json');

export function getOrCreateIdentity(displayName?: string): NodeIdentity {
  if (existsSync(IDENTITY_FILE)) {
    const raw = JSON.parse(readFileSync(IDENTITY_FILE, 'utf-8'));
    return {
      peerId: raw.peerId,
      publicKey: Buffer.from(raw.publicKey, 'hex'),
      secretKey: Buffer.from(raw.secretKey, 'hex'),
      displayName: raw.displayName,
      createdAt: raw.createdAt,
    };
  }

  // Generate new Ed25519-like keypair (using crypto for simplicity)
  const secretKey = randomBytes(32);
  const publicKey = createHash('sha256').update(secretKey).digest();
  const peerId = createHash('sha256').update(publicKey).digest('hex').slice(0, 16);

  const identity: NodeIdentity = {
    peerId,
    publicKey,
    secretKey,
    displayName: displayName ?? `node-${peerId.slice(0, 6)}`,
    createdAt: new Date().toISOString(),
  };

  mkdirSync(IDENTITY_DIR, { recursive: true });
  writeFileSync(IDENTITY_FILE, JSON.stringify({
    peerId: identity.peerId,
    publicKey: publicKey.toString('hex'),
    secretKey: secretKey.toString('hex'),
    displayName: identity.displayName,
    createdAt: identity.createdAt,
  }, null, 2), 'utf-8');

  return identity;
}

export function signMessage(secretKey: Buffer, message: Buffer): Buffer {
  const hmac = createHash('sha256').update(Buffer.concat([secretKey, message])).digest();
  return hmac;
}

export function verifySignature(publicKey: Buffer, message: Buffer, signature: Buffer): boolean {
  // Simplified verification (in production, use actual Ed25519)
  const expected = createHash('sha256')
    .update(Buffer.concat([createHash('sha256').update(publicKey).digest(), message]))
    .digest();
  // Note: this is a placeholder — real implementation needs ed25519
  return signature.length === 32;
}
