// Auto-Linker: 노트 본문에서 기존 노트 제목과 매칭하여 [[wikilink]] 자동 삽입
// 제텔카스텐 핵심: 노트 간 연결이 지식 네트워크를 만든다

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve, extname } from 'node:path';
import { DEFAULT_FOLDERS, type FolderNames } from '../config.js';

/**
 * vault의 모든 .md 노트 제목을 수집.
 * frontmatter title 또는 첫 heading 또는 파일명.
 */
export function collectVaultTitles(vaultPath: string, folders: FolderNames = DEFAULT_FOLDERS): string[] {
  const titles = new Set<string>();
  const dirs = [folders.fleeting, folders.literature, folders.permanent, folders.wiki, '_drafts'];

  for (const dir of dirs) {
    const fullDir = resolve(vaultPath, dir);
    if (!existsSync(fullDir)) continue;

    try {
      const files = readdirSync(fullDir).filter(f => extname(f) === '.md');
      for (const file of files) {
        try {
          const content = readFileSync(join(fullDir, file), 'utf-8');
          // frontmatter title
          const titleMatch = content.match(/^title:\s*"?([^"\n]+)"?\s*$/m);
          if (titleMatch && titleMatch[1].length > 2) {
            titles.add(titleMatch[1].trim());
            continue;
          }
          // first heading
          const headingMatch = content.match(/^#\s+(.+)$/m);
          if (headingMatch && headingMatch[1].length > 2) {
            titles.add(headingMatch[1].trim());
            continue;
          }
          // filename without extension + timestamp prefix
          const name = file.replace(/^\d{4}-\d{2}-\d{2}T[\d-]+-/, '').replace(/\.md$/, '').replace(/-/g, ' ');
          if (name.length > 2) titles.add(name);
        } catch { /* skip unreadable files */ }
      }
    } catch { /* dir not readable */ }
  }

  return [...titles].filter(t => t.length > 3); // ignore very short titles
}

/**
 * 제목에서 링크 가능한 핵심 구문(phrases)을 추출.
 * 예: "Steve Jobs' 2005 Stanford Commencement Address"
 * → ["Steve Jobs", "Stanford Commencement Address", "Stanford"]
 */
function extractLinkablePhrases(title: string): string[] {
  const phrases: string[] = [];

  // 전체 제목 (짧으면)
  if (title.length <= 40) phrases.push(title);

  // 고유명사/핵심 구문 추출: 대문자로 시작하는 연속 단어
  const properNouns = title.match(/[A-Z\uAC00-\uD7A3][a-z\uAC00-\uD7A3]+(?:\s+[A-Z\uAC00-\uD7A3][a-z\uAC00-\uD7A3]+)*/g);
  if (properNouns) {
    for (const pn of properNouns) {
      if (pn.length > 4) phrases.push(pn);
    }
  }

  // 한국어: 긴 제목에서 의미 있는 부분 (4글자 이상 한글 연속)
  const koreanPhrases = title.match(/[\uAC00-\uD7A3]{4,}/g);
  if (koreanPhrases) phrases.push(...koreanPhrases);

  return [...new Set(phrases)].filter(p => p.length > 3);
}

/**
 * 노트 본문에서 기존 노트 제목/핵심 구문과 매칭하여 [[wikilink]]를 삽입.
 * - 이미 [[...]]로 감싸진 부분은 건드리지 않음
 * - frontmatter 영역은 건드리지 않음
 * - 자기 자신의 제목은 건드리지 않음
 * - heading(#) 줄은 건드리지 않음
 */
export function insertWikilinks(body: string, vaultTitles: string[], selfTitle?: string): string {
  if (vaultTitles.length === 0) return body;

  // frontmatter 분리
  const fmMatch = body.match(/^(---[\s\S]*?---\n?)/);
  const frontmatter = fmMatch ? fmMatch[1] : '';
  let content = fmMatch ? body.slice(frontmatter.length) : body;

  // 제목 → 링크 가능 구문 매핑
  const phraseToTitle = new Map<string, string>();
  for (const title of vaultTitles) {
    if (title === selfTitle) continue;
    for (const phrase of extractLinkablePhrases(title)) {
      if (!phraseToTitle.has(phrase)) {
        phraseToTitle.set(phrase, title);
      }
    }
  }

  // 긴 구문부터 매칭 (짧은 구문이 긴 구문의 부분 매칭되는 것 방지)
  const sortedPhrases = [...phraseToTitle.keys()].sort((a, b) => b.length - a.length);
  const linkedPhrases = new Set<string>(); // 이미 링크된 구문 (중복 방지)

  const contentLower = content.toLowerCase();
  for (const phrase of sortedPhrases) {
    const targetTitle = phraseToTitle.get(phrase)!;
    if (linkedPhrases.has(targetTitle)) continue;

    // 사전 필터: 본문에 포함되지 않으면 regex 생성 스킵 (성능 최적화)
    if (!contentLower.includes(phrase.toLowerCase())) continue;

    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(
      `(?<!\\[\\[)(?<!#\\s)\\b(${escaped})\\b(?!\\]\\])(?![^\\[]*\\]\\])`,
      'gi'
    );

    let replaced = false;
    content = content.replace(regex, (match) => {
      if (replaced) return match;
      replaced = true;
      linkedPhrases.add(targetTitle);
      return `[[${targetTitle}|${match}]]`;
    });
  }

  return frontmatter + content;
}

/**
 * vault 스캔 + wikilink 삽입을 한 번에 수행하는 편의 함수.
 */
export function autoLink(
  body: string,
  vaultPath: string,
  selfTitle?: string,
  folders: FolderNames = DEFAULT_FOLDERS,
): string {
  const titles = collectVaultTitles(vaultPath, folders);
  return insertWikilinks(body, titles, selfTitle);
}
