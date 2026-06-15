// Capture inbox panel (Design §7) — live capture progress + manual add + pause.

import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { useAppStore } from '../../stores/app-store.js';
import { registerCommand } from '../../lib/commands.js';
import { ipc, onIpc } from '../../lib/ipc-client.js';
import { useT, type MsgKey } from '../../lib/i18n.js';
import type { CaptureItem } from '../../../shared/ipc-types.js';

let captureCommandsRegistered = false;
function registerCaptureCommands(): void {
  if (captureCommandsRegistered) return;
  captureCommandsRegistered = true;
  registerCommand({
    id: 'panel.capture', title: 'Open capture inbox', category: 'Panels',
    defaultKeys: 'mod+shift+k', allowInEditor: true, // not mod+shift+i (= Electron DevTools)
    run: () => useAppStore.getState().setRightPanel('capture'),
  });
}
registerCaptureCommands();

const STATUS_COLOR: Record<CaptureItem['status'], string> = {
  queued: 'var(--ink-faint)', processing: 'var(--accent-2)', done: 'var(--accent)',
  rejected: '#c0556a', duplicate: 'var(--ink-faint)',
};

const btn: CSSProperties = {
  padding: '5px 12px', background: 'var(--hover)', border: '1px solid var(--border)',
  borderRadius: 4, color: 'var(--ink-dim)', fontSize: 11, cursor: 'pointer',
};

export function CapturePanel() {
  const t = useT();
  const [items, setItems] = useState<CaptureItem[]>([]);
  const [paused, setPaused] = useState(false);

  const refresh = useCallback(() => {
    void ipc('capture:list', 60).then(setItems).catch(() => { /* engine not ready */ });
  }, []);

  useEffect(() => {
    refresh();
    const offProg = onIpc('capture:progress', () => refresh());
    const offDone = onIpc('capture:done', () => refresh());
    void ipc('capture:counts').then((c) => setPaused(!c.watching)).catch(() => {});
    return () => { offProg(); offDone(); };
  }, [refresh]);

  const togglePause = useCallback(async () => {
    const next = !paused;
    setPaused(next);
    await ipc('capture:set-paused', next).catch(() => {});
  }, [paused]);

  const pasteLink = useCallback(async () => {
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (!/^https?:\/\//i.test(text)) return;
      await ipc('vault:capture', { kind: 'url', payload: text, source: 'drop' });
      refresh();
    } catch { /* clipboard denied / empty / not a url */ }
  }, [refresh]);

  return (
    <div style={{ padding: 12 }}>
      <div style={{ fontSize: 10, color: 'var(--ink-faint)', marginBottom: 10, lineHeight: 1.5 }}>
        {t('capture.hint')}
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        <button onClick={() => void pasteLink()} style={btn}>{t('capture.pasteLink')}</button>
        <button
          onClick={() => void togglePause()}
          style={{ ...btn, marginLeft: 'auto', color: paused ? 'var(--accent)' : 'var(--ink-dim)' }}
        >
          {paused ? t('capture.resume') : t('capture.pause')}
        </button>
      </div>

      {items.length === 0 && (
        <div style={{ textAlign: 'center', color: 'var(--ink-faint)', fontSize: 11, padding: 20 }}>
          {t('capture.empty')}
        </div>
      )}

      {items.map((it) => (
        <div key={it.id} style={{ padding: '6px 8px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 9, color: STATUS_COLOR[it.status], minWidth: 44 }}>{t(`capture.status.${it.status}` as MsgKey)}</span>
          <span style={{ flex: 1, fontSize: 11, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {it.title}
          </span>
          {it.category && <span style={{ fontSize: 9, color: 'var(--accent-2)' }}>{it.category}</span>}
          {it.decision === 'review' && <span style={{ fontSize: 9, color: 'var(--accent)' }}>{t('capture.review')}</span>}
        </div>
      ))}
    </div>
  );
}
