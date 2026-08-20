// The one wikilink parser. Everything that needs to read `[[...]]` should end up here.
//
// IMPORT-FREE ON PURPOSE. No `node:` builtins, no bare specifiers. The Electron
// renderer and the browser `@stellavault/graph` bundle both want this module, and a
// single `node:path` import here would pull better-sqlite3's transitive graph into a
// Vite bundle. Keep it dependency-free so `@stellavault/core/links` stays isomorphic.
//
// Shapes this is built for (measured on the 17,642-note vault backing this project):
//   2,622 wikilinks in 505 files, only two forms — [[target]] (89.4%) and
//   [[target|alias]] (10.6%). Zero heading anchors, zero block anchors, zero embeds.
//   So anchors/embeds are PARSED (they are cheap and Obsidian emits them) but no
//   resolution logic is written for them anywhere downstream.

export interface ParsedWikilink {
  /**
   * Target segment exactly as written — alias and anchor removed, but NOT trimmed.
   * Byte-fidelity matters for editor round-trips; normalize with {@link resolveTargetKey}.
   */
  target: string;
  /** Text after the first `|`, verbatim. null when the link has no alias. */
  alias: string | null;
  /** Text after the first `#`, verbatim, without the `#`. null when there is no anchor. */
  section: string | null;
  /** A `^`-prefixed section is an Obsidian block id, not a heading. */
  isBlockRef: boolean;
  /** `![[...]]` transclusion. */
  isEmbed: boolean;
  /** The link lives inside the YAML frontmatter block (an Obsidian property link). */
  inFrontmatter: boolean;
  /** Offset of the match in the ORIGINAL text — the `!` for embeds, else the first `[`. */
  index: number;
  /** Length of the whole match, including a leading `!`. */
  length: number;
}

export interface ParseWikilinkOptions {
  /** Keep only the first link per {@link resolveTargetKey}. Default false. */
  dedupe?: boolean;
  /** Blank fenced/inline/indented code before matching. Default true. */
  skipCode?: boolean;
  /** Stop after this many links. Default unlimited. */
  limit?: number;
}

/** A links-table row, ready for `VectorStore.upsertLinks`. */
export interface LinkRow {
  targetRaw: string;
  targetNorm: string;
  section: string | null;
  alias: string | null;
  /** Ordinal within the document (frontmatter links first, then body order). */
  position: number;
}

/**
 * Per-document link cap. A note is not supposed to carry a thousand outlinks; a
 * generated/pathological file that does would otherwise blow up the links table and
 * the graph edge count for everyone. (Threat model §2 — 대량 호출/데이터 팽창.)
 */
const MAX_LINKS_PER_DOC = 1000;

/** Frontmatter recursion guard — YAML nests, but not this deep in practice. */
const MAX_FRONTMATTER_DEPTH = 6;

/**
 * LINE-BOUNDED on purpose. The regex this replaces was `/\[\[([^\]]+)\]\]/g`, which
 * lets `[^\]]` swallow newlines: the vault has 16 unclosed `[[` openers sitting in
 * frontmatter that feed exactly that shape: an unclosed opener pairs with whatever `]]`
 * comes next, possibly hundreds of lines later, yielding one giant bogus target.
 * (16 = counted; the bogus-target outcome is the mechanism, not a separately measured number.) Excluding `\n` (and `[`) makes an unclosed opener simply not match.
 * Fresh object per call so a stateful `lastIndex` can never leak between callers.
 */
function wikilinkRegex(): RegExp {
  return /(!?)\[\[([^\[\]\n]+)\]\]/g;
}

/**
 * Split the inner text of a wikilink on the FIRST pipe. VERBATIM, NO TRIM.
 *
 * The desktop editor (renderer/lib/markdown.ts `parseWikilinkInner`) keeps targets
 * untrimmed so the TipTap node serializes back to the exact bytes it parsed. Trimming
 * belongs to the resolution layer ({@link resolveTargetKey}) — do it here and every note
 * containing a padded target like `[[ Foo ]]` gets silently rewritten on its next save.
 */
export function splitWikilinkInner(inner: string): { target: string; alias: string | null } {
  const pipe = inner.indexOf('|');
  if (pipe === -1) return { target: inner, alias: null };
  return { target: inner.slice(0, pipe), alias: inner.slice(pipe + 1) };
}

/**
 * Normalized lookup key for a target: alias dropped, anchor dropped, trimmed, lowercased.
 * This is what `links.target_norm` stores and what the resolution ladder indexes on.
 */
export function resolveTargetKey(target: string): string {
  let t = target;
  const pipe = t.indexOf('|');
  if (pipe >= 0) t = t.slice(0, pipe);
  const hash = t.indexOf('#');
  if (hash >= 0) t = t.slice(0, hash);
  return t.trim().toLowerCase();
}

