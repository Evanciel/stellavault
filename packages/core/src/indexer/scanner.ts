// Design Ref: §6 — Indexer (scanner: glob + frontmatter 파싱)

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { createHash } from 'node:crypto';
import matter from 'gray-matter';
import type { Document } from '../types/document.js';

export type SkipReason = 'empty' | 'parse-error' | 'binary' | 'too-large' | 'unreadable';

export interface SkippedFile {
  path: string;
  reason: SkipReason;
  detail?: string;
}

export interface ScanResult {
  documents: Document[];
  scannedFiles: number;
  skippedFiles: number;
  skipped: SkippedFile[];
}

const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5MB safeguard

export function scanVault(vaultPath: string): ScanResult {
  const documents: Document[] = [];
  const skipped: SkippedFile[] = [];

  const mdFiles = findMdFiles(vaultPath);

  for (const filePath of mdFiles) {
    const rel = relative(vaultPath, filePath).replace(/\\/g, '/');
    try {
      const stat = statSync(filePath);
      if (stat.size === 0) {
        skipped.push({ path: rel, reason: 'empty' });
        continue;
      }
      if (stat.size > MAX_FILE_BYTES) {
        skipped.push({ path: rel, reason: 'too-large', detail: `${stat.size}B` });
        continue;
      }
      const doc = parseDocument(vaultPath, filePath);
      if (!doc.content || doc.content.trim().length === 0) {
        skipped.push({ path: rel, reason: 'empty', detail: 'no content after frontmatter' });
        continue;
      }
      documents.push(doc);
    } catch (err) {
      const msg = (err as Error)?.message ?? String(err);
      const reason: SkipReason = /ENOENT|EACCES|EPERM/.test(msg) ? 'unreadable' : 'parse-error';
      skipped.push({ path: rel, reason, detail: msg.slice(0, 200) });
    }
  }

  return { documents, scannedFiles: mdFiles.length, skippedFiles: skipped.length, skipped };
}

function findMdFiles(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'zh-CN') continue;
      findMdFiles(fullPath, files);
    } else if (extname(entry.name) === '.md') {
      files.push(fullPath);
    }
  }
  return files;
}

/**
 * Parse a single file into a Document, applying the same empty/too-large guards
 * as scanVault. Returns the parsed Document, or a SkippedFile if it was skipped.
 * Exported for the targeted incremental indexer (T2-2 — indexFiles).
 */
export function scanFile(
  vaultPath: string,
  filePath: string,
): { document: Document } | { skipped: SkippedFile } {
  const rel = relative(vaultPath, filePath).replace(/\\/g, '/');
  try {
    const stat = statSync(filePath);
    if (stat.size === 0) return { skipped: { path: rel, reason: 'empty' } };
    if (stat.size > MAX_FILE_BYTES) return { skipped: { path: rel, reason: 'too-large', detail: `${stat.size}B` } };
    const doc = parseDocument(vaultPath, filePath);
    if (!doc.content || doc.content.trim().length === 0) {
      return { skipped: { path: rel, reason: 'empty', detail: 'no content after frontmatter' } };
    }
    return { document: doc };
  } catch (err) {
    const msg = (err as Error)?.message ?? String(err);
    const reason: SkipReason = /ENOENT|EACCES|EPERM/.test(msg) ? 'unreadable' : 'parse-error';
    return { skipped: { path: rel, reason, detail: msg.slice(0, 200) } };
  }
}

/**
 * Compute the stable document id for a vault-relative path (sha256 of the
 * normalized relative path, first 16 hex). Used to map a deleted file path back
 * to its index row without re-reading the (now absent) file. (T2-2)
 */
export function docIdForPath(vaultPath: string, filePath: string): string {
  const relativePath = relative(vaultPath, filePath).replace(/\\/g, '/');
  return createHash('sha256').update(relativePath).digest('hex').slice(0, 16);
}

/**
 * YAML 이 깨졌을 때 프론트매터 블록만 <글자로> 떼어낸다.
 * 파싱하지 않으므로 어떤 YAML 이든 통과한다. 블록이 없으면 원문 그대로.
 */
export function stripFrontmatterBlock(raw: string): string {
  const open = /^---[ \t]*\r?\n/.exec(raw);
  if (!open) return raw;

  // 🔴 닫는 구분자는 <열 0>에서 시작해야 한다. 들여쓴 `  ---` 는 YAML 블록 스칼라
  //    안의 글자일 수 있어 구분자가 아니다 (코덱스 P3, 2026-08-21).
  // 🔴 그리고 split/join 이 아니라 <원문을 잘라낸다> — join('\n') 은 CRLF 를 LF 로
  //    바꿔서, 떼어내기만 해야 할 함수가 본문을 조용히 고쳐 놓는다.
  const from = open[0].length - 1;              // 여는 줄 끝의 \n 을 가리킨다
  const close = /\n---[ \t]*(?:\r?\n|$)/.exec(raw.slice(from));
  if (!close) return raw;                       // 닫는 --- 이 없다 = 프론트매터가 아니다
  return raw.slice(from + close.index + close[0].length);
}

