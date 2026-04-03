// Federation: Sharing Control v2 — Level-based sharing system
// Level 0: 차단 (검색 안 됨)
// Level 1: 제목 + 유사도만
// Level 2: Level 1 + 50자 스니펫
// Level 3: Level 2 + 요청 시 전문 (피어 승인)
// Level 4: Level 3 + 전문 자동 공개
//
// 상호 매칭: 내 공개 레벨이 높을수록 남의 것도 더 많이 볼 수 있음

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export type SharingLevel = 0 | 1 | 2 | 3 | 4;

export const LEVEL_LABELS: Record<SharingLevel, string> = {
  0: 'Blocked (not searchable)',
  1: 'Title + similarity only',
  2: 'Title + snippet (50 chars)',
  3: 'Full text on request (approval needed)',
  4: 'Full text auto-shared',
};

export const LEVEL_ICONS: Record<SharingLevel, string> = {
  0: '🚫', 1: '📌', 2: '📝', 3: '📖', 4: '🌐',
};

export interface SharingRule {
  pattern: string;     // 태그명, 폴더명, 또는 문서ID
  type: 'tag' | 'folder' | 'doc';
  level: SharingLevel;
}

export interface SharingConfig {
  defaultLevel: SharingLevel;    // 규칙에 안 걸리는 문서의 기본 레벨
  myNodeLevel: SharingLevel;     // 내 노드의 전체 공개 레벨 (상호 매칭용)
  rules: SharingRule[];          // 태그/폴더/문서별 레벨 규칙
  blockedDocIds: string[];       // 개별 문서 강제 차단 (Level 0)
  blockSensitivePatterns: boolean;
  pendingRequests: FullTextRequest[];  // 전문 열람 요청 대기열
}

export interface FullTextRequest {
  requestId: string;
  fromPeerId: string;
  fromName: string;
  documentTitle: string;
  documentId: string;
  requestedAt: string;
  status: 'pending' | 'approved' | 'denied';
}

// 크레딧 보너스 (레벨별)
export const LEVEL_CREDIT_MULTIPLIER: Record<SharingLevel, number> = {
  0: 0, 1: 1, 2: 2, 3: 5, 4: 10,
};

const SHARING_FILE = join(homedir(), '.stellavault', 'federation', 'sharing.json');

const SENSITIVE_PATTERNS = [
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/,
  /\b\d{3}[-.]?\d{4}[-.]?\d{4}\b/,
  /\b(sk-|pk-|api[_-]?key|token|secret)[a-zA-Z0-9_-]{10,}\b/i,
  /\bpassword\s*[:=]\s*\S+/i,
  /\b\d{6}[-]\d{7}\b/,
];

const DEFAULT_CONFIG: SharingConfig = {
  defaultLevel: 2,     // 기본: 스니펫까지
  myNodeLevel: 2,      // 내 노드 기본: 스니펫까지
  rules: [
    // 기본 규칙
    { pattern: 'public', type: 'tag', level: 4 },
    { pattern: 'opensource', type: 'tag', level: 4 },
    { pattern: 'personal', type: 'tag', level: 1 },
    { pattern: 'private', type: 'tag', level: 0 },
    { pattern: 'secret', type: 'tag', level: 0 },
    { pattern: 'diary', type: 'tag', level: 0 },
    { pattern: 'salary', type: 'tag', level: 0 },
    { pattern: 'password', type: 'tag', level: 0 },
    { pattern: 'credential', type: 'tag', level: 0 },
    { pattern: '03_Daily', type: 'folder', level: 1 },
    { pattern: '06_Archive', type: 'folder', level: 1 },
    { pattern: '.obsidian', type: 'folder', level: 0 },
  ],
  blockedDocIds: [],
  blockSensitivePatterns: true,
  pendingRequests: [],
};

export function loadSharingConfig(): SharingConfig {
  if (existsSync(SHARING_FILE)) {
    const raw = JSON.parse(readFileSync(SHARING_FILE, 'utf-8'));
    return { ...DEFAULT_CONFIG, ...raw };
  }
  return { ...DEFAULT_CONFIG };
}

export function saveSharingConfig(config: SharingConfig): void {
  mkdirSync(join(homedir(), '.stellavault', 'federation'), { recursive: true });
  writeFileSync(SHARING_FILE, JSON.stringify(config, null, 2), 'utf-8');
}

