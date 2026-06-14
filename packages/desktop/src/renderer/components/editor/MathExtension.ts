// KaTeX math for TipTap (T2-14).
//
// Two surfaces, deliberately split:
//   • Inline math  $E = mc^2$       — decoration overlay over plain text (kept
//     as text in the document → tiptap-markdown round-trips it verbatim; the
//     `$…$` survives a save via restoreEscapedSyntax in lib/markdown.ts).
//   • Display math $$ … $$          — a REAL atom node (`mathBlock`) with a
//     clean source↔render swap: rendered KaTeX is shown when blurred, the raw
//     `$$tex$$` editable textarea appears on focus/click. Serializes back to
//     `$$tex$$` via the node's storage.markdown spec, and parses from markdown
//     via registerMathBlockRule (see lib/markdown.ts).
//
// CSS: bundled locally (import below) instead of a remote CDN <link> — offline
// support + no third-party request under CSP/privacy.

import { Node, mergeAttributes, nodeInputRule } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { registerMathBlockRule } from '../../lib/markdown.js';
// T2-14: bundle KaTeX styles locally (Vite resolves the package's relative
// font URLs from node_modules) — replaces the remote cdn.jsdelivr.net <link>.
import 'katex/dist/katex.min.css';

// Lazy-load KaTeX JS to avoid blocking editor startup. The CSS is bundled
// eagerly (above) but is tiny; the JS engine is the heavy part.
let katexLoaded = false;
let katexRender: ((tex: string, el: HTMLElement, opts: any) => void) | null = null;
const katexWaiters: Array<() => void> = [];

async function ensureKaTeX(): Promise<void> {
  if (katexLoaded) return;
  try {
    const katex = await import('katex');
    katexRender = katex.default?.render ?? (katex as any).render;
    katexLoaded = true;
    // Re-render any nodes that mounted before KaTeX finished loading.
    while (katexWaiters.length) katexWaiters.shift()!();
  } catch {
    console.warn('[MathExtension] KaTeX not available');
  }
}

/** Render `tex` into `el`. Falls back to monospace source if KaTeX is missing
 *  or the expression is invalid. */
function renderInto(el: HTMLElement, tex: string, displayMode: boolean): void {
  if (katexRender) {
    try {
      el.classList.remove('sv-math-error');
      katexRender(tex, el, { displayMode, throwOnError: false, output: 'html' });
      return;
    } catch {
      el.textContent = tex;
      el.classList.add('sv-math-error');
      return;
    }
  }
  // KaTeX not ready yet — show source, then re-render when it loads.
  el.textContent = displayMode ? `$$${tex}$$` : `$${tex}$`;
  el.classList.add('sv-math-pending');
  katexWaiters.push(() => {
    el.classList.remove('sv-math-pending');
    el.replaceChildren();
    renderInto(el, tex, displayMode);
  });
}

// ─── Inline math: $…$ via decorations (text stays in the doc) ───────────────
// Regex to find $...$ — guards against $$ on either side so display math is
// not mistaken for inline.
const INLINE_MATH = /(?<!\$)\$(?!\$)([^$\n]+?)(?<!\$)\$(?!\$)/g;

function inlineMathWidget(tex: string): HTMLElement {
  const el = document.createElement('span');
  el.className = 'sv-math-inline';
  el.setAttribute('data-tex', tex);
  renderInto(el, tex, false);
  return el;
}

function buildInlineDecorations(doc: any): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node: any, pos: number) => {
    if (!node.isText) return;
    const text: string = node.text ?? '';
    const re = new RegExp(INLINE_MATH.source, 'g');
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
      const from = pos + match.index;
      const to = from + match[0].length;
      const tex = match[1].trim();
      if (!tex) continue;
      // Render the math as a widget AFTER the source, and dim the raw `$…$`
      // text so the cursor can still enter it to edit (Obsidian-style).
      decorations.push(
        Decoration.inline(from, to, { class: 'sv-math-src' }),
        Decoration.widget(to, () => inlineMathWidget(tex), { side: 1 }),
      );
    }
  });
  return DecorationSet.create(doc, decorations);
}

/** Inline-math decoration plugin — attached by the display-math node so the
 *  whole math feature lives in one extension. */
function inlineMathPlugin(): Plugin {
  void ensureKaTeX();
  return new Plugin({
    key: new PluginKey('svInlineMath'),
    state: {
      init: (_, state) => buildInlineDecorations(state.doc),
      apply: (tr, old) => (tr.docChanged ? buildInlineDecorations(tr.doc) : old),
    },
    props: { decorations(state) { return this.getState(state); } },
  });
}

