// Feature: stellavault ask — Q&A + auto-filing
// vault 대상 자연어 질문 → 검색 → 답변 구조화 → vault에 .md 저장

import type { SearchEngine } from '../search/index.js';
import type { SearchResult } from '../types/search.js';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

export interface AskResult {
  question: string;
  answer: string;
  sources: Array<{ title: string; filePath: string; score: number; snippet: string }>;
  savedTo: string | null; // vault에 저장된 경로 (null이면 미저장)
}

// ─── T3-2: pluggable Synthesizer ─────────────────────────────────────────────
// askVault is extractive by default (no API key → search-list summary, see
// composeAnswer). A Synthesizer lets a caller (the desktop main process) inject a
// real LLM that turns the retrieved sources into a synthesized, cited answer.
// The interface is intentionally provider-agnostic: core never imports an LLM SDK
// or holds an API key. The desktop wires an Anthropic-backed implementation; the
// no-key path stays the extractive fallback. The synthesizer receives the already
// retrieved sources (title + snippet) so it can ground its answer and cite them.

/** One retrieved source handed to a Synthesizer. */
export interface SynthesisSource {
  title: string;
  filePath: string;
  snippet: string;   // chunk/document excerpt used for grounding
  score: number;
}

/** Pluggable LLM synthesizer. Returns the synthesized answer text (markdown).
 *  Implementations MUST ground the answer in `sources` and SHOULD cite notes as
 *  [[Title]] wikilinks so the desktop can render clickable backlinks. */
export interface Synthesizer {
  synthesize(input: {
    question: string;
    sources: SynthesisSource[];
    /** Optional: 'ask' (Q&A) or 'wiki' (compiled article on a topic). */
    mode?: 'ask' | 'wiki';
  }): Promise<string>;
}

/**
 * 질문에 대해 vault를 검색하고 구조화된 답변을 생성.
 * LLM 없이 검색 결과를 구조화하는 버전 (LLM 연동은 MCP ask tool에서 처리).
 */
export async function askVault(
  searchEngine: SearchEngine,
  question: string,
  options: {
    limit?: number;
    save?: boolean;
    vaultPath?: string;
    outputDir?: string;
    mode?: 'default' | 'quotes';
    // T3-2: optional LLM synthesizer. When provided (an API key is configured),
    // the answer is synthesized + cited instead of the extractive search-list.
    // Failure inside the synthesizer falls back to the extractive composeAnswer.
    synthesizer?: Synthesizer;
  } = {},
): Promise<AskResult> {
  const { limit = 10, save = false, vaultPath, outputDir = '_stellavault/answers', mode = 'default', synthesizer } = options;

  // 1. 검색
  const results = await searchEngine.search({ query: question, limit });

  // 2. 소스 정리
  const sources = results.map((r) => ({
    title: r.document.title,
    filePath: r.document.filePath,
    score: Math.round(r.score * 1000) / 1000,
    snippet: r.chunk?.content?.substring(0, 200) ?? '',
  }));

  // 3. 답변 구성 — synthesizer가 있으면 LLM 합성, 없으면(또는 실패 시) 추출형 폴백
  let answer: string;
  if (synthesizer && results.length > 0 && mode !== 'quotes') {
    try {
      answer = await synthesizer.synthesize({ question, sources, mode: 'ask' });
    } catch {
      // LLM 실패 → 추출형 폴백 (no-key 경로와 동일). 호출자에 에러를 던지지 않음.
      answer = composeAnswer(question, results);
    }
  } else {
    answer = mode === 'quotes'
      ? composeQuotes(question, results)
      : composeAnswer(question, results);
  }

  // 4. vault에 저장 (선택)
  let savedTo: string | null = null;
  if (save && vaultPath) {
    savedTo = saveAnswerToVault(question, answer, sources, vaultPath, outputDir);
  }

  return { question, answer, sources, savedTo };
}

/**
 * 검색 결과를 구조화된 답변으로 구성.
 * LLM 없이도 유용한 요약을 만듦.
 */
