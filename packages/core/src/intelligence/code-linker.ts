// Design Ref: F15 — 코드-지식 링커
// 코드 파일/함수에서 키워드 추출 → 관련 노트 자동 매칭
// Plan SC: SC-03 코드 파일에서 관련 노트 3개+ 반환

import type { SearchEngine } from '../search/index.js';
import type { SearchResult } from '../types/search.js';

export interface CodeLink {
  filePath: string;
  keywords: string[];
  relatedNotes: Array<{
    documentId: string;
    title: string;
    score: number;
    matchedKeywords: string[];
  }>;
}

/**
 * Extract meaningful keywords from a code file path and optional content.
 */
export function extractCodeKeywords(filePath: string, content?: string): string[] {
  const keywords = new Set<string>();

  // From file path: directory names + file name parts
  const skipParts = new Set(['src', 'lib', 'dist', 'node_modules', '.', '']);
  const parts = filePath
    .replace(/\\/g, '/')
    .split('/')
    .filter((p) => !skipParts.has(p));

  for (const part of parts) {
    // Split camelCase/PascalCase/kebab-case/snake_case
    const words = part
      .replace(/\.[^.]+$/, '') // remove extension
      .replace(/([a-z])([A-Z])/g, '$1 $2') // camelCase split
      .replace(/[-_]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2)
      .map((w) => w.toLowerCase());
    words.forEach((w) => keywords.add(w));
  }

  // From content: extract identifiers and comments
  if (content) {
    // Extract import statements
    const imports = content.match(/import\s+.*?from\s+['"]([^'"]+)['"]/g) ?? [];
    for (const imp of imports) {
      const match = imp.match(/from\s+['"]([^'"]+)['"]/);
      if (match) {
        const modName = match[1].split('/').pop()?.replace(/\.[^.]+$/, '') ?? '';
        if (modName.length > 2) keywords.add(modName.toLowerCase());
      }
    }

    // Extract TODO/FIXME comments
    const comments = content.match(/\/\/\s*(TODO|FIXME|NOTE):\s*(.+)/gi) ?? [];
    for (const c of comments) {
      const words = c.replace(/\/\/\s*(TODO|FIXME|NOTE):\s*/i, '').split(/\s+/);
      words.filter((w) => w.length > 3).forEach((w) => keywords.add(w.toLowerCase()));
    }

    // Extract function/class names
    const funcNames = content.match(/(?:function|class|const|let|var)\s+([A-Za-z]\w{3,})/g) ?? [];
    for (const fn of funcNames) {
      const name = fn.split(/\s+/)[1];
      if (name) {
        // Split camelCase
        const words = name.replace(/([a-z])([A-Z])/g, '$1 $2').split(/\s+/);
        words.filter((w) => w.length > 2).forEach((w) => keywords.add(w.toLowerCase()));
      }
    }
  }

  // Remove common noise words
  const noise = new Set(['the', 'and', 'for', 'with', 'from', 'this', 'that', 'not', 'but', 'are', 'was', 'has', 'have', 'new', 'get', 'set', 'use', 'type', 'void', 'null', 'true', 'false', 'return', 'async', 'await', 'export', 'default', 'import', 'const', 'string', 'number', 'boolean', 'interface', 'function', 'index', 'main', 'app', 'test', 'spec', 'utils', 'helpers']);
  return [...keywords].filter((k) => !noise.has(k)).slice(0, 20);
}

/**
 * Link a code file to related knowledge notes via keyword search.
 */
export async function linkCodeToKnowledge(
  searchEngine: SearchEngine,
  filePath: string,
  content?: string,
  limit = 5,
): Promise<CodeLink> {
  const keywords = extractCodeKeywords(filePath, content);

  if (keywords.length === 0) {
    return { filePath, keywords: [], relatedNotes: [] };
  }

  // Search using top keywords as query
  const query = keywords.slice(0, 8).join(' ');
  const results: SearchResult[] = await searchEngine.search({
    query,
    limit: limit * 2,
    threshold: 0.1,
  });

  // Score which keywords matched in each result
  const relatedNotes = results.slice(0, limit).map((r) => {
    const titleLower = r.document.title.toLowerCase();
    const contentLower = r.chunk.content.toLowerCase();
    const matchedKeywords = keywords.filter(
      (k) => titleLower.includes(k) || contentLower.includes(k) || r.document.tags.some((t) => t.toLowerCase().includes(k))
    );

    return {
      documentId: r.document.id,
      title: r.document.title,
      score: r.score,
      matchedKeywords,
    };
  });

  return { filePath, keywords, relatedNotes };
}
