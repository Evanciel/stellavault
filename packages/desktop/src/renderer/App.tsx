// Root app layout — sidebar | editor | optional right panel.

import { Suspense, lazy, useEffect, useState } from 'react';
import { useAppStore } from './stores/app-store.js';
import { useSettingsStore, initSettings, resolveTheme } from './stores/settings-store.js';
import { registerBuiltinCommands, registerCommand } from './lib/commands.js';
import { initHotkeys } from './lib/hotkeys.js';
import { TitleBar } from './components/layout/TitleBar.js';
import { Sidebar } from './components/sidebar/Sidebar.js';
import { EditorArea } from './components/editor/EditorArea.js';
import { StatusBar } from './components/layout/StatusBar.js';
import { ResizeHandle } from './components/layout/ResizeHandle.js';
import { QuickSwitcher } from './components/shared/QuickSwitcher.js';
import { CommandPalette } from './components/shared/CommandPalette.js';
import { SettingsModal } from './components/settings/SettingsModal.js';
import { AIPanel } from './components/panels/AIPanel.js';
// T2-12: GraphPanel pulls in the three/fiber/drei "three" chunk — lazy-load so
// it's fetched only when the graph panel is opened, not on app startup.
const GraphPanel = lazy(() => import('./components/panels/GraphPanel.js').then((m) => ({ default: m.GraphPanel })));
import { BacklinksPanel } from './components/panels/BacklinksPanel.js';
import { SearchPanel } from './components/panels/SearchPanel.js';
import { OutlinePanel } from './components/panels/OutlinePanel.js';
import { TagsPanel } from './components/panels/TagsPanel.js';
import { CoachPanel } from './components/panels/CoachPanel.js'; // T2-6
import { SynthesisPanel } from './components/panels/SynthesisPanel.js'; // T3-1
import { FindReplace } from './components/editor/FindReplace.js'; // T2-4
import { CaptureHost } from './components/decisions/CaptureHost.js'; // T3-5/T3-6 capture & automation modals
import { ipc, onIpc } from './lib/ipc-client.js';
import './theme.css';

const PANEL_TITLES: Record<string, string> = {
  ai: 'AI Intelligence',
  graph: '3D Graph',
  backlinks: 'Backlinks',
  search: 'Search',
  outline: 'Outline',
  tags: 'Tags',
  coach: 'Coach', // T2-6
  synthesis: 'Synthesize', // T3-1
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
  const setSidebarWidth = useAppStore((s) => s.setSidebarWidth);
  const setRightPanelWidth = useAppStore((s) => s.setRightPanelWidth);
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

  // T1-9: once settings hydrate, seed the app-store pane widths from the
  // persisted `panels` slice (one-way: store is the live source during drag,
  // settings is the durable store). Runs only on hydration flip.
  useEffect(() => {
    if (!settingsHydrated) return;
    const panels = useSettingsStore.getState().settings.panels;
    if (!panels) return;
    const st = useAppStore.getState();
    if (typeof panels.sidebarWidth === 'number') st.setSidebarWidth(panels.sidebarWidth);
    if (typeof panels.rightPanelWidth === 'number') st.setRightPanelWidth(panels.rightPanelWidth);
  }, [settingsHydrated]);

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
        {!sidebarCollapsed && (
          <ResizeHandle
            side="right"
            width={sidebarWidth}
            min={180}
            max={500}
            onResize={setSidebarWidth}
            onCommit={(w) => void useSettingsStore.getState().update({
              panels: {
                sidebarWidth: w,
                rightPanelWidth: useAppStore.getState().rightPanelWidth,
              },
            })}
          />
        )}

        {/* T2-4: position:relative so the FindReplace overlay anchors to the
            editor column (not the viewport). */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>
          <EditorArea />
          <FindReplace />
        </div>

        {rightPanel !== 'none' && (
          <ResizeHandle
            side="left"
            width={rightPanelWidth}
            min={280}
            max={500}
            onResize={setRightPanelWidth}
            onCommit={(w) => void useSettingsStore.getState().update({
              panels: {
                sidebarWidth: useAppStore.getState().sidebarWidth,
                rightPanelWidth: w,
              },
            })}
          />
        )}
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
              {rightPanel === 'graph' && (
                <Suspense fallback={<div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-faint)', fontSize: 12 }}>Loading graph…</div>}>
                  <GraphPanel />
                </Suspense>
              )}
              {rightPanel === 'backlinks' && <BacklinksPanel />}
              {rightPanel === 'search' && <SearchPanel />}
              {rightPanel === 'outline' && <OutlinePanel />}
              {rightPanel === 'tags' && <TagsPanel />}
              {rightPanel === 'coach' && <CoachPanel />}
              {rightPanel === 'synthesis' && <SynthesisPanel />}
            </div>
          </div>
        )}
      </div>

      <StatusBar />
      <QuickSwitcher />
      <CommandPalette />
      <SettingsModal />
      <CaptureHost />
    </div>
  );
}
