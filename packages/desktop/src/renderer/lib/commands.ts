// Command registry (W1-12) — single source of truth for every app action.
// Palette, hotkeys, and (Wave 3) the plugin API all dispatch through here.

import { create } from 'zustand';
import { useAppStore } from '../stores/app-store.js';
import { useSettingsStore } from '../stores/settings-store.js';
import { ipc } from './ipc-client.js';

export interface CommandDef {
  id: string;
  title: string;
  category: string;
  run: () => void | Promise<void>;
  /** Normalized chord, e.g. 'mod+shift+p'. Overridable via settings.hotkeys. */
  defaultKeys?: string;
  /** Fire even when focus is inside an input/textarea/contenteditable. */
  allowInEditor?: boolean;
}

const registry = new Map<string, CommandDef>();

export function registerCommand(cmd: CommandDef): void {
  registry.set(cmd.id, cmd);
}

export function listCommands(): CommandDef[] {
  return [...registry.values()];
}

export function getCommand(id: string): CommandDef | undefined {
  return registry.get(id);
}

export function runCommand(id: string): void {
  const cmd = registry.get(id);
  if (!cmd) {
    console.warn(`[commands] Unknown command: ${id}`);
    return;
  }
  void cmd.run();
}

// ─── UI state shared between commands and the modal components ───
// Lives here (not app-store.ts) so the registry stays self-contained.

/** Settings modal tab ids — mirrored by SettingsModal.tsx. */
export type SettingsTabId = 'general' | 'editor' | 'appearance' | 'hotkeys' | 'about';

/** T2-3: per-tab editor view mode.
 *  - live    → WYSIWYG TipTap editor (default)
 *  - reading → rendered, read-only (no toolbar/editing chrome)
 *  - source  → raw markdown in a plain textarea (verbatim tab.content) */
export type ViewMode = 'live' | 'reading' | 'source';

interface UiState {
  paletteOpen: boolean;
  paletteMode: 'command' | 'new-note';
  switcherOpen: boolean;
  settingsOpen: boolean;
  /** Tab the settings modal should show when (re)opened. */
  settingsTab: SettingsTabId;
  /** Diagnostics text shown by the palette's stats modal. */
  statsText: string | null;
  /** T2-3: view mode per tab id. Absent → 'live'. */
  viewModes: Record<string, ViewMode>;
  // T2-4: in-note find & replace overlay. 'find' = Ctrl+F (search only);
  // 'replace' = Ctrl+H (search + replace row). null = closed.
  findReplaceMode: 'find' | 'replace' | null;

  setPaletteOpen: (open: boolean, mode?: 'command' | 'new-note') => void;
  setSwitcherOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean, tab?: SettingsTabId) => void;
  setStatsText: (text: string | null) => void;
  /** T2-3: set a tab's view mode. */
  setViewMode: (tabId: string, mode: ViewMode) => void;
  setFindReplaceMode: (mode: 'find' | 'replace' | null) => void;
}

export const useUiStore = create<UiState>((set) => ({
  paletteOpen: false,
  paletteMode: 'command',
  switcherOpen: false,
  settingsOpen: false,
  settingsTab: 'general',
  statsText: null,
  viewModes: {},
  findReplaceMode: null,

  setPaletteOpen: (open, mode = 'command') => set({ paletteOpen: open, paletteMode: mode }),
  setSwitcherOpen: (open) => set({ switcherOpen: open }),
  setSettingsOpen: (open, tab) => set((s) => ({ settingsOpen: open, settingsTab: open ? (tab ?? 'general') : s.settingsTab })),
  setStatsText: (text) => set({ statsText: text }),
  setViewMode: (tabId, mode) => set((s) => ({ viewModes: { ...s.viewModes, [tabId]: mode } })),
  setFindReplaceMode: (mode) => set({ findReplaceMode: mode }),
}));

/** T2-3: read/cycle the active tab's view mode (shared by the mode commands
 *  and the EditorArea toolbar). */
export function getActiveViewMode(): ViewMode {
  const activeId = useAppStore.getState().activeTabId;
  if (!activeId) return 'live';
  return useUiStore.getState().viewModes[activeId] ?? 'live';
}

function setActiveViewMode(mode: ViewMode): void {
  const activeId = useAppStore.getState().activeTabId;
  if (activeId) useUiStore.getState().setViewMode(activeId, mode);
}

// ─── Helpers used by built-in commands ───

async function createAndOpenNote(filePath: string, title: string, content: string): Promise<void> {
  await ipc('vault:create-file', filePath, content);
  const loaded = await ipc('vault:read-file', filePath);
  useAppStore.getState().openFile(filePath, title, loaded);
  const tree = await ipc('vault:read-tree');
  useAppStore.getState().setFileTree(tree);
}

