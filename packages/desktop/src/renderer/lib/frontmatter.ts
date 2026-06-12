// Frontmatter parse/stringify — gray-matter wrap (W1-7, plan §3 W1-7).
// Design Ref: §W1-7 — vault:read-file → parse → {frontmatter, body} → body to
// TipTap, frontmatter to PropertiesEditor; save recombines via stringify.
//
// Fidelity contract:
//   - `fmBlock` is the ORIGINAL frontmatter text (byte-preserving). Body-only
//     edits recompose as `fmBlock + newBody` — YAML is never re-stringified
//     unless the user actually edits a property.
//   - stringify() preserves key insertion order (js-yaml sortKeys=false).
//   - Known limitation (documented in plan §W1-7): YAML comments and exotic
//     formatting are lost ONLY when properties are edited, not on body edits.
//
// NOTE: gray-matter was replaced with direct js-yaml: gray-matter calls
// Buffer.from() at parse time, and the sandboxed renderer has no Node globals
// ("ReferenceError: Buffer is not defined" in the packaged app). js-yaml v4 is
// pure JS — no Buffer, no fs.

import yaml from 'js-yaml';

// Frontmatter block at the very start of the file: ---\n ... \n---\n
const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

export interface ParsedNote {
  /** Parsed YAML frontmatter (empty object when none / on YAML parse error). */
  frontmatter: Record<string, unknown>;
  /** Markdown body without the frontmatter block. */
  body: string;
  /** The full original source (frontmatter + body), verbatim. */
  raw: string;
  /** Original frontmatter block text including delimiters, '' if none. */
  fmBlock: string;
}

/** ISO date at UTC midnight (what js-yaml produces for `date: 2026-06-12`). */
function dateToFriendlyString(d: Date): string {
  const iso = d.toISOString();
  return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso;
}

/**
 * js-yaml parses unquoted dates into Date objects; dumping them back would
 * rewrite `date: 2026-06-12` as a full ISO timestamp. Normalize to strings at
 * parse time so the editor shows (and re-saves) the familiar form.
 */
function normalizeValues(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (v instanceof Date) out[k] = dateToFriendlyString(v);
    else if (Array.isArray(v)) out[k] = v.map((x) => (x instanceof Date ? dateToFriendlyString(x) : x));
    else out[k] = v;
  }
  return out;
}

/**
 * Split markdown source into frontmatter + body.
 * Malformed YAML never throws: the whole file is treated as body (so the
 * original text survives the round-trip untouched).
 */
export function parse(md: string): ParsedNote {
  const m = FM_RE.exec(md);
  if (!m) return { frontmatter: {}, body: md, raw: md, fmBlock: '' };
  const fmBlock = m[0];
  const body = md.slice(fmBlock.length);
  try {
    const data = yaml.load(m[1]);
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      return { frontmatter: normalizeValues(data as Record<string, unknown>), body, raw: md, fmBlock };
    }
    return { frontmatter: {}, body, raw: md, fmBlock };
  } catch (err) {
    console.error('[frontmatter] YAML parse failed — treating file as plain body', err);
    return { frontmatter: {}, body: md, raw: md, fmBlock: '' };
  }
}

/**
 * Recombine body + frontmatter into full markdown source.
 * Key order = object insertion order. Empty frontmatter → body unchanged
 * (gray-matter would otherwise emit an empty `---` block).
 */
export function stringify(body: string, frontmatter: Record<string, unknown>): string {
  if (!frontmatter || Object.keys(frontmatter).length === 0) return body;
  try {
    // dump preserves insertion order; lineWidth -1 = never wrap long values
    // (matches gray-matter's output shape: ---\n{yaml}---\n{body}).
    const yamlText = yaml.dump(frontmatter, { lineWidth: -1 });
    return `---\n${yamlText}---\n${body}`;
  } catch (err) {
    console.error('[frontmatter] YAML stringify failed — saving body only', err);
    return body;
  }
}
