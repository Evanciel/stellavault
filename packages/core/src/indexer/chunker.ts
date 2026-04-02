// Design Ref: §6.1 — Chunking Strategy (heading 기반 + 오버랩)

import type { Chunk } from '../types/chunk.js';

export interface ChunkOptions {
  maxTokens: number;   // default: 300
  overlap: number;     // default: 50
  minTokens: number;   // default: 50
}

const DEFAULT_OPTIONS: ChunkOptions = {
  maxTokens: 300,
  overlap: 50,
  minTokens: 50,
};

/**
 * 문서를 heading 기반으로 청킹합니다.
 * Step 1: heading 분할 → Step 2: 길이 검사 → Step 3: 메타데이터 → Step 4: 짧은 청크 병합
 */
export function chunkDocument(
  documentId: string,
  content: string,
  options: Partial<ChunkOptions> = {},
): Chunk[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const lines = content.split('\n');

  // Step 1: heading 기반 섹션 분할
  const sections = splitByHeadings(lines);

  // Step 2-3: 길이 검사 + 메타데이터
  const rawChunks: Chunk[] = [];
  for (const section of sections) {
    const tokenCount = estimateTokens(section.content);

    if (tokenCount <= opts.maxTokens) {
      rawChunks.push(makeChunk(documentId, rawChunks.length, section));
    } else {
      // 긴 섹션은 문장 단위로 재분할 + 오버랩
      const subChunks = splitByTokenLimit(section, opts.maxTokens, opts.overlap);
      for (const sub of subChunks) {
        rawChunks.push(makeChunk(documentId, rawChunks.length, sub));
      }
    }
  }

  // Step 4: 짧은 청크 병합
  return mergeShortChunks(rawChunks, opts.minTokens);
}

interface Section {
  heading: string;
  content: string;
  startLine: number;
  endLine: number;
}

function splitByHeadings(lines: string[]): Section[] {
  const sections: Section[] = [];
  let currentHeading = '';
  let currentLines: string[] = [];
  let startLine = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^#{1,6}\s/.test(line)) {
      if (currentLines.length > 0) {
        sections.push({
          heading: currentHeading,
          content: currentLines.join('\n').trim(),
          startLine,
          endLine: i - 1,
        });
      }
      currentHeading = line.replace(/^#{1,6}\s+/, '').trim();
      currentLines = [line];
      startLine = i;
    } else {
      currentLines.push(line);
    }
  }

  if (currentLines.length > 0) {
    sections.push({
      heading: currentHeading,
      content: currentLines.join('\n').trim(),
      startLine,
      endLine: lines.length - 1,
    });
  }

  return sections.filter(s => s.content.length > 0);
}

function splitByTokenLimit(section: Section, maxTokens: number, overlap: number): Section[] {
  const sentences = section.content.split(/(?<=[.!?。]\s)/);
  const results: Section[] = [];
  let current: string[] = [];
  let currentTokens = 0;

  for (const sentence of sentences) {
    const sentenceTokens = estimateTokens(sentence);
    if (currentTokens + sentenceTokens > maxTokens && current.length > 0) {
      results.push({
        heading: section.heading,
        content: current.join('').trim(),
        startLine: section.startLine,
        endLine: section.endLine,
      });
      // 오버랩: 마지막 문장들을 다음 청크에 포함
      const overlapText = getOverlapText(current, overlap);
      current = overlapText ? [overlapText, sentence] : [sentence];
      currentTokens = estimateTokens(current.join(''));
    } else {
      current.push(sentence);
      currentTokens += sentenceTokens;
    }
  }

  if (current.length > 0) {
    results.push({
      heading: section.heading,
      content: current.join('').trim(),
      startLine: section.startLine,
      endLine: section.endLine,
    });
  }

  return results;
}

function getOverlapText(sentences: string[], overlapTokens: number): string {
  let tokens = 0;
  const overlap: string[] = [];
  for (let i = sentences.length - 1; i >= 0; i--) {
    const t = estimateTokens(sentences[i]);
    if (tokens + t > overlapTokens) break;
    overlap.unshift(sentences[i]);
    tokens += t;
  }
  return overlap.join('');
}

function mergeShortChunks(chunks: Chunk[], minTokens: number): Chunk[] {
  if (chunks.length <= 1) return chunks;
  const result: Chunk[] = [];

  for (const chunk of chunks) {
    if (result.length > 0 && chunk.tokenCount < minTokens) {
      const prev = result[result.length - 1];
      prev.content += '\n\n' + chunk.content;
      prev.endLine = chunk.endLine;
      prev.tokenCount += chunk.tokenCount;
    } else {
      result.push({ ...chunk });
    }
  }

  return result;
}

function makeChunk(documentId: string, index: number, section: Section): Chunk {
  return {
    id: `${documentId}#${index}`,
    documentId,
    content: section.content,
    heading: section.heading,
    startLine: section.startLine,
    endLine: section.endLine,
    tokenCount: estimateTokens(section.content),
  };
}

/** 간단한 토큰 수 추정 (영어: ~4chars/token, 한국어: ~2chars/token) */
export function estimateTokens(text: string): number {
  const koreanChars = (text.match(/[가-힣]/g) || []).length;
  const otherChars = text.length - koreanChars;
  return Math.ceil(koreanChars / 2 + otherChars / 4);
}
