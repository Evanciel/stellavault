// Bottom status bar — vault stats, word count, theme indicator.

import { useMemo } from 'react';
import { useAppStore } from '../../stores/app-store.js';
import { countText } from '../../lib/text-count.js';

export function StatusBar() {
  const tabs = useAppStore((s) => s.tabs);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const coreReady = useAppStore((s) => s.coreReady);
  const vaultPath = useAppStore((s) => s.vaultPath);

  const activeTab = tabs.find((t) => t.id === activeTabId);
  // T1-6: CJK-correct count — strips frontmatter + markdown syntax, counts
  // CJK by segment and latin by whitespace. Memoized on the note content.
  const counts = useMemo(
    () => (activeTab && activeTab.kind !== 'graph' ? countText(activeTab.content) : null),
    [activeTab?.content, activeTab?.kind],
  );

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
      {counts && (
        <span>
          {counts.words.toLocaleString()} words &middot; {counts.chars.toLocaleString()} chars
        </span>
      )}
      {activeTab?.isDirty && <span style={{ color: 'var(--accent)' }}>Modified</span>}
      <span style={{ marginLeft: 'auto' }}>
        {coreReady ? 'AI ready' : 'Loading AI...'}
      </span>
    </div>
  );
}
