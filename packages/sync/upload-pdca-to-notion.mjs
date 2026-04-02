/**
 * 로컬 PDCA 문서 → 노션 자동 업로드 스크립트
 *
 * 기능:
 * - 각 프로젝트의 docs/ 폴더를 스캔
 * - .md 파일을 Notion API로 업로드
 * - 프로젝트별 "📄 PDCA 원본" 하위 페이지에 정리
 * - 이미 업로드된 문서는 파일 수정일 비교 후 변경 시 업데이트
 * - 업로드 상태를 .upload-state.json에 저장 (증분 업로드)
 *
 * 사용법: node upload-pdca-to-notion.mjs
 * 환경변수: .env 파일 참조
 */

import { Client } from '@notionhq/client';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── 환경변수 로드 ───
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
const PROJECT_PATHS = (process.env.PROJECT_PATHS || '').split(',').map(p => p.trim()).filter(Boolean);
const STATE_FILE = path.join(__dirname, '.upload-state.json');

if (!NOTION_API_KEY || !ROOT_PAGE_ID) {
  console.error('❌ NOTION_API_KEY와 NOTION_ROOT_PAGE_ID가 필요합니다.');
  process.exit(1);
}
if (PROJECT_PATHS.length === 0) {
  console.error('❌ PROJECT_PATHS가 설정되지 않았습니다.');
  process.exit(1);
}

const notion = new Client({ auth: NOTION_API_KEY });

// ─── 업로드 상태 관리 (증분 업로드용) ───
function loadUploadState() {
  if (fs.existsSync(STATE_FILE)) {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
  }
  return { lastUpload: null, files: {} };
}

function saveUploadState(state) {
  state.lastUpload = new Date().toISOString();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
}

// ─── 프로젝트 이름 → 노션 페이지 매핑 ───
const PROJECT_NAME_MAP = {
  'ai_destiny': 'AI Destiny',
  'project-manager': 'Project Manager',
  'stock_analist_beta': 'Stokova',
  'stock-autotrade': 'Quantrism',
  'vibevonweb': 'Vibevonweb',
  'TEST': '클로드 코드 마스터 가이드',
};

// PDCA 폴더 구조 → 노션 카테고리 매핑
const PHASE_MAP = {
  '00-pm': '📋 PM 분석',
  '01-plan': '📝 Plan (계획)',
  '02-design': '📐 Design (설계)',
  '03-analysis': '🔍 Analysis (검증)',
  '04-report': '📊 Report (보고)',
};

// ─── 노션에서 프로젝트 하위 페이지 ID 찾기 ───
async function findProjectPages(rootPageId) {
  const pageMap = {};
  let cursor = undefined;

  while (true) {
    const response = await notion.blocks.children.list({
      block_id: rootPageId,
      start_cursor: cursor,
      page_size: 100,
    });

    for (const block of response.results) {
      if (block.type === 'child_page') {
        pageMap[block.child_page.title] = block.id;
      }
    }

    if (!response.has_more) break;
    cursor = response.next_cursor;
  }

  return pageMap;
}

// ─── "PDCA 원본" 컨테이너 페이지 찾기 또는 생성 ───
async function findOrCreateContainer(parentPageId, title) {
  let cursor = undefined;
  while (true) {
    const response = await notion.blocks.children.list({
      block_id: parentPageId,
      start_cursor: cursor,
      page_size: 100,
    });

    for (const block of response.results) {
      if (block.type === 'child_page' && block.child_page.title === title) {
        return block.id;
      }
    }

    if (!response.has_more) break;
    cursor = response.next_cursor;
  }

  // 없으면 생성
  const page = await notion.pages.create({
    parent: { page_id: parentPageId },
    icon: { emoji: '📂' },
    properties: {
      title: [{ text: { content: title } }],
    },
    children: [
      {
        object: 'block',
        type: 'callout',
        callout: {
          icon: { emoji: '📄' },
          color: 'blue_background',
          rich_text: [{ text: { content: `${title} — 로컬 PDCA 문서 원본이 자동 업로드됩니다.` } }],
        },
      },
    ],
  });

  return page.id;
}

