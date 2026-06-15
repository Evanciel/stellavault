// Bottom status bar — vault stats, word count, capture pill, AI status.

import { useMemo, useState, useEffect, type CSSProperties } from 'react';
import { useAppStore } from '../../stores/app-store.js';
import { countText } from '../../lib/text-count.js';
import { ipc, onIpc } from '../../lib/ipc-client.js';
import { useT } from '../../lib/i18n.js';

const pillBtn: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 4, background: 'transparent',
  border: 'none', color: 'var(--ink-faint)', cursor: 'pointer', fontSize: 10, padding: 0,
};

// Always-on capture indicator (Design §7) — watching dot + pending-review badge.
function CapturePill() {
  const tr = useT();
  const setRightPanel = useAppStore((s) => s.setRightPanel);
  const coreReady = useAppStore((s) => s.coreReady);
  const [counts, setCounts] = useState({ pendingReviewCount: 0, queueDepth: 0, watching: false });

  useEffect(() => {
    if (!coreReady) return;
    let alive = true;
    const refresh = () => void ipc('capture:counts')
      .then((c) => { if (alive) setCounts({ pendingReviewCount: c.pendingReviewCount, queueDepth: c.queueDepth, watching: c.watching }); })
      .catch(() => {});
    refresh();
    const offDone = onIpc('capture:done', refresh);
    const offProg = onIpc('capture:progress', refresh);
    const offReview = onIpc('review:changed', refresh);
    const timer = window.setInterval(refresh, 5000);
    return () => { alive = false; offDone(); offProg(); offReview(); window.clearInterval(timer); };
  }, [coreReady]);

  if (!coreReady) return null;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <button onClick={() => setRightPanel('capture')} title={tr('status.captureInbox')} style={pillBtn}>
        <span style={{ color: counts.watching ? 'var(--accent)' : 'var(--ink-faint)' }}>◉</span>
        {counts.queueDepth > 0 && <span style={{ color: 'var(--accent-2)' }}>{counts.queueDepth}</span>}
        <span>{tr('status.capture')}</span>
      </button>
      {counts.pendingReviewCount > 0 && (
        <button onClick={() => setRightPanel('review')} title={tr('status.reviewQueue')} style={{ ...pillBtn, color: 'var(--accent)' }}>
          ⚑ {counts.pendingReviewCount}
        </button>
      )}
    </span>
  );
}

export function StatusBar() {
  const tr = useT();
  const tabs = useAppStore((s) => s.tabs);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const coreReady = useAppStore((s) => s.coreReady);
  const vaultPath = useAppStore((s) => s.vaultPath);

  const activeTab = tabs.find((tab) => tab.id === activeTabId);
  // T1-6: CJK-correct count — strips frontmatter + markdown syntax, counts CJK by
  // segment and latin by whitespace. Memoized on the note content.
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
      <span>{vaultPath.split(/[/\\]/).pop() || tr('status.noVault')}</span>
      {counts && (
        <span>{tr('status.wordsChars', { words: counts.words.toLocaleString(), chars: counts.chars.toLocaleString() })}</span>
      )}
      {activeTab?.isDirty && <span style={{ color: 'var(--accent)' }}>{tr('status.modified')}</span>}
      <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 14 }}>
        <CapturePill />
        <span>{coreReady ? tr('status.aiReady') : tr('status.aiLoading')}</span>
      </span>
    </div>
  );
}
