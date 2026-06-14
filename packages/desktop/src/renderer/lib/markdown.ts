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
import TextStyle from '@tiptap/extension-text-style';

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

// ─── Inline colored-text / colored-highlight markdown rules (editor upgrade) ─
// Color marks have NO markdown equivalent. Decision (assignment §3): serialize
// as minimal inline HTML — Obsidian renders raw HTML, so files stay readable:
//   text color        → <span style="color: …">…</span>
//   colored highlight → <mark style="background-color: …">…</mark>
// markdownConfig.html stays false, so on parse markdown-it would escape those
// tags to literal text. registerInlineStyleRule() below recognizes EXACTLY
// these two shapes (validated color values only) and re-emits them as raw
// HTML so TipTap's DOM parser restores the marks. Anything else stays escaped.

/** Allow only safe CSS color tokens — hex, rgb()/rgba(), or a bare keyword. */
export function isSafeCssColor(value: string): boolean {
  return /^(#[0-9a-fA-F]{3,8}|rgba?\(\s*[\d.,\s%]+\s*\)|[a-zA-Z]+)$/.test(value);
}

const STYLE_OPEN_RE = /^<(span|mark) style="(color|background-color):\s*([^";<>]{1,64})">/;
const STYLE_CLOSE_RE = /^<\/(span|mark)>/;

/**
 * markdown-it inline rule for the two color-span shapes above. Idempotent
 * (tiptap-markdown calls parse.setup() on EVERY parse). Tag/property must
 * pair correctly (span↔color, mark↔background-color) and the value must pass
 * isSafeCssColor — otherwise the source stays escaped text (no raw HTML).
 */
export function registerInlineStyleRule(md: MarkdownItLike): void {
  const tagged = md as MarkdownItLike & { __svInlineStyle?: boolean };
  if (tagged.__svInlineStyle) return;
  tagged.__svInlineStyle = true;

  // NOTE: tokens are pushed with nesting 0 (not +1/−1). A stray close tag
  // with nesting −1 corrupts markdown-it's inline delimiter stack
  // (state._prev_delimiters.pop() → undefined → balance_pairs crash).
  // Pairing is enforced STATELESSLY (silent-pass safe): an open tag needs a
  // matching close ahead in the source; a close tag needs a matching open
  // behind. Unpaired tags simply stay escaped text. The renderer emits raw
  // HTML and the DOM parser tolerates any residual mis-nesting.
  md.inline.ruler.before('link', 'sv_inline_style', (state, silent) => {
    const src: string = state.src;
    const pos: number = state.pos;
    if (src.charCodeAt(pos) !== 0x3c /* < */) return false;
    const rest = src.slice(pos);

    const open = STYLE_OPEN_RE.exec(rest);
    if (open) {
      const [full, tag, prop, rawValue] = open;
      const value = rawValue.trim();
      if (!isSafeCssColor(value)) return false;
      if ((tag === 'span') !== (prop === 'color')) return false; // span↔color, mark↔background-color
      // Only accept the open tag if a matching close exists ahead.
      if (src.indexOf(`</${tag}>`, pos + full.length) === -1) return false;
      if (!silent) {
        const token = state.push('sv_style_open', tag, 0);
        token.meta = { tag, prop, value };
      }
      state.pos = pos + full.length;
      return true;
    }

    const close = STYLE_CLOSE_RE.exec(rest);
    if (close) {
      // Only accept the close tag if a matching open exists behind.
      if (src.lastIndexOf(`<${close[1]} style="`, pos) === -1) return false;
      if (!silent) {
        const token = state.push('sv_style_close', close[1], 0);
        token.meta = { tag: close[1] };
      }
      state.pos = pos + close[0].length;
      return true;
    }
    return false;
  });

  md.renderer.rules.sv_style_open = (tokens, idx) => {
    const { tag, prop, value } = tokens[idx].meta as { tag: string; prop: string; value: string };
    return `<${tag} style="${prop}: ${md.utils.escapeHtml(value)}">`;
  };
  md.renderer.rules.sv_style_close = (tokens, idx) => {
    const { tag } = tokens[idx].meta as { tag: string };
    return `</${tag}>`;
  };
}

