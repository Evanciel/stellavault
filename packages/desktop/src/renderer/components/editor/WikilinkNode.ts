// TipTap inline node: wikilink (W1-9, plan §W1-9).
// Design Ref: §W1-9 — accent-colored clickable span; click → open note tab;
// missing note → create-on-click (vault:create-file) then open.
//
// Markdown round-trip (B1 / plan §4-A): serialize/parse delegate to the pure
// rules in ../../lib/markdown.ts (serializeWikilink / registerWikilinkRule)
// via tiptap-markdown's per-extension `storage.markdown` spec.
// attrs are kept VERBATIM (no trim) so `[[ My Note |x]]` round-trips
// byte-identical; trimming happens only when resolving a click target.

import { Node, mergeAttributes } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { ipc } from '../../lib/ipc-client.js';
import { registerWikilinkRule, serializeWikilink } from '../../lib/markdown.js';
import { useAppStore } from '../../stores/app-store.js';
import type { FileTreeNode } from '../../../shared/ipc-types.js';

// ─── Note resolution ────────────────────────────────────────────────────────

/** Find a markdown file in the tree whose basename (or relative path) matches
 *  the wikilink target, case-insensitive. */
function findNoteInTree(nodes: FileTreeNode[], target: string): FileTreeNode | null {
  const wanted = `${target.toLowerCase()}.md`;
  // `folder/note` targets match on path suffix; bare titles match basename.
  const wantedSuffix = `/${wanted}`;
  for (const node of nodes) {
    if (node.isDir) {
      const hit = node.children ? findNoteInTree(node.children, target) : null;
      if (hit) return hit;
    } else {
      const name = node.name.toLowerCase();
      const path = node.path.replace(/\\/g, '/').toLowerCase();
      if (name === wanted || path.endsWith(wantedSuffix)) return node;
    }
  }
  return null;
}

/** Title shown in the tab — basename without extension. */
function titleFromTarget(target: string): string {
  const base = target.split('/').pop() ?? target;
  return base;
}

/**
 * After a note tab is opened, scroll to a `#heading` anchor (T2-13). The
 * MarkdownEditor of the freshly-opened tab needs a tick to mount + parse its
 * content before its `sv:scroll-to-heading` listener (MarkdownEditor.tsx) is
 * live, so we retry a few animation frames. `index` is 0 — wikilink anchors
 * name a heading by text; the first match wins (Obsidian behaviour).
 */
function scrollToAnchor(headingText: string): void {
  const text = headingText.trim();
  if (!text) return;
  let tries = 0;
  const fire = () => {
    window.dispatchEvent(new CustomEvent('sv:scroll-to-heading', { detail: { text, index: 0 } }));
    if (++tries < 6) requestAnimationFrame(fire);
  };
  requestAnimationFrame(fire);
}

/**
 * Open the note a wikilink points to; create it first if missing. If the raw
 * target carries a `#heading` anchor ([[Note#Heading]], T2-13), scroll the
 * opened note to that heading after it mounts.
 * Exposed for WikilinkSuggestion / future command-palette use.
 */
export async function openWikilinkTarget(rawTarget: string): Promise<void> {
  // Split the heading/block anchor ([[Note#Heading]]) from the note target.
  const hashAt = rawTarget.indexOf('#');
  const anchor = hashAt === -1 ? '' : rawTarget.slice(hashAt + 1).trim();
  const target = (hashAt === -1 ? rawTarget : rawTarget.slice(0, hashAt)).trim();
  // Pure same-note anchor ([[#Heading]]): just scroll the current note.
  if (!target) {
    if (anchor) scrollToAnchor(anchor);
    return;
  }

  const store = useAppStore.getState();
  const existing = findNoteInTree(store.fileTree, target);

  try {
    if (existing) {
      const content = await ipc('vault:read-file', existing.path);
      useAppStore.getState().openFile(existing.path, titleFromTarget(target), content);
      if (anchor) scrollToAnchor(anchor);
      return;
    }

    // Create-on-click. vault:create-file has an exists-guard in main (Stage D
    // contract) — a race with an unindexed file surfaces as a thrown error.
    const vaultPath = store.vaultPath || (await ipc('vault:get-path'));
    const filePath = `${vaultPath.replace(/[\\/]+$/, '')}/${target}.md`;
    await ipc('vault:create-file', filePath, '');
    const tree = await ipc('vault:read-tree');
    useAppStore.getState().setFileTree(tree);
    const content = await ipc('vault:read-file', filePath);
    useAppStore.getState().openFile(filePath, titleFromTarget(target), content);
    if (anchor) scrollToAnchor(anchor);
  } catch (err) {
    console.error(`[wikilink] failed to open/create "${target}"`, err);
  }
}

