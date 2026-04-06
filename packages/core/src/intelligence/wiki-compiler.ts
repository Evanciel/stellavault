// Feature: stellavault compile — raw → wiki 컴파일
// raw/ 폴더의 문서를 분석하여 구조화된 wiki .md 파일 생성

import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { join, resolve, basename, extname } from 'node:path';
import type { SearchEngine } from '../search/index.js';
import type { VectorStore } from '../store/types.js';

export interface CompileResult {
  rawDocCount: number;
  wikiArticles: string[];
  indexFile: string;
  concepts: string[];
}

export interface RawDocument {
  filePath: string;
  title: string;
  content: string;
  tags: string[];
}

/**
 * raw/ 폴더를 스캔하여 문서 목록 반환
 */
export function scanRawDirectory(rawPath: string): RawDocument[] {
  if (!existsSync(rawPath)) return [];

  const docs: RawDocument[] = [];
  const files = readdirSync(rawPath, { recursive: true }) as string[];

  for (const file of files) {
    const fullPath = join(rawPath, file);
    if (!statSync(fullPath).isFile()) continue;
    const ext = extname(file).toLowerCase();
    if (!['.md', '.txt', '.html'].includes(ext)) continue;

    const content = readFileSync(fullPath, 'utf-8');
    const title = extractTitle(content, file);
    const tags = extractTags(content);

    docs.push({ filePath: file, title, content, tags });
  }

  return docs;
}

/**
 * 문서에서 제목 추출
 */
