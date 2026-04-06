// Zettelkasten System — 프론트메터 스캔 + 인덱스 코드 + 인박스 제로 + 원자성 검증
// Inspired by Luhmann + Karpathy "Self-Compiling Zettelkasten"

import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve, extname } from 'node:path';

// ─── Frontmatter Scanner ───

export interface FrontmatterEntry {
  filePath: string;
  title: string;
  id?: string;        // Luhmann index code
  type?: string;       // fleeting | literature | permanent | wiki
  tags: string[];
  summary?: string;
  connections: string[]; // backlinks
  archived?: boolean;
  created?: string;
  wordCount: number;
}

/**
 * Vault의 모든 .md 파일에서 프론트메터만 추출 (본문 미읽기 → 토큰 절감).
 * 40만 단어를 수백 줄로 압축.
 */
export function scanFrontmatter(vaultPath: string, options?: { includeArchived?: boolean }): FrontmatterEntry[] {
  const entries: FrontmatterEntry[] = [];
  const includeArchived = options?.includeArchived ?? false;

  function walkDir(dir: string, rel: string) {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      if (name.startsWith('.') || name === 'node_modules') continue;
      const full = join(dir, name);
      const relPath = rel ? `${rel}/${name}` : name;
      if (statSync(full).isDirectory()) {
        walkDir(full, relPath);
      } else if (extname(name) === '.md') {
        const entry = extractFrontmatter(full, relPath);
        if (entry && (includeArchived || !entry.archived)) {
          entries.push(entry);
        }
      }
    }
  }

  walkDir(vaultPath, '');
  return entries;
}

