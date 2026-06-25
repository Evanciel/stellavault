// Settings store (W1-1) — renderer mirror of ~/.stellavault/desktop-settings.json.
// Hydrates from main via 'settings:get'; writes via 'settings:set' (main persists
// atomically and broadcasts 'settings:changed' back to every window).

import { create } from 'zustand';
import type { AppSettings } from '../../shared/ipc-types.js';
import { settingsGet, settingsSet, onSettingsChanged } from '../lib/ipc-client.js';

// Renderer-side defaults — used only until hydration completes.
// Source of truth lives in main/settings-store.ts (mirrored here, plan §4-B).
export const DEFAULT_SETTINGS: AppSettings = {
  version: 1,
  theme: 'dark',
  language: 'en',
  accent: '#6366f1',
  editor: { fontSize: 15, lineWidth: 720, spellcheck: false },
  hotkeys: {},
  dailyNotes: { folder: 'Daily', format: 'YYYY-MM-DD', templatePath: '' },
  templatesFolder: 'Templates',
  bookmarks: [],
  session: { openTabs: [], activeTab: null },
  window: { width: 1400, height: 900 },
  // T1-9: default pane widths mirror app-store (sidebarWidth 260, rightPanelWidth 380).
  panels: { sidebarWidth: 260, rightPanelWidth: 380 },
  // T1-15: default graph slider values mirror force-sim.ts DEFAULT_SIM_SETTINGS.
  graph: { repel: 8, link: 1, center: 0.15, linkDistance: 60 },
  // T3-9 / T3-7: vault registry + Publish port mirror main getDefaults.
  vaults: [],
  publishPort: 3105,
  // T3-3: Agent Memory (embedded MCP server) does not auto-start by default.
  mcpAutoStart: false,
  // P0-1: review-every-write confirm gate OFF by default (autonomous filing + undo is shipped).
  confirmWrites: false,
};

interface SettingsState {
  settings: AppSettings;
  hydrated: boolean;

  /** Load settings from main once at boot. */
  hydrate: () => Promise<void>;
  /** Persist a patch via main; state updates when the merged result returns. */
  update: (patch: Partial<AppSettings>) => Promise<void>;
  /** Apply a main-process broadcast (settings:changed). */
  applyRemote: (settings: AppSettings) => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  settings: DEFAULT_SETTINGS,
  hydrated: false,

  hydrate: async () => {
    try {
      const settings = await settingsGet();
      set({ settings, hydrated: true });
    } catch (err) {
      console.error('[settings] hydrate failed, using defaults:', err);
      set({ hydrated: true });
    }
  },

  update: async (patch) => {
    // Optimistic local merge so the UI responds instantly; the authoritative
    // merged object from main overwrites it on resolve (and via broadcast).
    set((s) => ({ settings: { ...s.settings, ...patch } }));
    try {
      const merged = await settingsSet(patch);
      set({ settings: merged });
    } catch (err) {
      console.error('[settings] update failed:', err);
    }
  },

  applyRemote: (settings) => set({ settings, hydrated: true }),
}));

/** Boot-time wiring: hydrate + subscribe to broadcasts. Returns unsubscribe. */
export function initSettings(): () => void {
  void useSettingsStore.getState().hydrate();
  return onSettingsChanged((settings) => {
    useSettingsStore.getState().applyRemote(settings);
  });
}

/** Resolve 'system' theme against the OS preference. */
export function resolveTheme(theme: AppSettings['theme']): 'dark' | 'light' {
  if (theme === 'system') {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  return theme;
}
