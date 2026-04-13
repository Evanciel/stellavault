// KaTeX math rendering for TipTap.
// Inline math: $E = mc^2$
// Display math: $$\int_0^\infty e^{-x} dx = 1$$

import { Node, mergeAttributes } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

// Lazy-load KaTeX to avoid blocking editor startup
let katexLoaded = false;
let katexRender: ((tex: string, el: HTMLElement, opts: any) => void) | null = null;

async function ensureKaTeX() {
  if (katexLoaded) return;
  try {
    const katex = await import('katex');
    katexRender = katex.default?.render ?? katex.render;
    katexLoaded = true;
    // Inject KaTeX CSS
    if (!document.getElementById('katex-css')) {
      const link = document.createElement('link');
      link.id = 'katex-css';
      link.rel = 'stylesheet';
      link.href = 'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css';
      document.head.appendChild(link);
    }
  } catch {
    console.warn('[MathExtension] KaTeX not available');
  }
}

// Regex to find $...$ (inline) and $$...$$ (display) in text
const INLINE_MATH = /(?<!\$)\$(?!\$)(.+?)(?<!\$)\$(?!\$)/g;
const DISPLAY_MATH = /\$\$(.+?)\$\$/gs;

function renderMath(tex: string, displayMode: boolean): HTMLElement {
  const el = document.createElement(displayMode ? 'div' : 'span');
  el.className = displayMode ? 'sv-math-display' : 'sv-math-inline';
  el.setAttribute('data-tex', tex);

  if (katexRender) {
    try {
      katexRender(tex, el, { displayMode, throwOnError: false, output: 'html' });
    } catch {
      el.textContent = tex;
      el.style.color = '#ef4444';
    }
  } else {
    el.textContent = displayMode ? `$$${tex}$$` : `$${tex}$`;
    el.style.fontFamily = 'monospace';
    el.style.color = 'var(--accent-2)';
  }

  return el;
}

export const MathExtension = Node.create({
  name: 'mathBlock',
  group: 'block',
  content: 'text*',
  marks: '',
  atom: true,

  addAttributes() {
    return {
      tex: { default: '' },
      displayMode: { default: true },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-math]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-math': '' }), 0];
  },

  addProseMirrorPlugins() {
    // Load KaTeX on first use
    void ensureKaTeX();

    return [
      new Plugin({
        key: new PluginKey('mathDecorations'),
        state: {
          init(_, state) {
            return buildDecorations(state.doc);
          },
          apply(tr, old) {
            if (tr.docChanged) return buildDecorations(tr.doc);
            return old;
          },
        },
        props: {
          decorations(state) {
            return this.getState(state);
          },
        },
      }),
    ];
  },
});

function buildDecorations(doc: any): DecorationSet {
  const decorations: Decoration[] = [];

  doc.descendants((node: any, pos: number) => {
    if (!node.isText) return;
    const text = node.text ?? '';

    // Display math $$...$$
    let match;
    const displayRegex = new RegExp(DISPLAY_MATH.source, 'gs');
    while ((match = displayRegex.exec(text)) !== null) {
      const from = pos + match.index;
      const to = from + match[0].length;
      const tex = match[1].trim();

      decorations.push(
        Decoration.widget(from, () => renderMath(tex, true), { side: -1 })
      );
    }

    // Inline math $...$
    const inlineRegex = new RegExp(INLINE_MATH.source, 'g');
    while ((match = inlineRegex.exec(text)) !== null) {
      // Skip if inside a display math
      const fullMatch = match[0];
      if (text.substring(match.index - 1, match.index) === '$') continue;

      const from = pos + match.index;
      const to = from + fullMatch.length;
      const tex = match[1].trim();

      decorations.push(
        Decoration.widget(to, () => renderMath(tex, false), { side: 1 })
      );
    }
  });

  return DecorationSet.create(doc, decorations);
}
