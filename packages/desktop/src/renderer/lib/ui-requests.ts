// Promise-based UI requests — replaces window.prompt() which freezes Electron.
// Vanilla DOM modal (no React) so non-component code (TipTap extensions) can use it.
// Styled with the same CSS vars as components/ui/Modal.tsx.

export function requestText(title: string, placeholder = ''): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false;

    const overlay = document.createElement('div');
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', title);
    overlay.style.cssText = `
      position:fixed; inset:0; background:rgba(0,0,0,0.5); z-index:10001;
      display:flex; justify-content:center; padding-top:18vh;
    `;

    const panel = document.createElement('div');
    panel.style.cssText = `
      width:380px; height:fit-content; background:var(--bg-2,#0f0f18);
      border:1px solid var(--border,rgba(100,120,255,0.12)); border-radius:10px;
      box-shadow:0 16px 48px rgba(0,0,0,0.5); overflow:hidden;
    `;

    const header = document.createElement('div');
    header.style.cssText = `
      padding:14px 18px; border-bottom:1px solid var(--border,rgba(100,120,255,0.12));
      font-size:13px; font-weight:600; color:var(--ink,#e0e0f0);
    `;
    header.textContent = title;

    const body = document.createElement('div');
    body.style.cssText = 'padding:16px 18px;';

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = placeholder;
    input.setAttribute('aria-label', title);
    input.style.cssText = `
      width:100%; box-sizing:border-box; background:var(--hover,rgba(255,255,255,0.04));
      border:1px solid var(--border,rgba(100,120,255,0.12)); border-radius:4px;
      padding:8px 12px; font-size:13px; color:var(--ink,#e0e0f0); outline:none;
      margin-bottom:12px;
    `;

    const buttons = document.createElement('div');
    buttons.style.cssText = 'display:flex; gap:8px; justify-content:flex-end;';

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.cssText = `
      padding:6px 14px; background:var(--hover,rgba(255,255,255,0.04));
      border:1px solid var(--border,rgba(100,120,255,0.12)); border-radius:4px;
      color:var(--ink-dim,#9a9ab0); cursor:pointer; font-size:12px;
    `;

    const okBtn = document.createElement('button');
    okBtn.textContent = 'Insert';
    okBtn.style.cssText = `
      padding:6px 14px; background:var(--accent,#6366f1); border:none; border-radius:4px;
      color:#fff; cursor:pointer; font-size:12px;
    `;

    function finish(value: string | null) {
      if (settled) return;
      settled = true;
      document.removeEventListener('keydown', onKeyDown, true);
      overlay.remove();
      resolve(value);
    }

    function submit() {
      const val = input.value.trim();
      finish(val || null);
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(null); }
      else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); submit(); }
    }

    cancelBtn.addEventListener('click', () => finish(null));
    okBtn.addEventListener('click', submit);
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) finish(null); });
    document.addEventListener('keydown', onKeyDown, true);

    buttons.appendChild(cancelBtn);
    buttons.appendChild(okBtn);
    body.appendChild(input);
    body.appendChild(buttons);
    panel.appendChild(header);
    panel.appendChild(body);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    setTimeout(() => input.focus(), 50);
  });
}

export function requestImageUrl(): Promise<string | null> {
  return requestText('Insert image', 'https://example.com/image.png');
}
