// Flush a dirty preview note's Edit-segment changes to disk BEFORE the preview is
// re-centered onto another note (graph click / backlink / outlink / local node) or
// opened in a tab. The preview slice is a single mutable object, so swapping it
// without saving silently loses edits (review: critical data-loss). Auto-save then
// swap is the safest default — it never blocks on a dialog and never drops edits.
// Throws on write failure so the caller can ABORT the swap and keep the edits.

import { useAppStore } from '../stores/app-store.js';
import { ipc } from './ipc-client.js';
import { showToast } from './toast.js';

export async function flushDirtyPreview(): Promise<void> {
  const p = useAppStore.getState().previewNote;
  if (!p?.isDirty) return;
  try {
    await ipc('vault:write-file', p.filePath, p.content); // content is markdown source (B1)
    useAppStore.getState().markPreviewClean();
  } catch (err) {
    console.error('[preview] auto-save before swap failed:', err);
    const msg = err instanceof Error ? err.message : String(err);
    showToast(`Auto-save failed: ${p.title} — ${msg}`, 'error', 0);
    throw err; // let the caller abort the re-center so edits aren't lost
  }
}
