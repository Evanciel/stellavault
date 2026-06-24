// React NodeView for CodeBlockLowlight (T1-14) — adds a language <select> and
// a copy button to the top of every code block, Notion/Obsidian-style.
//
// CodeBlockLowlight stores the language in the node attr `language`; the
// markdown serializer (tiptap-markdown) emits ```<language> fences from it, so
// changing the picker round-trips to disk as ```ts / ```python / etc. The
// <pre><code> content stays driven by NodeViewContent so editing + lowlight
// highlighting are unaffected.

import { NodeViewContent, NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react';
import { useState } from 'react';
import { useT } from '../../lib/i18n.js';

// A short, high-traffic language list for the picker. 'auto' → no language attr
// (lowlight auto-detects). Any language already on a node but missing here is
// appended at render time so it is never silently dropped.
const TOP_LANGUAGES = [
  'auto', 'text', 'javascript', 'typescript', 'jsx', 'tsx', 'python', 'java',
  'go', 'rust', 'c', 'cpp', 'csharp', 'json', 'yaml', 'toml', 'bash', 'shell',
  'sql', 'html', 'css', 'markdown', 'diff', 'dockerfile',
];

export function CodeBlockView(props: ReactNodeViewProps) {
  const { node, updateAttributes, extension } = props;
  const t = useT();
  const language: string = (node.attrs.language as string) || 'auto';
  const [copied, setCopied] = useState(false);

  const options = TOP_LANGUAGES.includes(language)
    ? TOP_LANGUAGES
    : [...TOP_LANGUAGES, language];

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(node.textContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch (err) {
      console.error('[code-block] copy failed:', err);
    }
  };

  return (
    <NodeViewWrapper className="sv-code-block-wrap">
      <div className="sv-code-block-bar" contentEditable={false}>
        <select
          className="sv-code-lang"
          value={language}
          aria-label={t('editor.codeBlock.languageAriaLabel')}
          // Stop the editor from intercepting key/mouse while choosing.
          onMouseDown={(e) => e.stopPropagation()}
          onChange={(e) => {
            const v = e.target.value;
            updateAttributes({ language: v === 'auto' ? null : v });
          }}
        >
          {options.map((l) => (
            <option key={l} value={l}>{l}</option>
          ))}
        </select>
        <button
          type="button"
          className="sv-code-copy"
          onClick={onCopy}
          aria-label={t('editor.codeBlock.copyAriaLabel')}
        >
          {copied ? t('common.copied') : t('common.copy')}
        </button>
      </div>
      <pre className={extension.options.HTMLAttributes?.class as string | undefined}>
        <NodeViewContent as="code" />
      </pre>
    </NodeViewWrapper>
  );
}