// Highlight with an Obsidian-compatible `==text==` serializer.
// Without this, html:false drops the highlight mark on save (text kept,
// formatting silently lost). `==…==` parses back as literal text for now
// (markdown-it has no mark plugin here) but is stable on disk and renders
// correctly in Obsidian. Proper parse support can ride along with W1-9.
// Editor upgrade: multicolor highlights (attrs.color set) serialize as
// <mark style="background-color: …"> instead — parsed back via
// registerInlineStyleRule. Default (colorless) highlight stays `==…==`.
export const MarkdownHighlight = Highlight.extend({
  addStorage() {
    return {
      markdown: {
        serialize: {
          open(_state: unknown, mark: { attrs: { color?: string | null } }) {
            const c = mark.attrs?.color;
            return c && isSafeCssColor(String(c)) ? `<mark style="background-color: ${c}">` : '==';
          },
          close(_state: unknown, mark: { attrs: { color?: string | null } }) {
            const c = mark.attrs?.color;
            return c && isSafeCssColor(String(c)) ? '</mark>' : '==';
          },
          mixable: true,
          expelEnclosingWhitespace: true,
        },
        parse: { setup: registerInlineStyleRule },
      },
    };
  },
});

// Text color mark — TextStyle (nested v2 dep) with a `color` attribute.
// @tiptap/extension-color is NOT installed for the desktop's v2 tree, so this
// is the documented ~20-LoC custom pattern instead (benchmark spec §2).
// Serializes to <span style="color: …"> (see decision note above).
declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    svTextColor: {
      /** Apply a text color to the selection. */
      setTextColor: (color: string) => ReturnType;
      /** Remove the text color from the selection. */
      unsetTextColor: () => ReturnType;
    };
  }
}

export const MarkdownTextColor = TextStyle.extend({
  addAttributes() {
    return {
      color: {
        default: null,
        parseHTML: (el: HTMLElement) => el.style.color || null,
        renderHTML: (attrs: { color?: string | null }) =>
          attrs.color ? { style: `color: ${attrs.color}` } : {},
      },
    };
  },

  addCommands() {
    return {
      ...this.parent?.(),
      setTextColor: (color: string) => ({ chain }) =>
        chain().setMark('textStyle', { color }).run(),
      unsetTextColor: () => ({ chain }) =>
        chain().setMark('textStyle', { color: null }).removeEmptyTextStyle().run(),
    };
  },

  addStorage() {
    return {
      markdown: {
        serialize: {
          open(_state: unknown, mark: { attrs: { color?: string | null } }) {
            const c = mark.attrs?.color;
            return c && isSafeCssColor(String(c)) ? `<span style="color: ${c}">` : '';
          },
          close(_state: unknown, mark: { attrs: { color?: string | null } }) {
            const c = mark.attrs?.color;
            return c && isSafeCssColor(String(c)) ? '</span>' : '';
          },
          mixable: true,
          expelEnclosingWhitespace: true,
        },
        parse: { setup: registerInlineStyleRule },
      },
    };
  },
});

// ─── Callout markdown rules (editor upgrade) ────────────────────────────────
// Obsidian callout syntax on disk:
//   > [!info]
//   > body…
// Serialize: CalloutNode delegates to serializeCallout (state.write = raw, so
// `[!type]` is never escaped). Parse: registerCalloutRule converts a parsed
// blockquote whose first paragraph starts with `[!type]` into
// <div data-callout="type"> which CalloutNode.parseHTML picks up.

/** prosemirror-markdown node serializer for the callout node. */
export function serializeCallout(state: any, node: any): void {
  const type = String(node.attrs?.type || 'info');
  state.wrapBlock('> ', null, node, () => {
    state.write(`[!${type}]`);
    state.ensureNewLine();
    state.renderContent(node);
  });
}

const CALLOUT_MARKER_RE = /^\[!([A-Za-z]+)\][^\S\n]*(\n|$)/;

/**
 * markdown-it core rule: blockquote → callout div when the first paragraph
 * begins with `[!type]`. Idempotent (setup() runs on every parse). Plain
 * blockquotes are left untouched.
 */
