// Premium markdown renderers for assistant chat output (used by SanitizedMarkdown).
// Presentational only — the content is ALREADY sanitized text by the time these run
// (rehype-sanitize + enforceAppHost). These add a copy button + language label to code
// blocks and keep inline code tight. No new URLs/attributes are introduced.

import React, { useState, useMemo, useRef, useEffect } from 'react';
import type { Components } from 'react-markdown';
import { common, createLowlight } from 'lowlight';
import { visit } from 'unist-util-visit';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import { useT } from './i18n.js';

// One shared highlighter over the "common" language set (js/ts/py/json/bash/css/…). lowlight
// is already a dependency (tiptap code-block). It emits a hast tree of <span class="hljs-*">,
// which we convert to React elements (NO dangerouslySetInnerHTML) — colors come from theme.css.
const lowlight = createLowlight(common);

function langFromClass(className?: string): string {
  const m = /language-([\w-]+)/.exec(className || '');
  return m ? m[1] : '';
}

interface HastNode { type: string; value?: string; tagName?: string; properties?: { className?: string[] }; children?: HastNode[] }

function hastToReact(node: HastNode, key: number): React.ReactNode {
  if (node.type === 'text') return node.value;
  if (node.type === 'element') {
    const cls = node.properties?.className?.join(' ');
    return React.createElement(
      node.tagName || 'span',
      { key, className: cls },
      (node.children || []).map((c, i) => hastToReact(c, i)),
    );
  }
  return null;
}

/** Syntax-highlighted children for a code block, or null if the language is unknown/unsupported. */
function highlight(code: string, lang: string): React.ReactNode | null {
  if (!lang || !lowlight.registered(lang)) return null;
  try {
    const tree = lowlight.highlight(lang, code) as unknown as HastNode;
    return (tree.children || []).map((c, i) => hastToReact(c, i));
  } catch {
    return null;
  }
}

/** Recursively flatten a React node tree to its text — for the copy button. */
function nodeText(node: React.ReactNode): string {
  if (node == null || node === false) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join('');
  if (React.isValidElement(node)) return nodeText((node.props as { children?: React.ReactNode }).children);
  return '';
}

// ── KaTeX math ────────────────────────────────────────────────────────────────
// Render math via katex.render into a ref'd node — NO dangerouslySetInnerHTML (mirrors the
// lowlight hast→React pattern above + the editor's MathExtension). trust:false is LOAD-BEARING:
// it disables \href/\url/\includegraphics/\html*, so KaTeX cannot emit active content; the
// CHAT_SANITIZE_SCHEMA is therefore left byte-for-byte unchanged (math arrives as a raw LaTeX
// string from the remark plugin below, never as HTML through the sanitize pipeline).
function Math({ latex, displayMode }: { latex: string; displayMode: boolean }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    try {
      katex.render(latex, el, { throwOnError: false, trust: false, output: 'html', displayMode });
    } catch {
      el.textContent = displayMode ? `$$${latex}$$` : `$${latex}$`; // inert fallback
    }
  }, [latex, displayMode]);
  return React.createElement(displayMode ? 'div' : 'span', { ref, className: 'sv-math' });
}

interface MdastNode { type: string; value?: string; lang?: string; data?: unknown; children?: MdastNode[] }

/** remark plugin (chat renderer ONLY): split text nodes on $$block$$ / $inline$ into code nodes
 *  tagged with a math className so the `code` component renders <Math>. Guards the '$5 and $10'
 *  false-positive by forbidding a digit immediately inside the single-$ delimiters. The sanitize
 *  schema (which already allows className on code/pre) is untouched. */
export function remarkChatMath() {
  return (tree: MdastNode): void => {
    visit(tree as never, 'text', (node: MdastNode, index: number | null, parent: MdastNode | null) => {
      if (!parent || index === null || typeof node.value !== 'string' || !node.value.includes('$')) return;
      const value = node.value;
      // $$block$$  OR  $inline$ where the opening $ is NOT followed by a space or digit (so
      // "$5 and $10" currency is never math); a math run ending in a digit (e.g. $E=mc^2$) is fine.
      const re = /\$\$([^$]+?)\$\$|\$(?!\s)(?!\d)([^$\n]+?)\$/g;
      const out: MdastNode[] = [];
      let last = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(value)) !== null) {
        if (m.index > last) out.push({ type: 'text', value: value.slice(last, m.index) });
        if (m[1] != null) {
          out.push({ type: 'code', lang: 'math-display', value: m[1].trim(), data: { hProperties: { className: ['language-math-display'] } } });
        } else {
          out.push({ type: 'inlineCode', value: (m[2] ?? '').trim(), data: { hProperties: { className: ['math-inline'] } } });
        }
        last = re.lastIndex;
      }
      if (out.length === 0) return undefined;
      if (last < value.length) out.push({ type: 'text', value: value.slice(last) });
      parent.children!.splice(index, 1, ...out);
      return index + out.length; // continue after the inserted nodes
    });
  };
}

function CodeBlock({ className, children }: { className?: string; children?: React.ReactNode }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const lang = langFromClass(className);
  const raw = useMemo(() => nodeText(children), [children]);
  const highlighted = useMemo(() => highlight(raw, lang), [raw, lang]);
  const copy = () => {
    try {
      void navigator.clipboard.writeText(nodeText(children));
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch { /* clipboard unavailable */ }
  };
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', margin: '8px 0', background: 'var(--hover)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '3px 10px', borderBottom: '1px solid var(--border)', fontSize: 10.5, color: 'var(--ink-faint)' }}>
        <span style={{ fontFamily: 'var(--mono, monospace)', letterSpacing: '0.03em', textTransform: 'lowercase' }}>{lang || 'code'}</span>
        <button
          onClick={copy}
          style={{ background: 'none', border: 'none', padding: '2px 4px', cursor: 'pointer', color: copied ? 'var(--accent-2)' : 'var(--ink-faint)', fontSize: 10.5, fontWeight: 600 }}
        >
          {copied ? t('panel.ai.copied') : t('panel.ai.copy')}
        </button>
      </div>
      <pre className="sv-hl" style={{ margin: 0, padding: '10px 12px', overflowX: 'auto', fontSize: 12.5, lineHeight: 1.55 }}>
        <code className={className} style={{ fontFamily: 'var(--mono, monospace)', background: 'none', padding: 0 }}>{highlighted ?? children}</code>
      </pre>
    </div>
  );
}

export const chatMarkdownComponents: Components = {
  // A fenced code block arrives as <pre><code class="language-x">…; an inline code as a bare
  // <code> with no language- class. Route block → CodeBlock, inline → a tight styled span.
  code({ className, children, ...rest }) {
    const cls = className || '';
    // Math (from remarkChatMath) routes to <Math> before the code-block path.
    if (/math-inline/.test(cls)) return <Math latex={nodeText(children)} displayMode={false} />;
    if (/language-math-display/.test(cls)) return <Math latex={nodeText(children)} displayMode />;
    const isBlock = /language-/.test(cls) || (rest as { 'data-block'?: boolean })['data-block'];
    if (isBlock) return <CodeBlock className={className}>{children}</CodeBlock>;
    return (
      <code style={{ fontFamily: 'var(--mono, monospace)', fontSize: '0.88em', background: 'var(--hover)', border: '1px solid var(--border)', borderRadius: 4, padding: '1px 5px' }}>{children}</code>
    );
  },
  // The default `pre` would double-wrap our CodeBlock (which already renders a <pre>). Pass
  // children through so only CodeBlock's <pre> remains.
  pre({ children }) {
    return <>{children}</>;
  },
};
