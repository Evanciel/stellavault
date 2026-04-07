// 통합 인제스트 파이프라인
// 어떤 입력이든 → Stellavault 포맷으로 자동 변환 + 분류 + 연결
//
// 지원 입력: URL, PDF 텍스트, 마크다운, 플레인텍스트, YouTube
// 출력: frontmatter 포맷 .md → raw/ → compile → lint

import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join, resolve, extname, basename } from 'node:path';
import { scanFrontmatter, assignIndexCodes, archiveFile, type FrontmatterEntry } from './zettelkasten.js';
import { compileWiki } from './wiki-compiler.js';
import { autoLink } from './auto-linker.js';
import { DEFAULT_FOLDERS, type FolderNames } from '../config.js';

/** HTML 엔티티 디코딩 */
function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&#39;/g, "'").replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
}

/** YAML 값에서 위험한 문자를 이스케이프 */
function sanitizeYaml(val: string): string {
  return decodeHtmlEntities(val).replace(/["\\]/g, '\\$&').replace(/\n/g, ' ').slice(0, 200);
}

export type NoteStage = 'fleeting' | 'literature' | 'permanent';

export interface IngestInput {
  type: 'url' | 'text' | 'file' | 'youtube' | 'pdf-text' | 'pdf' | 'docx' | 'pptx' | 'xlsx' | 'xls';
  content: string;       // URL, 텍스트, 또는 파일 내용
  title?: string;
  tags?: string[];
  source?: string;       // 원본 출처
  stage?: NoteStage;     // 기본값: fleeting
}

export interface IngestResult {
  savedTo: string;       // vault 내 상대 경로
  stage: NoteStage;
  title: string;
  indexCode?: string;
  tags: string[];
  wordCount: number;
}

/**
 * 어떤 입력이든 Stellavault 표준 포맷으로 변환하여 저장.
 */
export function ingest(
  vaultPath: string,
  input: IngestInput,
  folders: FolderNames = DEFAULT_FOLDERS,
): IngestResult {
  const stage = input.stage ?? 'fleeting';
  const title = decodeHtmlEntities(input.title ?? extractTitleFromContent(input.content, input.type));
  const tags = input.tags ?? extractAutoTags(input.content, input.type);
  const source = input.source ?? (input.type === 'url' || input.type === 'youtube' ? input.content.split('\n')[0] : 'manual');

  // 본문 정리
  const body = cleanContent(input.content, input.type);
  const wordCount = body.split(/\s+/).length;

  // 자동 분류: 길이/구조에 따라 stage 결정
  const autoStage = classifyStage(body, stage, wordCount);

  // 폴더 결정 (config-driven)
  const folderMap: Record<NoteStage, string> = {
    fleeting: folders.fleeting,
    literature: folders.literature,
    permanent: folders.permanent,
  };
  const folder = folderMap[autoStage];
  const dir = resolve(vaultPath, folder);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  // 파일명 생성
  const now = new Date();
  const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const slug = title.slice(0, 50).replace(/[^a-zA-Z0-9가-힣\s]/g, '').replace(/\s+/g, '-').toLowerCase();
  const filename = `${timestamp}-${slug}.md`;
  const filePath = join(folder, filename);
  const fullPath = resolve(vaultPath, filePath);

  // path traversal 방지
  if (!fullPath.startsWith(resolve(vaultPath))) {
    throw new Error('Invalid path');
  }

  // 인덱스 코드 생성 (lazy — 전체 스캔 건너뛸 수 있음)
  let indexCode: string | undefined;
  try {
    // 성능: raw/ 폴더만 스캔 (전체 vault 스캔 대신)
    const rawEntries = scanFrontmatter(resolve(vaultPath, folder));
    const assignments = assignIndexCodes([...rawEntries, {
      filePath, title, tags, connections: [], wordCount,
    }]);
    indexCode = assignments.get(filePath);
  } catch { /* index code is optional */ }

  // Stellavault 표준 포맷으로 저장
  let md = buildStandardNote({
    title,
    body,
    tags,
    stage: autoStage,
    source,
    indexCode,
    created: now.toISOString(),
    inputType: input.type,
  });

  // wikilink 자동 삽입: 기존 노트 제목과 매칭
  try {
    md = autoLink(md, vaultPath, title, folders);
  } catch { /* autoLink 실패해도 저장은 진행 */ }

  writeFileSync(fullPath, md, 'utf-8');

  // 자동 compile: fleeting → wiki (rule-based, <100ms)
  try {
    const rawDir = resolve(vaultPath, folders.fleeting);
    const wikiDir = resolve(vaultPath, folders.wiki);
    if (existsSync(rawDir)) {
      compileWiki(rawDir, wikiDir);
    }
  } catch { /* compile 실패해도 ingest 성공 */ }

  return {
    savedTo: filePath,
    stage: autoStage,
    title,
    indexCode,
    tags,
    wordCount,
  };
}

/**
 * 여러 입력을 배치 처리.
 */
export function ingestBatch(
  vaultPath: string,
  inputs: IngestInput[],
): IngestResult[] {
  return inputs.map(input => ingest(vaultPath, input));
}

/**
 * 노트 승격: fleeting → literature → permanent.
 * 내용이 충분히 정제되면 다음 단계로 이동.
 */
export function promoteNote(
  vaultPath: string,
  filePath: string,
  targetStage: NoteStage,
  folders: FolderNames = DEFAULT_FOLDERS,
): string {
  const fullPath = resolve(vaultPath, filePath);
  if (!existsSync(fullPath)) throw new Error(`File not found: ${filePath}`);

  const content = readFileSync(fullPath, 'utf-8');

  // frontmatter의 type 변경
  const updated = content.replace(
    /^type:\s*.+$/m,
    `type: ${targetStage}`
  );

  // 대상 폴더로 이동 (config-driven)
  const folderMap: Record<NoteStage, string> = {
    fleeting: folders.fleeting,
    literature: folders.literature,
    permanent: folders.permanent,
  };
  const newDir = resolve(vaultPath, folderMap[targetStage]);
  if (!existsSync(newDir)) mkdirSync(newDir, { recursive: true });

  const newPath = join(folderMap[targetStage], basename(filePath));
  const newFullPath = resolve(vaultPath, newPath);

  if (!newFullPath.startsWith(resolve(vaultPath))) {
    throw new Error('Invalid path');
  }

  writeFileSync(newFullPath, updated, 'utf-8');

  // 원본에 archive 플래그
  archiveFile(fullPath);

  return newPath;
}

// ─── 내부 헬퍼 ───

function extractTitleFromContent(content: string, type: string): string {
  if (type === 'url' || type === 'youtube') {
    // URL에서 도메인 + 경로 추출
    try {
      const url = new URL(content.split('\n')[0]);
      return url.hostname + url.pathname.slice(0, 40);
    } catch { return 'Untitled Clip'; }
  }

  // 첫 heading 또는 첫 줄
  const heading = content.match(/^#\s+(.+)$/m);
  if (heading) return heading[1];

  const firstLine = content.split('\n')[0].trim();
  return firstLine.slice(0, 80) || 'Untitled';
}

function extractAutoTags(content: string, type: string): string[] {
  const tags = new Set<string>();

  // 입력 타입 태그
  if (type === 'url') tags.add('web-clip');
  if (type === 'youtube') tags.add('youtube');
  if (type === 'pdf-text' || type === 'pdf') tags.add('pdf');
  if (type === 'docx') tags.add('document');
  if (type === 'pptx') tags.add('presentation');
  if (type === 'xlsx' || type === 'xls') tags.add('spreadsheet');

  // 인라인 #태그 추출
  const inline = content.match(/#([a-zA-Z가-힣][a-zA-Z0-9가-힣_-]{2,})/g) ?? [];
  inline.forEach(t => tags.add(t.slice(1)));

  return [...tags].slice(0, 10);
}

function cleanContent(content: string, type: string): string {
  if (type === 'url' || type === 'youtube') {
    // URL은 첫 줄이 URL, 나머지가 내용
    const lines = content.split('\n');
    return lines.slice(1).join('\n').trim() || lines[0];
  }
  return content.trim();
}

function classifyStage(body: string, requestedStage: NoteStage, wordCount: number): NoteStage {
  // 요청된 단계가 permanent면 그대로
  if (requestedStage === 'permanent') return 'permanent';

  // 자동 분류 기준:
  // - 200단어 미만 + 구조 없음 → fleeting
  // - 200-1000단어 + 출처 있음 → literature
  // - 1000단어+ + 구조 있음 → permanent 후보 (but 수동 승격 권장)
  if (wordCount < 200 && !body.includes('## ')) return 'fleeting';
  if (wordCount >= 200 && (body.includes('## ') || body.includes('> '))) return 'literature';

  return requestedStage;
}

function buildStandardNote(params: {
  title: string;
  body: string;
  tags: string[];
  stage: NoteStage;
  source: string;
  indexCode?: string;
  created: string;
  inputType: string;
}): string {
  const lines = [
    '---',
    `title: "${sanitizeYaml(params.title)}"`,
    `type: ${params.stage}`,
    `source: ${params.source}`,
    `input_type: ${params.inputType}`,
    params.indexCode ? `zettel_id: "${params.indexCode}"` : null,
    `tags: [${params.tags.map(t => `"${t}"`).join(', ')}]`,
    `created: ${params.created}`,
    `summary: "${sanitizeYaml(params.body.slice(0, 100))}"`,
    '---',
    '',
    `# ${params.title}`,
    '',
    params.body,
    '',
    '---',
    `*Ingested via \`stellavault ingest\` (${params.inputType}) at ${params.created}*`,
  ];

  return lines.filter(l => l !== null).join('\n');
}
