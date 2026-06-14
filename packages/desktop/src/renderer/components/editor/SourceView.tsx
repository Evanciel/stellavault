// T2-3: Source mode — raw markdown in a plain textarea.
//
// Shows the tab's FULL markdown source (frontmatter + body) VERBATIM, exactly
// as it sits in tab.content / on disk. Edits write straight back to
// tab.content (no TipTap round-trip), so what you type is byte-for-byte what
// gets saved — the escape hatch for verifying/repairing markdown the WYSIWYG
// editor would normalize (HTML spans, math, exotic syntax).
//
// NOTE: this binds to the FULL content (not the split body) on purpose — the
// whole value of Source mode is seeing the unmodified file, frontmatter and
// all. EditorArea routes the change back through updateTabContent directly.

import { useEffect, useRef, useState } from 'react';

interface Props {
  /** Full markdown source of the tab (frontmatter + body), verbatim. */
  content: string;
  /** Emits the new full source on every edit. */
  onChange: (content: string) => void;
}

export function SourceView({ content, onChange }: Props) {
  // Local mirror so the caret isn't reset by the controlled round-trip; the
  // textarea is the source of truth while focused. Re-sync if the tab content
  // changes underneath us (external reload / programmatic edit).
  const [value, setValue] = useState(content);
  const dirtyRef = useRef(false);

  useEffect(() => {
    if (!dirtyRef.current) setValue(content);
  }, [content]);

  return (
    <textarea
      className="sv-source-view"
      value={value}
      spellCheck={false}
      aria-label="Markdown source"
      onChange={(e) => {
        dirtyRef.current = true;
        setValue(e.target.value);
        onChange(e.target.value);
      }}
      onBlur={() => { dirtyRef.current = false; }}
      style={{
        display: 'block',
        width: '100%',
        minHeight: 480,
        boxSizing: 'border-box',
        resize: 'none',
        background: 'var(--editor-bg)',
        border: 'none',
        outline: 'none',
        color: 'var(--ink)',
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 13.5,
        lineHeight: 1.6,
        padding: 0,
        whiteSpace: 'pre',
        overflowWrap: 'normal',
        overflowX: 'auto',
        tabSize: 2,
      }}
    />
  );
}
