// Review queue panel (Design §7) — confidence-gated items needing a category.

import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { useAppStore } from '../../stores/app-store.js';
import { registerCommand } from '../../lib/commands.js';
import { ipc, onIpc } from '../../lib/ipc-client.js';
import { useT } from '../../lib/i18n.js';
import type { ReviewItem } from '../../../shared/ipc-types.js';

let reviewCommandsRegistered = false;
function registerReviewCommands(): void {
  if (reviewCommandsRegistered) return;
  reviewCommandsRegistered = true;
  registerCommand({
    id: 'panel.review', title: 'Open review queue', category: 'Panels',
    defaultKeys: 'mod+shift+u', allowInEditor: true, // not mod+shift+r (= reload)
    run: () => useAppStore.getState().setRightPanel('review'),
  });
}
registerReviewCommands();

const card: CSSProperties = { padding: 10, marginBottom: 8, background: 'var(--hover)', border: '1px solid var(--border)', borderRadius: 6 };
const chip: CSSProperties = { padding: '3px 8px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 12, color: 'var(--accent-2)', fontSize: 10, cursor: 'pointer' };
const smallBtn: CSSProperties = { padding: '3px 8px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--ink-dim)', fontSize: 10, cursor: 'pointer' };

export function ReviewQueuePanel() {
  const t = useT();
  const openFile = useAppStore((s) => s.openFile);
  const [items, setItems] = useState<ReviewItem[]>([]);

  const refresh = useCallback(() => {
    void ipc('review:list').then(setItems).catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
    const off = onIpc('review:changed', () => refresh());
    const offDone = onIpc('capture:done', () => refresh());
    return () => { off(); offDone(); };
  }, [refresh]);

  const confirm = useCallback(async (id: string, categoryId: string) => {
    await ipc('review:confirm', id, categoryId).catch(() => {});
    refresh();
  }, [refresh]);

  const skip = useCallback(async (id: string) => {
    await ipc('review:skip', id).catch(() => {});
    refresh();
  }, [refresh]);

  const open = useCallback((notePath: string, title: string) => {
    void ipc('vault:read-file', notePath).then((content) => openFile(notePath, title, content)).catch(() => {});
  }, [openFile]);

  if (items.length === 0) {
    return (
      <div style={{ textAlign: 'center', color: 'var(--ink-faint)', fontSize: 12, padding: 28 }}>
        {t('review.empty')}
      </div>
    );
  }

  return (
    <div style={{ padding: 12 }}>
      <div style={{ fontSize: 10, color: 'var(--ink-faint)', marginBottom: 10 }}>
        {t('review.needCategory', { n: items.length })}
      </div>
      {items.map((it) => (
        <div key={it.id} style={card}>
          <div
            onClick={() => open(it.notePath, it.title)}
            title={it.notePath}
            style={{ fontSize: 12, color: 'var(--ink)', fontWeight: 600, cursor: 'pointer', marginBottom: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          >
            {it.title}
          </div>
          {it.suggestions.length > 0 ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
              {it.suggestions.map((s) => (
                <button key={s.id} onClick={() => void confirm(it.id, s.id)} style={chip} title={s.label}>
                  {s.label} <span style={{ opacity: 0.5 }}>{Math.round(s.sim * 100)}%</span>
                </button>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: 10, color: 'var(--ink-faint)', marginBottom: 6 }}>{t('review.noMatch')}</div>
          )}
          <div style={{ display: 'flex' }}>
            <button onClick={() => void skip(it.id)} style={{ ...smallBtn, marginLeft: 'auto' }}>{t('common.skip')}</button>
          </div>
        </div>
      ))}
    </div>
  );
}