export function registerCalloutRule(md: MarkdownItLike): void {
  const tagged = md as MarkdownItLike & { __svCallout?: boolean };
  if (tagged.__svCallout) return;
  tagged.__svCallout = true;

  (md as any).core.ruler.push('sv_callout', (state: any) => {
    const tokens = state.tokens;
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].type !== 'blockquote_open') continue;
      if (tokens[i + 1]?.type !== 'paragraph_open' || tokens[i + 2]?.type !== 'inline') continue;
      const inline = tokens[i + 2];
      const m = CALLOUT_MARKER_RE.exec(inline.content);
      if (!m) continue;
      const type = m[1].toLowerCase();

      // Find the matching blockquote_close (track nesting).
      let depth = 0;
      let close = -1;
      for (let j = i; j < tokens.length; j++) {
        if (tokens[j].type === 'blockquote_open') depth++;
        else if (tokens[j].type === 'blockquote_close' && --depth === 0) { close = j; break; }
      }
      if (close === -1) continue;

      tokens[i].type = 'sv_callout_open';
      tokens[i].tag = 'div';
      tokens[i].attrSet('data-callout', type);
      tokens[close].type = 'sv_callout_close';
      tokens[close].tag = 'div';

      // Strip the `[!type]` marker line from the first paragraph.
      const stripped = inline.content.replace(/^\[![A-Za-z]+\][^\S\n]*\n?/, '');
      if (stripped === '') {
        tokens.splice(i + 1, 3); // marker-only paragraph → remove it entirely
      } else {
        inline.content = stripped;
        const kids = inline.children ?? [];
        if (kids[0]?.type === 'text') {
          kids[0].content = kids[0].content.replace(/^\[![A-Za-z]+\][^\S\n]*/, '');
          if (kids[0].content === '') {
            kids.shift();
            if (kids[0]?.type === 'softbreak') kids.shift();
          }
        }
      }
    }
  });
}

// ─── Math block markdown rule (T2-14) ──────────────────────────────────────
// Display math on disk (Obsidian/Pandoc style):
//   $$
//   \int_0^\infty e^{-x} dx = 1
//   $$
// or a single line `$$tex$$`. Parse: a block rule emits an html_block token
// rendering <div data-math-block data-tex="…"> which MathExtension.parseHTML
// turns into the real `mathBlock` node. Serialize: the node's storage.markdown
// spec writes `$$tex$$` back out (see MathExtension.ts). Inline `$…$` stays
// plain text (round-trips via restoreEscapedSyntax). idempotent.

/** markdown-it block rule for `$$ … $$` fenced display math. */
export function registerMathBlockRule(md: MarkdownItLike): void {
  const tagged = md as MarkdownItLike & { __svMathBlock?: boolean };
  if (tagged.__svMathBlock) return;
  tagged.__svMathBlock = true;

  const block = (md as any).block;
  if (!block?.ruler?.before) return;

  block.ruler.before('fence', 'sv_math_block', (state: any, startLine: number, endLine: number, silent: boolean) => {
    const start = state.bMarks[startLine] + state.tShift[startLine];
    const max = state.eMarks[startLine];
    const src: string = state.src;
    // Must begin with `$$`.
    if (start + 2 > max) return false;
    if (src.charCodeAt(start) !== 0x24 /* $ */ || src.charCodeAt(start + 1) !== 0x24) return false;

    const firstLine = src.slice(start + 2, max);
    // Single-line form: `$$tex$$`.
    const singleClose = firstLine.indexOf('$$');
    if (singleClose !== -1) {
      if (silent) return true;
      const tex = firstLine.slice(0, singleClose).trim();
      pushMathToken(state, startLine, startLine + 1, tex);
      state.line = startLine + 1;
      return true;
    }

    // Multi-line form: scan for a line that is exactly (or ends with) `$$`.
    let nextLine = startLine;
    let haveEnd = false;
    const buf: string[] = [];
    if (firstLine.trim()) buf.push(firstLine);
    while (++nextLine < endLine) {
      const lstart = state.bMarks[nextLine] + state.tShift[nextLine];
      const lmax = state.eMarks[nextLine];
      const line = src.slice(lstart, lmax);
      const trimmed = line.trim();
      if (trimmed === '$$' || trimmed.endsWith('$$')) {
        haveEnd = true;
        const body = trimmed === '$$' ? '' : trimmed.slice(0, -2);
        if (body) buf.push(body);
        break;
      }
      buf.push(line);
    }
    if (!haveEnd) return false;
    if (silent) return true;
    pushMathToken(state, startLine, nextLine + 1, buf.join('\n').trim());
    state.line = nextLine + 1;
    return true;
  });

  md.renderer.rules.sv_math_block = (tokens, idx) => {
    const { tex } = tokens[idx].meta as { tex: string };
    return `<div data-math-block data-tex="${md.utils.escapeHtml(tex)}"></div>\n`;
  };
}

function pushMathToken(state: any, startLine: number, endLine: number, tex: string): void {
  const token = state.push('sv_math_block', 'div', 0);
  token.map = [startLine, endLine];
  token.block = true;
  token.meta = { tex };
}

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