// ─── Display math: real `mathBlock` atom node with source↔render swap ────────

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    mathBlock: {
      /** Insert a display-math block, optionally pre-filled with `tex`. */
      insertMathBlock: (tex?: string) => ReturnType;
    };
  }
}

export const MathExtension = Node.create({
  name: 'mathBlock',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      tex: { default: '' },
    };
  },

  parseHTML() {
    return [{
      tag: 'div[data-math-block]',
      getAttrs: (el) => ({ tex: (el as HTMLElement).getAttribute('data-tex') ?? '' }),
    }];
  },

  renderHTML({ HTMLAttributes, node }) {
    return ['div', mergeAttributes(HTMLAttributes, {
      'data-math-block': '',
      'data-tex': String(node.attrs.tex ?? ''),
      class: 'sv-math-display',
    })];
  },

  addCommands() {
    return {
      insertMathBlock:
        (tex = '') =>
        ({ chain }) =>
          chain().insertContent({ type: this.name, attrs: { tex } }).run(),
    };
  },

  // `$$ … $$` on its own line → mathBlock. Captures the inner tex.
  addInputRules() {
    return [
      nodeInputRule({
        find: /\$\$([^$]+)\$\$$/,
        type: this.type,
        getAttributes: (match) => ({ tex: (match[1] ?? '').trim() }),
      }),
    ];
  },

  // Clean source↔render swap: a NodeView that shows rendered KaTeX, and swaps
  // to an editable <textarea> of the raw `$$tex$$` on click/focus.
  addNodeView() {
    return ({ node, editor, getPos }) => {
      void ensureKaTeX();
      let tex: string = String(node.attrs.tex ?? '');
      let editing = false;

      const dom = document.createElement('div');
      dom.className = 'sv-math-display';
      dom.setAttribute('data-math-block', '');

      const rendered = document.createElement('div');
      rendered.className = 'sv-math-rendered';

      const textarea = document.createElement('textarea');
      textarea.className = 'sv-math-editor';
      textarea.spellcheck = false;
      textarea.style.display = 'none';

      function paintRendered() {
        rendered.replaceChildren();
        if (tex.trim()) {
          renderInto(rendered, tex, true);
        } else {
          rendered.textContent = 'Empty math block — click to edit';
          rendered.classList.add('sv-math-empty');
        }
      }
      paintRendered();

      function enterEdit() {
        if (editing || !editor.isEditable) return;
        editing = true;
        textarea.value = tex;
        textarea.style.display = 'block';
        rendered.style.display = 'none';
        // Defer focus so the click that triggered us doesn't steal it back.
        requestAnimationFrame(() => {
          textarea.focus();
          textarea.setSelectionRange(textarea.value.length, textarea.value.length);
          autosize();
        });
      }

      function commit() {
        if (!editing) return;
        editing = false;
        const next = textarea.value;
        textarea.style.display = 'none';
        rendered.style.display = '';
        if (next !== tex) {
          tex = next;
          const pos = typeof getPos === 'function' ? getPos() : null;
          if (pos != null) {
            editor.view.dispatch(editor.view.state.tr.setNodeMarkup(pos, undefined, { tex }));
          }
        }
        paintRendered();
      }

      function autosize() {
        textarea.style.height = 'auto';
        textarea.style.height = `${textarea.scrollHeight}px`;
      }

      rendered.addEventListener('mousedown', (e) => { e.preventDefault(); enterEdit(); });
      textarea.addEventListener('input', autosize);
      textarea.addEventListener('blur', commit);
      textarea.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
          e.preventDefault();
          commit();
          editor.commands.focus();
        }
      });

      dom.appendChild(rendered);
      dom.appendChild(textarea);

      return {
        dom,
        update(updated) {
          if (updated.type.name !== 'mathBlock') return false;
          if (!editing) {
            tex = String(updated.attrs.tex ?? '');
            paintRendered();
          }
          return true;
        },
        stopEvent: () => editing, // let the textarea own its events while editing
        ignoreMutation: () => true,
        destroy() {
          textarea.removeEventListener('input', autosize);
        },
      };
    };
  },

  addProseMirrorPlugins() {
    return [inlineMathPlugin()];
  },

  // tiptap-markdown spec: serialize → $$tex$$ on its own block. Parse is wired
  // in lib/markdown.ts (registerMathBlockRule) so the rule lives beside the
  // other custom block rules (callout/wikilink).
  addStorage() {
    return {
      markdown: {
        serialize(state: any, node: any) {
          state.write(`$$${String(node.attrs.tex ?? '').trim()}$$`);
          state.closeBlock(node);
        },
        parse: {
          setup(md: any) {
            registerMathBlockRule(md);
          },
        },
      },
    };
  },
});