// ─── Phase 컨테이너 찾기 또는 생성 ───
async function findOrCreatePhaseContainer(parentPageId, phaseDir) {
  const phaseName = PHASE_MAP[phaseDir] || phaseDir;
  return findOrCreateContainer(parentPageId, phaseName);
}

// ─── 마크다운을 Notion 블록으로 변환 ───
function markdownToNotionBlocks(markdown, fileName) {
  const blocks = [];

  // 파일 정보 callout
  blocks.push({
    object: 'block',
    type: 'callout',
    callout: {
      icon: { emoji: '📄' },
      color: 'gray_background',
      rich_text: [{ text: { content: `원본 파일: ${fileName}\n마지막 업로드: ${new Date().toISOString().slice(0, 10)}` } }],
    },
  });

  // 구분선
  blocks.push({ object: 'block', type: 'divider', divider: {} });

  // 마크다운 내용을 2000자 단위로 분할 (Notion API rich_text 제한)
  const MAX_LEN = 2000;
  const chunks = [];
  let remaining = markdown;

  while (remaining.length > 0) {
    if (remaining.length <= MAX_LEN) {
      chunks.push(remaining);
      break;
    }
    let splitIdx = remaining.lastIndexOf('\n', MAX_LEN);
    if (splitIdx === -1 || splitIdx < MAX_LEN * 0.5) splitIdx = MAX_LEN;
    chunks.push(remaining.slice(0, splitIdx));
    remaining = remaining.slice(splitIdx);
  }

  for (const chunk of chunks) {
    blocks.push({
      object: 'block',
      type: 'code',
      code: {
        language: 'markdown',
        rich_text: [{ text: { content: chunk } }],
      },
    });
  }

  return blocks;
}

// ─── 기존 페이지 찾기 (ID 반환, 없으면 null) ───
async function findExistingPage(parentPageId, title) {
  let cursor = undefined;
  while (true) {
    const response = await notion.blocks.children.list({
      block_id: parentPageId,
      start_cursor: cursor,
      page_size: 100,
    });

    for (const block of response.results) {
      if (block.type === 'child_page' && block.child_page.title === title) {
        return block.id;
      }
    }

    if (!response.has_more) break;
    cursor = response.next_cursor;
  }
  return null;
}

// ─── 기존 페이지의 모든 블록 삭제 ───
async function clearPageContent(pageId) {
  let cursor = undefined;
  const blockIds = [];

  while (true) {
    const response = await notion.blocks.children.list({
      block_id: pageId,
      start_cursor: cursor,
      page_size: 100,
    });

    for (const block of response.results) {
      blockIds.push(block.id);
    }

    if (!response.has_more) break;
    cursor = response.next_cursor;
  }

  // 각 블록 삭제
  for (const blockId of blockIds) {
    try {
      await notion.blocks.delete({ block_id: blockId });
      await new Promise(r => setTimeout(r, 400));
    } catch {
      // 이미 삭제된 블록은 무시
    }
  }
}

// ─── API 호출 재시도 래퍼 (rate limit 대응) ───
async function withRetry(fn, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (err.status === 429 && attempt < maxRetries) {
        const waitSec = Math.pow(2, attempt) * 2;
        console.log(`      ⏳ Rate limit — ${waitSec}초 대기 후 재시도 (${attempt}/${maxRetries})`);
        await new Promise(r => setTimeout(r, waitSec * 1000));
      } else if (attempt < maxRetries && err.status >= 500) {
        await new Promise(r => setTimeout(r, 3000));
      } else {
        throw err;
      }
    }
  }
}

