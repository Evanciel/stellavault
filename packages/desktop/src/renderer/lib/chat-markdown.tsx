// Premium markdown renderers for assistant chat output (used by SanitizedMarkdown).
// Presentational only — the content is ALREADY sanitized text by the time these run
// (rehype-sanitize + enforceAppHost). These add a copy button + language label to code
// blocks and keep inline code tight. No new URLs/attributes are introduced.

import React, { useState } from 'react';
import type { Components } from 'react-markdown';
import { useT } from './i18n.js';

function langFromClass(className?: string): string {
  const m = /language-([\w-]+)/.exec(className || '');
  return m ? m[1] : '';
}

/** Recursively flatten a React node tree to its text — for the copy button. */
function nodeText(node: React.ReactNode): string {
  if (node == null || node === false) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join('');
  if (React.isValidElement(node)) return nodeText((node.props as { children?: React.ReactNode }).children);
  return '';
}

function CodeBlock({ className, children }: { className?: string; children?: React.ReactNode }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const lang = langFromClass(className);
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
      <pre style={{ margin: 0, padding: '10px 12px', overflowX: 'auto', fontSize: 12.5, lineHeight: 1.55 }}>
        <code className={className} style={{ fontFamily: 'var(--mono, monospace)', background: 'none', padding: 0 }}>{children}</code>
      </pre>
    </div>
  );
}

export const chatMarkdownComponents: Components = {
  // A fenced code block arrives as <pre><code class="language-x">…; an inline code as a bare
  // <code> with no language- class. Route block → CodeBlock, inline → a tight styled span.
  code({ className, children, ...rest }) {
    const isBlock = /language-/.test(className || '') || (rest as { 'data-block'?: boolean })['data-block'];
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
