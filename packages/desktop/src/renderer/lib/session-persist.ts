// Session persistence + Stage D command registration (W1-10/11/17).
// Imported once (side-effect) from main.tsx — init is idempotent.
//
//  • Restore: once settings hydrate, reopen settings.session.openTabs and the
//    active tab (files read via vault:read-file; missing files are skipped).
//  • Persist: debounced subscribe on the app-store — whenever open tab paths
//    or the active tab change, write settings.session via 'settings:set'.
//  • Commands: template-aware daily note (overrides the Stage B builtin
//    'file.daily-note' — same id + same mod+shift+d chord, so the palette
//    keeps a single entry; a 'daily.open-today' alias id would double-bind
//    the hotkey), bookmark current note, Ctrl+Tab / Ctrl+Shift+Tab cycling.
//  • Close guard (B5, renderer-only): main/index.ts is owned by another
//    agent this stage, so instead of the window:close-request round-trip we
//    install a beforeunload guard — Electron blocks the close while any tab
//    is dirty. Limitation: no native confirm dialog is shown (Chromium
//    suppresses the beforeunload prompt in Electron); the close is silently
//    refused until tabs are saved. Full main-side round-trip lands later.

import { useAppStore } from '../stores/app-store.js';
import { useSettingsStore } from '../stores/settings-store.js';
import { ipc, settingsSet } from './ipc-client.js';
import { registerBuiltinCommands, registerCommand } from './commands.js';
import { openDailyNote } from '../components/sidebar/CalendarWidget.js';
import { bookmarkCurrentNote } from '../components/sidebar/BookmarksSection.js';

function basename(p: string): string {
  const norm = p.replace(/\\/g, '/');
  return norm.slice(norm.lastIndexOf('/') + 1).replace(/\.md$/i, '');
}

// ─── Commands (W1-10/11/17) ───

function cycleTab(direction: 1 | -1): void {
  const s = useAppStore.getState();
  if (s.tabs.length < 2) return;
  const idx = s.tabs.findIndex((t) => t.id === s.activeTabId);
  const next = (idx + direction + s.tabs.length) % s.tabs.length;
  s.setActiveTab(s.tabs[next].id);
}

function registerStageDCommands(): void {
  // Builtins first (idempotent) so our daily-note override wins regardless of
  // App.tsx's later registerBuiltinCommands() call (Map.set, no re-run).
  registerBuiltinCommands();

  registerCommand({
    id: 'file.daily-note', title: "Open today's daily note", category: 'File',
    defaultKeys: 'mod+shift+d',
    run: () => openDailyNote(new Date()),
  });
  registerCommand({
    id: 'bookmark.current', title: 'Bookmark current note', category: 'File',
    run: () => bookmarkCurrentNote(),
  });
  registerCommand({
    id: 'tab.next', title: 'Next tab', category: 'View',
    defaultKeys: 'mod+tab', allowInEditor: true,
    run: () => cycleTab(1),
  });
  registerCommand({
    id: 'tab.prev', title: 'Previous tab', category: 'View',
    defaultKeys: 'mod+shift+tab', allowInEditor: true,
    run: () => cycleTab(-1),
  });
}

// ─── Session restore + persist (W1-17) ───

let restoreDone = false;

async function restoreSession(): Promise<void> {
  const { openTabs, activeTab } = useSettingsStore.getState().settings.session;
  try {
    for (const filePath of openTabs) {
      try {
        const content = await ipc('vault:read-file', filePath);
        useAppStore.getState().openFile(filePath, basename(filePath), content);
      } catch {
        // File moved/deleted since last session — skip silently.
      }
    }
    if (activeTab && useAppStore.getState().tabs.some((t) => t.id === activeTab)) {
      useAppStore.getState().setActiveTab(activeTab);
    }
  } finally {
    restoreDone = true; // persistence only starts after restore completes
  }
}

function startPersist(): void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastKey = '';

  useAppStore.subscribe((state) => {
    if (!restoreDone) return;
    const openTabs = state.tabs.map((t) => t.filePath);
    const key = `${openTabs.join('\u0000')}|${state.activeTabId ?? ''}`;
    if (key === lastKey) return;
    lastKey = key;

    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      const s = useAppStore.getState();
      settingsSet({
        session: {
          openTabs: s.tabs.map((t) => t.filePath),
          activeTab: s.activeTabId,
        },
      }).catch((err) => console.warn('[session] persist failed:', err));
    }, 800);
  });
}

// ─── Window close guard (B5, renderer side) ───

function installCloseGuard(): void {
  window.addEventListener('beforeunload', (e) => {
    const dirty = useAppStore.getState().tabs.some((t) => t.isDirty);
    if (!dirty) return;
    // Electron honors preventDefault in beforeunload — the close is refused.
    e.preventDefault();
    e.returnValue = false;
  });
}

// ─── Init (idempotent) ───

let initialized = false;

export function initSessionPersist(): void {
  if (initialized) return;
  initialized = true;

  registerStageDCommands();
  installCloseGuard();
  startPersist();

  // Restore once settings hydrate (App.tsx triggers hydration on mount).
  const state = useSettingsStore.getState();
  if (state.hydrated) {
    void restoreSession();
  } else {
    const unsub = useSettingsStore.subscribe((s) => {
      if (!s.hydrated || restoreDone) return;
      unsub();
      void restoreSession();
    });
  }
}

// Side-effect on import (main.tsx imports this module once).
initSessionPersist();
