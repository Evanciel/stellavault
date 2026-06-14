// Draggable vertical resize handle for the sidebar / right panel (T1-9).
//
// Pointer-drag with min/max clamp. `side` controls drag direction:
//   'right' (handle on the RIGHT edge of an element, e.g. sidebar) → width
//           grows as the pointer moves right.
//   'left'  (handle on the LEFT edge of an element, e.g. right panel) → width
//           grows as the pointer moves left.
// onResize fires the clamped width live during drag; onCommit fires once on
// pointer-up (used to persist the final width into settings — avoids spamming
// settings:set on every pointermove).

import { useCallback, useRef } from 'react';

interface Props {
  side: 'left' | 'right';
  width: number;          // current width of the panel being resized
  min: number;
  max: number;
  onResize: (w: number) => void;
  onCommit?: (w: number) => void;
}

export function ResizeHandle({ side, width, min, max, onResize, onCommit }: Props) {
  const latestRef = useRef(width);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = width;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMove = (ev: PointerEvent) => {
      const delta = ev.clientX - startX;
      const raw = side === 'right' ? startWidth + delta : startWidth - delta;
      const clamped = Math.min(max, Math.max(min, raw));
      latestRef.current = clamped;
      onResize(clamped);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      onCommit?.(latestRef.current);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [side, width, min, max, onResize, onCommit]);

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize panel"
      onPointerDown={onPointerDown}
      style={{
        width: 6,
        flexShrink: 0,
        cursor: 'col-resize',
        // Slightly negative margin so the 6px hit-area straddles the 1px border
        // without shifting layout.
        marginLeft: side === 'left' ? -3 : 0,
        marginRight: side === 'right' ? -3 : 0,
        position: 'relative',
        zIndex: 5,
      }}
      // Visual: a faint accent line on hover only (keeps the chrome quiet).
      onMouseEnter={(e) => { (e.currentTarget.firstChild as HTMLElement).style.opacity = '1'; }}
      onMouseLeave={(e) => { (e.currentTarget.firstChild as HTMLElement).style.opacity = '0'; }}
    >
      <div style={{
        position: 'absolute',
        inset: '0 2px',
        background: 'var(--accent)',
        opacity: 0,
        transition: 'opacity 0.12s',
      }} />
    </div>
  );
}
