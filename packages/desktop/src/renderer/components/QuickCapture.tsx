// Quick capture (hermes absorb, v0.20 quick-entry) — the ENTIRE UI of the tiny always-on-top
// window main opens on the global hotkey (renderer entry renders this for location.hash
// '#capture'). One textarea: Enter files the text into the vault through the SAME audited
// capture funnel as drag-drop/clip ('vault:capture', kind:'text', source:'quick'), Esc hides.
// No vault browsing, no other IPC — the window's whole job is "thought in, note filed".
import { useCallback, useEffect, useRef, useState } from 'react';
import { ipc } from '../lib/ipc-client.js';
import { useT } from '../lib/i18n.js';

export function QuickCapture() {
  const t = useT();
  const [text, setText] = useState('');
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  // The window is hidden (not destroyed) between uses — refocus + reset whenever it reappears.
  useEffect(() => {
    const onFocus = () => { setState('idle'); taRef.current?.focus(); };
    window.addEventListener('focus', onFocus);
    taRef.current?.focus();
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  const hide = useCallback(() => {
    setText('');
    setState('idle');
    void ipc('capture:hide').catch(() => {});
  }, []);

  const submit = useCallback(async () => {
    const body = text.trim();
    if (!body || state === 'saving') return;
    setState('saving');
    try {
      const r = await ipc('vault:capture', { kind: 'text', payload: body.slice(0, 20_000), source: 'quick' });
      if ((r as { id?: string })?.id) {
        setState('saved');
        setTimeout(hide, 550); // brief ✓ then hide — the note is queued in the funnel
      } else {
        setState('error');
      }
    } catch {
      setState('error');
    }
  }, [text, state, hide]);

  return (
    <div style={{
      height: '100vh', display: 'flex', flexDirection: 'column', gap: 6, padding: 10,
      background: 'var(--bg-1, #0a0a0f)', color: 'var(--ink, #e0e0f0)',
      fontFamily: 'system-ui, sans-serif', boxSizing: 'border-box',
      border: '1px solid var(--border, #2a2a3a)', borderRadius: 8,
    }}>
      <div style={{ fontSize: 11, color: 'var(--ink-dim, #9a9ab0)', display: 'flex', justifyContent: 'space-between' }}>
        <span>✦ {t('quickCapture.title')}</span>
        <span>
          {state === 'saving' ? t('quickCapture.saving')
            : state === 'saved' ? t('quickCapture.saved')
            : state === 'error' ? t('quickCapture.error')
            : t('quickCapture.hint')}
        </span>
      </div>
      <textarea
        ref={taRef}
        value={text}
        onChange={(e) => setText(e.target.value.slice(0, 20_000))}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void submit(); }
          else if (e.key === 'Escape') { e.preventDefault(); hide(); }
        }}
        placeholder={t('quickCapture.placeholder')}
        aria-label={t('quickCapture.title')}
        autoFocus
        style={{
          flex: 1, resize: 'none', padding: '8px 10px', fontSize: 13, lineHeight: 1.5,
          background: 'var(--bg-2, #12121a)', color: 'var(--ink, #e0e0f0)',
          border: '1px solid var(--border, #2a2a3a)', borderRadius: 6, outline: 'none',
        }}
      />
    </div>
  );
}