/**
 * End offset (exclusive) of the leading YAML frontmatter block, or 0 when there is none.
 *
 * Frontmatter is NOT code: 32 real Obsidian property links live in YAML in this vault,
 * so it is never masked — it is only flagged, via `inFrontmatter`. An unterminated `---`
 * opener yields 0 rather than swallowing the file.
 */
export function frontmatterEnd(text: string): number {
  const start = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  if (!text.startsWith('---', start)) return 0;
  const firstNl = text.indexOf('\n', start);
  if (firstNl === -1) return 0;
  if (text.slice(start + 3, firstNl).trim() !== '') return 0;

  let pos = firstNl + 1;
  while (pos < text.length) {
    const nl = text.indexOf('\n', pos);
    const lineEnd = nl === -1 ? text.length : nl;
    const line = stripCr(text.slice(pos, lineEnd));
    if (line === '---' || line === '...') return nl === -1 ? text.length : nl + 1;
    if (nl === -1) break;
    pos = nl + 1;
  }
  return 0;
}

function stripCr(line: string): string {
  return line.endsWith('\r') ? line.slice(0, -1) : line;
}

/**
 * Space-fill the given ranges, PRESERVING OFFSETS and line breaks, so `index`/`length`
 * from the masked scan still point at the original text.
 */
function blankRanges(text: string, ranges: Array<[number, number]>): string {
  if (ranges.length === 0) return text;
  const chars = text.split('');
  for (const [from, to] of ranges) {
    for (let i = from; i < to && i < chars.length; i++) {
      if (chars[i] !== '\n' && chars[i] !== '\r') chars[i] = ' ';
    }
  }
  return chars.join('');
}

/** Fenced blocks (``` and ~~~) plus 4-space / tab indented blocks, line by line. */
function blockCodeRanges(text: string, from: number): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let fenceChar = '';
  let fenceLen = 0;
  // An indented code block cannot interrupt a paragraph (CommonMark), so it only starts
  // after a blank line or at the top of the scan. Without this rule, a 4-space-indented
  // list continuation line would be masked and its links lost.
  let prevBlank = true;
  let pos = from;

  while (pos <= text.length) {
    const nl = text.indexOf('\n', pos);
    const lineEnd = nl === -1 ? text.length : nl;
    const line = stripCr(text.slice(pos, lineEnd));

    if (fenceChar) {
      ranges.push([pos, lineEnd]);
      const close = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line);
      // The closing fence must use the same character and be at least as long.
      if (close && close[1][0] === fenceChar && close[1].length >= fenceLen) {
        fenceChar = '';
        fenceLen = 0;
        prevBlank = false;
      }
    } else {
      const open = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
      if (open && !(open[1][0] === '`' && open[2].includes('`'))) {
        fenceChar = open[1][0];
        fenceLen = open[1].length;
        prevBlank = false;
        ranges.push([pos, lineEnd]);
      } else if (prevBlank && line.trim() !== '' && /^(?: {4}|\t)/.test(line)) {
        ranges.push([pos, lineEnd]); // stays "prevBlank" so the block keeps running
      } else {
        prevBlank = line.trim() === '';
      }
    }

    if (nl === -1) break;
    pos = nl + 1;
  }
  return ranges;
}

/**
 * Inline backtick runs, one line at a time. A closing run must be EXACTLY as long as the
 * opener (CommonMark). Confining spans to a single line keeps an unmatched backtick from
 * blanking the rest of the note — the same runaway failure the line-bounded link regex fixes.
 */
function inlineCodeRanges(text: string, from: number): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let pos = from;

  while (pos <= text.length) {
    const nl = text.indexOf('\n', pos);
    const lineEnd = nl === -1 ? text.length : nl;
    let i = pos;
    while (i < lineEnd) {
      if (text[i] !== '`') {
        i++;
        continue;
      }
      let n = 0;
      while (i + n < lineEnd && text[i + n] === '`') n++;
      let j = i + n;
      let close = -1;
      while (j < lineEnd) {
        if (text[j] === '`') {
          let m = 0;
          while (j + m < lineEnd && text[j + m] === '`') m++;
          if (m === n) {
            close = j;
            break;
          }
          j += m;
        } else {
          j++;
        }
      }
      if (close >= 0) {
        ranges.push([i, close + n]);
        i = close + n;
      } else {
        i += n;
      }
    }
    if (nl === -1) break;
    pos = nl + 1;
  }
  return ranges;
}

/**
 * Blank every code region from `fmEnd` onward, offsets intact.
 *
 * Measured worth: masking removes 50 real false positives (1.91% of vault occurrences),
 * nearly all one project's placeholder syntax — `[[tts:text]]`, `[[reply_to:<id>]]` —
 * living in fenced samples under 04_Projects/oasis-agent/docs/.
 */
function maskCode(text: string, fmEnd: number): string {
  const blocksMasked = blankRanges(text, blockCodeRanges(text, fmEnd));
  return blankRanges(blocksMasked, inlineCodeRanges(blocksMasked, fmEnd));
}

