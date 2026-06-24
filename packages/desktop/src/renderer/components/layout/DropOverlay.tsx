// Global drop overlay (Design §7) — drop external files/links anywhere to capture.
// Capture-phase listeners claim the drop BEFORE the editor, so PDFs/docs/links dropped
// anywhere (incl. the editor area) are captured; only image-only drops onto the editor
// are left to ProseMirror (in-note image embed). Internal DnD (FileTree/TabBar carry
// application/x-sv-path) is ignored. Dropping opens the Capture panel so progress shows.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppStore } from '../../stores/app-store.js';
import { ipc } from '../../lib/ipc-client.js';
import { showToast } from '../../lib/toast.js';

const MAX_FILE = 50 * 1024 * 1024;
// window + document both listen (some Electron builds deliver an OS file drop to
// only one) — this guards onDrop against double-processing the same event.
const handledDrops = new WeakSet<DragEvent>();

// Internal DnD (FileTree/TabBar carry these markers) must pass through untouched.
// For everything else we preventDefault generously on dragenter/over so Chromium
// actually FIRES the `drop` event — it silently drops the drop otherwise. (The old
// allow-list check returned false mid-drag for some file types → no preventDefault →
// no drop → "nothing happens".)
function isInternalDrag(dt: DataTransfer | null): boolean {
  if (!dt) return false;
  const types = Array.from(dt.types);
  return types.includes('application/x-sv-path') || types.includes('application/x-stellavault-internal');
}

async function fileToBase64(file: File): Promise<string> {
  const dataUrl: string = await new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(r.error);
    r.readAsDataURL(file);
  });
  const comma = dataUrl.indexOf(',');
  return comma === -1 ? '' : dataUrl.slice(comma + 1);
}

export function DropOverlay() {
  const setRightPanel = useAppStore((s) => s.setRightPanel);
  const [active, setActive] = useState(false);
  const depth = useRef(0);

  const handleFiles = useCallback(async (files: FileList) => {
    for (const file of Array.from(files)) {
      if (file.size > MAX_FILE) { console.warn(`[capture] skipping ${file.name} (>50MB)`); continue; }
      try {
        // Path capture goes through the preload-only captureDroppedFile: the real
        // path is resolved INSIDE preload via webUtils.getPathForFile and can't be
        // forged by the renderer (Codex P1). base64-over-IPC is the fallback for
        // files with no backing path (and large drops that silently failed on it).
        let res: { id: string } | null = null;
        let usedPath = false;
        try {
          res = await window.stellavault.captureDroppedFile(file, { fileName: file.name, mime: file.type });
          usedPath = true;
        } catch {
          const base64 = await fileToBase64(file);
          res = base64 ? await ipc('vault:capture', { kind: 'file', payload: file.name, source: 'drop', sourceMeta: { fileName: file.name, mime: file.type, base64 } }) : null;
        }
        console.log('[capture] capture →', { usedPath, res });
        if (res && !res.id) console.warn('[capture] engine not ready yet — wait for "AI ready" in the status bar, then re-drop.');
      } catch (err) {
        console.error('[capture] file capture failed:', err);
      }
    }
  }, []);

  useEffect(() => {
    const onDragEnter = (e: DragEvent) => {
      if (isInternalDrag(e.dataTransfer)) return;
      e.preventDefault();              // required so the later `drop` can fire
      depth.current += 1;
      setActive(true);
    };
    const onDragOver = (e: DragEvent) => {
      if (isInternalDrag(e.dataTransfer)) return;
      e.preventDefault();              // Chromium discards the `drop` without this
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };
    const onDragLeave = (e: DragEvent) => {
      if (isInternalDrag(e.dataTransfer)) return;
      depth.current -= 1;
      if (depth.current <= 0) { depth.current = 0; setActive(false); }
    };
    const onDrop = (e: DragEvent) => {
      if (isInternalDrag(e.dataTransfer)) return;
      if (handledDrops.has(e)) return;   // window + document both fire — process once
      handledDrops.add(e);
      depth.current = 0;
      setActive(false);
      const dt = e.dataTransfer;
      const files = dt?.files;
      const uri = files && files.length > 0
        ? ''
        : (dt?.getData('text/uri-list') || dt?.getData('text/plain') || '').trim();
      // Visible-without-DevTools confirmation that the drop reached us at all.
      const n = files?.length ?? 0;
      showToast(n > 0 ? `📥 Drop received — ${n} file(s)` : uri ? '📥 Drop received — link' : '📥 Drop received (empty)', 'info');
      console.log('[capture] drop', { types: dt ? Array.from(dt.types) : [], files: n, uri: uri.slice(0, 80) });
      if (!dt) return;

      const target = e.target as HTMLElement | null;
      const inEditor = !!(target && target.closest('.ProseMirror'));
      const imageOnly = !!files && files.length > 0 && Array.from(files).every((f) => f.type.startsWith('image/'));

      // Image dropped into a note → let the editor embed it (don't claim the event).
      if (inEditor && imageOnly) return;
      // Nothing capturable (e.g. an in-app text selection, no files/uri) → pass through.
      if ((!files || files.length === 0) && !uri) return;

      // Otherwise this is a capture: claim the drop so the editor/file-tree don't also act.
      e.preventDefault();
      e.stopPropagation();

      if (files && files.length > 0) {
        void handleFiles(files);
        setRightPanel('capture'); // surface progress immediately
        return;
      }
      const kind = /^https?:\/\//i.test(uri) ? 'url' : 'text';
      void ipc('vault:capture', { kind, payload: uri, source: 'drop' });
      setRightPanel('capture');
    };

    // Capture phase (true) → fire before the editor's own drop handler. Attach to
    // BOTH window and document: certain Electron/Chromium builds route OS file drops
    // to only one of them. onDrop dedupes via handledDrops; the symmetric double
    // dragenter/leave on the depth counter nets out.
    const targets: Array<Window | Document> = [window, document];
    for (const tg of targets) {
      tg.addEventListener('dragenter', onDragEnter as EventListener, true);
      tg.addEventListener('dragover', onDragOver as EventListener, true);
      tg.addEventListener('dragleave', onDragLeave as EventListener, true);
      tg.addEventListener('drop', onDrop as EventListener, true);
    }
    return () => {
      for (const tg of targets) {
        tg.removeEventListener('dragenter', onDragEnter as EventListener, true);
        tg.removeEventListener('dragover', onDragOver as EventListener, true);
        tg.removeEventListener('dragleave', onDragLeave as EventListener, true);
        tg.removeEventListener('drop', onDrop as EventListener, true);
      }
    };
  }, [handleFiles, setRightPanel]);

  if (!active) return null;
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999, pointerEvents: 'none',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'color-mix(in srgb, var(--accent) 12%, transparent)',
      border: '3px dashed var(--accent)',
    }}>
      <div style={{
        padding: '18px 28px', borderRadius: 12, background: 'var(--bg-1, #0a0a0f)',
        border: '1px solid var(--accent)', color: 'var(--ink)', fontSize: 15, fontWeight: 600,
        boxShadow: '0 8px 40px rgba(0,0,0,0.4)',
      }}>
        📥 Drop to capture into your vault
      </div>
    </div>
  );
}