function extractFrontmatter(fullPath: string, relPath: string): FrontmatterEntry | null {
  const raw = readFileSync(fullPath, 'utf-8');

  // Quick word count without full parse
  const wordCount = raw.split(/\s+/).length;

  // Parse YAML frontmatter
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) {
    // No frontmatter — extract title from first heading
    const titleMatch = raw.match(/^#\s+(.+)$/m);
    return {
      filePath: relPath,
      title: titleMatch?.[1] ?? relPath.replace(/\.md$/, ''),
      tags: [],
      connections: [],
      wordCount,
    };
  }

  const fm = fmMatch[1];
  const get = (key: string): string | undefined => {
    const m = fm.match(new RegExp(`^${key}:\\s*["']?(.+?)["']?\\s*$`, 'm'));
    return m?.[1];
  };
  const getArray = (key: string): string[] => {
    const m = fm.match(new RegExp(`^${key}:\\s*\\[([^\\]]*)\\]`, 'm'));
    if (m) return m[1].split(',').map(s => s.trim().replace(/["']/g, '')).filter(Boolean);
    return [];
  };
  const getBool = (key: string): boolean | undefined => {
    const v = get(key);
    if (v === 'true') return true;
    if (v === 'false') return false;
    return undefined;
  };

  // Extract [[backlinks]] from content (quick scan, first 500 chars)
  const linkSection = raw.substring(0, Math.min(raw.length, 2000));
  const links = [...linkSection.matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g)].map(m => m[1]);

  return {
    filePath: relPath,
    title: get('title') ?? relPath.replace(/\.md$/, ''),
    id: get('id') ?? get('zettel_id'),
    type: get('type') ?? get('note_type'),
    tags: getArray('tags'),
    summary: get('summary') ?? get('description'),
    connections: links,
    archived: getBool('archived') ?? getBool('archive'),
    created: get('created') ?? get('date'),
    wordCount,
  };
}

// ─── Luhmann Index Code ───

/**
 * 기존 인덱스 코드를 분석하여 다음 사용 가능한 코드를 생성.
 * 패턴: 1A → 1B, 1A → 1A1, 1A1 → 1A1a
 */
export function generateNextIndexCode(existingCodes: string[], parentCode?: string): string {
  if (existingCodes.length === 0 && !parentCode) return '1A';

  if (parentCode) {
    // 하위 분기: parentCode의 자식 중 마지막 번호 + 1
    const children = existingCodes.filter(c => c.startsWith(parentCode) && c.length > parentCode.length);
    if (children.length === 0) {
      // 첫 자식: 숫자 끝이면 알파벳 추가, 알파벳 끝이면 숫자 추가
      const lastChar = parentCode[parentCode.length - 1];
      return /[a-zA-Z]/.test(lastChar) ? `${parentCode}1` : `${parentCode}a`;
    }
    // 마지막 자식의 다음
    const sorted = children.sort();
    const last = sorted[sorted.length - 1];
    return incrementCode(last);
  }

  // 최상위: 마지막 코드의 다음
  const topLevel = existingCodes.filter(c => /^[0-9]+[A-Z]$/.test(c)).sort();
  if (topLevel.length === 0) return '1A';
  return incrementCode(topLevel[topLevel.length - 1]);
}

function incrementCode(code: string): string {
  const lastChar = code[code.length - 1];
  const prefix = code.slice(0, -1);

  if (/[0-9]/.test(lastChar)) {
    return prefix + String(parseInt(lastChar) + 1);
  }
  if (/[a-z]/.test(lastChar)) {
    return prefix + String.fromCharCode(lastChar.charCodeAt(0) + 1);
  }
  if (/[A-Z]/.test(lastChar)) {
    return prefix + String.fromCharCode(lastChar.charCodeAt(0) + 1);
  }
  return code + '1';
}

/**
 * 프론트메터에 인덱스 코드가 없는 노트에 자동 부여.
 */
export function assignIndexCodes(entries: FrontmatterEntry[]): Map<string, string> {
  const assignments = new Map<string, string>(); // filePath → indexCode
  const existingCodes = entries.filter(e => e.id).map(e => e.id!);

  for (const entry of entries) {
    if (entry.id) continue; // 이미 있음

    // 같은 태그를 가진 노트의 인덱스 코드를 찾아 하위로 분기
    const sibling = entries.find(e =>
      e.id && e.tags.some(t => entry.tags.includes(t))
    );

    const newCode = generateNextIndexCode(
      [...existingCodes, ...assignments.values()],
      sibling?.id
    );
    assignments.set(entry.filePath, newCode);
  }

  return assignments;
}

// ─── Inbox Zero (Archive) ───

/**
 * raw/ 폴더에서 archive 플래그가 없는 파일만 반환 (인박스 제로).
 */
export function getInboxItems(vaultPath: string, rawDir = 'raw'): FrontmatterEntry[] {
  const rawPath = resolve(vaultPath, rawDir);
  return scanFrontmatter(rawPath, { includeArchived: false });
}

/**
 * 파일에 archive: true 플래그 추가.
 */
export function archiveFile(fullPath: string): void {
  const content = readFileSync(fullPath, 'utf-8');

  if (content.startsWith('---\n')) {
    // 기존 프론트메터에 추가
    const updated = content.replace('---\n', '---\narchived: true\n');
    writeFileSync(fullPath, updated, 'utf-8');
  } else {
    // 프론트메터 생성
    writeFileSync(fullPath, `---\narchived: true\n---\n\n${content}`, 'utf-8');
  }
}

// ─── Atomicity Check ───

/**
 * 원자성 검증: 하나의 메모에 여러 주제가 섞여있는지 감지.
 * - heading 3개 이상 → 분할 후보
 * - 1500단어 초과 → 분할 후보
 */
export function checkAtomicity(entries: FrontmatterEntry[], vaultPath: string): Array<{
  filePath: string;
  title: string;
  reason: string;
  headingCount?: number;
  wordCount: number;
}> {
  const violations: Array<{ filePath: string; title: string; reason: string; headingCount?: number; wordCount: number }> = [];

  for (const entry of entries) {
    // 단어 수 검사
    if (entry.wordCount > 1500) {
      violations.push({
        filePath: entry.filePath,
        title: entry.title,
        reason: `Too long (${entry.wordCount} words). Consider splitting into smaller atomic notes.`,
        wordCount: entry.wordCount,
      });
      continue;
    }

    // Heading 수 검사 (프론트메터 이후)
    const fullPath = resolve(vaultPath, entry.filePath);
    if (!existsSync(fullPath)) continue;
    const content = readFileSync(fullPath, 'utf-8');
    const headings = content.match(/^##\s+.+$/gm) ?? [];

    if (headings.length >= 4) {
      violations.push({
        filePath: entry.filePath,
        title: entry.title,
        reason: `Multiple topics (${headings.length} sections). Each heading could be its own note.`,
        headingCount: headings.length,
        wordCount: entry.wordCount,
      });
    }
  }

  return violations;
}

// ─── Orphan & Broken Link Detection ───

/**
 * 고아 노트 (연결 0개) + 끊긴 링크 탐지.
 */
export function detectOrphansAndBrokenLinks(entries: FrontmatterEntry[]): {
  orphans: FrontmatterEntry[];
  brokenLinks: Array<{ filePath: string; brokenLink: string }>;
} {
  const titleSet = new Set(entries.map(e => e.title));
  const fileSet = new Set(entries.map(e => e.filePath.replace(/\.md$/, '')));

  // 고아: 어디서도 참조되지 않고 자기도 참조 안 하는 노트
  const referenced = new Set<string>();
  for (const e of entries) {
    for (const conn of e.connections) {
      referenced.add(conn);
    }
  }
  const orphans = entries.filter(e =>
    e.connections.length === 0 && !referenced.has(e.title)
  );

  // 끊긴 링크: [[X]]가 있는데 X 노트가 없음
  const brokenLinks: Array<{ filePath: string; brokenLink: string }> = [];
  for (const e of entries) {
    for (const conn of e.connections) {
      if (!titleSet.has(conn) && !fileSet.has(conn)) {
        brokenLinks.push({ filePath: e.filePath, brokenLink: conn });
      }
    }
  }

  return { orphans, brokenLinks };
}