function formatDailyName(format: string, date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return format
    .replace(/YYYY/g, String(date.getFullYear()))
    .replace(/MM/g, pad(date.getMonth() + 1))
    .replace(/DD/g, pad(date.getDate()));
}

async function openDailyNote(): Promise<void> {
  const { dailyNotes } = useSettingsStore.getState().settings;
  const vaultPath = useAppStore.getState().vaultPath || await ipc('vault:get-path');
  const name = formatDailyName(dailyNotes.format || 'YYYY-MM-DD', new Date());
  const folder = dailyNotes.folder ? `${vaultPath}/${dailyNotes.folder}` : vaultPath;
  const filePath = `${folder}/${name}.md`;
  try {
    const content = await ipc('vault:read-file', filePath);
    useAppStore.getState().openFile(filePath, name, content);
  } catch {
    // Doesn't exist yet — create (template wiring lands with W1-10).
    if (dailyNotes.folder) {
      try { await ipc('vault:create-folder', folder); } catch { /* exists */ }
    }
    await createAndOpenNote(filePath, name, `# ${name}\n\n`);
  }
}

// App menu (W2) — create a uniquely-named folder at the vault root and refresh the tree.
async function createNewFolder(): Promise<void> {
  const vaultPath = useAppStore.getState().vaultPath || await ipc('vault:get-path');
  let name = 'New folder';
  for (let i = 2; await ipc('vault:exists', `${vaultPath}/${name}`); i++) {
    name = `New folder ${i}`;
  }
  await ipc('vault:create-folder', `${vaultPath}/${name}`);
  const tree = await ipc('vault:read-tree');
  useAppStore.getState().setFileTree(tree);
}

async function saveActiveTab(): Promise<void> {
  const s = useAppStore.getState();
  const tab = s.tabs.find((t) => t.id === s.activeTabId);
  if (!tab || !tab.isDirty) return;
  // tab.content is markdown source (B1) — safe to write as-is.
  await ipc('vault:write-file', tab.filePath, tab.content);
  s.markTabClean(tab.id);
}

// ─── Built-in commands (migrated from CommandPalette/App/TitleBar) ───

let builtinsRegistered = false;

