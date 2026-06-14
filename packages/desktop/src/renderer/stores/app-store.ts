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
  // Stage D additive (W1-7): parsed YAML frontmatter CACHE, set only by
  // updateTabFrontmatter (Properties edits). `content` stays authoritative —
  // EditorArea derives {frontmatter, body} from it via lib/frontmatter.ts.
  frontmatter?: Record<string, unknown>;
  // Wave 2 additive: special tab kinds. 'note' (default, file-backed) or
  // 'graph' (full main-pane GraphView — no file, never dirty, content unused).
  kind?: 'note' | 'graph';
}

// Singleton id for the graph tab — at most one graph tab is ever open.
export const GRAPH_TAB_ID = '__graph-view__';

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
  rightPanel: 'none' | 'graph' | 'ai' | 'backlinks' | 'search' | 'outline' | 'tags' | 'coach'; // T2-6: 'coach'
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
  // Stage D additive (W1-7): Properties edit — caller (EditorArea) recomposes
  // the full markdown `content` (stringify(body, frontmatter)) and passes both.
  updateTabFrontmatter: (id: string, frontmatter: Record<string, unknown>, content: string) => void;
  markTabClean: (id: string) => void;
  // Stage C additive (W1-15) — used only by lib/runtime-sync.ts.
  markTabExternallyChanged: (id: string) => void;
  // T1-8 additive: dismiss the external-change flag without reloading content
  // ("Keep mine" in EditorArea's reload bar).
  clearExternallyChanged: (id: string) => void;
  reloadTab: (id: string, content: string) => void;
  // Stage D additive (W1-3) — used only by components/sidebar/file-ops.ts.
  // Rename support: tab id === filePath, so both are rewritten together.
  renameTabPath: (oldPath: string, newPath: string, newTitle?: string) => void;
  // Stage D additive (W1-17) — drag-reorder in TabBar.
  reorderTabs: (fromIndex: number, toIndex: number) => void;
  // Wave 2 additive: open (or focus) the singleton full-pane graph tab.
  openGraphTab: () => void;

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

  // Stage D additive (W1-7): Properties grid edit — see EditorArea.tsx.
  updateTabFrontmatter: (id, frontmatter, content) => set((s) => ({
    tabs: s.tabs.map((t) => t.id === id ? { ...t, frontmatter, content, isDirty: true } : t),
  })),

  markTabClean: (id) => set((s) => ({
    tabs: s.tabs.map((t) => t.id === id ? { ...t, isDirty: false } : t),
  })),

  // Stage C additive (W1-15): external change handling — see lib/runtime-sync.ts.
  markTabExternallyChanged: (id) => set((s) => ({
    tabs: s.tabs.map((t) => t.id === id ? { ...t, externallyChanged: true } : t),
  })),
  // T1-8 additive: "Keep mine" — clear the flag, leave content/dirty untouched.
  clearExternallyChanged: (id) => set((s) => ({
    tabs: s.tabs.map((t) => t.id === id ? { ...t, externallyChanged: false } : t),
  })),
  reloadTab: (id, content) => set((s) => ({
    tabs: s.tabs.map((t) => t.id === id
      ? { ...t, content, isDirty: false, externallyChanged: false }
      : t),
  })),

  // Stage D additive (W1-3): rename a tab's path in place — see file-ops.ts.
  renameTabPath: (oldPath, newPath, newTitle) => set((s) => ({
    tabs: s.tabs.map((t) => t.filePath === oldPath
      ? { ...t, id: newPath, filePath: newPath, title: newTitle ?? t.title }
      : t),
    activeTabId: s.activeTabId === oldPath ? newPath : s.activeTabId,
  })),

  // Stage D additive (W1-17): drag-reorder — see TabBar.tsx.
  reorderTabs: (fromIndex, toIndex) => set((s) => {
    if (fromIndex === toIndex) return {};
    if (fromIndex < 0 || fromIndex >= s.tabs.length) return {};
    if (toIndex < 0 || toIndex >= s.tabs.length) return {};
    const next = [...s.tabs];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    return { tabs: next };
  }),

  // Wave 2 additive: singleton graph tab — focus if already open.
  openGraphTab: () => set((s) => {
    const existing = s.tabs.find((t) => t.kind === 'graph');
    if (existing) return { activeTabId: existing.id };
    const tab: OpenTab = {
      id: GRAPH_TAB_ID, filePath: '', title: 'Graph',
      isDirty: false, content: '', kind: 'graph',
    };
    return { tabs: [...s.tabs, tab], activeTabId: tab.id };
  }),

  setRightPanel: (panel) => set({ rightPanel: panel }),
  setRightPanelWidth: (w) => set({ rightPanelWidth: w }),
  // Stage C additive (W1-6).
  openSearchWithQuery: (query) => set({ rightPanel: 'search', pendingSearchQuery: query }),
  clearPendingSearchQuery: () => set({ pendingSearchQuery: null }),
  toggleTheme: () => set((s) => ({ theme: s.theme === 'dark' ? 'light' : 'dark' })),
  setVaultPath: (p) => set({ vaultPath: p }),
  setCoreReady: (ready) => set({ coreReady: ready }),
}));