// ─── 단일 문서 업로드 또는 업데이트 ───
async function uploadDocument(parentPageId, filePath, fileName, state) {
  const title = fileName.replace(/\.md$/, '');
  const fileStat = fs.statSync(filePath);
  const fileModified = fileStat.mtimeMs;
  const stateKey = filePath.replace(/\\/g, '/');

  // 파일 수정일 비교 — 변경 없으면 스킵
  if (state.files[stateKey] && state.files[stateKey].modified >= fileModified) {
    return 'skip';
  }

  const markdown = fs.readFileSync(filePath, 'utf-8');
  const blocks = markdownToNotionBlocks(markdown, fileName);

  const existingPageId = await findExistingPage(parentPageId, title);

  if (existingPageId) {
    // 기존 페이지 업데이트: 내용 삭제 후 다시 추가
    await clearPageContent(existingPageId);
    await new Promise(r => setTimeout(r, 500));

    // 블록 추가 (100개 단위, 재시도 포함)
    for (let i = 0; i < blocks.length; i += 100) {
      const batch = blocks.slice(i, i + 100);
      await withRetry(() => notion.blocks.children.append({
        block_id: existingPageId,
        children: batch,
      }));
      await new Promise(r => setTimeout(r, 500));
    }

    // 상태 저장
    state.files[stateKey] = { modified: fileModified, pageId: existingPageId };
    return 'updated';
  }

  // 새 페이지 생성
  const firstBatch = blocks.slice(0, 100);
  const page = await withRetry(() => notion.pages.create({
    parent: { page_id: parentPageId },
    icon: { emoji: '📄' },
    properties: {
      title: [{ text: { content: title } }],
    },
    children: firstBatch,
  }));

  // 나머지 블록 추가
  for (let i = 100; i < blocks.length; i += 100) {
    const batch = blocks.slice(i, i + 100);
    await withRetry(() => notion.blocks.children.append({
      block_id: page.id,
      children: batch,
    }));
    await new Promise(r => setTimeout(r, 500));
  }

  // 상태 저장
  state.files[stateKey] = { modified: fileModified, pageId: page.id };
  return 'uploaded';
}

// ─── 프로젝트 하나 처리 ───
async function processProject(projectPath, projectPageId, state) {
  const docsDir = path.join(projectPath, 'docs');

  if (!fs.existsSync(docsDir)) {
    console.log(`  ⚠️ docs/ 폴더 없음 — 스킵`);
    return { uploaded: 0, updated: 0, skipped: 0 };
  }

  // "PDCA 원본" 컨테이너 찾기/생성
  const containerPageId = await findOrCreateContainer(projectPageId, '📄 PDCA 원본');
  await new Promise(r => setTimeout(r, 500));

  let uploaded = 0;
  let updated = 0;
  let skipped = 0;

  // docs/ 하위 디렉토리 순회
  const entries = fs.readdirSync(docsDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      // docs/ 루트의 .md 파일
      if (entry.name.endsWith('.md')) {
        const filePath = path.join(docsDir, entry.name);
        const result = await uploadDocument(containerPageId, filePath, entry.name, state);
        if (result === 'uploaded') { console.log(`    ✅ ${entry.name}`); uploaded++; }
        else if (result === 'updated') { console.log(`    🔄 ${entry.name}`); updated++; }
        else { skipped++; }
        await new Promise(r => setTimeout(r, 500));
      }
      continue;
    }

    // Phase 디렉토리 (01-plan, 02-design, etc.)
    const phaseDir = entry.name;
    if (!PHASE_MAP[phaseDir] && phaseDir === 'archive') continue;

    const phaseDirPath = path.join(docsDir, phaseDir);
    const phasePageId = await findOrCreatePhaseContainer(containerPageId, phaseDir);
    await new Promise(r => setTimeout(r, 500));

    // Phase 디렉토리 내 파일/폴더 순회
    const phaseEntries = fs.readdirSync(phaseDirPath, { withFileTypes: true });

    for (const phaseEntry of phaseEntries) {
      if (phaseEntry.isFile() && phaseEntry.name.endsWith('.md')) {
        const filePath = path.join(phaseDirPath, phaseEntry.name);
        const result = await uploadDocument(phasePageId, filePath, phaseEntry.name, state);
        if (result === 'uploaded') { console.log(`    ✅ ${phaseDir}/${phaseEntry.name}`); uploaded++; }
        else if (result === 'updated') { console.log(`    🔄 ${phaseDir}/${phaseEntry.name}`); updated++; }
        else { skipped++; }
        await new Promise(r => setTimeout(r, 500));
      }

      // features/ 하위 디렉토리
      if (phaseEntry.isDirectory() && phaseEntry.name === 'features') {
        const featuresDir = path.join(phaseDirPath, 'features');
        const featureFiles = fs.readdirSync(featuresDir).filter(f => f.endsWith('.md'));

        for (const featureFile of featureFiles) {
          const filePath = path.join(featuresDir, featureFile);
          const result = await uploadDocument(phasePageId, filePath, featureFile, state);
          if (result === 'uploaded') { console.log(`    ✅ ${phaseDir}/features/${featureFile}`); uploaded++; }
          else if (result === 'updated') { console.log(`    🔄 ${phaseDir}/features/${featureFile}`); updated++; }
          else { skipped++; }
          await new Promise(r => setTimeout(r, 500));
        }
      }
    }
  }

  return { uploaded, updated, skipped };
}

