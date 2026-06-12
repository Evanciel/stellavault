// Root app layout — sidebar | editor | optional right panel.

import { useEffect, useState } from 'react';
import { useAppStore } from './stores/app-store.js';
import { useSettingsStore, initSettings, resolveTheme } from './stores/settings-store.js';
import { registerBuiltinCommands, registerCommand } from './lib/commands.js';
import { initHotkeys } from './lib/hotkeys.js';
import { TitleBar } from './components/layout/TitleBar.js';
import { Sidebar } from './components/sidebar/Sidebar.js';
import { EditorArea } from './components/editor/EditorArea.js';
import { StatusBar } from './components/layout/StatusBar.js';
import { QuickSwitcher } from './components/shared/QuickSwitcher.js';
import { CommandPalette } from './components/shared/CommandPalette.js';
import { SettingsModal } from './components/settings/SettingsModal.js';
import { AIPanel } from './components/panels/AIPanel.js';
import { GraphPanel } from './components/panels/GraphPanel.js';
import { BacklinksPanel } from './components/panels/BacklinksPanel.js';
import { SearchPanel } from './components/panels/SearchPanel.js';
import { OutlinePanel } from './components/panels/OutlinePanel.js';
import { TagsPanel } from './components/panels/TagsPanel.js';
import { ipc, onIpc } from './lib/ipc-client.js';
import './theme.css';

const PANEL_TITLES: Record<string, string> = {
  ai: 'AI Intelligence',
  graph: '3D Graph',
  backlinks: 'Backlinks',
  search: 'Search',
  outline: 'Outline',
  tags: 'Tags',
};

// Stage C (W1-4/5/6): panel commands registered via the W1-12 registry —
// palette entries + default hotkeys come for free. Idempotent (Map.set).
let stageCPanelCommandsRegistered = false;
function registerStageCPanelCommands(): void {
  if (stageCPanelCommandsRegistered) return;
  stageCPanelCommandsRegistered = true;
  const app = () => useAppStore.getState();
  registerCommand({
    id: 'search.open', title: 'Open search panel', category: 'Panels',
    defaultKeys: 'mod+shift+f', allowInEditor: true,
    run: () => app().setRightPanel('search'),
  });
  registerCommand({
    id: 'panel.outline', title: 'Open outline panel', category: 'Panels',
    defaultKeys: 'mod+shift+o',
    run: () => app().setRightPanel('outline'),
  });
  registerCommand({
    id: 'panel.tags', title: 'Open tags panel', category: 'Panels',
    defaultKeys: 'mod+shift+t',
    run: () => app().setRightPanel('tags'),
  });
}