export function registerBuiltinCommands(): void {
  if (builtinsRegistered) return;
  builtinsRegistered = true;

  const ui = () => useUiStore.getState();
  const app = () => useAppStore.getState();

  const builtins: CommandDef[] = [
    {
      id: 'app.command-palette', title: 'Open command palette', category: 'App',
      defaultKeys: 'mod+shift+p', allowInEditor: true,
      run: () => ui().setPaletteOpen(!ui().paletteOpen),
    },
    {
      id: 'app.quick-switcher', title: 'Open quick switcher', category: 'App',
      defaultKeys: 'mod+p', allowInEditor: true,
      run: () => ui().setSwitcherOpen(!ui().switcherOpen),
    },
    {
      id: 'app.open-settings', title: 'Open settings', category: 'App',
      defaultKeys: 'mod+,', allowInEditor: true,
      run: () => ui().setSettingsOpen(true),
    },
    {
      id: 'file.new-note', title: 'Create new note', category: 'File',
      defaultKeys: 'mod+n',
      // Palette morphs into a title input — prompt() freezes Electron.
      run: () => ui().setPaletteOpen(true, 'new-note'),
    },
    {
      id: 'file.save', title: 'Save current note', category: 'File',
      defaultKeys: 'mod+s', allowInEditor: true,
      run: () => saveActiveTab(),
    },
    {
      id: 'file.daily-note', title: "Open today's daily note", category: 'File',
      defaultKeys: 'mod+shift+d',
      run: () => openDailyNote(),
    },
    // T2-4: in-note find & replace. allowInEditor so Ctrl+F/Ctrl+H fire while
    // typing. The FindReplace overlay reads ui.findReplaceMode.
    {
      id: 'editor.find', title: 'Find in note', category: 'Edit',
      defaultKeys: 'mod+f', allowInEditor: true,
      run: () => ui().setFindReplaceMode('find'),
    },
    {
      id: 'editor.replace', title: 'Find & replace in note', category: 'Edit',
      defaultKeys: 'mod+h', allowInEditor: true,
      run: () => ui().setFindReplaceMode('replace'),
    },
    {
      id: 'view.toggle-sidebar', title: 'Toggle sidebar', category: 'View',
      defaultKeys: 'mod+b',
      run: () => app().toggleSidebar(),
    },
    {
      id: 'view.toggle-theme', title: 'Toggle dark/light theme', category: 'View',
      run: () => {
        const settings = useSettingsStore.getState();
        const next = settings.settings.theme === 'light' ? 'dark' : 'light';
        void settings.update({ theme: next });
      },
    },
    {
      id: 'graph.open-view', title: 'Open graph view', category: 'View',
      defaultKeys: 'mod+g',
      // Full main-pane graph TAB (Wave 2) — the side panel stays on 'panel.graph'.
      run: () => app().openGraphTab(),
    },
    // ─── T2-3: editor view modes ───
    {
      id: 'view.editor-live', title: 'Editor: Live (WYSIWYG)', category: 'View',
      run: () => setActiveViewMode('live'),
    },
    {
      id: 'view.editor-reading', title: 'Editor: Reading (rendered)', category: 'View',
      run: () => setActiveViewMode('reading'),
    },
    {
      id: 'view.editor-source', title: 'Editor: Source (raw markdown)', category: 'View',
      run: () => setActiveViewMode('source'),
    },
    {
      id: 'view.editor-cycle-mode', title: 'Editor: cycle view mode', category: 'View',
      defaultKeys: 'mod+shift+m', allowInEditor: true,
      run: () => {
        const order: ViewMode[] = ['live', 'reading', 'source'];
        const next = order[(order.indexOf(getActiveViewMode()) + 1) % order.length];
        setActiveViewMode(next);
      },
    },
    {
      id: 'panel.ai', title: 'Open AI panel', category: 'Panels',
      run: () => app().setRightPanel('ai'),
    },
    {
      id: 'panel.graph', title: 'Open 3D graph', category: 'Panels',
      run: () => app().setRightPanel('graph'),
    },
    {
      id: 'panel.backlinks', title: 'Open backlinks', category: 'Panels',
      run: () => app().setRightPanel('backlinks'),
    },
    {
      id: 'panel.close', title: 'Close right panel', category: 'Panels',
      run: () => app().setRightPanel('none'),
    },
    // ─── App menu (W2) — File ───
    {
      id: 'file.new-folder', title: 'Create new folder', category: 'File',
      run: () => createNewFolder(),
    },
    {
      id: 'file.open-vault-folder', title: 'Open vault folder in Explorer', category: 'File',
      run: async () => {
        const vaultPath = app().vaultPath || await ipc('vault:get-path');
        await ipc('shell:open-path', vaultPath);
      },
    },
    // ─── App menu (W2) — View ───
    {
      id: 'view.toggle-right-panel', title: 'Toggle right panel', category: 'View',
      run: () => {
        const s = app();
        s.setRightPanel(s.rightPanel === 'none' ? 'graph' : 'none');
      },
    },
    {
      id: 'panel.search', title: 'Open search panel', category: 'Panels',
      run: () => app().setRightPanel('search'),
    },
    {
      id: 'panel.outline', title: 'Open outline panel', category: 'Panels',
      run: () => app().setRightPanel('outline'),
    },
    {
      id: 'panel.tags', title: 'Open tags panel', category: 'Panels',
      run: () => app().setRightPanel('tags'),
    },
    {
      id: 'view.zoom-in', title: 'Zoom in', category: 'View',
      defaultKeys: 'mod+=', allowInEditor: true,
      run: () => { void ipc('window:zoom', 'in'); },
    },
    {
      id: 'view.zoom-out', title: 'Zoom out', category: 'View',
      defaultKeys: 'mod+-', allowInEditor: true,
      run: () => { void ipc('window:zoom', 'out'); },
    },
    {
      id: 'view.zoom-reset', title: 'Reset zoom', category: 'View',
      defaultKeys: 'mod+0', allowInEditor: true,
      run: () => { void ipc('window:zoom', 'reset'); },
    },
    // ─── App menu (W2) — Tools / Help ───
    {
      id: 'app.keyboard-shortcuts', title: 'Keyboard shortcuts', category: 'App',
      run: () => ui().setSettingsOpen(true, 'hotkeys'),
    },
    {
      id: 'help.about', title: 'About Stellavault', category: 'Help',
      run: () => ui().setSettingsOpen(true, 'about'),
    },
    {
      id: 'help.github', title: 'Open GitHub repository', category: 'Help',
      run: () => { void ipc('shell:open-external', 'https://github.com/Evanciel/stellavault'); },
    },
    {
      id: 'vault.reindex', title: 'Re-index vault', category: 'Vault',
      run: () => { void ipc('core:index'); },
    },
    {
      id: 'vault.diagnostics', title: 'Run diagnostics', category: 'Vault',
      run: async () => {
        const stats = await ipc('core:get-stats');
        // Modal instead of alert() — alert() freezes Electron.
        ui().setStatsText(
          `Vault: ${stats.documentCount} docs, ${stats.chunkCount} chunks\n` +
          `DB: ${(stats.dbSizeBytes / 1024 / 1024).toFixed(1)}MB\n` +
          `Last indexed: ${stats.lastIndexed || 'Never'}`,
        );
      },
    },
  ];

  for (const cmd of builtins) registerCommand(cmd);
}
