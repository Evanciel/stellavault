// Minimal inline toast — vanilla DOM (no React) so any module (TipTap
// extensions, store subscribers, save handlers) can surface a transient
// message. Styled with the same CSS vars as lib/ui-requests.ts / Modal.tsx.
//
// Created for T1-12 (save write-failure feedback) and reused by T1-8
// (external-change auto-reload notice). NEW file on purpose — keeps this
// helper off main/index.ts so the security agent's edits don't collide.

export type ToastKind = 'info' | 'success' | 'error';

let container: HTMLDivElement | null = null;

function ensureContainer(): HTMLDivElement {
  if (container && document.body.contains(container)) return container;
  container = document.createElement('div');
  container.setAttribute('aria-live', 'polite');
  container.style.cssText = `
    position:fixed; bottom:20px; right:20px; z-index:10002;
    display:flex; flex-direction:column; gap:8px; align-items:flex-end;
    pointer-events:none;
  `;
  document.body.appendChild(container);
  return container;
}

const ACCENTS: Record<ToastKind, string> = {
  info: 'var(--accent,#6366f1)',
  success: 'var(--accent-2,#22c55e)',
  error: '#ef4444',
};

/**
 * Show a transient toast. Returns immediately. `durationMs` <= 0 keeps it until
 * the user clicks it (used for errors the user should acknowledge).
 */
export function showToast(message: string, kind: ToastKind = 'info', durationMs = 3500): void {
  const root = ensureContainer();

  const el = document.createElement('div');
  el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  el.style.cssText = `
    pointer-events:auto; max-width:360px; box-sizing:border-box;
    background:var(--bg-2,#0f0f18);
    border:1px solid var(--border,rgba(100,120,255,0.12));
    border-left:3px solid ${ACCENTS[kind]}; border-radius:8px;
    box-shadow:0 8px 28px rgba(0,0,0,0.45);
    padding:10px 14px; font-size:12.5px; line-height:1.5;
    color:var(--ink,#e0e0f0); cursor:pointer;
    opacity:0; transform:translateY(6px); transition:opacity .14s, transform .14s;
  `;
  el.textContent = message;

  let removed = false;
  function remove(): void {
    if (removed) return;
    removed = true;
    el.style.opacity = '0';
    el.style.transform = 'translateY(6px)';
    setTimeout(() => el.remove(), 160);
  }

  el.addEventListener('click', remove);
  root.appendChild(el);
  // next frame → enter transition
  requestAnimationFrame(() => { el.style.opacity = '1'; el.style.transform = 'translateY(0)'; });

  if (durationMs > 0) setTimeout(remove, durationMs);
}
