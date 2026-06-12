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

// Characters prosemirror-markdown escapes inside plain text.
const MD_ESCAPABLE = /\\([\\`*_~[\]])/g;

function unescapeAll(s: string): string {
  return s.replace(MD_ESCAPABLE, '$1');
}

/**
 * Post-serialize guard: tiptap-markdown (prosemirror-markdown) escapes
 * `[ ] _ * ~` in plain text, which corrupts wikilinks (`\[\[Note\]\]`) and
 * math (`$x\_1$`) on disk. Both live as plain text in the document until
 * W1-9 introduces real nodes, so we restore them here. Fenced code blocks
 * and inline code spans are left untouched (the serializer never escapes
 * inside code, so any backslashes there are user content).
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