// ─── 메인 실행 ───
async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║  📤 로컬 PDCA → 노션 업로드 시작             ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log('');

  // 상태 로드
  const state = loadUploadState();
  if (state.lastUpload) {
    console.log(`🕐 마지막 업로드: ${state.lastUpload}`);
  } else {
    console.log('🆕 첫 업로드 실행');
  }

  // 프로젝트 페이지 매핑
  console.log('🔍 노션 프로젝트 페이지 검색 중...');
  const projectPages = await findProjectPages(ROOT_PAGE_ID);
  console.log(`   ${Object.keys(projectPages).length}개 프로젝트 발견\n`);

  let totalUploaded = 0;
  let totalUpdated = 0;
  let totalSkipped = 0;

  for (const projectPath of PROJECT_PATHS) {
    const dirName = path.basename(projectPath);
    const searchName = PROJECT_NAME_MAP[dirName];

    if (!searchName) {
      console.log(`⚠️ ${dirName} — 매핑 없음, 스킵`);
      continue;
    }

    const matchedTitle = Object.keys(projectPages).find(title =>
      title.includes(searchName)
    );

    if (!matchedTitle) {
      console.log(`⚠️ ${searchName} — 노션 페이지 못 찾음, 스킵`);
      continue;
    }

    const pageId = projectPages[matchedTitle];
    console.log(`📁 ${matchedTitle}`);
    console.log(`   경로: ${projectPath}`);

    const result = await processProject(projectPath, pageId, state);
    totalUploaded += result.uploaded;
    totalUpdated += result.updated;
    totalSkipped += result.skipped;

    console.log(`   📊 신규: ${result.uploaded}건, 업데이트: ${result.updated}건, 스킵: ${result.skipped}건\n`);

    // 프로젝트별 중간 상태 저장 (중단 시에도 진행분 보존)
    saveUploadState(state);
  }

  // 최종 상태 저장
  saveUploadState(state);

  console.log('╔══════════════════════════════════════════════╗');
  console.log(`║  ✅ 업로드 완료                               ║`);
  console.log(`║  📤 신규: ${totalUploaded} | 🔄 업데이트: ${totalUpdated} | ⏭️ 스킵: ${totalSkipped}  ║`);
  console.log('╚══════════════════════════════════════════════╝');
}

main().catch(err => {
  console.error('❌ 업로드 실패:', err.message);
  if (err.body) console.error('   상세:', err.body);
  process.exit(1);
});
