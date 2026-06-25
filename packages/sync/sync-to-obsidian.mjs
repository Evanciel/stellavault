/**
 * 노션 프로젝트 페이지 → 옵시디언 마크다운 동기화 스크립트
 *
 * 기능:
 * - "프로젝트" 페이지 하위의 모든 페이지를 재귀적으로 순회
 * - 각 페이지를 마크다운으로 변환하여 옵시디언 볼트에 저장
 * - 페이지 계층 구조를 폴더 구조로 변환
 * - 마지막 동기화 이후 변경된 페이지만 업데이트 (증분 동기화)
 *
 * 사용법: node sync-to-obsidian.mjs
 * 환경변수: .env 파일 참조
 */

import { Client } from '@notionhq/client';
import { NotionToMarkdown } from 'notion-to-md';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
// G2 — conflict-aware write-back (guarded writes + push surface). Pure of Notion, unit-tested.
import {
  loadSyncState, saveSyncState, guardedWrite, mergeConflictQueue, renderConflictNote,
  reconcileTombstones, atomicWriteFile, normRel, hashFile, samePath,
} from './lib/writeback.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── 환경변수 로드 (.env 파일 직접 파싱, dotenv 의존성 제거) ───
function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) {
    console.error('❌ .env 파일이 없습니다. .env.example을 복사하여 .env를 만들어주세요.');
    process.exit(1);
  }
  const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}
loadEnv();

// ─── 설정 ───
const NOTION_API_KEY = process.env.NOTION_API_KEY;
const ROOT_PAGE_ID = process.env.NOTION_ROOT_PAGE_ID;
const OBSIDIAN_PATH = process.env.OBSIDIAN_PATH || 'F:/obsidian/Notion-Projects';
const STATE_FILE = path.join(__dirname, '.sync-state.json');
// G2 push surface: a machine queue (sync dir) + a human-readable note inside the vault.
const CONFLICT_QUEUE = path.join(__dirname, '.sync-conflicts.json');
const CONFLICT_NOTE = path.join(OBSIDIAN_PATH, '_SYNC-CONFLICTS.md');
const CONFLICT_NOTE_RESERVED = '_SYNC-CONFLICTS'; // a Notion page sanitising to this is refused

if (!NOTION_API_KEY || !ROOT_PAGE_ID) {
  console.error('❌ NOTION_API_KEY와 NOTION_ROOT_PAGE_ID가 필요합니다.');
  process.exit(1);
}

// ─── 클라이언트 초기화 ───
const notion = new Client({ auth: NOTION_API_KEY });
const n2m = new NotionToMarkdown({ notionClient: notion });

// 동기화 상태 관리(증분 + G2 fingerprint)는 ./lib/writeback.mjs 로 이동 (atomic + .bak 복구).

