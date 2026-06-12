// Runtime sync (Stage C) — renderer side of two background loops:
//   W1-14: FSRS access tracking — record an 'open' access whenever the user
//          activates a tab (debounced: once per file per 5 minutes).
//   W1-15: external file changes — main emits 'file:changed'; if the file is
//          open and clean we silently reload it, if dirty we flag the tab
//          (tab.externallyChanged — display lands in a later stage).
//
// Imported once (side-effect) from main.tsx; init is idempotent.

import { useAppStore } from '../stores/app-store.js';
import { ipc, onIpc } from './ipc-client.js';

// ─── Raw bridge invoke ───
// Stage C IPC contract channels ('core:record-access', 'core:ask',
// 'core:decay-list', 'core:related', …) live in shared/ipc-types.ts which is
// owned by another agent — until that lands, cast through the same underlying
// window.stellavault.invoke the typed client uses (preload allowlist is the
// real runtime boundary). Other Stage C renderer files reuse this helper.
export function invokeIpcRaw<T>(channel: string, ...args: unknown[]): Promise<T> {
  const invoke = window.stellavault.invoke as unknown as
    (c: string, ...a: unknown[]) => Promise<T>;
  return invoke(channel, ...args);
}

// ─── W1-14: FSRS access recording ───

const OPEN_DEBOUNCE_MS = 5 * 60 * 1000;
/** filePath → last time an 'open' access was recorded. Module-level on purpose. */
const lastOpenRecorded = new Map<string, number>();

/**
 * Record a FSRS access for a note. 'open' (weak signal) is debounced to once
 * per file per 5 minutes; 'review' (strong, explicit) always fires.
 */
export function recordAccess(filePath: string, kind: 'open' | 'review'): void {
  if (kind === 'open') {
    const now = Date.now();
    const last = lastOpenRecorded.get(filePath) ?? 0;
    if (now - last < OPEN_DEBOUNCE_MS) return;
    lastOpenRecorded.set(filePath, now);
  }
  invokeIpcRaw<void>('core:record-access', filePath, kind).catch((err) => {
    console.warn('[runtime-sync] record-access failed:', err);
  });
}

// ─── Init (idempotent) ───

let initialized = false;

export function initRuntimeSync(): void {
  if (initialized) return;
  initialized = true;

  // W1-14: whenever the active tab changes, record an 'open' access.
  let prevActiveTabId = useAppStore.getState().activeTabId;
  useAppStore.subscribe((state) => {
    if (state.activeTabId === prevActiveTabId) return;
    prevActiveTabId = state.activeTabId;
    const tab = state.tabs.find((t) => t.id === state.activeTabId);
    if (tab) recordAccess(tab.filePath, 'open');
  });

  // W1-15: external change → reload clean tabs, flag dirty ones.
  onIpc('file:changed', (payload) => {
    // Main may emit a bare path (Stage C contract) or the IpcEventMap object.
    const filePath = typeof payload === 'string'
      ? payload
      : (payload as { filePath?: string } | undefined)?.filePath;
    if (!filePath) return;

    const s = useAppStore.getState();
    const tab = s.tabs.find((t) => t.filePath === filePath);
    if (!tab) return;

    if (tab.isDirty) {
      s.markTabExternallyChanged(tab.id);
      return;
    }
    ipc('vault:read-file', filePath)
      .then((content) => useAppStore.getState().reloadTab(tab.id, content))
      .catch(() => useAppStore.getState().markTabExternallyChanged(tab.id));
  });
}

// Side-effect on import (main.tsx imports this module once).
initRuntimeSync();