/** Parse every wikilink in a markdown body. Offsets are into `text` as given. */
export function parseWikilinks(text: string, opts: ParseWikilinkOptions = {}): ParsedWikilink[] {
  if (!text) return [];
  const skipCode = opts.skipCode !== false;
  const limit =
    typeof opts.limit === 'number' && Number.isFinite(opts.limit) && opts.limit > 0
      ? Math.floor(opts.limit)
      : Number.POSITIVE_INFINITY;

  const fmEnd = frontmatterEnd(text);
  const scan = skipCode ? maskCode(text, fmEnd) : text;

  const out: ParsedWikilink[] = [];
  const seen = opts.dedupe ? new Set<string>() : null;
  const re = wikilinkRegex();
  let m: RegExpExecArray | null;

  while (out.length < limit && (m = re.exec(scan)) !== null) {
    const { target: withAnchor, alias } = splitWikilinkInner(m[2]);
    const hash = withAnchor.indexOf('#');
    const target = hash >= 0 ? withAnchor.slice(0, hash) : withAnchor;
    const section = hash >= 0 ? withAnchor.slice(hash + 1) : null;

    if (seen) {
      const key = resolveTargetKey(target);
      if (seen.has(key)) continue;
      seen.add(key);
    }

    out.push({
      target,
      alias,
      section,
      isBlockRef: section !== null && section.startsWith('^'),
      isEmbed: m[1] === '!',
      inFrontmatter: m.index < fmEnd,
      index: m.index,
      length: m[0].length,
    });
  }
  return out;
}

/**
 * Rewrite wikilinks in place. `fn` returns the replacement, or null/undefined to leave
 * the link untouched. Code regions are skipped by default, so a `[[tts:text]]` sample
 * inside a fence is never rewritten.
 */
export function replaceWikilinks(
  text: string,
  fn: (link: ParsedWikilink) => string | null | undefined,
  opts: { skipCode?: boolean } = {},
): string {
  const links = parseWikilinks(text, { skipCode: opts.skipCode });
  if (links.length === 0) return text;

  let out = '';
  let cursor = 0;
  for (const link of links) {
    const replacement = fn(link);
    if (replacement == null) continue;
    out += text.slice(cursor, link.index) + replacement;
    cursor = link.index + link.length;
  }
  return out + text.slice(cursor);
}

/**
 * Links reachable from parsed frontmatter values (Obsidian property links).
 *
 * The indexer stores `doc.content` POST-frontmatter (scanner.ts runs gray-matter), so
 * YAML links are invisible to a body-only scan — 32 of them exist in this vault. Values
 * are never code, hence `skipCode: false`. `index`/`length` are offsets inside the value
 * string, not the file, which is why the DB stores an ordinal `position` instead.
 */
export function parseFrontmatterWikilinks(frontmatter: unknown, limit = MAX_LINKS_PER_DOC): ParsedWikilink[] {
  const out: ParsedWikilink[] = [];

  const walk = (value: unknown, depth: number): void => {
    if (out.length >= limit || depth > MAX_FRONTMATTER_DEPTH || value == null) return;
    if (typeof value === 'string') {
      for (const link of parseWikilinks(value, { skipCode: false })) {
        if (out.length >= limit) return;
        out.push({ ...link, inFrontmatter: true });
      }
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) walk(item, depth + 1);
      return;
    }
    if (typeof value === 'object') {
      for (const item of Object.values(value as Record<string, unknown>)) walk(item, depth + 1);
    }
  };

  walk(frontmatter, 0);
  return out;
}

/**
 * Every link a document contributes: frontmatter properties first (they physically precede
 * the body), then body links with code masked. Capped at {@link MAX_LINKS_PER_DOC}.
 */
export function collectDocumentLinks(
  content: string,
  frontmatter?: unknown,
  opts: { limit?: number } = {},
): ParsedWikilink[] {
  const limit = opts.limit ?? MAX_LINKS_PER_DOC;
  const fromYaml = frontmatter == null ? [] : parseFrontmatterWikilinks(frontmatter, limit);
  const remaining = limit - fromYaml.length;
  const fromBody = remaining > 0 ? parseWikilinks(content ?? '', { skipCode: true, limit: remaining }) : [];
  return [...fromYaml, ...fromBody];
}

/**
 * Project parsed links onto links-table rows. Targetless links — `[[|alias]]`, or a
 * same-note anchor like `[[#Heading]]` — carry nothing to resolve and are dropped, so
 * `position` is the ordinal among STORED rows.
 */
export function toLinkRows(links: ParsedWikilink[]): LinkRow[] {
  const rows: LinkRow[] = [];
  for (const link of links) {
    const targetNorm = resolveTargetKey(link.target);
    if (!targetNorm) continue;
    rows.push({
      targetRaw: link.target.trim(),
      targetNorm,
      section: link.section,
      alias: link.alias,
      position: rows.length,
    });
  }
  return rows;
}
