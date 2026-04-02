/**
 * Notion DB → Obsidian vault 구조화 동기화 (Federation Phase 1b)
 *
 * 기존 sync-to-obsidian.mjs는 페이지 계층을 그대로 복사.
 * 이 스크립트는 Notion DB 속성을 frontmatter로 매핑하고,
 * DB 이름에 따라 vault 폴더를 자동 결정합니다.
 *
 * 사용법: node structured-sync.mjs
 * 환경변수: .env (NOTION_API_KEY, NOTION_ROOT_PAGE_ID, OBSIDIAN_PATH)
 */

import { Client } from '@notionhq/client';
import { NotionToMarkdown } from 'notion-to-md';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// .env 로드
function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) { console.error('❌ .env 필요'); process.exit(1); }
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim(), v = t.slice(eq + 1).trim();
    if (!process.env[k]) process.env[k] = v;
  }
}
loadEnv();

const NOTION_API_KEY = process.env.NOTION_API_KEY;
const ROOT_PAGE_ID = process.env.NOTION_ROOT_PAGE_ID;
const OBSIDIAN_PATH = process.env.OBSIDIAN_PATH || './vault';

const notion = new Client({ auth: NOTION_API_KEY });
const n2m = new NotionToMarkdown({ notionClient: notion });

// DB 이름 → vault 폴더 매핑
const DB_FOLDER_MAP = {
  'Projects': '02_Projects',
  'Research': '04_Resources',
  'Meeting Notes': '02_Projects/meetings',
  'Daily Journal': '03_Daily',
  'Knowledge': '01_Knowledge',
  'Resources': '04_Resources',
  'Archive': '06_Archive',
};

// Notion 속성 → frontmatter 변환
function extractFrontmatter(page) {
  const props = page.properties || {};
  const fm = {
    title: '',
    source: 'notion',
    type: 'note',
    tags: [],
    notion_id: page.id,
    synced_at: new Date().toISOString(),
    last_edited: page.last_edited_time,
  };

  for (const [key, prop] of Object.entries(props)) {
    switch (prop.type) {
      case 'title':
        fm.title = prop.title?.map(t => t.plain_text).join('') || '';
        break;
      case 'multi_select':
        if (key.toLowerCase().includes('tag')) {
          fm.tags = prop.multi_select?.map(s => s.name) || [];
        }
        break;
      case 'select':
        if (key.toLowerCase().includes('type') || key.toLowerCase().includes('category')) {
          fm.type = prop.select?.name || 'note';
        }
        break;
      case 'date':
        if (prop.date?.start) fm[key.toLowerCase().replace(/\s+/g, '_')] = prop.date.start;
        break;
      case 'rich_text':
        const text = prop.rich_text?.map(t => t.plain_text).join('') || '';
        if (text && key.toLowerCase() !== 'title') {
          fm[key.toLowerCase().replace(/\s+/g, '_')] = text;
        }
        break;
      case 'url':
        if (prop.url) fm[key.toLowerCase().replace(/\s+/g, '_')] = prop.url;
        break;
    }
  }

  return fm;
}

// frontmatter를 YAML 문자열로 변환
function toYamlFrontmatter(fm) {
  const lines = ['---'];
  for (const [key, value] of Object.entries(fm)) {
    if (value === null || value === undefined || value === '') continue;
    if (Array.isArray(value)) {
      lines.push(`${key}: [${value.map(v => `"${v}"`).join(', ')}]`);
    } else if (typeof value === 'string' && (value.includes(':') || value.includes('"'))) {
      lines.push(`${key}: "${value.replace(/"/g, '\\"')}"`);
    } else {
      lines.push(`${key}: ${value}`);
    }
  }
  lines.push('---');
  return lines.join('\n');
}

// DB의 페이지들을 동기화
async function syncDatabase(dbId, dbName) {
  const folder = DB_FOLDER_MAP[dbName] || `01_Knowledge/${dbName}`;
  const targetDir = path.join(OBSIDIAN_PATH, folder);
  fs.mkdirSync(targetDir, { recursive: true });

  console.log(`📁 ${dbName} → ${folder}`);

  let cursor;
  let synced = 0;
  do {
    const response = await notion.databases.query({
      database_id: dbId,
      start_cursor: cursor,
      page_size: 100,
    });

    for (const page of response.results) {
      try {
        const fm = extractFrontmatter(page);
        if (!fm.title) continue;

        // 마크다운 변환
        const mdBlocks = await n2m.pageToMarkdown(page.id);
        const mdContent = n2m.toMarkdownString(mdBlocks)?.parent || '';

        // frontmatter + content
        const fullContent = `${toYamlFrontmatter(fm)}\n\n# ${fm.title}\n\n${mdContent}`;

        // 파일 저장
        const safeTitle = fm.title.replace(/[<>:"/\\|?*]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80);
        const filePath = path.join(targetDir, `${safeTitle}.md`);
        fs.writeFileSync(filePath, fullContent, 'utf-8');
        synced++;
      } catch (err) {
        console.error(`  ⚠ ${page.id}: ${err.message}`);
      }
    }

    cursor = response.has_more ? response.next_cursor : undefined;
  } while (cursor);

  console.log(`  ✅ ${synced}개 페이지 동기화`);
  return synced;
}

// 루트 페이지 하위의 DB들을 찾아서 동기화
async function main() {
  console.log('\n✦ Stellavault Structured Sync\n');

  // 루트 페이지의 자식 블록에서 DB 찾기
  const blocks = await notion.blocks.children.list({ block_id: ROOT_PAGE_ID, page_size: 100 });
  const databases = blocks.results.filter(b => b.type === 'child_database');

  if (databases.length === 0) {
    // DB가 없으면 기존 방식(페이지 기반)으로 폴백
    console.log('  DB 없음 — 페이지 기반 동기화로 폴백');
    console.log('  → node sync-to-obsidian.mjs 실행하세요');
    return;
  }

  let totalSynced = 0;
  for (const db of databases) {
    const dbName = db.child_database?.title || 'Untitled';
    totalSynced += await syncDatabase(db.id, dbName);
  }

  console.log(`\n✅ 총 ${totalSynced}개 페이지 구조화 동기화 완료`);
  console.log('💡 stellavault index로 재인덱싱하면 검색에 반영됩니다\n');
}

main().catch(err => { console.error('❌', err.message); process.exit(1); });