// 문서의 공유 레벨 결정
export function getDocumentLevel(
  doc: { tags: string[]; filePath: string; id: string; content: string },
  config?: SharingConfig,
): SharingLevel {
  const cfg = config ?? loadSharingConfig();

  // 1. 개별 차단
  if (cfg.blockedDocIds.includes(doc.id)) return 0;

  // 2. 민감 패턴 감지 → Level 0
  if (cfg.blockSensitivePatterns) {
    for (const pattern of SENSITIVE_PATTERNS) {
      if (pattern.test(doc.content)) return 0;
    }
  }

  // 3. 규칙 매칭 (가장 구체적인 규칙 우선)
  let matchedLevel: SharingLevel | null = null;

  // 문서ID 규칙 (가장 구체적)
  for (const rule of cfg.rules) {
    if (rule.type === 'doc' && rule.pattern === doc.id) {
      return rule.level;
    }
  }

  // 태그 규칙 (가장 제한적인 것 적용)
  const docTags = doc.tags.map(t => t.toLowerCase());
  for (const rule of cfg.rules) {
    if (rule.type === 'tag' && docTags.includes(rule.pattern.toLowerCase())) {
      if (matchedLevel === null || rule.level < matchedLevel) {
        matchedLevel = rule.level;
      }
    }
  }

  // 폴더 규칙
  for (const rule of cfg.rules) {
    if (rule.type === 'folder' && doc.filePath.startsWith(rule.pattern)) {
      if (matchedLevel === null || rule.level < matchedLevel) {
        matchedLevel = rule.level;
      }
    }
  }

  return matchedLevel ?? cfg.defaultLevel;
}

// 이전 API 호환: isDocumentShareable = Level > 0
export function isDocumentShareable(
  doc: { tags: string[]; filePath: string; id: string; content: string },
  config?: SharingConfig,
): boolean {
  return getDocumentLevel(doc, config) > 0;
}

// 상호 매칭: 내 레벨에 따라 상대 문서를 어디까지 볼 수 있는가
export function getAccessibleLevel(myLevel: SharingLevel, docLevel: SharingLevel): SharingLevel {
  // 내 공개 레벨이 상대 문서 레벨 이상이어야 열람 가능
  // 단, 상대가 공개한 범위를 넘을 수는 없음
  return Math.min(myLevel, docLevel) as SharingLevel;
}

// 검색 결과에 레벨 정보 추가
export interface LeveledSearchResult {
  title: string;
  similarity: number;
  snippet?: string;       // Level 2+ only
  fullTextAvailable: boolean;  // Level 3+ → 요청 가능, Level 4 → 자동
  autoShare: boolean;     // Level 4 → true
  level: SharingLevel;
}

export function buildLeveledResult(
  doc: { title: string; content: string; tags: string[]; filePath: string; id: string },
  similarity: number,
  requesterNodeLevel: SharingLevel,
  config?: SharingConfig,
): LeveledSearchResult | null {
  const docLevel = getDocumentLevel(doc, config);
  if (docLevel === 0) return null; // 차단

  const accessLevel = getAccessibleLevel(requesterNodeLevel, docLevel);
  if (accessLevel === 0) return null;

  return {
    title: accessLevel >= 1 ? doc.title : '[Hidden]',
    similarity,
    snippet: accessLevel >= 2 ? sanitizeSnippet(doc.content.slice(0, 50)) : undefined,
    fullTextAvailable: docLevel >= 3,
    autoShare: docLevel >= 4,
    level: accessLevel,
  };
}

