// TipTap block node: callout (editor upgrade — Naver/Notion/Obsidian parity).
// Proper node (replaces the old fake blockquote+emoji slash shortcut): a
// wrapping block with a `type` attribute (info | warning | tip | …).
//
// Markdown round-trip (assignment §3): serialize/parse delegate to the pure
// rules in ../../lib/markdown.ts (serializeCallout / registerCalloutRule) via
// tiptap-markdown's per-extension `storage.markdown` spec — on disk this is
// Obsidian callout syntax:
//   > [!info]
//   > body…

import { Node, mergeAttributes } from '@tiptap/core';
import { registerCalloutRule, serializeCallout } from '../../lib/markdown.js';

/** Types with dedicated styling in MarkdownEditor's CSS; any other [!word]
 *  from disk is preserved verbatim and rendered with the default look. */
export const CALLOUT_TYPES = ['info', 'warning', 'tip'] as const;
export type CalloutType = (typeof CALLOUT_TYPES)[number];

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    callout: {
      /** Wrap the selection in a callout (or lift out when already inside). */
      toggleCallout: (type?: string) => ReturnType;
      /** Change the type of the callout the cursor is in. */
      setCalloutType: (type: string) => ReturnType;
    };
  }
}

export const CalloutNode = Node.create({
  name: 'callout',
  group: 'block',
  content: 'paragraph+',
  defining: true,

  addAttributes() {
    return {
      type: {
        default: 'info',
        parseHTML: (el) => (el as HTMLElement).getAttribute('data-callout') || 'info',
        // data-callout is emitted in renderHTML below (single source).
        renderHTML: () => ({}),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-callout]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-callout': String(node.attrs.type || 'info'),
        class: 'sv-callout',
      }),
      0,
    ];
  },

  addCommands() {
    return {
      toggleCallout: (type = 'info') => ({ editor, commands }) =>
        editor.isActive(this.name)
          ? commands.lift(this.name)
          : commands.wrapIn(this.name, { type }),
      setCalloutType: (type: string) => ({ commands }) =>
        commands.updateAttributes(this.name, { type }),
    };
  },

  // tiptap-markdown per-node spec (same convention as WikilinkNode).
  addStorage() {
    return {
      markdown: {
        serialize: serializeCallout,
        parse: {
          setup(md: any) {
            registerCalloutRule(md);
          },
        },
      },
    };
  },
});
