// Global app state — tabs, sidebar, active panel, settings.

import { create } from 'zustand';
import type { FileTreeNode } from '../../shared/ipc-types.js';

export interface OpenTab {
  id: string;        // Unique tab ID (typically file path)
  filePath: string;
  title: string;
  isDirty: boolean;
  content: string;   // Current editor content
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

  // Panel
  rightPanel: 'none' | 'graph' | 'ai' | 'backlinks';
  rightPanelWidth: number;

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

  setRightPanel: (panel: AppState['rightPanel']) => void;
  setRightPanelWidth: (w: number) => void;
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

  setRightPanel: (panel) => set({ rightPanel: panel }),
  setRightPanelWidth: (w) => set({ rightPanelWidth: w }),
  toggleTheme: () => set((s) => ({ theme: s.theme === 'dark' ? 'light' : 'dark' })),
  setVaultPath: (p) => set({ vaultPath: p }),
  setCoreReady: (ready) => set({ coreReady: ready }),
}));
