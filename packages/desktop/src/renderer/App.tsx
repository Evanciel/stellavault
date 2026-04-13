// Root app layout — sidebar | editor | optional right panel.

import { useEffect } from 'react';
import { useAppStore } from './stores/app-store.js';
import { TitleBar } from './components/layout/TitleBar.js';
import { Sidebar } from './components/sidebar/Sidebar.js';
import { EditorArea } from './components/editor/EditorArea.js';
import { StatusBar } from './components/layout/StatusBar.js';
import { QuickSwitcher } from './components/shared/QuickSwitcher.js';
import { CommandPalette } from './components/shared/CommandPalette.js';
import { AIPanel } from './components/panels/AIPanel.js';
import { GraphPanel } from './components/panels/GraphPanel.js';
import { BacklinksPanel } from './components/panels/BacklinksPanel.js';
import { ipc, onIpc } from './lib/ipc-client.js';
import './theme.css';

export function App() {
  const theme = useAppStore((s) => s.theme);
  const sidebarWidth = useAppStore((s) => s.sidebarWidth);
  const sidebarCollapsed = useAppStore((s) => s.sidebarCollapsed);
  const rightPanel = useAppStore((s) => s.rightPanel);
  const setRightPanel = useAppStore((s) => s.setRightPanel);
  const rightPanelWidth = useAppStore((s) => s.rightPanelWidth);
  const setFileTree = useAppStore((s) => s.setFileTree);
  const setVaultPath = useAppStore((s) => s.setVaultPath);
  const setCoreReady = useAppStore((s) => s.setCoreReady);

  // Load vault tree on mount
  useEffect(() => {
    void (async () => {
      const vp = await ipc('vault:get-path');
      setVaultPath(vp);
      const tree = await ipc('vault:read-tree');
      setFileTree(tree);
    })();

    // Listen for core ready
    const off = onIpc('core:ready', () => setCoreReady(true));

    // Listen for file changes (from watcher)
    const offFile = onIpc('file:changed', () => {
      void ipc('vault:read-tree').then((tree) => setFileTree(tree));
    });

    return () => { off(); offFile(); };
  }, [setFileTree, setVaultPath, setCoreReady]);

  return (
    <div
      data-theme={theme === 'light' ? 'light' : undefined}
      style={{
        width: '100%',
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg)',
        color: 'var(--ink)',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
        fontSize: '13px',
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
                {rightPanel === 'ai' ? 'AI Intelligence' : rightPanel === 'graph' ? '3D Graph' : 'Backlinks'}
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
            </div>
          </div>
        )}
      </div>

      <StatusBar />
      <QuickSwitcher />
      <CommandPalette />
    </div>
  );
}
