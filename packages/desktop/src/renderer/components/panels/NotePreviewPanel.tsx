// Note preview panel — web/Obsidian-style READ-ONLY preview. Clicking a graph
// node streams the note here (right panel) instead of stealing the main pane,
// so the graph stays visible. Reuses MarkdownEditor in readOnly mode → the
// rendering matches the editor exactly (callouts, wikilinks, code, math, …).

import { useAppStore } from '../../stores/app-store.js';
import { MarkdownEditor } from '../editor/MarkdownEditor.js';
import { parse as parseFrontmatter } from '../../lib/frontmatter.js';

export function NotePreviewPanel() {
  const preview = useAppStore((s) => s.previewNote);
  const openFile = useAppStore((s) => s.openFile);

  if (!preview) {
    return (
      <div style={{ padding: 20, textAlign: 'center', color: 'var(--ink-faint)', fontSize: 11 }}>
        Click a note in the graph to preview it here
      </div>
    );
  }

  // B1/W1-7: split the YAML so it never enters TipTap (matches EditorArea).
  const body = parseFrontmatter(preview.content).body;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header — note title + "open in editor" escape hatch. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 12px',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <span
          title={preview.title}
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: 12,
            fontWeight: 600,
            color: 'var(--ink)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {preview.title}
        </span>
        <button
          onClick={() => openFile(preview.filePath, preview.title, preview.content)}
          title="Open in editor"
          style={{
            padding: '3px 10px',
            fontSize: 11,
            borderRadius: 4,
            cursor: 'pointer',
            border: '1px solid var(--border)',
            background: 'transparent',
            color: 'var(--accent-2)',
            whiteSpace: 'nowrap',
          }}
        >
          Open ↗
        </button>
      </div>

      {/* Read-only render. key={filePath} forces a fresh editor per note: TipTap
          binds `content` at mount, so without the remount switching notes would
          keep showing the first one. Preview-only → remount cost is fine. */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        <MarkdownEditor key={preview.filePath} content={body} onChange={() => {}} readOnly />
      </div>
    </div>
  );
}