function parseDocument(vaultPath: string, filePath: string): Document {
  const raw = readFileSync(filePath, 'utf-8');
  const stat = statSync(filePath);

  // 🔴 프론트매터가 깨졌다고 <문서를 통째로 잃지> 않는다.
  //    실측 2026-08-20: 볼트 17,371개 중 131개가 바로 여기서 죽었고, 전부
  //    `title: Web — RAG Metrics: Assessing …` 처럼 따옴표 없는 값에 콜론이 든
  //    자동생성 노트였다. YAML 만 못 읽을 뿐 <본문은 멀쩡하다>.
  //    프론트매터를 버리고 본문을 살린다 — 잃는 쪽이 훨씬 비싸다.
  //    (그 131개는 색인에 있다가 한 번의 index 실행으로 축출됐다. indexer/index.ts §4 참조)
  let frontmatter: Record<string, unknown>;
  let content: string;
  try {
    // 🔴 options 를 넘겨 gray-matter 의 <캐시 경로>를 끈다
    //    (node_modules/gray-matter/index.js: `if (!options)` 안에서만 캐시를 읽는다).
    //    캐시가 걸리면 1차에 던진 원문이 2차엔 `{data:{}, content:원문전체}` 로 와서
    //    아래 가드를 <통과>하고, 프론트매터 글자가 본문에 섞인 채 색인된다.
    //    ★그 오염을 실제 볼트 색인에서 봤다 (2026-08-21, 131개). 추측이 아니다.
    //
    // 🔴🔴 이 수정은 <예방>이지 <복구>가 아니다 (코덱스 13차 P2). `contentHash` 는
    //    아래에서 <원본 바이트>를 해시하므로, 파서 의미가 바뀌어도 파일이 안 바뀌면
    //    해시가 같고 색인기는 그 문서를 `unchanged` 로 건너뛴다. 즉 <이미 오염된 행>은
    //    파일을 건드리기 전까지 그대로 남는다.
    //    복구하려면 재색인을 강제해야 한다 — 실볼트는 2026-08-21 에 전체 재색인으로
    //    복구했고(문서 17,407 · 프론트매터잔존 0 실측), 그래서 지금 남아 있지 않다.
    //    ⚠️ 다른 볼트에는 이 조건이 성립하지 않는다. "고쳤다" 를 "이미 낫는다" 로 읽지 마라.
    const parsed = matter(raw, {});

    // gray-matter 가 <던지지 않고> 본문을 삼키는 경우가 둘 있다. 둘 다 문서 유실이다:
    //   ① 닫는 --- 이 없으면  data 가 <문자열>이 되고 content 가 '' 이 된다
    //      (실측: '---\n그냥 구분선\n\n본문.' → data="그냥 구분선\n본문." · content="")
    //   ② 같은 바이트를 두 번 파싱하면 캐시가 걸려 1차에 던진 것이 2차엔 data={} 로 온다
    // 그래서 예외만 보지 말고 <결과가 쓸 만한지>를 본다.
    const dataOk = !!parsed.data && typeof parsed.data === 'object' && !Array.isArray(parsed.data);
    const gotContent = (parsed.content ?? '').trim().length > 0;
    // 🔴 여기 한때 `notStripped` 가드가 하나 더 있었다. matter(raw, {}) 로 캐시를 끈
    //    지금은 <절대 발화하지 않는 죽은 코드>이면서, 유효한 프론트매터 뒤 본문이
    //    `---` 수평선으로 시작하는 문서에서 title·tags 를 버리는 오탐을 실제로 냈다
    //    (코덱스 2차 P2, 2026-08-21). 닿지 않는 방어는 결함만 남기므로 지웠다.
    //    ★대신 캐시를 되살리는 변이가 이제 시험을 빨갛게 만든다 — 방어가 하나라 잰다.
    if (!dataOk || (!gotContent && raw.trim().length > 0)) {
      throw new Error('frontmatter parse yielded no usable content (delimiter or cache)');
    }

    frontmatter = parsed.data;
    content = parsed.content;
  } catch (err) {
    content = stripFrontmatterBlock(raw);
    // 흔적을 남긴다 — 나중에 "왜 태그가 없지?" 를 추적할 수 있어야 한다.
    frontmatter = { __frontmatterError: ((err as Error)?.message ?? String(err)).slice(0, 200) };
  }

  const relativePath = relative(vaultPath, filePath).replace(/\\/g, '/');
  const id = createHash('sha256').update(relativePath).digest('hex').slice(0, 16);
  const contentHash = createHash('sha256').update(raw).digest('hex').slice(0, 16);

  // 🔴 여기부터는 <파생>이다. 파생이 실패해도 문서를 잃지 않는다.
  //    예: `date: not-a-date` 는 유효한 YAML 이라 위 try 를 통과하지만
  //    new Date(...).toISOString() 이 RangeError 를 던져 파일 전체가 탈락했다
  //    (코덱스 P1, 2026-08-21). 잘못된 필드만 기본값으로 되돌린다.
  const fmTitle = typeof frontmatter.title === 'string' && frontmatter.title.trim().length > 0
    ? frontmatter.title
    : undefined;
  const title = fmTitle
    ?? extractFirstHeading(content)
    ?? relativePath.replace(/\.md$/, '');

  const tags = extractTags(frontmatter, content);

  if (frontmatter.aliases) {
    const aliases = Array.isArray(frontmatter.aliases) ? frontmatter.aliases : [frontmatter.aliases];
    for (const alias of aliases) {
      if (typeof alias === 'string' && alias.length > 1) tags.push(alias);
    }
  }

  let source: string, type: string;
  try { source = inferSource(frontmatter, relativePath); } catch { source = 'local'; }
  try { type = inferType(frontmatter, relativePath); } catch { type = 'note'; }

  const fmDate = frontmatter.date ?? frontmatter.created ?? frontmatter.created_at;
  let lastModified = stat.mtime.toISOString();
  // 🔴 null 만 거르면 <타입이 틀린 값>이 통과한다 (코덱스 10차 P2).
  //    YAML `date: false` 는 유효한 boolean 이고 `new Date(false)` 는 NaN 이 아니라
  //    1970-01-01 이라 아래 가드를 <통과한다>. 그러면 "잘못된 필드는 mtime 으로
  //    되돌린다" 는 약속과 달리 1970년이 lastModified 로 저장된다.
  //    쓸 수 있는 것은 문자열·숫자·Date 뿐이다 (js-yaml 은 날짜를 Date 로 준다).
  const dateIsUsable = typeof fmDate === 'string' || typeof fmDate === 'number'
    || fmDate instanceof Date;
  if (dateIsUsable) {
    const parsedDate = new Date(fmDate as string | number | Date);
    // NaN 이면 toISOString 이 RangeError 다 — 던지게 두지 않고 파일 mtime 으로 되돌린다.
    if (!Number.isNaN(parsedDate.getTime())) lastModified = parsedDate.toISOString();
  }

  return {
    id,
    filePath: relativePath,
    title,
    content,
    frontmatter,
    tags,
    lastModified,
    contentHash,
    source,
    type,
  };
}

