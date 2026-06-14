// T2-3: editor view-mode toggle (Live / Reading / Source).
//
// A small segmented control rendered in the editor pane header. Reads + writes
// the per-tab mode via useUiStore (lib/commands.ts) so the toolbar and the
// `view.editor-*` commands stay in sync. Keyed by tab id — each open note
// remembers its own mode.

import { useUiStore, type ViewMode } from '../../lib/commands.js';

const MODES: { id: ViewMode; label: string; title: string }[] = [
  { id: 'live', label: 'Live', title: 'Live (WYSIWYG)' },
  { id: 'reading', label: 'Reading', title: 'Reading (rendered, read-only)' },
  { id: 'source', label: 'Source', title: 'Source (raw markdown)' },
];

export function ViewModeToggle({ tabId }: { tabId: string }) {
  const mode = useUiStore((s) => s.viewModes[tabId] ?? 'live');
  const setViewMode = useUiStore((s) => s.setViewMode);

  return (
    <div className="sv-mode-toggle" role="group" aria-label="Editor view mode">
      {MODES.map((m) => {
        const active = mode === m.id;
        return (
          <button
            key={m.id}
            type="button"
            title={m.title}
            aria-pressed={active}
            onClick={() => setViewMode(tabId, m.id)}
            style={{
              padding: '3px 9px',
              fontSize: 11,
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer',
              background: active ? 'var(--selection)' : 'transparent',
              color: active ? 'var(--accent-2)' : 'var(--ink-faint)',
              fontWeight: active ? 600 : 400,
            }}
          >
            {m.label}
          </button>
        );
      })}
    </div>
  );
}
