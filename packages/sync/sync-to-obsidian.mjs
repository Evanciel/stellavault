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

if (!NOTION_API_KEY || !ROOT_PAGE_ID) {
  console.error('❌ NOTION_API_KEY와 NOTION_ROOT_PAGE_ID가 필요합니다.');
  process.exit(1);
}

// ─── 클라이언트 초기화 ───
const notion = new Client({ auth: NOTION_API_KEY });
const n2m = new NotionToMarkdown({ notionClient: notion });

// ─── 동기화 상태 관리 (증분 동기화용) ───
function loadSyncState() {
  if (fs.existsSync(STATE_FILE)) {
    const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
    if (!data.children) data.children = {};
    return data;
  }
  return { lastSync: null, pages: {}, children: {} };
}

function saveSyncState(state) {
  state.lastSync = new Date().toISOString();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
}

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
async function syncPageTree(pageId, dirPath, depth = 0, state) {
  const indent = '  '.repeat(depth);
  const children = await getChildPages(pageId);

  let syncCount = 0;
  let skipCount = 0;

  for (const child of children) {
    const title = child.title;
    const safeName = sanitizeFileName(title);

    // 변경 여부 확인 (증분 동기화)
    const prevEdited = state.pages[child.id];
    const hasChildren = state.children?.[child.id];

    if (prevEdited === child.lastEdited) {
      // 변경 없는 페이지 — 하위 페이지가 있었으면 재귀만 수행 (API 호출 없음)
      if (hasChildren) {
        const subDir = path.join(dirPath, safeName);
        const subResult = await syncPageTree(child.id, subDir, depth + 1, state);
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

    if (grandChildren.length > 0) {
      // 하위 페이지가 있으면 폴더 생성 + index.md
      const subDir = path.join(dirPath, safeName);
      fs.mkdirSync(subDir, { recursive: true });

      const markdown = await pageToMarkdown(child.id);
      const content = addFrontmatter(markdown, child, title);
      fs.writeFileSync(path.join(subDir, `${safeName}.md`), content, 'utf-8');

      // 하위 페이지 재귀 동기화
      const subResult = await syncPageTree(child.id, subDir, depth + 1, state);
      syncCount += 1 + subResult.syncCount;
      skipCount += subResult.skipCount;
      state.children[child.id] = true;
    } else {
      const markdown = await pageToMarkdown(child.id);
      const content = addFrontmatter(markdown, child, title);
      fs.writeFileSync(path.join(dirPath, `${safeName}.md`), content, 'utf-8');
      syncCount++;
      delete state.children?.[child.id];
    }

    // 상태 업데이트
    state.pages[child.id] = child.lastEdited;

    // Rate limit 방지 (Notion API: 3 req/sec)
    await new Promise(r => setTimeout(r, 350));
  }

  return { syncCount, skipCount };
}

// ─── 메인 실행 ───
async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║  📚 Notion → Obsidian 동기화 시작            ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log('');
  console.log(`📁 저장 경로: ${OBSIDIAN_PATH}`);
  console.log(`🔗 루트 페이지: ${ROOT_PAGE_ID}`);

  // 상태 로드
  const state = loadSyncState();
  if (state.lastSync) {
    console.log(`🕐 마지막 동기화: ${state.lastSync}`);
  } else {
    console.log('🆕 첫 동기화 실행');
  }
  console.log('');

  // 출력 디렉토리 생성
  fs.mkdirSync(OBSIDIAN_PATH, { recursive: true });

  // 동기화 실행
  const startTime = Date.now();
  const result = await syncPageTree(ROOT_PAGE_ID, OBSIDIAN_PATH, 0, state);
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  // 상태 저장
  saveSyncState(state);

  console.log('');
  console.log('╔══════════════════════════════════════════════╗');
  console.log(`║  ✅ 동기화 완료 (${elapsed}초)                  ║`);
  console.log(`║  📄 업데이트: ${result.syncCount}건 | ⏭️ 스킵: ${result.skipCount}건     ║`);
  console.log(`║  📁 저장: ${OBSIDIAN_PATH}  ║`);
  console.log('╚══════════════════════════════════════════════╝');
}

main().catch(err => {
  console.error('❌ 동기화 실패:', err.message);
  process.exit(1);
});