// ─── Embed / transclusion markdown rules (T3-10) ───────────────────────────
// Obsidian embed syntax on disk (image-style):
//   ![[Note]]            — transclude the whole note
//   ![[Note#Heading]]    — transclude just that heading's section
// These render inline + READ-ONLY inside the editor (EmbedNode.ts loads the
// target via vault:read-file). Round-trip: the node's storage.markdown spec
// writes `![[target]]` / `![[target#heading]]` back out verbatim (see
// EmbedNode.ts → serializeEmbed below). Parse: an inline rule (registered
// BEFORE the wikilink rule, since `![[` begins with `!` then `[[`) emits a
// <span data-type="embed"> which EmbedNode.parseHTML turns into the node.
//
// Like wikilinks, attrs are kept VERBATIM (no trim) so byte-fidelity holds on
// round-trip; trimming happens only when resolving the target for read.

/** Split an embed inner (`target#heading`). target keeps everything before the
 *  FIRST '#'; heading is everything after it (may itself contain '#'). No trim. */
export function parseEmbedInner(inner: string): { target: string; heading: string | null } {
  const hash = inner.indexOf('#');
  if (hash === -1) return { target: inner, heading: null };
  return { target: inner.slice(0, hash), heading: inner.slice(hash + 1) };
}

/** Serialize an embed node back to markdown. heading === null → no anchor. */
export function serializeEmbed(target: string, heading: string | null): string {
  return heading === null ? `![[${target}]]` : `![[${target}#${heading}]]`;
}

/**
 * Register the `![[target#heading]]` inline rule on a markdown-it instance.
 * Idempotent — tiptap-markdown calls parse.setup() on EVERY parse, so we tag
 * the instance to avoid stacking duplicate rules. Registered before 'link' AND
 * before the wikilink rule (`![[` would otherwise be a `!` text node followed
 * by a parsed wikilink). Same code-safety properties as the wikilink rule:
 * inline-only, so fenced/inline code is never scanned.
 */
export function registerEmbedRule(md: MarkdownItLike): void {
  const tagged = md as MarkdownItLike & { __svEmbed?: boolean };
  if (tagged.__svEmbed) return;
  tagged.__svEmbed = true;

  md.inline.ruler.before('link', 'sv_embed', (state, silent) => {
    const src: string = state.src;
    const pos: number = state.pos;
    // Must start with `![[`.
    if (src.charCodeAt(pos) !== 0x21 /* ! */) return false;
    if (src.charCodeAt(pos + 1) !== 0x5b /* [ */ || src.charCodeAt(pos + 2) !== 0x5b) return false;
    const end = src.indexOf(']]', pos + 3);
    if (end === -1) return false;
    const inner = src.slice(pos + 3, end);
    if (inner.length === 0 || inner.includes('[[') || inner.includes('\n')) return false;
    if (!silent) {
      const { target, heading } = parseEmbedInner(inner);
      const token = state.push('sv_embed', '', 0);
      token.meta = { target, heading };
    }
    state.pos = end + 2;
    return true;
  });

  md.renderer.rules.sv_embed = (tokens, idx) => {
    const { target, heading } = tokens[idx].meta as { target: string; heading: string | null };
    const esc = md.utils.escapeHtml;
    const headingAttr = heading === null ? '' : ` data-heading="${esc(heading)}"`;
    const label = heading === null ? target : `${target}#${heading}`;
    // Emit a block-level <div data-embed> (EmbedNode is a block node). The
    // browser's HTML parser hoists a block <div> out of the surrounding <p>
    // markdown-it wraps inline content in, so TipTap's DOMParser sees it as a
    // top-level block and instantiates the embed node correctly.
    return `<div data-embed data-type="embed" data-target="${esc(target)}"${headingAttr} class="sv-embed">${esc(label)}</div>`;
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
    // Embeds: !\[\[Target\]\] → ![[Target]] (inner unescaped). MUST run before
    // the wikilink branch so the `![` isn't split off as a stray text node.
    .replace(/!\\\[\\\[((?:\\.|[^[\]\n])+?)\\\]\\\]/g, (_m, inner: string) => `![[${unescapeAll(inner)}]]`)
    // Wikilinks: \[\[Target\|alias\]\] → [[Target|alias]] (inner unescaped)
    .replace(/\\\[\\\[((?:\\.|[^[\]\n])+?)\\\]\\\]/g, (_m, inner: string) => `[[${unescapeAll(inner)}]]`)
    // Display math: $$…$$ — unescape inner tex
    .replace(/\$\$([^$]+?)\$\$/g, (_m, tex: string) => `$$${unescapeAll(tex)}$$`)
    // Inline math: $…$ — unescape inner tex
    .replace(/(?<!\$)\$(?!\$)([^$\n]+?)\$(?!\$)/g, (_m, tex: string) => `$${unescapeAll(tex)}$`);
}
