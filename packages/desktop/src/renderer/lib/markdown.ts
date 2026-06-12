// Markdown ↔ editor serialization layer — single source of truth (B1).
// Design Ref: §4-A — tiptap-markdown adopted; OpenTab.content is ALWAYS the
// markdown source of the note, never TipTap HTML.
//
// Read path:  raw .md text is handed to TipTap as `content` — the Markdown
//             extension (registered below) parses it as markdown.
// Write path: editorToMarkdown(editor) — serializes via tiptap-markdown,
//             then restores syntax the serializer over-escapes ([[wikilinks]],
//             $math$) so files on disk stay Obsidian-compatible.
//
// NOTE: keep this module free of relative imports — tests/md-roundtrip.mjs
// imports it directly under `node --experimental-strip-types`.

import type { AnyExtension, Editor } from '@tiptap/core';
import { Markdown } from 'tiptap-markdown';
import Highlight from '@tiptap/extension-highlight';

// Shared config — MarkdownEditor (and any future editor surface) must use
// this single instance so serialize/parse behavior never diverges.
export const markdownConfig = {
  html: false,               // never emit raw HTML into .md files
  tightLists: true,          // no <p> wrappers inside <li> output
  tightListClass: 'tight',
  bulletListMarker: '-',
  linkify: false,            // Link extension's autolink already covers this
  breaks: false,             // standard markdown: single \n is not <br>
  transformPastedText: true, // pasted markdown text is parsed, not kept literal
  transformCopiedText: false,
} as const;

// Cast: tiptap-markdown is hoisted to the repo root and types against the
// root @tiptap/core (v3, used by @stellavault/graph) while desktop pins v2
// locally — structurally compatible for our use, but nominal types clash.
export const MarkdownSerializerExtension =
  Markdown.configure({ ...markdownConfig }) as unknown as AnyExtension;

// Highlight with an Obsidian-compatible `==text==` serializer.
// Without this, html:false drops the highlight mark on save (text kept,
// formatting silently lost). `==…==` parses back as literal text for now
// (markdown-it has no mark plugin here) but is stable on disk and renders
// correctly in Obsidian. Proper parse support can ride along with W1-9.
export const MarkdownHighlight = Highlight.extend({
  addStorage() {
    return {
      markdown: {
        serialize: { open: '==', close: '==', mixable: true, expelEnclosingWhitespace: true },
        parse: {},
      },
    };
  },
});

/** Serialize the current editor document to markdown source. */
export function editorToMarkdown(editor: Editor): string {
  const raw: string = editor.storage.markdown.getMarkdown();
  return restoreEscapedSyntax(raw);
}

/**
 * Prepare markdown source for the editor. Currently a pass-through (the
 * Markdown extension parses `setContent`/initial content as markdown);
 * kept as the seam where frontmatter splitting lands in W1-7.
 */
export function markdownToEditor(md: string): string {
  return md;
}

// ─── Wikilink markdown rules (W1-9) ────────────────────────────────────────
// Pure helpers shared by WikilinkNode.ts (TipTap node) and the round-trip
// tests. The node's storage.markdown spec delegates here so serialize/parse
// stay in this single module (plan §W1-9: "직렬화: 노드 ↔ [[target|alias]]").

/** Split the inner text of a wikilink (`target|alias`). Verbatim, no trim —
 *  byte-fidelity on round-trip; trimming happens only at click-resolution. */
export function parseWikilinkInner(inner: string): { target: string; alias: string | null } {
  const pipe = inner.indexOf('|');
  if (pipe === -1) return { target: inner, alias: null };
  return { target: inner.slice(0, pipe), alias: inner.slice(pipe + 1) };
}

/** Serialize a wikilink node back to markdown. alias === null → no pipe. */
export function serializeWikilink(target: string, alias: string | null): string {
  return alias === null ? `[[${target}]]` : `[[${target}|${alias}]]`;
}

// Minimal structural typing for the markdown-it instance tiptap-markdown
// hands to parse.setup() — avoids a hard dep on @types/markdown-it here.
interface MarkdownItLike {
  inline: { ruler: { before: (name: string, ruleName: string, fn: (state: any, silent: boolean) => boolean) => void } };
  renderer: { rules: Record<string, (tokens: any[], idx: number) => string> };
  utils: { escapeHtml: (s: string) => string };
}

