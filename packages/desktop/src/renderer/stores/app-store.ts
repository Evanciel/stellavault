// Global app state — tabs, sidebar, active panel, settings.

import { create } from 'zustand';
import type { FileTreeNode } from '../../shared/ipc-types.js';

export interface OpenTab {
  id: string;        // Unique tab ID (typically file path)
  filePath: string;
  title: string;
  isDirty: boolean;
  // Markdown SOURCE of the note — never TipTap HTML (B1, plan §4-A).
  // Loaded verbatim from vault:read-file; updated via editorToMarkdown
  // (renderer/lib/markdown.ts); written verbatim by vault:write-file.
  content: string;
  // Stage C additive (W1-15): set by lib/runtime-sync.ts when the file changed
  // on disk while this tab was dirty. TabBar/EditorArea display lands in a later stage.
  externallyChanged?: boolean;
}

interface AppState {
  // Sidebar
  sidebarWidth: number;
  sidebarCollapsed: boolean;
  fileTree: FileTreeNode[];
  expandedFolders: Set<string>;

  // Tabs
  tabs: OpenTab[];
  activeTabId: string | null;

  // Panel (Stage C adds 'search' | 'outline' | 'tags' — W1-4/5/6)
  rightPanel: 'none' | 'graph' | 'ai' | 'backlinks' | 'search' | 'outline' | 'tags';
  rightPanelWidth: number;

  // Stage C additive (W1-6): cross-panel search hand-off — TagsPanel (or any
  // caller) sets a query via openSearchWithQuery(); SearchPanel consumes it,
  // then calls clearPendingSearchQuery().
  pendingSearchQuery: string | null;

  // Theme
  theme: 'dark' | 'light';

  // Vault
  vaultPath: string;
  coreReady: boolean;

  // Actions
  setSidebarWidth: (w: number) => void;
  toggleSidebar: () => void;
  setFileTree: (tree: FileTreeNode[]) => void;
  toggleFolder: (path: string) => void;

  openFile: (filePath: string, title: string, content: string) => void;
  closeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  updateTabContent: (id: string, content: string) => void;
  markTabClean: (id: string) => void;
  // Stage C additive (W1-15) — used only by lib/runtime-sync.ts.
  markTabExternallyChanged: (id: string) => void;
  reloadTab: (id: string, content: string) => void;

  setRightPanel: (panel: AppState['rightPanel']) => void;
  setRightPanelWidth: (w: number) => void;
  // Stage C additive (W1-6).
  openSearchWithQuery: (query: string) => void;
  clearPendingSearchQuery: () => void;
  toggleTheme: () => void;
  setVaultPath: (p: string) => void;
  setCoreReady: (ready: boolean) => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  sidebarWidth: 260,
  sidebarCollapsed: false,
  fileTree: [],
  expandedFolders: new Set<string>(),

  tabs: [],
  activeTabId: null,

  rightPanel: 'none',
  rightPanelWidth: 380,
  pendingSearchQuery: null,

  theme: 'dark',
  vaultPath: '',
  coreReady: false,

  setSidebarWidth: (w) => set({ sidebarWidth: w }),
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setFileTree: (tree) => set({ fileTree: tree }),
  toggleFolder: (path) => set((s) => {
    const next = new Set(s.expandedFolders);
    if (next.has(path)) next.delete(path); else next.add(path);
    return { expandedFolders: next };
  }),

  openFile: (filePath, title, content) => set((s) => {
    const existing = s.tabs.find((t) => t.filePath === filePath);
    if (existing) {
      return { activeTabId: existing.id };
    }
    const tab: OpenTab = { id: filePath, filePath, title, isDirty: false, content };
    return { tabs: [...s.tabs, tab], activeTabId: tab.id };
  }),

  closeTab: (id) => set((s) => {
    const idx = s.tabs.findIndex((t) => t.id === id);
    if (idx === -1) return {};
    const next = s.tabs.filter((t) => t.id !== id);
    let activeTabId = s.activeTabId;
    if (activeTabId === id) {
      activeTabId = next[Math.min(idx, next.length - 1)]?.id ?? null;
    }
    return { tabs: next, activeTabId };
  }),

  setActiveTab: (id) => set({ activeTabId: id }),

  updateTabContent: (id, content) => set((s) => ({
    tabs: s.tabs.map((t) => t.id === id ? { ...t, content, isDirty: true } : t),
  })),

  markTabClean: (id) => set((s) => ({
    tabs: s.tabs.map((t) => t.id === id ? { ...t, isDirty: false } : t),
  })),

  // Stage C additive (W1-15): external change handling — see lib/runtime-sync.ts.
  markTabExternallyChanged: (id) => set((s) => ({
    tabs: s.tabs.map((t) => t.id === id ? { ...t, externallyChanged: true } : t),
  })),
  reloadTab: (id, content) => set((s) => ({
    tabs: s.tabs.map((t) => t.id === id
      ? { ...t, content, isDirty: false, externallyChanged: false }
      : t),
  })),

  setRightPanel: (panel) => set({ rightPanel: panel }),
  setRightPanelWidth: (w) => set({ rightPanelWidth: w }),
  // Stage C additive (W1-6).
  openSearchWithQuery: (query) => set({ rightPanel: 'search', pendingSearchQuery: query }),
  clearPendingSearchQuery: () => set({ pendingSearchQuery: null }),
  toggleTheme: () => set((s) => ({ theme: s.theme === 'dark' ? 'light' : 'dark' })),
  setVaultPath: (p) => set({ vaultPath: p }),
  setCoreReady: (ready) => set({ coreReady: ready }),
}));
