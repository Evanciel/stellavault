import { describe, it, expect } from 'vitest';
import { extractEntities, extractQueryTerms } from '../src/indexer/entity-extractor.js';

describe('extractEntities (index-time)', () => {
  it('extracts wikilink targets, stripping alias and section', () => {
    const e = extractEntities({
      content: 'See [[Reciprocal Rank Fusion]] and [[FSRS|the scheduler]] and [[Zettelkasten#method]].',
    });
    expect(e).toContain('reciprocal rank fusion');
    expect(e).toContain('fsrs');
    expect(e).toContain('zettelkasten');
  });

  it('includes tags (doc + inline) normalized', () => {
    const e = extractEntities({
      content: 'note about #knowledge-management here',
      tags: ['React', 'spaced/repetition'],
    });
    expect(e).toContain('react');
    expect(e).toContain('spaced repetition');
    expect(e).toContain('knowledge management');
  });

  it('includes heading and title', () => {
    const e = extractEntities({ content: 'body', heading: 'OAuth Flow', title: 'Auth Design' });
    expect(e).toContain('oauth flow');
    expect(e).toContain('auth design');
  });

  it('detects Title-Case phrases and acronyms as fallback', () => {
    const e = extractEntities({ content: 'Uses the Model Context Protocol (MCP) to connect tools.' });
    expect(e).toContain('model context protocol');
    expect(e).toContain('mcp');
  });

  it('dedupes and caps at 30', () => {
    const many = Array.from({ length: 50 }, (_, i) => `[[Entity ${i}]]`).join(' ');
    const e = extractEntities({ content: many });
    expect(e.length).toBeLessThanOrEqual(30);
  });

  it('handles Korean wikilinks/tags/heading (no Title-Case needed)', () => {
    const e = extractEntities({ content: '[[지식 관리]] 관련 메모', tags: ['옵시디언'], heading: '제텔카스텐' });
    expect(e).toContain('지식 관리');
    expect(e).toContain('옵시디언');
    expect(e).toContain('제텔카스텐');
  });

  it('filters stopwords', () => {
    const e = extractEntities({ content: 'the and for' });
    expect(e).not.toContain('the');
    expect(e).not.toContain('and');
  });
});

describe('extractQueryTerms (query-time)', () => {
  it('generates lowercase n-grams for multi-word phrases', () => {
    const t = extractQueryTerms('Reciprocal Rank Fusion');
    expect(t).toContain('reciprocal rank fusion');
    expect(t).toContain('reciprocal');
    expect(t).toContain('rank fusion');
  });

  it('works on lowercase queries (Title-Case independent)', () => {
    const t = extractQueryTerms('how does reciprocal rank fusion work');
    expect(t).toContain('reciprocal rank fusion');
  });

  it('captures acronyms and wikilinks', () => {
    const t = extractQueryTerms('explain FSRS and [[Zettelkasten]]');
    expect(t).toContain('fsrs');
    expect(t).toContain('zettelkasten');
  });

  it('drops pure-stopword grams', () => {
    const t = extractQueryTerms('what is the');
    expect(t).not.toContain('the');
    expect(t).not.toContain('what is the');
  });

  it('tokenizes Korean queries', () => {
    const t = extractQueryTerms('지식 관리 방법');
    expect(t).toContain('지식');
    expect(t).toContain('지식 관리');
  });
});
