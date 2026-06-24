// Command registry (W1-12) — single source of truth for every app action.
// Palette, hotkeys, and (Wave 3) the plugin API all dispatch through here.

import { create } from 'zustand';
import { useAppStore } from '../stores/app-store.js';
import { useSettingsStore } from '../stores/settings-store.js';
import { ipc } from './ipc-client.js';
import { t } from './i18n.js';

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
      id: 'app.command-palette', title: t('command.commandPalette'), category: 'App',
      defaultKeys: 'mod+shift+p', allowInEditor: true,
      run: () => ui().setPaletteOpen(!ui().paletteOpen),
    },
    {
      id: 'app.quick-switcher', title: t('command.quickSwitcher'), category: 'App',
      defaultKeys: 'mod+p', allowInEditor: true,
      run: () => ui().setSwitcherOpen(!ui().switcherOpen),
    },
    {
      id: 'app.open-settings', title: t('command.openSettings'), category: 'App',
      defaultKeys: 'mod+,', allowInEditor: true,
      run: () => ui().setSettingsOpen(true),
    },
    {
      id: 'file.new-note', title: t('action.newNote'), category: 'File',
      defaultKeys: 'mod+n',
      // Palette morphs into a title input — prompt() freezes Electron.
      run: () => ui().setPaletteOpen(true, 'new-note'),
    },
    {
      id: 'file.save', title: t('command.saveNote'), category: 'File',
      defaultKeys: 'mod+s', allowInEditor: true,
      run: () => saveActiveTab(),
    },
    {
      id: 'file.daily-note', title: t('command.dailyNote'), category: 'File',
      defaultKeys: 'mod+shift+d',
      run: () => openDailyNote(),
    },
    // T2-4: in-note find & replace. allowInEditor so Ctrl+F/Ctrl+H fire while
    // typing. The FindReplace overlay reads ui.findReplaceMode.
    {
      id: 'editor.find', title: t('command.findInNote'), category: 'Edit',
      defaultKeys: 'mod+f', allowInEditor: true,
      run: () => ui().setFindReplaceMode('find'),
    },
    {
      id: 'editor.replace', title: t('command.findReplace'), category: 'Edit',
      defaultKeys: 'mod+h', allowInEditor: true,
      run: () => ui().setFindReplaceMode('replace'),
    },
    {
      id: 'view.toggle-sidebar', title: t('action.toggleSidebar'), category: 'View',
      defaultKeys: 'mod+b',
      run: () => app().toggleSidebar(),
    },
    {
      id: 'view.toggle-theme', title: t('action.toggleThemeDarkLight'), category: 'View',
      run: () => {
        const settings = useSettingsStore.getState();
        const next = settings.settings.theme === 'light' ? 'dark' : 'light';
        void settings.update({ theme: next });
      },
    },
    {
      id: 'graph.open-view', title: t('action.openGraphView'), category: 'View',
      defaultKeys: 'mod+g',
      // Full main-pane graph TAB (Wave 2) — the side panel stays on 'panel.graph'.
      run: () => app().openGraphTab(),
    },
    {
      id: 'chat.open-view', title: t('action.openChat'), category: 'View',
      // Full main-pane AI chat TAB — the right AI panel keeps its own chat tab too.
      run: () => app().openChatTab(),
    },
    // ─── T2-3: editor view modes ───
    {
      id: 'view.editor-live', title: t('command.editorLive'), category: 'View',
      run: () => setActiveViewMode('live'),
    },
    {
      id: 'view.editor-reading', title: t('command.editorReading'), category: 'View',
      run: () => setActiveViewMode('reading'),
    },
    {
      id: 'view.editor-source', title: t('command.editorSource'), category: 'View',
      run: () => setActiveViewMode('source'),
    },
    {
      id: 'view.editor-cycle-mode', title: t('command.editorCycleMode'), category: 'View',
      defaultKeys: 'mod+shift+m', allowInEditor: true,
      run: () => {
        const order: ViewMode[] = ['live', 'reading', 'source'];
        const next = order[(order.indexOf(getActiveViewMode()) + 1) % order.length];
        setActiveViewMode(next);
      },
    },
    {
      id: 'panel.ai', title: t('command.openAiPanel'), category: 'Panels',
      run: () => app().setRightPanel('ai'),
    },
    {
      // T3-1: Wiki Synthesis panel. SynthesisPanel also self-registers this id
      // (idempotent) with a default hotkey; this builtin keeps it discoverable.
      id: 'panel.synthesis', title: t('command.openSynthesisPanel'), category: 'Panels',
      run: () => app().setRightPanel('synthesis'),
    },
    {
      id: 'panel.graph', title: t('command.open3dGraph'), category: 'Panels',
      run: () => app().setRightPanel('graph'),
    },
    {
      id: 'panel.backlinks', title: t('command.openBacklinks'), category: 'Panels',
      run: () => app().setRightPanel('backlinks'),
    },
    {
      id: 'panel.close', title: t('command.closeRightPanel'), category: 'Panels',
      run: () => app().setRightPanel('none'),
    },
    // ─── App menu (W2) — File ───
    {
      id: 'file.new-folder', title: t('action.newFolder'), category: 'File',
      run: () => createNewFolder(),
    },
    {
      id: 'file.open-vault-folder', title: t('action.openVaultFolder'), category: 'File',
      run: async () => {
        const vaultPath = app().vaultPath || await ipc('vault:get-path');
        await ipc('shell:open-path', vaultPath);
      },
    },
    // ─── App menu (W2) — View ───
    {
      id: 'view.toggle-right-panel', title: t('action.toggleRightPanel'), category: 'View',
      run: () => {
        const s = app();
        s.setRightPanel(s.rightPanel === 'none' ? 'graph' : 'none');
      },
    },
    {
      id: 'panel.search', title: t('command.searchPanel'), category: 'Panels',
      run: () => app().setRightPanel('search'),
    },
    {
      id: 'panel.outline', title: t('command.outlinePanel'), category: 'Panels',
      run: () => app().setRightPanel('outline'),
    },
    {
      id: 'panel.tags', title: t('command.tagsPanel'), category: 'Panels',
      run: () => app().setRightPanel('tags'),
    },
    {
      id: 'view.zoom-in', title: t('action.zoomIn'), category: 'View',
      defaultKeys: 'mod+=', allowInEditor: true,
      run: () => { void ipc('window:zoom', 'in'); },
    },
    {
      id: 'view.zoom-out', title: t('action.zoomOut'), category: 'View',
      defaultKeys: 'mod+-', allowInEditor: true,
      run: () => { void ipc('window:zoom', 'out'); },
    },
    {
      id: 'view.zoom-reset', title: t('action.resetZoom'), category: 'View',
      defaultKeys: 'mod+0', allowInEditor: true,
      run: () => { void ipc('window:zoom', 'reset'); },
    },
    // ─── App menu (W2) — Tools / Help ───
    {
      id: 'app.keyboard-shortcuts', title: t('action.keyboardShortcuts'), category: 'App',
      run: () => ui().setSettingsOpen(true, 'hotkeys'),
    },
    {
      id: 'help.about', title: t('action.aboutStellavault'), category: 'Help',
      run: () => ui().setSettingsOpen(true, 'about'),
    },
    // T3-12: in-app auto-update. Returns a status string (disabled on unsigned
    // builds); the main process also broadcasts progress via 'update:status'.
    {
      id: 'help.check-updates', title: t('action.checkForUpdates'), category: 'Help',
      run: async () => {
        const status = await ipc('update:check');
        ui().setStatsText(`Updates: ${status}`);
      },
    },
    {
      id: 'help.github', title: t('command.openGithubRepo'), category: 'Help',
      run: () => { void ipc('shell:open-external', 'https://github.com/Evanciel/stellavault'); },
    },
    {
      id: 'vault.reindex', title: t('action.reindexVault'), category: 'Vault',
      run: () => { void ipc('core:index'); },
    },
    // ─── T3-7: Publish (local read-only PWA + dashboard) ───
    {
      id: 'publish.start', title: t('command.publishStartLocal'), category: 'Vault',
      run: async () => {
        try {
          const status = await ipc('publish:start');
          // Open the loopback dashboard in the OS browser (T3-7).
          if (status.running && status.url) {
            await ipc('shell:open-external', status.url);
          }
          ui().setStatsText(
            status.running
              ? `Publish (read-only) is live — local only.\n\n${status.url}\n\nOpened in your browser. Anyone on this machine can read your vault at that address. Run "Publish: stop" to shut it down.`
              : 'Publish server did not start.',
          );
        } catch (err) {
          ui().setStatsText(`Publish failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      },
    },
    {
      id: 'publish.stop', title: t('command.publishStopLocal'), category: 'Vault',
      run: async () => {
        try {
          await ipc('publish:stop');
          ui().setStatsText('Publish server stopped.');
        } catch (err) {
          ui().setStatsText(`Could not stop Publish: ${err instanceof Error ? err.message : String(err)}`);
        }
      },
    },
    // ─── T3-9: multi-vault ───
    {
      id: 'vault.add', title: t('action.addVault'), category: 'Vault',
      run: async () => {
        try {
          const added = await ipc('vault:add-to-registry');
          if (added) ui().setStatsText(`Added vault "${added.name}". Pick it from the vault switcher (titlebar) to load it.`);
        } catch (err) {
          ui().setStatsText(`Add vault failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      },
    },
    {
      id: 'vault.diagnostics', title: t('command.runDiagnostics'), category: 'Vault',
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