export function App() {
  const appTheme = useAppStore((s) => s.theme);
  const sidebarWidth = useAppStore((s) => s.sidebarWidth);
  const sidebarCollapsed = useAppStore((s) => s.sidebarCollapsed);
  const rightPanel = useAppStore((s) => s.rightPanel);
  const setRightPanel = useAppStore((s) => s.setRightPanel);
  const rightPanelWidth = useAppStore((s) => s.rightPanelWidth);
  const setFileTree = useAppStore((s) => s.setFileTree);
  const setVaultPath = useAppStore((s) => s.setVaultPath);
  const setCoreReady = useAppStore((s) => s.setCoreReady);

  const settings = useSettingsStore((s) => s.settings);
  const settingsHydrated = useSettingsStore((s) => s.hydrated);

  // OS theme tracking so theme:'system' reacts live.
  const [osLight, setOsLight] = useState(
    () => window.matchMedia('(prefers-color-scheme: light)').matches,
  );
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = (e: MediaQueryListEvent) => setOsLight(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // Boot: settings hydrate + commands + hotkeys (W1-1, W1-12).
  useEffect(() => {
    registerBuiltinCommands();
    registerStageCPanelCommands();
    const offSettings = initSettings();
    const offHotkeys = initHotkeys(() => useSettingsStore.getState().settings.hotkeys);
    return () => { offSettings(); offHotkeys(); };
  }, []);

  // Load vault tree on mount
  useEffect(() => {
    void (async () => {
      const vp = await ipc('vault:get-path');
      setVaultPath(vp);
      const tree = await ipc('vault:read-tree');
      setFileTree(tree);
    })();

    // Listen for core ready
    const off = onIpc('core:ready', () => {
      setCoreReady(true);
      // First-run UX: an empty index means search/graph/tags are all dead until
      // the user finds the Reindex button. Index automatically once.
      void ipc('core:get-stats').then((stats) => {
        if (stats && stats.documentCount === 0) void ipc('core:index');
      }).catch(() => { /* stats unavailable — user can still reindex manually */ });
    });

    // Listen for file changes (from watcher)
    const offFile = onIpc('file:changed', () => {
      void ipc('vault:read-tree').then((tree) => setFileTree(tree));
    });

    return () => { off(); offFile(); };
  }, [setFileTree, setVaultPath, setCoreReady]);

  // settings.theme is the source of truth (W1-2); resolve 'system' via OS.
  const resolvedTheme = settings.theme === 'system'
    ? (osLight ? 'light' : 'dark')
    : settings.theme;

  // Keep app-store theme in sync both ways (TitleBar's toggle still writes
  // app-store; equality guards prevent loops).
  useEffect(() => {
    if (useAppStore.getState().theme !== resolvedTheme) {
      useAppStore.setState({ theme: resolvedTheme });
    }
  }, [resolvedTheme]);
  useEffect(() => {
    if (!settingsHydrated) return;
    const current = resolveTheme(useSettingsStore.getState().settings.theme);
    if (appTheme !== current) {
      void useSettingsStore.getState().update({ theme: appTheme });
    }
  }, [appTheme, settingsHydrated]);

  return (
    <div
      data-theme={resolvedTheme === 'light' ? 'light' : undefined}
      style={{
        width: '100%',
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg)',
        color: 'var(--ink)',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
        fontSize: '13px',
        // W1-2: accent + editor vars flow from settings; theme.css holds defaults.
        ['--accent' as string]: settings.accent,
        ['--editor-font-size' as string]: `${settings.editor.fontSize}px`,
        ['--editor-line-width' as string]: `${settings.editor.lineWidth}px`,
      }}
    >
      <TitleBar />

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {!sidebarCollapsed && (
          <div style={{
            width: sidebarWidth,
            minWidth: 180,
            maxWidth: 500,
            background: 'var(--sidebar-bg)',
            borderRight: '1px solid var(--border)',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          }}>
            <Sidebar />
          </div>
        )}

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <EditorArea />
        </div>

        {rightPanel !== 'none' && (
          <div style={{
            width: rightPanelWidth,
            minWidth: 280,
            maxWidth: 500,
            background: 'var(--sidebar-bg)',
            borderLeft: '1px solid var(--border)',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          }}>
            <div style={{
              padding: '6px 10px',
              borderBottom: '1px solid var(--border)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              fontSize: 11,
            }}>
              <span style={{ color: 'var(--ink-dim)', textTransform: 'uppercase', letterSpacing: '0.08em', fontSize: 10 }}>
                {PANEL_TITLES[rightPanel]}
              </span>
              <button
                onClick={() => setRightPanel('none')}
                style={{ background: 'transparent', border: 'none', color: 'var(--ink-faint)', cursor: 'pointer', fontSize: 14 }}
              >
                &#x2715;
              </button>
            </div>
            <div style={{ flex: 1, overflow: 'auto' }}>
              {rightPanel === 'ai' && <AIPanel />}
              {rightPanel === 'graph' && <GraphPanel />}
              {rightPanel === 'backlinks' && <BacklinksPanel />}
              {rightPanel === 'search' && <SearchPanel />}
              {rightPanel === 'outline' && <OutlinePanel />}
              {rightPanel === 'tags' && <TagsPanel />}
            </div>
          </div>
        )}
      </div>

      <StatusBar />
      <QuickSwitcher />
      <CommandPalette />
      <SettingsModal />
    </div>
  );
}
