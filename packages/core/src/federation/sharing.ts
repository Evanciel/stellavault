// Federation: Sharing Control
// 노드별 공유 범위 관리 — 태그/폴더/문서 단위로 공개/비공개 설정

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export interface SharingConfig {
  mode: 'whitelist' | 'blacklist';  // whitelist=명시적 공개만, blacklist=명시적 비공개만

  // 태그 기반
  allowedTags: string[];     // whitelist 모드: 이 태그가 있는 문서만 공개
  blockedTags: string[];     // blacklist 모드: 이 태그가 있는 문서 제외

  // 폴더 기반
  allowedFolders: string[];  // whitelist 모드: 이 폴더만 공개
  blockedFolders: string[];  // blacklist 모드: 이 폴더 제외

  // 문서 단위
  blockedDocIds: string[];   // 개별 문서 ID 차단 (둘 다 적용)

  // 콘텐츠 필터
  blockSensitivePatterns: boolean;  // 이메일, 전화번호, API키 패턴 자동 감지→차단
}

const SHARING_FILE = join(homedir(), '.stellavault', 'federation', 'sharing.json');

const DEFAULT_CONFIG: SharingConfig = {
  mode: 'blacklist',
  allowedTags: [],
  blockedTags: ['personal', 'private', 'secret', 'diary', 'salary', 'password', 'credential'],
  allowedFolders: [],
  blockedFolders: ['03_Daily', '06_Archive', '.obsidian'],
  blockedDocIds: [],
  blockSensitivePatterns: true,
};

// 민감 패턴
const SENSITIVE_PATTERNS = [
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/,  // 이메일
  /\b\d{3}[-.]?\d{4}[-.]?\d{4}\b/,    // 전화번호
  /\b(sk-|pk-|api[_-]?key|token|secret)[a-zA-Z0-9_-]{10,}\b/i,  // API 키
  /\bpassword\s*[:=]\s*\S+/i,         // password=xxx
  /\b\d{6}[-]\d{7}\b/,                // 주민번호 패턴
];

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

// 문서가 공유 가능한지 확인
export function isDocumentShareable(
  doc: { tags: string[]; filePath: string; id: string; content: string },
  config?: SharingConfig,
): boolean {
  const cfg = config ?? loadSharingConfig();

  // 1. 개별 차단 확인
  if (cfg.blockedDocIds.includes(doc.id)) return false;

  // 2. 폴더 기반 필터
  const folder = doc.filePath.split('/')[0] ?? '';
  if (cfg.mode === 'whitelist') {
    if (cfg.allowedFolders.length > 0 && !cfg.allowedFolders.some(f => doc.filePath.startsWith(f))) {
      return false;
    }
  } else {
    if (cfg.blockedFolders.some(f => doc.filePath.startsWith(f))) {
      return false;
    }
  }

  // 3. 태그 기반 필터
  const docTags = doc.tags.map(t => t.toLowerCase());
  if (cfg.mode === 'whitelist') {
    if (cfg.allowedTags.length > 0 && !cfg.allowedTags.some(t => docTags.includes(t.toLowerCase()))) {
      return false;
    }
  } else {
    if (cfg.blockedTags.some(t => docTags.includes(t.toLowerCase()))) {
      return false;
    }
  }

  // 4. 민감 패턴 감지
  if (cfg.blockSensitivePatterns) {
    for (const pattern of SENSITIVE_PATTERNS) {
      if (pattern.test(doc.content)) return false;
    }
  }

  return true;
}

// 스니펫에서 민감 정보 제거
export function sanitizeSnippet(snippet: string): string {
  let safe = snippet;
  for (const pattern of SENSITIVE_PATTERNS) {
    safe = safe.replace(pattern, '[REDACTED]');
  }
  return safe;
}

// CLI 헬퍼: 현재 공유 설정 요약
export function getSharingSummary(config?: SharingConfig): string {
  const cfg = config ?? loadSharingConfig();
  const lines: string[] = [];
  lines.push(`Mode: ${cfg.mode}`);
  if (cfg.mode === 'blacklist') {
    lines.push(`Blocked tags: ${cfg.blockedTags.join(', ') || 'none'}`);
    lines.push(`Blocked folders: ${cfg.blockedFolders.join(', ') || 'none'}`);
  } else {
    lines.push(`Allowed tags: ${cfg.allowedTags.join(', ') || 'all'}`);
    lines.push(`Allowed folders: ${cfg.allowedFolders.join(', ') || 'all'}`);
  }
  lines.push(`Blocked docs: ${cfg.blockedDocIds.length}`);
  lines.push(`Sensitive pattern filter: ${cfg.blockSensitivePatterns ? 'ON' : 'OFF'}`);
  return lines.join('\n');
}

// 태그 추가/제거 헬퍼
export function addBlockedTag(tag: string): void {
  const cfg = loadSharingConfig();
  if (!cfg.blockedTags.includes(tag.toLowerCase())) {
    cfg.blockedTags.push(tag.toLowerCase());
    saveSharingConfig(cfg);
  }
}

export function removeBlockedTag(tag: string): void {
  const cfg = loadSharingConfig();
  cfg.blockedTags = cfg.blockedTags.filter(t => t !== tag.toLowerCase());
  saveSharingConfig(cfg);
}

export function addBlockedFolder(folder: string): void {
  const cfg = loadSharingConfig();
  if (!cfg.blockedFolders.includes(folder)) {
    cfg.blockedFolders.push(folder);
    saveSharingConfig(cfg);
  }
}

export function blockDocument(docId: string): void {
  const cfg = loadSharingConfig();
  if (!cfg.blockedDocIds.includes(docId)) {
    cfg.blockedDocIds.push(docId);
    saveSharingConfig(cfg);
  }
}

export function unblockDocument(docId: string): void {
  const cfg = loadSharingConfig();
  cfg.blockedDocIds = cfg.blockedDocIds.filter(id => id !== docId);
  saveSharingConfig(cfg);
}