/**
 * Resolve a wikilink target to an EXISTING note (synchronous — searches the
 * in-memory file tree). Returns null for missing notes (the caller may then fall
 * back to openWikilinkTarget for create-on-click). Used by the preview panel to
 * route body wikilink clicks into the graph/preview explore flow instead of a tab.
 */
export function resolveWikilinkNote(rawTarget: string): { path: string; title: string } | null {
  const hashAt = rawTarget.indexOf('#');
  const target = (hashAt === -1 ? rawTarget : rawTarget.slice(0, hashAt)).trim();
  if (!target) return null;
  const existing = findNoteInTree(useAppStore.getState().fileTree, target);
  return existing ? { path: existing.path, title: titleFromTarget(target) } : null;
}

// ─── Node ───────────────────────────────────────────────────────────────────

export interface WikilinkAttrs {
  target: string;
  alias: string | null;
}

export const WikilinkNode = Node.create({
  name: 'wikilink',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      target: { default: '' },
      alias: { default: null },
    };
  },

  parseHTML() {
    return [{
      tag: 'span[data-type="wikilink"]',
      getAttrs: (el) => {
        const dom = el as HTMLElement;
        return {
          target: dom.getAttribute('data-target') ?? dom.textContent ?? '',
          alias: dom.getAttribute('data-alias'),  // null when attribute absent
        };
      },
    }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const { target, alias } = node.attrs as WikilinkAttrs;
    const label = alias !== null && alias.length > 0 ? alias : target;
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'wikilink',
        'data-target': target,
        ...(alias !== null ? { 'data-alias': alias } : {}),
        class: 'sv-wikilink',
        title: `Open "${target.trim()}"`,
      }),
      label,
    ];
  },

  // tiptap-markdown per-node spec (storage.markdown convention — see
  // node_modules/tiptap-markdown/src/util/extensions.js getMarkdownSpec).
  addStorage() {
    return {
      // Per-editor override: when set (e.g. by the preview panel), a wikilink click
      // calls this instead of opening a tab. Return true if handled; null/false →
      // fall through to the default openWikilinkTarget (open/create in a tab).
      clickHandler: null as ((target: string, alias: string | null) => boolean) | null,
      markdown: {
        serialize(state: any, node: any) {
          const { target, alias } = node.attrs as WikilinkAttrs;
          // state.write = raw output (no escaping) — keeps [[...]] verbatim.
          state.write(serializeWikilink(target, alias));
        },
        parse: {
          // Called by tiptap-markdown before every md.render().
          setup(md: any) {
            registerWikilinkRule(md);
          },
        },
      },
    };
  },

  addProseMirrorPlugins() {
    const ext = this;
    return [
      new Plugin({
        key: new PluginKey('wikilinkClick'),
        props: {
          handleClickOn(_view, _pos, node, _nodePos, _event, direct) {
            if (!direct || node.type.name !== 'wikilink') return false;
            const target = String(node.attrs.target);
            const alias = (node.attrs.alias ?? null) as string | null;
            // Per-editor override (preview panel routes clicks to recenter+explore).
            const handler = ext.editor?.storage?.wikilink?.clickHandler as
              | ((t: string, a: string | null) => boolean) | null | undefined;
            if (handler && handler(target, alias)) return true;
            void openWikilinkTarget(target);
            return true;
          },
        },
      }),
    ];
  },
});