// 전문 열람 요청
export function createFullTextRequest(
  fromPeerId: string, fromName: string,
  documentId: string, documentTitle: string,
): FullTextRequest {
  const cfg = loadSharingConfig();
  const request: FullTextRequest = {
    requestId: `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    fromPeerId, fromName, documentTitle, documentId,
    requestedAt: new Date().toISOString(),
    status: 'pending',
  };
  cfg.pendingRequests.push(request);
  // 최근 50개만 유지
  if (cfg.pendingRequests.length > 50) cfg.pendingRequests = cfg.pendingRequests.slice(-50);
  saveSharingConfig(cfg);
  return request;
}

export function approveRequest(requestId: string): boolean {
  const cfg = loadSharingConfig();
  const req = cfg.pendingRequests.find(r => r.requestId === requestId);
  if (!req) return false;
  req.status = 'approved';
  saveSharingConfig(cfg);
  return true;
}

export function denyRequest(requestId: string): boolean {
  const cfg = loadSharingConfig();
  const req = cfg.pendingRequests.find(r => r.requestId === requestId);
  if (!req) return false;
  req.status = 'denied';
  saveSharingConfig(cfg);
  return true;
}

export function getPendingRequests(): FullTextRequest[] {
  return loadSharingConfig().pendingRequests.filter(r => r.status === 'pending');
}

// 스니펫 민감 정보 제거
export function sanitizeSnippet(snippet: string): string {
  let safe = snippet;
  for (const pattern of SENSITIVE_PATTERNS) {
    safe = safe.replace(pattern, '[REDACTED]');
  }
  return safe;
}

// 규칙 관리 헬퍼
export function setTagLevel(tag: string, level: SharingLevel): void {
  const cfg = loadSharingConfig();
  const existing = cfg.rules.findIndex(r => r.type === 'tag' && r.pattern.toLowerCase() === tag.toLowerCase());
  if (existing >= 0) cfg.rules[existing].level = level;
  else cfg.rules.push({ pattern: tag.toLowerCase(), type: 'tag', level });
  saveSharingConfig(cfg);
}

export function setFolderLevel(folder: string, level: SharingLevel): void {
  const cfg = loadSharingConfig();
  const existing = cfg.rules.findIndex(r => r.type === 'folder' && r.pattern === folder);
  if (existing >= 0) cfg.rules[existing].level = level;
  else cfg.rules.push({ pattern: folder, type: 'folder', level });
  saveSharingConfig(cfg);
}

export function setNodeLevel(level: SharingLevel): void {
  const cfg = loadSharingConfig();
  cfg.myNodeLevel = level;
  saveSharingConfig(cfg);
}

export function setDefaultLevel(level: SharingLevel): void {
  const cfg = loadSharingConfig();
  cfg.defaultLevel = level;
  saveSharingConfig(cfg);
}

// CLI 요약
export function getSharingSummary(config?: SharingConfig): string {
  const cfg = config ?? loadSharingConfig();
  const lines: string[] = [];
  lines.push(`My Node Level: ${LEVEL_ICONS[cfg.myNodeLevel]} Level ${cfg.myNodeLevel} (${LEVEL_LABELS[cfg.myNodeLevel]})`);
  lines.push(`Default Doc Level: ${LEVEL_ICONS[cfg.defaultLevel]} Level ${cfg.defaultLevel}`);
  lines.push(`Credit Multiplier: ${LEVEL_CREDIT_MULTIPLIER[cfg.myNodeLevel]}x`);
  lines.push('');
  lines.push('Rules:');
  for (const rule of cfg.rules) {
    lines.push(`  ${LEVEL_ICONS[rule.level]} [${rule.type}] ${rule.pattern} → Level ${rule.level}`);
  }
  if (cfg.blockedDocIds.length > 0) {
    lines.push(`  🚫 ${cfg.blockedDocIds.length} docs individually blocked`);
  }
  lines.push('');
  const pending = cfg.pendingRequests.filter(r => r.status === 'pending');
  if (pending.length > 0) {
    lines.push(`📬 ${pending.length} pending full-text requests`);
  }
  lines.push(`Sensitive pattern filter: ${cfg.blockSensitivePatterns ? 'ON' : 'OFF'}`);
  return lines.join('\n');
}

// 레거시 호환
export function addBlockedTag(tag: string): void { setTagLevel(tag, 0); }
export function removeBlockedTag(tag: string): void { setTagLevel(tag, 2); }
export function addBlockedFolder(folder: string): void { setFolderLevel(folder, 0); }
export function blockDocument(docId: string): void {
  const cfg = loadSharingConfig();
  if (!cfg.blockedDocIds.includes(docId)) { cfg.blockedDocIds.push(docId); saveSharingConfig(cfg); }
}
export function unblockDocument(docId: string): void {
  const cfg = loadSharingConfig();
  cfg.blockedDocIds = cfg.blockedDocIds.filter(id => id !== docId);
  saveSharingConfig(cfg);
}
