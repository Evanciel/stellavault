// Table context bar (editor upgrade — benchmark spec P1).
// Rendered by MarkdownEditor when the cursor is inside a table: row/column
// add/delete, header toggle, merge/split, delete table. All commands are
// official TipTap table commands — only this bar UI is custom.

import type { Editor } from '@tiptap/react';
import { useT } from '../../lib/i18n.js';

export function TableControls({ editor }: { editor: Editor }) {
  const t = useT();
  if (!editor.isActive('table')) return null;

  const Btn = ({ label, title, onClick, danger }: {
    label: string; title: string; onClick: () => void; danger?: boolean;
  }) => (
    <button
      title={title}
      aria-label={title}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      style={{
        padding: '2px 8px',
        fontSize: 11,
        border: '1px solid var(--border)',
        borderRadius: 4,
        cursor: 'pointer',
        background: 'transparent',
        color: danger ? '#ef4444' : 'var(--ink-dim)',
      }}
    >
      {label}
    </button>
  );

  return (
    <div
      role="toolbar"
      aria-label="Table controls"
      style={{
        display: 'flex',
        gap: 4,
        alignItems: 'center',
        padding: '4px 8px',
        marginBottom: 8,
        border: '1px solid var(--border)',
        borderRadius: 6,
        background: 'var(--bg-2)',
        flexWrap: 'wrap',
      }}
    >
      <span style={{ fontSize: 10, color: 'var(--ink-faint)', marginRight: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {t('editor.tableControls.label')}
      </span>
      <Btn label="+Row" title={t('editor.tableControls.addRow')} onClick={() => editor.chain().focus().addRowAfter().run()} />
      <Btn label="−Row" title={t('editor.tableControls.deleteRow')} onClick={() => editor.chain().focus().deleteRow().run()} />
      <Btn label="+Col" title={t('editor.tableControls.addCol')} onClick={() => editor.chain().focus().addColumnAfter().run()} />
      <Btn label="−Col" title={t('editor.tableControls.deleteCol')} onClick={() => editor.chain().focus().deleteColumn().run()} />
      <Btn label="Header" title={t('editor.tableControls.header')} onClick={() => editor.chain().focus().toggleHeaderRow().run()} />
      <Btn label="Merge" title={t('editor.tableControls.merge')} onClick={() => editor.chain().focus().mergeOrSplit().run()} />
      <Btn label="× Table" title={t('editor.tableControls.deleteTable')} danger onClick={() => editor.chain().focus().deleteTable().run()} />
    </div>
  );
}
