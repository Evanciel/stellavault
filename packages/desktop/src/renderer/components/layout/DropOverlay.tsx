// Global drop overlay (Design §7) — drop external files/links anywhere to capture.
// Capture-phase listeners claim the drop BEFORE the editor, so PDFs/docs/links dropped
// anywhere (incl. the editor area) are captured; only image-only drops onto the editor
// are left to ProseMirror (in-note image embed). Internal DnD (FileTree/TabBar carry
// application/x-sv-path) is ignored. Dropping opens the Capture panel so progress shows.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppStore } from '../../stores/app-store.js';
import { ipc } from '../../lib/ipc-client.js';

const MAX_FILE = 50 * 1024 * 1024;

function isExternalDrag(dt: DataTransfer | null): boolean {
  if (!dt) return false;
  const types = Array.from(dt.types);
  if (types.includes('application/x-sv-path') || types.includes('application/x-stellavault-internal')) return false;
  return types.includes('Files') || types.includes('text/uri-list') || types.includes('text/plain');
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
        const base64 = await fileToBase64(file);
        if (!base64) continue;
        const res = await ipc('vault:capture', {
          kind: 'file', payload: file.name, source: 'drop',
          sourceMeta: { fileName: file.name, mime: file.type, base64 },
        });
        if (!res || !res.id) console.warn('[capture] engine not ready yet — wait for "AI ready" in the status bar, then re-drop.');
      } catch (err) {
        console.error('[capture] file read failed:', err);
      }
    }
  }, []);

  useEffect(() => {
    const onDragEnter = (e: DragEvent) => {
      if (!isExternalDrag(e.dataTransfer)) return;
      e.preventDefault();
      depth.current += 1;
      setActive(true);
    };
    const onDragOver = (e: DragEvent) => {
      if (!isExternalDrag(e.dataTransfer)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };
    const onDragLeave = (e: DragEvent) => {
      if (!isExternalDrag(e.dataTransfer)) return;
      depth.current -= 1;
      if (depth.current <= 0) { depth.current = 0; setActive(false); }
    };
    const onDrop = (e: DragEvent) => {
      if (!isExternalDrag(e.dataTransfer)) return;
      depth.current = 0;
      setActive(false);
      const dt = e.dataTransfer;
      if (!dt) return;

      const files = dt.files;
      const target = e.target as HTMLElement | null;
      const inEditor = !!(target && target.closest('.ProseMirror'));
      const imageOnly = files && files.length > 0 && Array.from(files).every((f) => f.type.startsWith('image/'));

      // Image dropped into a note → let the editor embed it (don't claim the event).
      if (inEditor && imageOnly) return;

      // Otherwise this is a capture: claim the drop so the editor doesn't also act.
      e.preventDefault();
      e.stopPropagation();

      if (files && files.length > 0) {
        void handleFiles(files);
        setRightPanel('capture'); // surface progress immediately
        return;
      }
      const uri = (dt.getData('text/uri-list') || dt.getData('text/plain') || '').trim();
      if (/^https?:\/\//i.test(uri)) {
        void ipc('vault:capture', { kind: 'url', payload: uri, source: 'drop' });
        setRightPanel('capture');
      } else if (uri) {
        void ipc('vault:capture', { kind: 'text', payload: uri, source: 'drop' });
        setRightPanel('capture');
      }
    };

    // Capture phase (true) → fire before the editor's own drop handler.
    window.addEventListener('dragenter', onDragEnter, true);
    window.addEventListener('dragover', onDragOver, true);
    window.addEventListener('dragleave', onDragLeave, true);
    window.addEventListener('drop', onDrop, true);
    return () => {
      window.removeEventListener('dragenter', onDragEnter, true);
      window.removeEventListener('dragover', onDragOver, true);
      window.removeEventListener('dragleave', onDragLeave, true);
      window.removeEventListener('drop', onDrop, true);
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
