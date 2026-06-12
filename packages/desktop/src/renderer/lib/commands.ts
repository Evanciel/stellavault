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

interface UiState {
  paletteOpen: boolean;
  paletteMode: 'command' | 'new-note';
  switcherOpen: boolean;
  settingsOpen: boolean;
  /** Diagnostics text shown by the palette's stats modal. */
  statsText: string | null;

  setPaletteOpen: (open: boolean, mode?: 'command' | 'new-note') => void;
  setSwitcherOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  setStatsText: (text: string | null) => void;
}

export const useUiStore = create<UiState>((set) => ({
  paletteOpen: false,
  paletteMode: 'command',
  switcherOpen: false,
  settingsOpen: false,
  statsText: null,

  setPaletteOpen: (open, mode = 'command') => set({ paletteOpen: open, paletteMode: mode }),
  setSwitcherOpen: (open) => set({ switcherOpen: open }),
  setSettingsOpen: (open) => set({ settingsOpen: open }),
  setStatsText: (text) => set({ statsText: text }),
}));

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