function extractTitle(content: string, filename: string): string {
  // YAML frontmatter title
  const fmMatch = content.match(/^---[\s\S]*?title:\s*["']?(.+?)["']?\s*$/m);
  if (fmMatch) return fmMatch[1];

  // First heading
  const headingMatch = content.match(/^#\s+(.+)$/m);
  if (headingMatch) return headingMatch[1];

  // Filename
  return basename(filename, extname(filename));
}

/**
 * 문서에서 태그 추출
 */
function extractTags(content: string): string[] {
  const tags = new Set<string>();

  // YAML tags
  const fmMatch = content.match(/^---[\s\S]*?tags:\s*\[([^\]]*)\]/m);
  if (fmMatch) {
    fmMatch[1].split(',').map(t => t.trim().replace(/["']/g, '')).filter(Boolean).forEach(t => tags.add(t));
  }

  // Inline #tags
  const inlineTags = content.match(/#([a-zA-Z가-힣][a-zA-Z0-9가-힣_-]*)/g) ?? [];
  inlineTags.forEach(t => tags.add(t.slice(1)));

  return [...tags];
}

/**
 * raw 문서들에서 핵심 개념(concepts) 추출
 */
export function extractConcepts(docs: RawDocument[]): Map<string, string[]> {
  const conceptMap = new Map<string, string[]>(); // concept → [docPaths]

  for (const doc of docs) {
    // 태그를 개념으로
    for (const tag of doc.tags) {
      const existing = conceptMap.get(tag) ?? [];
      existing.push(doc.filePath);
      conceptMap.set(tag, existing);
    }

    // 제목 키워드를 개념으로
    const titleWords = doc.title
      .split(/[\s\-_,]+/)
      .filter(w => w.length > 3)
      .map(w => w.toLowerCase());
    for (const word of titleWords) {
      const existing = conceptMap.get(word) ?? [];
      existing.push(doc.filePath);
      conceptMap.set(word, existing);
    }
  }

  // 2개 이상 문서에서 등장하는 개념만
  const filtered = new Map<string, string[]>();
  for (const [concept, docPaths] of conceptMap) {
    if (docPaths.length >= 2) {
      filtered.set(concept, [...new Set(docPaths)]);
    }
  }

  return filtered;
}

/**
 * 컴파일: raw/ → wiki/
 * - 개념별 문서 생성
 * - 인덱스 파일 생성
 * - 백링크 추가
 */
export function compileWiki(
  rawPath: string,
  wikiPath: string,
  options: { force?: boolean } = {},
): CompileResult {
  const docs = scanRawDirectory(rawPath);
  if (docs.length === 0) {
    return { rawDocCount: 0, wikiArticles: [], indexFile: '', concepts: [] };
  }

  // wiki 디렉토리 생성
  if (!existsSync(wikiPath)) {
    mkdirSync(wikiPath, { recursive: true });
  }

  const concepts = extractConcepts(docs);
  const wikiArticles: string[] = [];

  // 1. 각 raw 문서의 요약 문서 생성
  for (const doc of docs) {
    const slug = doc.title.replace(/[^a-zA-Z0-9가-힣\s]/g, '').replace(/\s+/g, '-').toLowerCase();
    const wikiFile = `${slug}.md`;
    const wikiFullPath = resolve(wikiPath, wikiFile);

    // path traversal 방지
    if (!wikiFullPath.startsWith(resolve(wikiPath))) continue;

    const relatedDocs = findRelatedDocs(doc, docs);
    const articleContent = generateArticle(doc, relatedDocs, concepts);

    writeFileSync(wikiFullPath, articleContent, 'utf-8');
    wikiArticles.push(wikiFile);
  }

  // 2. 개념별 허브 문서 생성
  for (const [concept, docPaths] of concepts) {
    const slug = concept.replace(/[^a-zA-Z0-9가-힣]/g, '-').toLowerCase();
    const hubFile = `_concept-${slug}.md`;
    const hubFullPath = resolve(wikiPath, hubFile);
    if (!hubFullPath.startsWith(resolve(wikiPath))) continue;

    const relatedArticles = docPaths.map(p => {
      const doc = docs.find(d => d.filePath === p);
      return doc?.title ?? p;
    });

    const hubContent = [
      '---',
      `title: "Concept: ${concept}"`,
      'type: concept',
      `date: ${new Date().toISOString()}`,
      '---',
      '',
      `# ${concept}`,
      '',
      `This concept appears in ${relatedArticles.length} documents.`,
      '',
      '## Related Documents',
      ...relatedArticles.map(a => `- [[${a}]]`),
      '',
      '---',
      '*Auto-generated by `stellavault compile`*',
    ].join('\n');

    writeFileSync(hubFullPath, hubContent, 'utf-8');
    wikiArticles.push(hubFile);
  }

  // 3. 인덱스 파일 생성
  const indexContent = generateIndex(docs, concepts, wikiArticles);
  const indexPath = resolve(wikiPath, '_index.md');
  writeFileSync(indexPath, indexContent, 'utf-8');

  return {
    rawDocCount: docs.length,
    wikiArticles,
    indexFile: '_index.md',
    concepts: [...concepts.keys()],
  };
}

function findRelatedDocs(doc: RawDocument, allDocs: RawDocument[]): RawDocument[] {
  return allDocs
    .filter(d => d.filePath !== doc.filePath)
    .filter(d => {
      const sharedTags = doc.tags.filter(t => d.tags.includes(t));
      return sharedTags.length > 0;
    })
    .slice(0, 5);
}

function generateArticle(doc: RawDocument, related: RawDocument[], concepts: Map<string, string[]>): string {
  const docConcepts = [...concepts.keys()].filter(c =>
    doc.content.toLowerCase().includes(c.toLowerCase()) || doc.tags.includes(c)
  );

  return [
    '---',
    `title: "${doc.title}"`,
    `source: "${doc.filePath}"`,
    `date: ${new Date().toISOString()}`,
    `tags: [${doc.tags.map(t => `"${t}"`).join(', ')}]`,
    'type: wiki-article',
    '---',
    '',
    `# ${doc.title}`,
    '',
    '## Summary',
    doc.content.substring(0, 500).replace(/^#.+$/gm, '').trim() + '...',
    '',
    docConcepts.length > 0 ? `## Related Concepts\n${docConcepts.map(c => `- [[_concept-${c}|${c}]]`).join('\n')}` : '',
    '',
    related.length > 0 ? `## 관련 문서\n${related.map(r => `- [[${r.title}]]`).join('\n')}` : '',
    '',
    `## Source`,
    `- Source: \`${doc.filePath}\``,
    '',
    '---',
    '*Compiled by `stellavault compile`*',
  ].filter(Boolean).join('\n');
}

function generateIndex(docs: RawDocument[], concepts: Map<string, string[]>, articles: string[]): string {
  return [
    '---',
    'title: "Wiki Index"',
    `date: ${new Date().toISOString()}`,
    'type: wiki-index',
    '---',
    '',
    '# Wiki Index',
    '',
    `Compiled ${articles.length} wiki articles from ${docs.length} source documents.`,
    '',
    '## Concepts',
    ...[...concepts.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .map(([c, paths]) => `- [[_concept-${c}|${c}]] (${paths.length})`),
    '',
    '## Articles',
    ...docs.map(d => `- [[${d.title}]] — ${d.tags.map(t => `#${t}`).join(' ')}`),
    '',
    '---',
    `*Last compiled: ${new Date().toISOString()}*`,
    '*Generated by `stellavault compile`*',
  ].join('\n');
}