/**
 * Register the `[[target|alias]]` inline rule on a markdown-it instance.
 * Idempotent — tiptap-markdown calls parse.setup() on EVERY parse, so we tag
 * the instance to avoid stacking duplicate rules.
 *
 * Code safety: this is an inline rule, so fenced code blocks (block-level)
 * are never scanned, and inline code spans are consumed by the backtick rule
 * before the scanner reaches an inner `[[`.
 */
export function registerWikilinkRule(md: MarkdownItLike): void {
  const tagged = md as MarkdownItLike & { __svWikilink?: boolean };
  if (tagged.__svWikilink) return;
  tagged.__svWikilink = true;

  md.inline.ruler.before('link', 'sv_wikilink', (state, silent) => {
    const src: string = state.src;
    const pos: number = state.pos;
    if (src.charCodeAt(pos) !== 0x5b /* [ */ || src.charCodeAt(pos + 1) !== 0x5b) return false;
    const end = src.indexOf(']]', pos + 2);
    if (end === -1) return false;
    const inner = src.slice(pos + 2, end);
    if (inner.length === 0 || inner.includes('[[') || inner.includes('\n')) return false;
    if (!silent) {
      const { target, alias } = parseWikilinkInner(inner);
      const token = state.push('sv_wikilink', '', 0);
      token.meta = { target, alias };
    }
    state.pos = end + 2;
    return true;
  });

  md.renderer.rules.sv_wikilink = (tokens, idx) => {
    const { target, alias } = tokens[idx].meta as { target: string; alias: string | null };
    const esc = md.utils.escapeHtml;
    const aliasAttr = alias === null ? '' : ` data-alias="${esc(alias)}"`;
    const label = alias !== null && alias.length > 0 ? alias : target;
    return `<span data-type="wikilink" data-target="${esc(target)}"${aliasAttr} class="sv-wikilink">${esc(label)}</span>`;
  };
}

// Characters prosemirror-markdown escapes inside plain text.
const MD_ESCAPABLE = /\\([\\`*_~[\]])/g;

function unescapeAll(s: string): string {
  return s.replace(MD_ESCAPABLE, '$1');
}

/**
 * Post-serialize guard: tiptap-markdown (prosemirror-markdown) escapes
 * `[ ] _ * ~` in plain text, which corrupts wikilinks (`\[\[Note\]\]`) and
 * math (`$x\_1$`) on disk.
 *
 * W1-9: wikilinks are now a real node (WikilinkNode.ts) that serializes raw
 * `[[target|alias]]` — those never pass through this guard's wikilink branch
 * (it only matches the ESCAPED form). The branch is kept as a fallback for
 * plain-text wikilinks that did not nodeify (e.g. user typed `[[` and escaped
 * the suggestion popup). Math still lives as plain text until it gets a node.
 * Fenced code blocks and inline code spans are left untouched (the serializer
 * never escapes inside code, so any backslashes there are user content).
 */
export function restoreEscapedSyntax(md: string): string {
  const lines = md.split('\n');
  let inFence = false;
  const out = lines.map((line) => {
    if (/^(```|~~~)/.test(line.trimStart())) {
      inFence = !inFence;
      return line;
    }
    if (inFence) return line;
    // Split out inline code spans; only transform the non-code segments.
    return line
      .split(/(`+[^`]*`+)/)
      .map((seg, i) => (i % 2 === 1 ? seg : restoreSegment(seg)))
      .join('');
  });
  return out.join('\n');
}

function restoreSegment(seg: string): string {
  return seg
    // Wikilinks: \[\[Target\|alias\]\] → [[Target|alias]] (inner unescaped)
    .replace(/\\\[\\\[((?:\\.|[^[\]\n])+?)\\\]\\\]/g, (_m, inner: string) => `[[${unescapeAll(inner)}]]`)
    // Display math: $$…$$ — unescape inner tex
    .replace(/\$\$([^$]+?)\$\$/g, (_m, tex: string) => `$$${unescapeAll(tex)}$$`)
    // Inline math: $…$ — unescape inner tex
    .replace(/(?<!\$)\$(?!\$)([^$\n]+?)\$(?!\$)/g, (_m, tex: string) => `$${unescapeAll(tex)}$`);
}
