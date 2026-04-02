// Federation Phase 2: Web of Trust
// vouch/revoke/block — 노드 간 상호 신뢰 관리

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export interface TrustEntry {
  peerId: string;
  displayName: string;
  level: 'vouched' | 'neutral' | 'blocked';
  reason?: string;
  updatedAt: string;
}

const TRUST_FILE = join(homedir(), '.stellavault', 'federation', 'trust.json');

function loadTrustDb(): Map<string, TrustEntry> {
  if (!existsSync(TRUST_FILE)) return new Map();
  const raw = JSON.parse(readFileSync(TRUST_FILE, 'utf-8')) as TrustEntry[];
  return new Map(raw.map(e => [e.peerId, e]));
}

function saveTrustDb(db: Map<string, TrustEntry>): void {
  mkdirSync(join(homedir(), '.stellavault', 'federation'), { recursive: true });
  writeFileSync(TRUST_FILE, JSON.stringify([...db.values()], null, 2), 'utf-8');
}

export function vouch(peerId: string, displayName: string, reason?: string): TrustEntry {
  const db = loadTrustDb();
  const entry: TrustEntry = { peerId, displayName, level: 'vouched', reason, updatedAt: new Date().toISOString() };
  db.set(peerId, entry);
  saveTrustDb(db);
  return entry;
}

export function revoke(peerId: string): boolean {
  const db = loadTrustDb();
  const entry = db.get(peerId);
  if (!entry) return false;
  entry.level = 'neutral';
  entry.updatedAt = new Date().toISOString();
  saveTrustDb(db);
  return true;
}

export function block(peerId: string, displayName: string, reason?: string): TrustEntry {
  const db = loadTrustDb();
  const entry: TrustEntry = { peerId, displayName, level: 'blocked', reason, updatedAt: new Date().toISOString() };
  db.set(peerId, entry);
  saveTrustDb(db);
  return entry;
}

export function getTrustLevel(peerId: string): TrustEntry['level'] {
  const db = loadTrustDb();
  return db.get(peerId)?.level ?? 'neutral';
}

export function isBlocked(peerId: string): boolean {
  return getTrustLevel(peerId) === 'blocked';
}

export function listTrusted(): TrustEntry[] {
  return [...loadTrustDb().values()];
}

// 신뢰 점수 계산 (0-100)
export function computeTrustScore(peerId: string): number {
  const level = getTrustLevel(peerId);
  switch (level) {
    case 'vouched': return 80;
    case 'neutral': return 50;
    case 'blocked': return 0;
  }
}