function composeAnswer(question: string, results: SearchResult[]): string {
  if (results.length === 0) {
    return `No results found for "${question}". Try different keywords or create a note on this topic.`;
  }

  const lines: string[] = [];
  lines.push(`## ${question}\n`);

  // Related documents
  lines.push(`### Related Documents (${results.length})\n`);
  for (const r of results.slice(0, 5)) {
    const score = Math.round(r.score * 100);
    lines.push(`- **${r.document.title}** (${score}% 관련)`);
    if (r.chunk?.content) {
      const snippet = r.chunk.content.substring(0, 150).replace(/\n/g, ' ').trim();
      lines.push(`  > ${snippet}...`);
    }
    if (r.document.tags.length > 0) {
      lines.push(`  Tags: ${r.document.tags.map(t => `#${t}`).join(' ')}`);
    }
    lines.push('');
  }

  // Related tags
  const allTags = new Set<string>();
  for (const r of results) {
    r.document.tags.forEach((t) => allTags.add(t));
  }
  if (allTags.size > 0) {
    lines.push(`### Related Tags`);
    lines.push([...allTags].map(t => `#${t}`).join(' '));
    lines.push('');
  }

  // Explore further
  lines.push(`### Explore Further`);
  lines.push(`- Dig deeper: \`stellavault ask "${question} advanced"\``);
  lines.push(`- Find knowledge gaps: \`stellavault gaps\``);

  return lines.join('\n');
}

/**
 * Quotes 모드: 원문 인용을 카드 형태로 나열.
 */
function composeQuotes(question: string, results: SearchResult[]): string {
  if (results.length === 0) {
    return `No quotes found for "${question}".`;
  }
  const lines: string[] = [];
  lines.push(`## Quotes: "${question}"\n`);
  lines.push(`*${results.length} sources found. Each quote is a direct excerpt.*\n`);

  for (let i = 0; i < Math.min(8, results.length); i++) {
    const r = results[i];
    const quote = r.chunk?.content
      ?.replace(/^---[\s\S]*?---\n?/, '')
      ?.replace(/^#+\s+.+\n/m, '')
      ?.trim()
      ?.substring(0, 300) ?? '';
    if (!quote) continue;

    const score = Math.round(r.score * 100);
    lines.push(`---`);
    lines.push(`**[${i + 1}] ${r.document.title}** (${score}% match)`);
    lines.push(`> ${quote.replace(/\n/g, '\n> ')}`);
    if (r.document.tags.length > 0) {
      lines.push(`Tags: ${r.document.tags.slice(0, 5).map(t => `#${t}`).join(' ')}`);
    }
    lines.push('');
  }

  lines.push('---');
  lines.push(`*Use \`stellavault ask "${question}" --save\` to save these quotes as a note.*`);
  return lines.join('\n');
}

/**
 * 답변을 vault에 .md 파일로 저장.
 * "_stellavault/answers/YYYY-MM-DD-question.md" 형식.
 */
function saveAnswerToVault(
  question: string,
  answer: string,
  sources: AskResult['sources'],
  vaultPath: string,
  outputDir: string,
): string {
  const dir = resolve(vaultPath, outputDir);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const date = new Date().toISOString().split('T')[0];
  const slug = question
    .toLowerCase()
    .replace(/[^a-z0-9가-힣\s]/g, '')
    .replace(/\s+/g, '-')
    .substring(0, 60);
  const filename = `${date}-${slug}.md`;
  const filePath = join(outputDir, filename);
  const fullPath = resolve(vaultPath, filePath);

  // vault 경로 내인지 확인 (path traversal 방지)
  if (!fullPath.startsWith(resolve(vaultPath))) {
    throw new Error('Invalid output path');
  }

  const content = [
    '---',
    `title: "${question}"`,
    `date: ${new Date().toISOString()}`,
    'type: answer',
    'source: stellavault-ask',
    `tags: [${sources.slice(0, 5).flatMap(s => s.title.split(/\s+/).slice(0, 2)).map(t => `"${t}"`).join(', ')}]`,
    '---',
    '',
    answer,
    '',
    '---',
    '*Generated by `stellavault ask`. Sources from your vault.*',
  ].join('\n');

  writeFileSync(fullPath, content, 'utf-8');
  return filePath;
}
