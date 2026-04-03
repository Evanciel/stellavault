// Federation: Node Reputation System
// 자동 평판 점수 — trust + consistency + freshness + consensus + history

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { getTrustLevel } from './trust.js';

export interface ReputationRecord {
  peerId: string;
  displayName: string;

  // 수동 (Web of Trust)
  trustBase: number;           // vouch=30, neutral=0, block=-100

  // 자동: 결과 일관성
  consistencyScore: number;    // 0-25, 다른 노드들과 결과 유사도
  consistencySamples: number;  // 측정 횟수

  // 자동: 활동 빈도
  freshnessScore: number;      // 0-15, 최근 활동
  lastSeen: string;
  totalInteractions: number;

  // 자동: 합의
  consensusScore: number;      // 0-20, 같은 쿼리에 다른 노드와 동일 결과
  consensusSamples: number;

  // 자동: 유용성 피드백
  historyScore: number;        // 0-10, 사용자 피드백 (결과 클릭율 등)
  helpfulCount: number;
  unhelpfulCount: number;

  updatedAt: string;
}

const REP_FILE = join(homedir(), '.stellavault', 'federation', 'reputation.json');

function loadRepDb(): Map<string, ReputationRecord> {
  if (!existsSync(REP_FILE)) return new Map();
  const records = JSON.parse(readFileSync(REP_FILE, 'utf-8')) as ReputationRecord[];
  return new Map(records.map(r => [r.peerId, r]));
}

function saveRepDb(db: Map<string, ReputationRecord>): void {
  mkdirSync(join(homedir(), '.stellavault', 'federation'), { recursive: true });
  writeFileSync(REP_FILE, JSON.stringify([...db.values()], null, 2), 'utf-8');
}

function getOrCreateRecord(peerId: string, displayName = ''): ReputationRecord {
  const db = loadRepDb();
  if (db.has(peerId)) return db.get(peerId)!;
  return {
    peerId, displayName,
    trustBase: 0,
    consistencyScore: 0, consistencySamples: 0,
    freshnessScore: 0, lastSeen: new Date().toISOString(), totalInteractions: 0,
    consensusScore: 0, consensusSamples: 0,
    historyScore: 0, helpfulCount: 0, unhelpfulCount: 0,
    updatedAt: new Date().toISOString(),
  };
}

// 종합 평판 점수 계산 (0-100)
export function computeReputation(peerId: string): number {
  const rec = getOrCreateRecord(peerId);

  // 수동 신뢰 기반
  const trustLevel = getTrustLevel(peerId);
  const trustBase = trustLevel === 'vouched' ? 30 : trustLevel === 'blocked' ? -100 : 0;

  // blocked이면 즉시 0
  if (trustBase <= -100) return 0;

  const score = Math.max(0, Math.min(100,
    trustBase +
    rec.consistencyScore +
    rec.freshnessScore +
    rec.consensusScore +
    rec.historyScore +
    // 새 노드 보너스 (상호작용 적으면 중립 시작)
    (rec.totalInteractions < 5 ? 40 : 0)
  ));

  return Math.round(score);
}

// 검색 결과에 합의 검증
export function verifyConsensus(
  queryId: string,
  allResults: Array<{ peerId: string; title: string; similarity: number }>,
): Map<string, number> {
  // 같은 제목을 반환한 노드가 많을수록 → 합의 높음
  const titleCounts = new Map<string, number>();
  for (const r of allResults) {
    titleCounts.set(r.title, (titleCounts.get(r.title) ?? 0) + 1);
  }

  const totalPeers = new Set(allResults.map(r => r.peerId)).size;
  const consensusBoost = new Map<string, number>();

  for (const r of allResults) {
    const count = titleCounts.get(r.title) ?? 1;
    // 여러 노드가 같은 결과 → 신뢰도 부스트
    const boost = count > 1 ? Math.min((count / totalPeers) * 20, 20) : 0;
    const current = consensusBoost.get(r.peerId) ?? 0;
    consensusBoost.set(r.peerId, Math.max(current, boost));
  }

  return consensusBoost;
}

// 노드 상호작용 기록 (검색 응답 받을 때마다)
export function recordInteraction(peerId: string, displayName: string): void {
  const db = loadRepDb();
  const rec = getOrCreateRecord(peerId, displayName);

  rec.totalInteractions++;
  rec.lastSeen = new Date().toISOString();
  rec.displayName = displayName || rec.displayName;

  // Freshness: 최근 7일 이내 활동이면 만점
  const daysSinceLastSeen = (Date.now() - new Date(rec.lastSeen).getTime()) / 86400000;
  rec.freshnessScore = daysSinceLastSeen < 1 ? 15 : daysSinceLastSeen < 7 ? 10 : daysSinceLastSeen < 30 ? 5 : 0;

  rec.updatedAt = new Date().toISOString();
  db.set(peerId, rec);
  saveRepDb(db);
}

// 결과 일관성 업데이트 (다른 노드와 비교)
export function recordConsistency(peerId: string, matchRate: number): void {
  const db = loadRepDb();
  const rec = getOrCreateRecord(peerId);

  rec.consistencySamples++;
  // 이동 평균
  rec.consistencyScore = Math.round(
    (rec.consistencyScore * (rec.consistencySamples - 1) + matchRate * 25) / rec.consistencySamples
  );

  rec.updatedAt = new Date().toISOString();
  db.set(peerId, rec);
  saveRepDb(db);
}

// 사용자 피드백 (결과가 유용했는지)
export function recordFeedback(peerId: string, helpful: boolean): void {
  const db = loadRepDb();
  const rec = getOrCreateRecord(peerId);

  if (helpful) rec.helpfulCount++;
  else rec.unhelpfulCount++;

  const total = rec.helpfulCount + rec.unhelpfulCount;
  rec.historyScore = total > 0 ? Math.round((rec.helpfulCount / total) * 10) : 0;

  rec.updatedAt = new Date().toISOString();
  db.set(peerId, rec);
  saveRepDb(db);
}

// 합의 점수 업데이트
export function recordConsensus(peerId: string, consensusBoost: number): void {
  const db = loadRepDb();
  const rec = getOrCreateRecord(peerId);

  rec.consensusSamples++;
  rec.consensusScore = Math.round(
    (rec.consensusScore * (rec.consensusSamples - 1) + consensusBoost) / rec.consensusSamples
  );

  rec.updatedAt = new Date().toISOString();
  db.set(peerId, rec);
  saveRepDb(db);
}

// 평판 목록 조회
export function getReputationBoard(): Array<ReputationRecord & { reputation: number }> {
  const db = loadRepDb();
  return [...db.values()]
    .map(r => ({ ...r, reputation: computeReputation(r.peerId) }))
    .sort((a, b) => b.reputation - a.reputation);
}

// 검색 결과 필터 + 정렬 (평판 가중)
export function filterByReputation<T extends { peerId: string; similarity: number }>(
  results: T[],
  minReputation = 10,
): (T & { adjustedScore: number; reputation: number })[] {
  return results
    .map(r => {
      const rep = computeReputation(r.peerId);
      // blocked 노드 필터링
      if (rep === 0) return null;
      // 평판 가중 점수: similarity * 0.7 + reputation/100 * 0.3
      const adjustedScore = r.similarity * 0.7 + (rep / 100) * 0.3;
      return { ...r, adjustedScore, reputation: rep };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null && r.reputation >= minReputation)
    .sort((a, b) => b.adjustedScore - a.adjustedScore);
}
