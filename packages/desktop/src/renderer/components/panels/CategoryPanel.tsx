// Category browser panel (Design §7) — the "촤라락" view of emergent + user categories.
// MVP: a flat list with origin + member count, refreshing as captures land.

import { useEffect, useState, type CSSProperties } from 'react';
import { useAppStore } from '../../stores/app-store.js';
import { registerCommand } from '../../lib/commands.js';
import { ipc, onIpc } from '../../lib/ipc-client.js';
import type { CategoryInfo } from '../../../shared/ipc-types.js';

let categoryCommandsRegistered = false;
function registerCategoryCommands(): void {
  if (categoryCommandsRegistered) return;
  categoryCommandsRegistered = true;
  registerCommand({
    id: 'panel.categories', title: 'Open categories', category: 'Panels',
    defaultKeys: 'mod+shift+g', allowInEditor: true, // not mod+shift+c (= inspect element)
    run: () => useAppStore.getState().setRightPanel('categories'),
  });
}
registerCategoryCommands();

const row: CSSProperties = { display: 'flex', gap: 8, alignItems: 'center', padding: '6px 8px', borderBottom: '1px solid var(--border)' };

export function CategoryPanel() {
  const [cats, setCats] = useState<CategoryInfo[]>([]);

  useEffect(() => {
    const refresh = () => void ipc('categories:list').then(setCats).catch(() => {});
    refresh();
    const off = onIpc('capture:done', () => refresh());
    const off2 = onIpc('review:changed', () => refresh());
    return () => { off(); off2(); };
  }, []);

  if (cats.length === 0) {
    return (
      <div style={{ textAlign: 'center', color: 'var(--ink-faint)', fontSize: 12, padding: 28 }}>
        No categories yet &mdash; they emerge as you capture.
      </div>
    );
  }

  return (
    <div style={{ padding: 12 }}>
      {cats.map((c) => (
        <div key={c.id} style={row}>
          <span style={{ flex: 1, fontSize: 12, color: 'var(--ink)' }}>{c.label}</span>
          <span style={{ fontSize: 9, color: 'var(--ink-faint)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{c.origin}</span>
          <span style={{ fontSize: 10, color: 'var(--ink-dim)', minWidth: 24, textAlign: 'right' }}>{c.memberCount}</span>
        </div>
      ))}
    </div>
  );
}
