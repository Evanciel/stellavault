// Cloud Sync (F-A04) — E2E encrypted SQLite backup
// 서버리스: S3-compatible API로 직접 업로드 (R2, S3, MinIO)
// Design Ref: PRD §7.1 Tier 2

import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export interface CloudConfig {
  endpoint: string;    // S3-compatible endpoint (e.g., https://xxx.r2.cloudflarestorage.com)
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  encryptionKey?: string;  // user-provided, or auto-generated
}

export interface SyncResult {
  action: 'upload' | 'download';
  dbSize: number;
  encryptedSize: number;
  timestamp: string;
  success: boolean;
  error?: string;
}

const CLOUD_DIR = join(homedir(), '.stellavault', 'cloud');
const KEY_FILE = join(CLOUD_DIR, 'encryption.key');
const SYNC_STATE_FILE = join(CLOUD_DIR, 'sync-state.json');

// AES-256-GCM 암호화
export function encrypt(data: Buffer, key: Buffer): { encrypted: Buffer; iv: Buffer; tag: Buffer } {
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { encrypted, iv, tag };
}

export function decrypt(encrypted: Buffer, key: Buffer, iv: Buffer, tag: Buffer): Buffer {
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

// 암호화 키 관리
export function getOrCreateEncryptionKey(userKey?: string): Buffer {
  mkdirSync(CLOUD_DIR, { recursive: true });

  if (userKey) {
    const key = createHash('sha256').update(userKey).digest();
    writeFileSync(KEY_FILE, key.toString('hex'), 'utf-8');
    return key;
  }

  if (existsSync(KEY_FILE)) {
    return Buffer.from(readFileSync(KEY_FILE, 'utf-8').trim(), 'hex');
  }

  const key = randomBytes(32);
  writeFileSync(KEY_FILE, key.toString('hex'), { encoding: 'utf-8', mode: 0o600 });
  try { chmodSync(KEY_FILE, 0o600); } catch { /* Windows may not support */ }
  return key;
}

// S3-compatible upload (presigned 불필요 — 직접 PUT)
async function s3Put(config: CloudConfig, objectKey: string, data: Buffer, contentType = 'application/octet-stream'): Promise<boolean> {
  const { endpoint, bucket, accessKeyId, secretAccessKey } = config;

  // HIGH-05: endpoint 검증
  try {
    const parsed = new URL(endpoint);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Invalid protocol');
    if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') throw new Error('Local endpoint');
  } catch (e) { throw new Error(`Invalid cloud endpoint: ${endpoint}. ${e instanceof Error ? e.message : ''}`); }

  const url = `${endpoint}/${bucket}/${objectKey}`;
  const date = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';

  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(data.length),
      'x-amz-date': date,
      'x-amz-content-sha256': createHash('sha256').update(data).digest('hex'),
      // R2는 Bearer token 지원
      'Authorization': `Bearer ${secretAccessKey}`,
    },
    body: data,
  });

  return res.ok;
}

async function s3Get(config: CloudConfig, objectKey: string): Promise<Buffer | null> {
  const url = `${config.endpoint}/${config.bucket}/${objectKey}`;
  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${config.secretAccessKey}` },
  });
  if (!res.ok) return null;
  return Buffer.from(await res.arrayBuffer());
}

// Sync: 로컬 DB → 암호화 → 업로드
export async function syncToCloud(dbPath: string, config: CloudConfig): Promise<SyncResult> {
  const timestamp = new Date().toISOString();
  try {
    if (!existsSync(dbPath)) {
      return { action: 'upload', dbSize: 0, encryptedSize: 0, timestamp, success: false, error: 'DB not found' };
    }

    const dbData = readFileSync(dbPath);
    const key = getOrCreateEncryptionKey(config.encryptionKey);
    const { encrypted, iv, tag } = encrypt(dbData, key);

    // 패키징: [iv(16)] + [tag(16)] + [encrypted data]
    const payload = Buffer.concat([iv, tag, encrypted]);

    const objectKey = `stellavault/index.db.enc`;
    const success = await s3Put(config, objectKey, payload);

    // 동기화 상태 저장
    const state = { lastSync: timestamp, dbSize: dbData.length, encryptedSize: payload.length, objectKey };
    mkdirSync(CLOUD_DIR, { recursive: true });
    writeFileSync(SYNC_STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');

    return { action: 'upload', dbSize: dbData.length, encryptedSize: payload.length, timestamp, success };
  } catch (err) {
    return { action: 'upload', dbSize: 0, encryptedSize: 0, timestamp, success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// Restore: 다운로드 → 복호화 → 로컬 DB 덮어쓰기
export async function restoreFromCloud(dbPath: string, config: CloudConfig): Promise<SyncResult> {
  const timestamp = new Date().toISOString();
  try {
    const objectKey = `stellavault/index.db.enc`;
    const payload = await s3Get(config, objectKey);
    if (!payload) {
      return { action: 'download', dbSize: 0, encryptedSize: 0, timestamp, success: false, error: 'No backup found in cloud' };
    }

    const key = getOrCreateEncryptionKey(config.encryptionKey);
    const iv = payload.subarray(0, 16);
    const tag = payload.subarray(16, 32);
    const encrypted = payload.subarray(32);

    const dbData = decrypt(encrypted, key, iv, tag);

    // 백업 후 덮어쓰기
    if (existsSync(dbPath)) {
      writeFileSync(dbPath + '.backup', readFileSync(dbPath));
    }
    writeFileSync(dbPath, dbData);

    return { action: 'download', dbSize: dbData.length, encryptedSize: payload.length, timestamp, success: true };
  } catch (err) {
    return { action: 'download', dbSize: 0, encryptedSize: 0, timestamp, success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// 동기화 상태 조회
export function getSyncState(): { lastSync: string; dbSize: number } | null {
  if (!existsSync(SYNC_STATE_FILE)) return null;
  return JSON.parse(readFileSync(SYNC_STATE_FILE, 'utf-8'));
}
