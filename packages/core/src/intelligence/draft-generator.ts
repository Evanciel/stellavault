// Express 단계: stellavault draft — wiki 기반 초안 생성
// Plan SC: SC3 (Express)
// 카파시의 "자가 컴파일" 결과물을 외부로 표현하는 출구

import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve, basename, extname } from 'node:path';
import { scanRawDirectory, extractConcepts, type RawDocument } from './wiki-compiler.js';
import { DEFAULT_FOLDERS, type FolderNames } from '../config.js';

export interface DraftOptions {
  topic?: string;       // 특정 토픽/태그 기반 필터
  format?: 'blog' | 'report' | 'outline' | 'instagram' | 'thread' | 'script';
  maxSections?: number;
}

export interface DraftResult {
  title: string;
  filePath: string;
  wordCount: number;
  sourceCount: number;  // 참조한 원본 문서 수
  concepts: string[];
}

/**
 * vault의 wiki 데이터를 기반으로 초안(draft)을 생성.
 * Express 단계: 지식이 vault에서 나가는 출구.
 */
export function generateDraft(
  vaultPath: string,
  options: DraftOptions = {},
  folders: FolderNames = DEFAULT_FOLDERS,
): DraftResult {
  const { topic, format = 'blog', maxSections = 8 } = options;

  // raw + wiki 문서 스캔
  const rawDir = resolve(vaultPath, folders.fleeting);
  const wikiDir = resolve(vaultPath, folders.wiki);
  const litDir = resolve(vaultPath, folders.literature);

  const allDocs: RawDocument[] = [];
  for (const dir of [rawDir, wikiDir, litDir]) {
    if (existsSync(dir)) {
      allDocs.push(...scanRawDirectory(dir));
    }
  }

  if (allDocs.length === 0) {
    throw new Error('No documents found in vault. Run `stellavault ingest` first.');
  }

  // 토픽 필터
  const filteredDocs = topic
    ? allDocs.filter(d =>
        d.tags.some(t => t.toLowerCase().includes(topic.toLowerCase())) ||
        d.title.toLowerCase().includes(topic.toLowerCase()) ||
        d.content.toLowerCase().includes(topic.toLowerCase())
      )
    : allDocs;

  if (filteredDocs.length === 0) {
    throw new Error(`No documents found for topic "${topic}". Try a broader term.`);
  }

  // 개념 추출
  const concepts = extractConcepts(filteredDocs);
  const topConcepts = [...concepts.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, maxSections);

  // 초안 생성
  const draftTitle = topic
    ? `Draft: ${topic}`
    : `Knowledge Draft — ${new Date().toISOString().split('T')[0]}`;

  let body: string;
  switch (format) {
    case 'outline':
      body = generateOutline(draftTitle, topConcepts, filteredDocs);
      break;
    case 'report':
      body = generateReport(draftTitle, topConcepts, filteredDocs);
      break;
    case 'instagram':
      body = generateInstagram(draftTitle, topConcepts, filteredDocs);
      break;
    case 'thread':
      body = generateThread(draftTitle, topConcepts, filteredDocs);
      break;
    case 'script':
      body = generateScript(draftTitle, topConcepts, filteredDocs);
      break;
    case 'blog':
    default:
      body = generateBlog(draftTitle, topConcepts, filteredDocs);
      break;
  }

  const wordCount = body.split(/\s+/).filter(Boolean).length;

  // _drafts/ 폴더에 저장
  const draftsDir = resolve(vaultPath, '_drafts');
  if (!existsSync(draftsDir)) mkdirSync(draftsDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const slug = (topic ?? 'knowledge').replace(/[^a-zA-Z0-9가-힣\s]/g, '').replace(/\s+/g, '-').toLowerCase().slice(0, 40);
  const filename = `${timestamp}-${slug}.md`;
  const filePath = join('_drafts', filename);
  const fullPath = resolve(vaultPath, filePath);

  writeFileSync(fullPath, body, 'utf-8');

  return {
    title: draftTitle,
    filePath,
    wordCount,
    sourceCount: filteredDocs.length,
    concepts: topConcepts.map(([c]) => c),
  };
}

// ─── 포맷별 생성기 ───

function generateBlog(title: string, concepts: [string, string[]][], docs: RawDocument[]): string {
  const lines: string[] = [];

  lines.push(`# ${title}`, '');
  lines.push(`> Auto-generated from ${docs.length} knowledge notes`, '');

  // 도입부: 전체 주제 요약
  lines.push('## Introduction', '');
  const topicWords = concepts.slice(0, 3).map(([c]) => c).join(', ');
  lines.push(`This post explores ${topicWords} based on ${docs.length} curated knowledge notes.`, '');

  // 섹션별: 개념 + 관련 문서 발췌
  for (const [concept, docPaths] of concepts) {
    lines.push(`## ${capitalize(concept)}`, '');

    const relatedDocs = docs.filter(d =>
      docPaths.includes(d.filePath) ||
      d.tags.includes(concept) ||
      d.title.toLowerCase().includes(concept.toLowerCase())
    ).slice(0, 3);

    for (const doc of relatedDocs) {
      const excerpt = extractExcerpt(doc.content, 150);
      if (excerpt) {
        lines.push(`> ${excerpt}`, `> — *${doc.title}*`, '');
      }
    }

    lines.push('<!-- TODO: Add your analysis and insights here -->', '');
  }

  // 참고 자료 (APA-style citations)
  lines.push('## References', '');
  const uniqueDocs = [...new Map(docs.map(d => [d.filePath, d])).values()].slice(0, 20);
  const now = new Date();
  for (let i = 0; i < uniqueDocs.length; i++) {
    const doc = uniqueDocs[i];
    const dateMatch = doc.content.match(/(?:created|date):\s*(\d{4}-\d{2}-\d{2})/);
    const year = dateMatch ? dateMatch[1].split('-')[0] : now.getFullYear().toString();
    const sourceMatch = doc.content.match(/source:\s*(.+)/);
    const source = sourceMatch ? sourceMatch[1].trim() : '';

    // APA-style: Author/Title (Year). Source.
    if (source.startsWith('http')) {
      lines.push(`[${i + 1}] ${doc.title} (${year}). Retrieved from ${source}`);
    } else {
      lines.push(`[${i + 1}] ${doc.title} (${year}). [[${basename(doc.filePath, extname(doc.filePath))}|Link]]`);
    }
  }
  lines.push('');

  lines.push(`---`, `*Generated by \`stellavault draft\` at ${new Date().toISOString()}*`);

  return lines.join('\n');
}

function generateReport(title: string, concepts: [string, string[]][], docs: RawDocument[]): string {
  const lines: string[] = [];

  lines.push(`# ${title}`, '');
  lines.push(`**Date:** ${new Date().toISOString().split('T')[0]}`);
  lines.push(`**Sources:** ${docs.length} documents`);
  lines.push(`**Key Topics:** ${concepts.map(([c]) => c).join(', ')}`, '');

  lines.push('## Executive Summary', '');
  lines.push('<!-- TODO: Write 2-3 sentence summary -->', '');

  for (const [concept, docPaths] of concepts) {
    lines.push(`## ${capitalize(concept)}`, '');
    lines.push(`**Related documents:** ${docPaths.length}`, '');

    const relatedDocs = docs.filter(d => docPaths.includes(d.filePath)).slice(0, 3);
    for (const doc of relatedDocs) {
      const excerpt = extractExcerpt(doc.content, 200);
      if (excerpt) lines.push(`- ${excerpt} *(${doc.title})*`);
    }
    lines.push('');
    lines.push('**Analysis:** <!-- TODO -->', '');
  }

  lines.push('## Conclusion', '', '<!-- TODO -->', '');
  lines.push(`---`, `*Generated by \`stellavault draft\` at ${new Date().toISOString()}*`);

  return lines.join('\n');
}

function generateOutline(title: string, concepts: [string, string[]][], docs: RawDocument[]): string {
  const lines: string[] = [];

  lines.push(`# ${title} — Outline`, '');
  lines.push(`Sources: ${docs.length} documents`, '');

  for (let i = 0; i < concepts.length; i++) {
    const [concept, docPaths] = concepts[i];
    lines.push(`${i + 1}. **${capitalize(concept)}** (${docPaths.length} sources)`);
    const relatedDocs = docs.filter(d => docPaths.includes(d.filePath)).slice(0, 3);
    for (const doc of relatedDocs) {
      lines.push(`   - ${doc.title}`);
    }
  }

  lines.push('', `---`, `*Generated by \`stellavault draft\` at ${new Date().toISOString()}*`);
  return lines.join('\n');
}

// ─── SNS 포맷 ───

function generateInstagram(title: string, concepts: [string, string[]][], docs: RawDocument[]): string {
  const lines: string[] = [];
  const topicWords = concepts.slice(0, 3).map(([c]) => c);

  lines.push(`${title}`, '');
  lines.push('---', '');

  // 슬라이드 1: Hook
  lines.push('**Slide 1 (Hook)**', '');
  lines.push(`Did you know about ${topicWords.join(', ')}?`, '');

  // 슬라이드 2-4: Key Points
  for (let i = 0; i < Math.min(3, concepts.length); i++) {
    const [concept] = concepts[i];
    const doc = docs.find(d => d.tags.includes(concept) || d.title.toLowerCase().includes(concept.toLowerCase()));
    const excerpt = doc ? extractExcerpt(doc.content, 80) : '';
    lines.push(`**Slide ${i + 2} (${capitalize(concept)})**`, '');
    lines.push(excerpt || `Key insight about ${concept}`, '');
  }

  // CTA
  lines.push('**Last Slide (CTA)**', '');
  lines.push('Save this for later! Follow for more knowledge drops.', '');

  // Caption
  lines.push('---', '', '**Caption:**', '');
  lines.push(`${topicWords.map(w => `#${w}`).join(' ')} #knowledge #secondbrain #stellavault`, '');
  lines.push(`---`, `*Generated by \`stellavault draft --format instagram\`*`);
  return lines.join('\n');
}

function generateThread(title: string, concepts: [string, string[]][], docs: RawDocument[]): string {
  const lines: string[] = [];

  // Tweet 1: Hook
  lines.push(`**1/** ${title}`, '');
  lines.push(`Here's what I learned from ${docs.length} sources:`, '');

  // Tweet 2-N: One per concept
  for (let i = 0; i < Math.min(6, concepts.length); i++) {
    const [concept, docPaths] = concepts[i];
    const doc = docs.find(d => docPaths.includes(d.filePath));
    const excerpt = doc ? extractExcerpt(doc.content, 200) : '';
    lines.push(`**${i + 2}/** ${capitalize(concept)}`, '');
    lines.push(excerpt || `Key point about ${concept}`, '');
  }

  // Final tweet
  lines.push(`**${Math.min(6, concepts.length) + 2}/** That's a wrap!`, '');
  lines.push('If this was useful, repost the first tweet.', '');
  lines.push(`---`, `*Generated by \`stellavault draft --format thread\`*`);
  return lines.join('\n');
}

function generateScript(title: string, concepts: [string, string[]][], docs: RawDocument[]): string {
  const lines: string[] = [];

  lines.push(`# ${title} — Video Script`, '');
  lines.push(`**Duration:** ~${Math.max(3, concepts.length * 2)} minutes`, '');

  // Intro
  lines.push('## Intro (30s)', '');
  lines.push(`"Hey everyone, today we're diving into ${concepts.slice(0, 2).map(([c]) => c).join(' and ')}."`, '');

  // Sections
  for (let i = 0; i < Math.min(5, concepts.length); i++) {
    const [concept, docPaths] = concepts[i];
    const relatedDocs = docs.filter(d => docPaths.includes(d.filePath)).slice(0, 2);
    lines.push(`## Section ${i + 1}: ${capitalize(concept)} (~${Math.max(1, Math.floor(relatedDocs.length))}min)`, '');
    for (const doc of relatedDocs) {
      const excerpt = extractExcerpt(doc.content, 150);
      if (excerpt) lines.push(`[Visual: ${doc.title}]`, excerpt, '');
    }
  }

  // Outro
  lines.push('## Outro (15s)', '');
  lines.push('"If you found this helpful, like and subscribe!"', '');
  lines.push(`---`, `*Generated by \`stellavault draft --format script\`*`);
  return lines.join('\n');
}

// ─── 유틸 ───

function extractExcerpt(content: string, maxLen: number): string {
  // frontmatter 제거
  const body = content.replace(/^---[\s\S]*?---\n?/, '').replace(/^#+\s+.+\n/m, '').trim();
  // 첫 의미 있는 문단
  const paragraphs = body.split(/\n\n+/).filter(p => p.length > 20 && !p.startsWith('> ') && !p.startsWith('- '));
  const first = paragraphs[0] ?? '';
  return first.length > maxLen ? first.slice(0, maxLen) + '...' : first;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
