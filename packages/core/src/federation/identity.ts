// Federation: Node Identity (HMAC-SHA256 signing)
// CRIT-01 fix: 실제 서명 검증 구현 (placeholder 제거)
// CRIT-04 fix: 키 파일 권한 0o600

import { randomBytes, createHash, createHmac } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from 'node:fs';
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
  const content = JSON.stringify({
    peerId: identity.peerId,
    publicKey: publicKey.toString('hex'),
    secretKey: secretKey.toString('hex'),
    displayName: identity.displayName,
    createdAt: identity.createdAt,
  }, null, 2);

  writeFileSync(IDENTITY_FILE, content, { encoding: 'utf-8', mode: 0o600 });
  try { chmodSync(IDENTITY_FILE, 0o600); } catch { /* Windows may not support */ }

  return identity;
}

// CRIT-01 fix: 실제 HMAC-SHA256 서명
export function signMessage(secretKey: Buffer, message: Buffer): Buffer {
  return createHmac('sha256', secretKey).update(message).digest();
}

// CRIT-01 fix: 실제 HMAC-SHA256 검증
export function verifySignature(publicKey: Buffer, secretKey: Buffer, message: Buffer, signature: Buffer): boolean {
  const expected = createHmac('sha256', secretKey).update(message).digest();
  if (expected.length !== signature.length) return false;
  // Timing-safe comparison
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected[i] ^ signature[i];
  }
  return diff === 0;
}

// Challenge-response 인증용 nonce 생성
export function createChallenge(): Buffer {
  return randomBytes(32);
}

// Challenge에 대한 응답 생성
export function respondToChallenge(secretKey: Buffer, challenge: Buffer): Buffer {
  return signMessage(secretKey, challenge);
}

// Challenge 응답 검증
export function verifyChallenge(secretKey: Buffer, challenge: Buffer, response: Buffer): boolean {
  return verifySignature(Buffer.alloc(0), secretKey, challenge, response);
}
