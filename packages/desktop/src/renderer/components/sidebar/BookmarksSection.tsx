// Bookmarks section (W1-11) — lists settings.bookmarks; click opens the note
// or runs a saved search; remove button edits settings.
//
// Placement note: Sidebar.tsx is owned by another agent this stage, so this is
// mounted as a collapsible section inside DailyBrief.tsx (same as CalendarWidget).
// Persisted via the settings store (W1-1) — no new IPC.

import { useState } from 'react';
import { useAppStore } from '../../stores/app-store.js';
import { useSettingsStore } from '../../stores/settings-store.js';
import { ipc } from '../../lib/ipc-client.js';
import { useT } from '../../lib/i18n.js';
import type { AppSettings } from '../../../shared/ipc-types.js';

type Bookmark = AppSettings['bookmarks'][number];

function basename(p: string): string {
  const norm = p.replace(/\\/g, '/');
  return norm.slice(norm.lastIndexOf('/') + 1).replace(/\.md$/i, '');
}

/** Add the active tab as a note bookmark (idempotent). Used by the
 *  'bookmark.current' command registered in lib/session-persist.ts. */
export async function bookmarkCurrentNote(): Promise<void> {
  const app = useAppStore.getState();
  const tab = app.tabs.find((t) => t.id === app.activeTabId);
  if (!tab) return;
  const settingsStore = useSettingsStore.getState();
  const bookmarks = settingsStore.settings.bookmarks;
  if (bookmarks.some((b) => b.type === 'note' && b.target === tab.filePath)) return;
  await settingsStore.update({
    bookmarks: [...bookmarks, { type: 'note', target: tab.filePath, label: tab.title }],
  });
}

export function BookmarksSection() {
  const t = useT();
  const bookmarks = useSettingsStore((s) => s.settings.bookmarks);
  const update = useSettingsStore((s) => s.update);
  const openFile = useAppStore((s) => s.openFile);
  const openSearchWithQuery = useAppStore((s) => s.openSearchWithQuery);
  const [collapsed, setCollapsed] = useState(false);

  async function handleOpen(bm: Bookmark): Promise<void> {
    if (bm.type === 'search') {
      openSearchWithQuery(bm.target);
      return;
    }
    try {
      const content = await ipc('vault:read-file', bm.target);
      openFile(bm.target, bm.label || basename(bm.target), content);
    } catch (err) {
      console.error('[bookmarks] failed to open note:', err);
    }
  }

  function handleRemove(bm: Bookmark): void {
    void update({
      bookmarks: bookmarks.filter((b) => !(b.type === bm.type && b.target === bm.target)),
    });
  }

  return (
    <section style={{ marginBottom: 24 }}>
      <button
        onClick={() => setCollapsed((c) => !c)}
        aria-expanded={!collapsed}
        style={headerButtonStyle}
      >
        <span style={{ marginRight: 8 }}>{collapsed ? '▸' : '▾'}</span>
        {t('sidebar.bookmarksTitle')}
      </button>

      {!collapsed && (
        bookmarks.length === 0 ? (
          <div style={emptyCardStyle}>
            <p style={{ fontSize: 12, color: 'var(--ink-faint)', margin: 0 }}>
              {t('sidebar.bookmarksEmpty')}
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {bookmarks.map((bm) => (
              <div
                key={`${bm.type}:${bm.target}`}
                style={rowStyle}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--accent)'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)'; }}
              >
                <button
                  onClick={() => void handleOpen(bm)}
                  title={bm.target}
                  style={labelButtonStyle}
                >
                  <span style={{ marginRight: 8, fontSize: 11, flexShrink: 0 }}>
                    {bm.type === 'search' ? '🔍' : '📄'}
                  </span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {bm.label || basename(bm.target)}
                  </span>
                </button>
                <button
                  aria-label={`${t('sidebar.removeBookmark')} ${bm.label}`}
                  onClick={() => handleRemove(bm)}
                  style={removeButtonStyle}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--ink)'; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--ink-faint)'; }}
                >
                  &#x2715;
                </button>
              </div>
            ))}
          </div>
        )
      )}
    </section>
  );
}

// ─── Styles ───

const headerButtonStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  width: '100%',
  background: 'transparent',
  border: 'none',
  padding: 0,
  margin: '0 0 10px',
  cursor: 'pointer',
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--ink-dim)',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  fontFamily: 'inherit',
  textAlign: 'left',
};

const emptyCardStyle: React.CSSProperties = {
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  padding: '12px 14px',
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  transition: 'border-color 0.15s',
};

const labelButtonStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  display: 'flex',
  alignItems: 'center',
  background: 'transparent',
  border: 'none',
  padding: '8px 4px 8px 12px',
  fontSize: 12,
  color: 'var(--ink)',
  cursor: 'pointer',
  fontFamily: 'inherit',
  textAlign: 'left',
};

const removeButtonStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: 'var(--ink-faint)',
  cursor: 'pointer',
  fontSize: 11,
  padding: '8px 10px',
  flexShrink: 0,
};