function inferSource(frontmatter: Record<string, unknown>, filePath: string): string {
  if (frontmatter.source && typeof frontmatter.source === 'string') {
    if (frontmatter.source.startsWith('http')) return 'clip';
    return frontmatter.source;
  }
  if (filePath.includes('clips/') || filePath.includes('clip/')) return 'clip';
  if (filePath.includes('PDCA') || filePath.includes('pdca')) return 'local';
  if (frontmatter['x-i18n']) return 'notion';
  if (frontmatter.clipped) return 'clip';
  return 'local';
}

function inferType(frontmatter: Record<string, unknown>, filePath: string): string {
  if (frontmatter.type && typeof frontmatter.type === 'string') return frontmatter.type;
  const tags = Array.isArray(frontmatter.tags) ? frontmatter.tags : [];
  if (tags.includes('bridge') || tags.includes('auto-generated')) return 'bridge';
  if (tags.includes('clip') || tags.includes('youtube')) return 'clip';
  if (tags.includes('decision')) return 'decision';
  if (filePath.includes('clips/')) return 'clip';
  if (filePath.includes('Decisions/') || filePath.includes('decisions/')) return 'decision';
  if (filePath.includes('Sessions/') || filePath.includes('sessions/')) return 'session';
  if (filePath.includes('Research/')) return 'research';
  if (filePath.includes('Lessons/')) return 'lesson';
  if (filePath.includes('Templates/')) return 'template';
  return 'note';
}

function extractFirstHeading(content: string): string | null {
  const match = content.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : null;
}

function extractTags(frontmatter: Record<string, unknown>, content: string): string[] {
  const tags = new Set<string>();

  const fmTags = frontmatter.tags;
  if (Array.isArray(fmTags)) {
    fmTags.forEach(t => tags.add(String(t)));
  } else if (typeof fmTags === 'string') {
    fmTags.split(',').map(t => t.trim()).filter(Boolean).forEach(t => tags.add(t));
  }

  const inlineTags = content.match(/(?:^|\s)#([a-zA-Z가-힣][a-zA-Z가-힣\w-]*)/g);
  if (inlineTags) {
    for (const raw of inlineTags) {
      const tag = raw.trim().slice(1);
      if (/^[0-9a-fA-F]{3,8}$/.test(tag)) continue;
      tags.add(tag);
    }
  }

  return [...tags];
}
