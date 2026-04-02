import { describe, it, expect } from 'vitest';
import { chunkDocument, estimateTokens } from '../src/indexer/chunker.js';

describe('estimateTokens', () => {
  it('영문 토큰 추정', () => {
    expect(estimateTokens('hello world')).toBe(3);
  });

  it('한국어 토큰 추정', () => {
    expect(estimateTokens('안녕하세요')).toBe(3);
  });

  it('빈 문자열', () => {
    expect(estimateTokens('')).toBe(0);
  });
});

describe('chunkDocument', () => {
  it('짧은 문서는 1개 청크', () => {
    const chunks = chunkDocument('doc1', '# Title\n\nShort content.');
    expect(chunks.length).toBe(1);
    expect(chunks[0].documentId).toBe('doc1');
    expect(chunks[0].id).toBe('doc1#0');
  });

  it('heading으로 분할', () => {
    const md = '# Title\n\nIntro.\n\n## A\n\n' + 'Content A. '.repeat(50) + '\n\n## B\n\n' + 'Content B. '.repeat(50);
    const chunks = chunkDocument('doc2', md);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
  });

  it('빈 문서는 빈 배열', () => {
    const chunks = chunkDocument('doc3', '');
    expect(chunks).toEqual([]);
  });

  it('heading 없는 문서도 처리', () => {
    const chunks = chunkDocument('doc4', 'Just plain text without headings.');
    expect(chunks.length).toBe(1);
  });

  it('짧은 청크 병합', () => {
    const md = '## A\n\nHi\n\n## B\n\nBye';
    const chunks = chunkDocument('doc5', md, { minTokens: 50 });
    // 둘 다 50 토큰 미만이므로 병합됨
    expect(chunks.length).toBe(1);
  });
});
