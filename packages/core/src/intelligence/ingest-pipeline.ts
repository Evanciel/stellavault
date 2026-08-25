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

/** 경로 구분자. 리터럴 역슬래시는 편집 도구가 이스케이프를 먹는다. */
const BACKSLASH = String.fromCharCode(92);

/**
 * 볼트 상대경로를 만든다 — <언제나 슬래시>다.
 *
 * 🔴 export 인 이유는 재사용이 아니라 <측정>이다. 이 정규화가 없으면 윈도우에서만
 *    깨지는데, CI 는 리눅스라 `join()` 이 이미 슬래시를 내므로 <시험이 아무것도
 *    증명하지 못한다>(코덱스 8차 P2). 함수를 꺼내면 역슬래시를 직접 먹여
 *    <어느 플랫폼에서든> 판별력 있게 잴 수 있다.
 */
export function toVaultPath(folder: string, filename: string): string {
  return join(folder, filename).split(BACKSLASH).join('/');
}

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
  // 🔴 항상 슬래시로 정규화한다. join() 은 윈도우에서 역슬래시를 내는데, 이 값이
  //    documents 의 <id 에도 file_path 에도> 그대로 들어간다. 파일 스캐너는 같은 파일을
  //    슬래시로 정규화해 <다른 id·다른 file_path> 로 쓰므로, 같은 노트가 두 행이 된다
  //    (UNIQUE(file_path) 도 서로 다른 문자열이라 안 걸린다).
  //    색인기가 그 중복을 치우긴 하지만, 근원을 안 고치면 ingest 마다 다시 생긴다
  //    (코덱스 6b, 2026-08-21 — indexer/index.ts 의 idsForRelPath 주석 참조).
  const filePath = toVaultPath(folder, filename);
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
  } catch (err) { console.warn('[ingest] Index code skipped:', err instanceof Error ? err.message : err); }

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
  } catch (err) { console.warn('[ingest] Auto-link skipped:', err instanceof Error ? err.message : err); }

  writeFileSync(fullPath, md, 'utf-8');

  // 자동 compile: fleeting → wiki (rule-based, <100ms)
  try {
    const rawDir = resolve(vaultPath, folders.fleeting);
    const wikiDir = resolve(vaultPath, folders.wiki);
    if (existsSync(rawDir)) {
      compileWiki(rawDir, wikiDir);
    }
  } catch (err) { console.warn('[ingest] Auto-compile skipped:', err instanceof Error ? err.message : err); }

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

  // 🔴 반환값은 <볼트 상대경로>다. 구분자를 정규화해 둔다 — 저장소 형식이 슬래시이고,
  //    이 값이 화면·로그·다음 색인의 입력으로 흘러가기 때문이다.
  // ⚠️ 예전 주석은 "호출부가 이것으로 id 를 만든다" 고 적었는데 <사실이 아니다>
  //    (코덱스 10차 P2). 저장소 안의 유일한 호출부는 이 경로를 <출력만> 한다.
  //    그리고 promoteNote 는 파일을 옮길 뿐 DB 행을 갱신하지 않는다 — 옮긴 결과가
  //    색인에 반영되는 것은 <다음 색인>이다. 여기서 정규화한다고 옛 행이 사라지지 않는다.
  const newPath = toVaultPath(folderMap[targetStage], basename(filePath));
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

  // 스마트 자동 태깅: 문서 내용 분석 → 카테고리 분류
  const lc = content.toLowerCase();
  if (/회의|meeting|minutes|참석자|agenda/.test(lc)) tags.add('meeting-notes');
  if (/기획|prd|요구사항|spec|feature|유저\s*스토리/.test(lc)) tags.add('planning');
  if (/api|endpoint|서버|backend|database|쿼리/.test(lc)) tags.add('technical');
  if (/디자인|design|ui|ux|figma|wireframe|mockup/.test(lc)) tags.add('design');
  if (/논문|paper|abstract|methodology|conclusion|참고문헌/.test(lc)) tags.add('research');
  if (/tutorial|강의|강좌|배우|learn|course/.test(lc)) tags.add('learning');
  if (/경쟁|competitor|시장|market|swot|분석/.test(lc)) tags.add('analysis');
  if (/일기|diary|journal|오늘|today|daily/.test(lc)) tags.add('journal');

  // Content-based keyword extraction — top meaningful words as tags
  // Simple TF approach: count word frequency, filter stop words, take top 3
  const stopWords = new Set([
    'the','a','an','and','or','but','in','on','at','to','for','of','with','by','from',
    'is','are','was','were','be','been','being','have','has','had','do','does','did',
    'will','would','could','should','may','might','can','this','that','these','those',
    'it','its','they','them','their','we','our','you','your','he','she','his','her',
    'not','no','all','each','every','both','few','more','most','other','some','such',
    'than','too','very','just','about','above','after','before','between','into','through',
    'during','without','also','how','what','which','who','when','where','why','if','then',
  ]);
  const wordFreq = new Map<string, number>();
  const words = content.toLowerCase().replace(/[^a-z가-힣\s]/g, ' ').split(/\s+/);
  for (const w of words) {
    if (w.length < 3 || stopWords.has(w)) continue;
    wordFreq.set(w, (wordFreq.get(w) ?? 0) + 1);
  }
  const topKeywords = [...wordFreq.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([word]) => word);
  topKeywords.forEach(k => tags.add(k));

  return [...tags].slice(0, 15);
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
    `source: "${sanitizeYaml(params.source)}"`,
    `input_type: ${params.inputType}`,
    params.indexCode ? `zettel_id: "${params.indexCode}"` : null,
    `tags: [${params.tags.map(t => `"${sanitizeYaml(t)}"`).join(', ')}]`,
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
