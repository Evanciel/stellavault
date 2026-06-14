// TipTap block node: embed / transclusion (T3-10).
// Design Ref: desktop-upgrade-proposal-v2.md §T3-10 — Obsidian `![[Note]]` /
// `![[Note#heading]]` composition. Renders the referenced note (or just one
// heading's section) INLINE and READ-ONLY inside the editor.
//
// Markdown round-trip (B1 / plan §4-A): serialize/parse delegate to the pure
// rules in ../../lib/markdown.ts (serializeEmbed / registerEmbedRule) via
// tiptap-markdown's per-extension `storage.markdown` spec — on disk this is
// the Obsidian embed syntax `![[target]]` / `![[target#heading]]`. attrs are
// kept VERBATIM (no trim) so the source round-trips byte-identical; trimming
// happens only when resolving the target/heading for read.
//
// The transcluded content is loaded via vault:read-file (same IPC the wikilink
// click-nav uses) and rendered as plain text in a styled <pre>-like surface.
// We deliberately do NOT recursively run the markdown pipeline here (no nested
// editor) — that keeps the embed atomic, non-editable, and immune to embed
// cycles. A header chip links to the source note (reuses openWikilinkTarget).

import { Node, mergeAttributes } from '@tiptap/core';
import { ipc } from '../../lib/ipc-client.js';
import { registerEmbedRule, serializeEmbed } from '../../lib/markdown.js';
import { useAppStore } from '../../stores/app-store.js';
import { openWikilinkTarget } from './WikilinkNode.js';
import type { FileTreeNode } from '../../../shared/ipc-types.js';

// ─── Note resolution (mirrors WikilinkNode.findNoteInTree) ──────────────────

/** Find a markdown file in the tree whose basename (or path suffix) matches the
 *  embed target, case-insensitive. Returns the ABSOLUTE path or null. */
function resolveTargetPath(nodes: FileTreeNode[], target: string): string | null {
  const wanted = `${target.toLowerCase()}.md`;
  const wantedSuffix = `/${wanted}`;
  for (const node of nodes) {
    if (node.isDir) {
      const hit = node.children ? resolveTargetPath(node.children, target) : null;
      if (hit) return hit;
    } else {
      const name = node.name.toLowerCase();
      const path = node.path.replace(/\\/g, '/').toLowerCase();
      if (name === wanted || path.endsWith(wantedSuffix)) return node.path;
    }
  }
  return null;
}

/** Slice the section under a `# Heading` out of full note markdown. Matches the
 *  heading by trimmed text (case-insensitive), then returns every line until the
 *  next heading of the SAME-or-shallower level (Obsidian section semantics).
 *  Returns null when the heading is not found. */
function sliceHeadingSection(md: string, heading: string): string | null {
  const want = heading.trim().toLowerCase();
  const lines = md.split('\n');
  let start = -1;
  let level = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = /^(#{1,6})\s+(.*?)\s*$/.exec(lines[i]);
    if (m && m[2].trim().toLowerCase() === want) {
      start = i;
      level = m[1].length;
      break;
    }
  }
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const m = /^(#{1,6})\s+/.exec(lines[i]);
    if (m && m[1].length <= level) { end = i; break; }
  }
  return lines.slice(start, end).join('\n').trim();
}

// ─── Node ───────────────────────────────────────────────────────────────────

export interface EmbedAttrs {
  target: string;
  heading: string | null;
}

export const EmbedNode = Node.create({
  name: 'embed',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true, // T3-11: a whole transclusion can be dragged as one block

  addAttributes() {
    return {
      target: { default: '' },
      heading: { default: null },
    };
  },

  parseHTML() {
    return [{
      // Block <div data-embed> from registerEmbedRule (markdown parse path) and
      // the static renderHTML fallback below.
      tag: 'div[data-embed]',
      getAttrs: (el) => {
        const dom = el as HTMLElement;
        return {
          target: dom.getAttribute('data-target') ?? '',
          heading: dom.getAttribute('data-heading'), // null when absent
        };
      },
    }];
  },

  // Static fallback render (e.g. getHTML / copy) — a labelled chip. The live
  // transcluded content is produced by the NodeView below.
  renderHTML({ node, HTMLAttributes }) {
    const { target, heading } = node.attrs as EmbedAttrs;
    const label = heading === null ? target : `${target}#${heading}`;
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-embed': '',
        'data-type': 'embed',
        'data-target': target,
        ...(heading !== null ? { 'data-heading': heading } : {}),
        class: 'sv-embed',
      }),
      `![[${label}]]`,
    ];
  },

  // Read-only transclusion NodeView: load + render the target note (or heading
  // section) as plain text. Failure (missing note / unindexed) shows a friendly
  // inline notice rather than breaking the document.
  addNodeView() {
    return ({ node }) => {
      const { target, heading } = node.attrs as EmbedAttrs;
      const cleanTarget = target.trim();

      const dom = document.createElement('div');
      dom.className = 'sv-embed-block';
      dom.setAttribute('data-target', target);
      if (heading !== null) dom.setAttribute('data-heading', heading);
      // contentEditable=false → the transclusion is read-only inside the editor.
      dom.contentEditable = 'false';

      const head = document.createElement('div');
      head.className = 'sv-embed-head';
      const titleLabel = heading === null ? cleanTarget : `${cleanTarget} › ${heading.trim()}`;
      head.textContent = `⧉ ${titleLabel}`;
      head.title = `Open "${cleanTarget}"`;
      head.addEventListener('mousedown', (e) => {
        e.preventDefault();
        // Reuse the wikilink resolver (opens / scrolls to the heading anchor).
        void openWikilinkTarget(heading === null ? cleanTarget : `${cleanTarget}#${heading.trim()}`);
      });

      const body = document.createElement('div');
      body.className = 'sv-embed-body';
      body.textContent = 'Loading…';

      dom.appendChild(head);
      dom.appendChild(body);

      void (async () => {
        try {
          const store = useAppStore.getState();
          const path = resolveTargetPath(store.fileTree, cleanTarget);
          if (!path) {
            body.textContent = `Note not found: ${cleanTarget}`;
            body.classList.add('sv-embed-missing');
            return;
          }
          const content = await ipc('vault:read-file', path);
          let text = content;
          if (heading !== null) {
            const section = sliceHeadingSection(content, heading);
            if (section === null) {
              body.textContent = `Heading not found: ${heading.trim()}`;
              body.classList.add('sv-embed-missing');
              return;
            }
            text = section;
          }
          // Render as plain text (no nested markdown pipeline — avoids embed
          // recursion + keeps the node atomic). Whitespace is preserved via CSS.
          body.textContent = text;
          body.classList.remove('sv-embed-missing');
        } catch (err) {
          console.error(`[embed] failed to load "${cleanTarget}"`, err);
          body.textContent = `Could not load: ${cleanTarget}`;
          body.classList.add('sv-embed-missing');
        }
      })();

      return {
        dom,
        // Atom node — it has no editable content; ignore all internal mutations.
        ignoreMutation: () => true,
        // The whole embed is read-only; never let it capture editing events.
        stopEvent: () => false,
      };
    };
  },

  // tiptap-markdown per-node spec (same convention as WikilinkNode / CalloutNode).
  addStorage() {
    return {
      markdown: {
        serialize(state: any, node: any) {
          const { target, heading } = node.attrs as EmbedAttrs;
          // state.write = raw output (no escaping) → keeps ![[...]] verbatim.
          state.write(serializeEmbed(target, heading));
          state.closeBlock(node);
        },
        parse: {
          setup(md: any) {
            registerEmbedRule(md);
          },
        },
      },
    };
  },
});