// ─── 페이지 제목에서 파일명 안전 문자열 생성 ───
function sanitizeFileName(name) {
  return name
    .replace(/[<>:"/\\|?*]/g, '')  // Windows 금지 문자 제거
    .replace(/\s+/g, ' ')          // 연속 공백 정리
    .trim()
    .slice(0, 100);                // 최대 100자
}

// ─── 아이콘을 문자열로 변환 ───
function getIcon(page) {
  if (!page.icon) return '';
  if (page.icon.type === 'emoji') return page.icon.emoji + ' ';
  return '';
}

// ─── 페이지 제목 추출 ───
function getTitle(page) {
  const titleProp = page.properties?.title || page.properties?.Name;
  if (!titleProp) return 'Untitled';
  const titleArr = titleProp.title || titleProp;
  if (Array.isArray(titleArr)) {
    return titleArr.map(t => t.plain_text).join('');
  }
  return 'Untitled';
}

// ─── 하위 페이지 목록 가져오기 ───
async function getChildPages(pageId) {
  const children = [];
  let cursor = undefined;

  while (true) {
    const response = await notion.blocks.children.list({
      block_id: pageId,
      start_cursor: cursor,
      page_size: 100,
    });

    for (const block of response.results) {
      if (block.type === 'child_page') {
        children.push({
          id: block.id,
          title: block.child_page.title,
          lastEdited: block.last_edited_time,
        });
      }
    }

    if (!response.has_more) break;
    cursor = response.next_cursor;
  }

  return children;
}

// ─── 페이지를 마크다운으로 변환 ───
async function pageToMarkdown(pageId) {
  try {
    const mdBlocks = await n2m.pageToMarkdown(pageId);
    const mdString = n2m.toMarkdownString(mdBlocks);
    // notion-to-md v3는 { parent: string } 객체를 반환할 수 있음
    return typeof mdString === 'string' ? mdString : mdString.parent || '';
  } catch (err) {
    console.warn(`  ⚠️ 마크다운 변환 실패 (${pageId}): ${err.message}`);
    return `> 변환 실패: ${err.message}`;
  }
}

// ─── 마크다운 프론트매터 추가 ───
function addFrontmatter(markdown, page, title) {
  const fm = [
    '---',
    `title: "${title.replace(/"/g, '\\"')}"`,
    `notion_id: "${page.id || ''}"`,
    `last_edited: "${page.lastEdited || new Date().toISOString()}"`,
    `synced_at: "${new Date().toISOString()}"`,
    '---',
    '',
  ].join('\n');
  return fm + markdown;
}

// ─── 재귀적으로 페이지 트리 동기화 ───
// ctx = { state, conflicts, claimedPaths, priorConflictIds, now } (G2 write-back).
async function syncPageTree(pageId, dirPath, depth, ctx) {
  const { state, now } = ctx;
  const indent = '  '.repeat(depth);
  const children = await getChildPages(pageId);

  let syncCount = 0;
  let skipCount = 0;

  for (const child of children) {
    const title = child.title;
    const safeName = sanitizeFileName(title);
    const hasChildren = state.children?.[child.id];
    const leaf = !hasChildren; // provisional (skip path); recomputed from grandChildren on change
    const leafPath = path.join(dirPath, `${safeName}.md`);
    const folderPath = path.join(dirPath, safeName, `${safeName}.md`);

    // 변경 여부 확인 (증분 동기화)
    const prevEdited = state.pages[child.id];

    if (prevEdited === child.lastEdited) {
      // G2 skip-path backfill: a pre-G2 page has no fingerprint. Adopt the current on-disk
      // file as the baseline (ONE cheap read, NO write) so the first future Notion change is a
      // clean overwrite instead of a vault-wide backup blizzard.
      if (!state.local[child.id]) {
        const file = leaf ? leafPath : folderPath;
        if (fs.existsSync(file)) {
          state.local[child.id] = { hash: hashFile(file), relPath: normRel(OBSIDIAN_PATH, file), leaf, syncedAt: now };
        }
      }
      if (hasChildren) {
        const subResult = await syncPageTree(child.id, path.join(dirPath, safeName), depth + 1, ctx);
        syncCount += subResult.syncCount;
        skipCount += 1 + subResult.skipCount;
      } else {
        skipCount++;
      }
      continue;
    }

    console.log(`${indent}📄 ${title}`);

    // 하위 페이지 확인
    const grandChildren = await getChildPages(child.id);
    await new Promise(r => setTimeout(r, 350));

    const isLeaf = grandChildren.length === 0;
    const targetPath = isLeaf ? leafPath : folderPath;

    // Never let a Notion page clobber our own conflict note (_SYNC-CONFLICTS.md).
    if (samePath(normRel(OBSIDIAN_PATH, targetPath), normRel(OBSIDIAN_PATH, CONFLICT_NOTE))) {
      console.warn(`${indent}  ⚠️ "${title}" → ${CONFLICT_NOTE_RESERVED} 예약 이름과 충돌, 건너뜀`);
      skipCount++;
      continue;
    }

    if (!isLeaf) fs.mkdirSync(path.join(dirPath, safeName), { recursive: true });

    const markdown = await pageToMarkdown(child.id);
    const content = addFrontmatter(markdown, child, title);
    // G2 — guarded: never overwrites a locally-edited file; pushes conflicts instead.
    const r = guardedWrite({
      root: OBSIDIAN_PATH, targetPath, content, rawMarkdown: markdown,
      id: child.id, title, leaf: isLeaf, state, conflicts: ctx.conflicts,
      claimedPaths: ctx.claimedPaths, priorConflictIds: ctx.priorConflictIds,
      now, notionLastEdited: child.lastEdited,
    });
    if (r.wrote) syncCount++;
    if (r.conflicted) console.warn(`${indent}  ⚠️ 충돌 — 로컬 보존, Notion 버전은 사이드카로`);

    // Children are independent pages — always recurse. The parent's children-marker + pages
    // pointer advance ONLY when the parent write did NOT conflict (frozen → re-evaluates next run).
    if (!isLeaf) {
      const subResult = await syncPageTree(child.id, path.join(dirPath, safeName), depth + 1, ctx);
      syncCount += subResult.syncCount;
      skipCount += subResult.skipCount;
      if (!r.conflicted) state.children[child.id] = true;
    } else if (!r.conflicted) {
      delete state.children?.[child.id];
    }

    if (!r.conflicted) state.pages[child.id] = child.lastEdited;

    // Rate limit 방지 (Notion API: 3 req/sec)
    await new Promise(r2 => setTimeout(r2, 350));
  }

  return { syncCount, skipCount };
}

// G2 — prior conflict queue drives resolution-adopt (sidecar-deleted → reconciled) + merge-forward.
function loadPriorQueue() {
  try { return JSON.parse(fs.readFileSync(CONFLICT_QUEUE, 'utf-8')); }
  catch { return { conflicts: [] }; }
}
const SIDECAR_REASONS = new Set(['edit-conflict', 'edit-conflict-relocated', 'local-deleted']);

// ─── 메인 실행 ───
async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║  📚 Notion → Obsidian 동기화 시작            ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log('');
  console.log(`📁 저장 경로: ${OBSIDIAN_PATH}`);
  console.log(`🔗 루트 페이지: ${ROOT_PAGE_ID}`);

  // 상태 로드 (atomic + .bak 복구, parse 실패해도 process.exit 안 함)
  const state = loadSyncState(STATE_FILE);
  console.log(state.lastSync ? `🕐 마지막 동기화: ${state.lastSync}` : '🆕 첫 동기화 실행');
  console.log('');

  fs.mkdirSync(OBSIDIAN_PATH, { recursive: true });

  // ── G2 conflict context ──
  const prior = loadPriorQueue();
  const priorConflictIds = new Set(prior.conflicts.filter((c) => SIDECAR_REASONS.has(c.reason)).map((c) => c.notionId));
  const conflicts = [];
  const claimedPaths = new Map();
  const now = new Date().toISOString();
  const ctx = { state, conflicts, claimedPaths, priorConflictIds, now };

  const startTime = Date.now();
  let result = { syncCount: 0, skipCount: 0 };
  try {
    result = await syncPageTree(ROOT_PAGE_ID, OBSIDIAN_PATH, 0, ctx);
    reconcileTombstones(OBSIDIAN_PATH, state, now); // settle accepted local deletions
  } finally {
    saveSyncState(STATE_FILE, state); // persist fingerprints even on a thrown error
  }
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  // ── G2 push surface: machine queue + a vault note + a log line ──
  // A prior sidecar-conflict NOT re-detected this run = the user reconciled it (resolution-adopt
  // advanced pages). One-shots auto-resolve once their artifact (backup / stale old path) is gone.
  const freshIds = new Set(conflicts.map((c) => c.notionId));
  const resolvedIds = new Set();
  for (const c of prior.conflicts) {
    if (SIDECAR_REASONS.has(c.reason) && !freshIds.has(c.notionId)) resolvedIds.add(c.notionId);
    if (c.reason === 'no-baseline-overwrite' && c.backupRelPath && !fs.existsSync(path.join(OBSIDIAN_PATH, c.backupRelPath))) resolvedIds.add(c.notionId);
    if (c.reason === 'relocated' && c.oldRelPath && !fs.existsSync(path.join(OBSIDIAN_PATH, c.oldRelPath))) resolvedIds.add(c.notionId);
  }
  const queue = mergeConflictQueue(prior, conflicts, resolvedIds, now);
  try {
    atomicWriteFile(CONFLICT_QUEUE, JSON.stringify(queue, null, 2));
    atomicWriteFile(CONFLICT_NOTE, renderConflictNote(queue)); // surfaced INSIDE the vault (push)
  } catch (e) { console.warn(`⚠️ 충돌 리포트 기록 실패: ${e.message}`); }

  console.log('');
  console.log('╔══════════════════════════════════════════════╗');
  console.log(`║  ✅ 동기화 완료 (${elapsed}초)                  ║`);
  console.log(`║  📄 업데이트: ${result.syncCount}건 | ⏭️ 스킵: ${result.skipCount}건     ║`);
  console.log(`║  📁 저장: ${OBSIDIAN_PATH}  ║`);
  console.log('╚══════════════════════════════════════════════╝');
  // Conflict summary as the FINAL line so run-sync.mjs's slice(-3) daily-log capture keeps it.
  console.log(queue.count ? `⚠️ 충돌 ${queue.count}건 — _SYNC-CONFLICTS.md 확인` : '✅ 충돌 없음');
}

main().catch(err => {
  console.error('❌ 동기화 실패:', err.message);
  process.exit(1);
});
