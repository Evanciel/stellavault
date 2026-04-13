// Bottom status bar — vault stats, word count, theme indicator.

import { useAppStore } from '../../stores/app-store.js';

export function StatusBar() {
  const tabs = useAppStore((s) => s.tabs);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const coreReady = useAppStore((s) => s.coreReady);
  const vaultPath = useAppStore((s) => s.vaultPath);

  const activeTab = tabs.find((t) => t.id === activeTabId);
  const wordCount = activeTab ? activeTab.content.split(/\s+/).filter(Boolean).length : 0;

  return (
    <div style={{
      height: 24,
      background: 'var(--tab-bg)',
      borderTop: '1px solid var(--border)',
      display: 'flex',
      alignItems: 'center',
      padding: '0 12px',
      gap: 16,
      fontSize: '10px',
      color: 'var(--ink-faint)',
    }}>
      <span>{vaultPath.split(/[/\\]/).pop() || 'No vault'}</span>
      {activeTab && <span>{wordCount} words</span>}
      {activeTab?.isDirty && <span style={{ color: 'var(--accent)' }}>Modified</span>}
      <span style={{ marginLeft: 'auto' }}>
        {coreReady ? 'AI ready' : 'Loading AI...'}
      </span>
    </div>
  );
}
