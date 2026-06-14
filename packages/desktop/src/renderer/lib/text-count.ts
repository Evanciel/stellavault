// Word / character counting that is correct for a Korean-first vault (T1-6).
//
// The old StatusBar did `content.split(/\s+/)` over the entire RAW markdown
// (frontmatter + syntax included). For CJK that yields ~1 "word" per line
// (no spaces), and it counts YAML/`#`/`[[ ]]` noise as content. This module
// strips the frontmatter block + common markdown tokens, then counts words
// with a script-aware rule:
//   - CJK runs are counted per-segment via Intl.Segmenter(granularity:'word')
//     when available (each Han/Hangul/Kana token ≈ one word), falling back to
//     one word per CJK codepoint.
//   - Latin/other text is counted by whitespace runs.
//
// Pure + dependency-free so it is unit-testable in isolation.
//
// NOTE: keep this module free of relative imports / DOM access — it may be
// imported directly by node-based tests.

// CJK ranges: Hangul (syllables + jamo), CJK Unified Ideographs (+ Ext A),
// Hiragana, Katakana, CJK symbols. The class body (no brackets) is reused to
// build single-char, global, run, and non-run matchers consistently.
const CJK_CLASS = '가-힣ᄀ-ᇿ㄰-㆏㐀-䶿一-鿿぀-ゟ゠-ヿ　-〿ｦ-ﾝ';
const CJK_GLOBAL = new RegExp(`[${CJK_CLASS}]`, 'g');
// Tokenizer: a maximal CJK run (group 1) OR a maximal non-CJK run (group 2).
const TOKEN_RE = new RegExp(`([${CJK_CLASS}]+)|([^${CJK_CLASS}]+)`, 'g');

/** Strip a leading YAML frontmatter block (`---\n…\n---`). */
export function stripFrontmatter(src: string): string {
  // Allow an optional leading BOM / blank lines before the opening fence.
  const m = /^﻿?\s*---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(src);
  return m ? src.slice(m[0].length) : src;
}

/**
 * Remove markdown syntax that should not count toward prose: fenced code,
 * inline code, images/links chrome, headings/list/quote markers, emphasis,
 * wikilink brackets, and HTML tags. Link/wikilink *text* is preserved.
 */
export function stripMarkdownSyntax(src: string): string {
  return src
    // Fenced code blocks (``` or ~~~) — drop entirely.
    .replace(/^(```|~~~)[^\n]*\n[\s\S]*?\n\1[^\n]*$/gm, ' ')
    // Inline code spans — drop the code, keep nothing.
    .replace(/`[^`\n]*`/g, ' ')
    // Images: ![alt](url) — drop entirely (alt is chrome, not prose).
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    // Links: [text](url) → text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    // Wikilinks: [[target|alias]] → alias, [[target]] → target
    .replace(/\[\[([^\]|\n]*)(?:\|([^\]\n]*))?\]\]/g, (_m, t, a) => (a != null && a !== '' ? a : t))
    // HTML tags.
    .replace(/<\/?[a-zA-Z][^>]*>/g, ' ')
    // Heading / blockquote / list markers at line start.
    .replace(/^[ \t]*#{1,6}[ \t]+/gm, '')
    .replace(/^[ \t]*>[ \t]?/gm, '')
    .replace(/^[ \t]*([-*+]|\d+\.)[ \t]+/gm, '')
    // Task checkbox.
    .replace(/^[ \t]*\[[ xX]\][ \t]+/gm, '')
    // Emphasis / strike / highlight markers (leave the inner text).
    .replace(/(\*\*|__|\*|_|~~|==)/g, '')
    // Horizontal rules.
    .replace(/^[ \t]*([-*_])(?:[ \t]*\1){2,}[ \t]*$/gm, ' ');
}

/** Count words in a CJK run (no whitespace). Uses Intl.Segmenter when present. */
function countCjkWords(run: string): number {
  const Segmenter = (Intl as { Segmenter?: typeof Intl.Segmenter }).Segmenter;
  if (Segmenter) {
    try {
      const seg = new Segmenter('ko', { granularity: 'word' });
      let n = 0;
      for (const s of seg.segment(run)) {
        if (s.isWordLike) n++;
      }
      if (n > 0) return n;
    } catch { /* fall through to codepoint count */ }
  }
  // Fallback: one word per CJK codepoint.
  const cjk = run.match(CJK_GLOBAL);
  return cjk ? cjk.length : 0;
}

export interface TextCounts {
  words: number;
  chars: number;   // characters excluding whitespace, frontmatter, and md syntax
}

/**
 * Count words + characters of a markdown note's prose. Frontmatter and common
 * markdown syntax are stripped first; CJK is counted by segment, latin by
 * whitespace runs.
 */
export function countText(content: string): TextCounts {
  const prose = stripMarkdownSyntax(stripFrontmatter(content)).trim();
  if (!prose) return { words: 0, chars: 0 };

  // chars = visible (non-whitespace) characters of the cleaned prose.
  const chars = prose.replace(/\s+/g, '').length;

  // Split prose into CJK runs and non-CJK runs; count each appropriately.
  let words = 0;
  TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN_RE.exec(prose)) !== null) {
    if (m[1]) {
      words += countCjkWords(m[1]);
    } else if (m[2]) {
      const latin = m[2].trim();
      if (latin) words += latin.split(/\s+/).filter(Boolean).length;
    }
  }
  return { words, chars };
}
