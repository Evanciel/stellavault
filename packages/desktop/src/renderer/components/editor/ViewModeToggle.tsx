// T2-3: editor view-mode toggle (Live / Reading / Source).
//
// A small segmented control rendered in the editor pane header. Reads + writes
// the per-tab mode via useUiStore (lib/commands.ts) so the toolbar and the
// `view.editor-*` commands stay in sync. Keyed by tab id — each open note
// remembers its own mode.

import { useUiStore, type ViewMode } from '../../lib/commands.js';
import { useT } from '../../lib/i18n.js';

const MODES: { id: ViewMode; labelKey: 'viewMode.live.label' | 'viewMode.reading.label' | 'viewMode.source.label'; titleKey: 'viewMode.live.title' | 'viewMode.reading.title' | 'viewMode.source.title' }[] = [
  { id: 'live', labelKey: 'viewMode.live.label', titleKey: 'viewMode.live.title' },
  { id: 'reading', labelKey: 'viewMode.reading.label', titleKey: 'viewMode.reading.title' },
  { id: 'source', labelKey: 'viewMode.source.label', titleKey: 'viewMode.source.title' },
];

export function ViewModeToggle({ tabId }: { tabId: string }) {
  const t = useT();
  const mode = useUiStore((s) => s.viewModes[tabId] ?? 'live');
  const setViewMode = useUiStore((s) => s.setViewMode);

  return (
    <div className="sv-mode-toggle" role="group" aria-label={t('viewMode.ariaLabel')}>
      {MODES.map((m) => {
        const active = mode === m.id;
        return (
          <button
            key={m.id}
            type="button"
            title={t(m.titleKey)}
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
            {t(m.labelKey)}
          </button>
        );
      })}
    </div>
  );
}
