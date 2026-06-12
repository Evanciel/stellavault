// Reusable right-click context menu (W1-3 — Stage D).
// Fixed-position overlay; closes on outside click, Escape, window blur, or
// a second context-menu invocation. Viewport-clamped via useLayoutEffect.

import { useLayoutEffect, useRef, useState, useEffect } from 'react';

export interface MenuItem {
  label: string;
  danger?: boolean;
  onClick: () => void;
}

export type MenuEntry = MenuItem | 'separator';

interface Props {
  x: number;
  y: number;
  entries: MenuEntry[];
  onClose: () => void;
}

export function ContextMenu({ x, y, entries, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  // Clamp to viewport once we know our rendered size.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const px = Math.min(x, window.innerWidth - rect.width - 8);
    const py = Math.min(y, window.innerHeight - rect.height - 8);
    setPos({ x: Math.max(4, px), y: Math.max(4, py) });
  }, [x, y, entries.length]);

  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    function onBlur() { onClose(); }
    // capture phase so clicks that stopPropagation elsewhere still close us
    document.addEventListener('mousedown', onMouseDown, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', onBlur);
    return () => {
      document.removeEventListener('mousedown', onMouseDown, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('blur', onBlur);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      role="menu"
      style={{
        position: 'fixed',
        left: pos.x,
        top: pos.y,
        zIndex: 10002,
        minWidth: 160,
        background: 'var(--bg-2)',
        border: '1px solid var(--border)',
        borderRadius: 6,
        boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
        padding: '4px 0',
        fontSize: 12,
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {entries.map((entry, i) =>
        entry === 'separator' ? (
          <div key={`sep-${i}`} style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
        ) : (
          <div
            key={entry.label}
            role="menuitem"
            onClick={() => { onClose(); entry.onClick(); }}
            style={{
              padding: '5px 14px',
              cursor: 'pointer',
              color: entry.danger ? '#ef4444' : 'var(--ink-dim)',
              whiteSpace: 'nowrap',
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'var(--hover)'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
          >
            {entry.label}
          </div>
        ),
      )}
    </div>
  );
}
