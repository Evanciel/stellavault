// Root app layout — sidebar | editor | optional right panel.

import { useEffect } from 'react';
import { useAppStore } from './stores/app-store.js';
import { TitleBar } from './components/layout/TitleBar.js';
import { Sidebar } from './components/sidebar/Sidebar.js';
import { EditorArea } from './components/editor/EditorArea.js';
import { StatusBar } from './components/layout/StatusBar.js';
import { ipc, onIpc } from './lib/ipc-client.js';

export function App() {
  const theme = useAppStore((s) => s.theme);
  const sidebarWidth = useAppStore((s) => s.sidebarWidth);
  const sidebarCollapsed = useAppStore((s) => s.sidebarCollapsed);
  const setFileTree = useAppStore((s) => s.setFileTree);
  const setVaultPath = useAppStore((s) => s.setVaultPath);
  const setCoreReady = useAppStore((s) => s.setCoreReady);

  const isDark = theme === 'dark';

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

  // Apply theme CSS variables
  const vars = isDark ? {
    '--bg': '#0a0a0f',
    '--bg-2': '#0f0f18',
    '--bg-3': '#14141f',
    '--ink': '#e0e0f0',
    '--ink-dim': '#8a8aa0',
    '--ink-faint': '#4a4a60',
    '--border': 'rgba(100,120,255,0.12)',
    '--accent': '#6366f1',
    '--accent-2': '#818cf8',
    '--sidebar-bg': '#0c0c14',
    '--editor-bg': '#0f0f18',
    '--tab-bg': '#0a0a12',
    '--tab-active': '#14141f',
    '--hover': 'rgba(100,120,255,0.08)',
    '--selection': 'rgba(99,102,241,0.25)',
  } : {
    '--bg': '#fafafa',
    '--bg-2': '#ffffff',
    '--bg-3': '#f3f3f6',
    '--ink': '#1a1a2e',
    '--ink-dim': '#666680',
    '--ink-faint': '#99999a',
    '--border': 'rgba(0,0,0,0.08)',
    '--accent': '#6366f1',
    '--accent-2': '#818cf8',
    '--sidebar-bg': '#f5f5f8',
    '--editor-bg': '#ffffff',
    '--tab-bg': '#f0f0f3',
    '--tab-active': '#ffffff',
    '--hover': 'rgba(0,0,0,0.04)',
    '--selection': 'rgba(99,102,241,0.15)',
  };

  return (
    <div style={{
      ...vars as React.CSSProperties,
      width: '100%',
      height: '100vh',
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--bg)',
      color: 'var(--ink)',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
      fontSize: '13px',
      userSelect: 'none',
    }}>
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
      </div>

      <StatusBar />
    </div>
  );
}
