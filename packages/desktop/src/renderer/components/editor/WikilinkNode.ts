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
 * Open the note a wikilink points to; create it first if missing.
 * Exposed for WikilinkSuggestion / future command-palette use.
 */
export async function openWikilinkTarget(rawTarget: string): Promise<void> {
  // Strip heading/block anchors ([[Note#Heading]]) and trim for resolution.
  const target = rawTarget.split('#')[0].trim();
  if (!target) return;

  const store = useAppStore.getState();
  const existing = findNoteInTree(store.fileTree, target);

  try {
    if (existing) {
      const content = await ipc('vault:read-file', existing.path);
      useAppStore.getState().openFile(existing.path, titleFromTarget(target), content);
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
  } catch (err) {
    console.error(`[wikilink] failed to open/create "${target}"`, err);
  }
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
    return [
      new Plugin({
        key: new PluginKey('wikilinkClick'),
        props: {
          handleClickOn(_view, _pos, node, _nodePos, _event, direct) {
            if (!direct || node.type.name !== 'wikilink') return false;
            void openWikilinkTarget(String(node.attrs.target));
            return true;
          },
        },
      }),
    ];
  },
});
