// Horizontal tab bar for open files.

import { useAppStore } from '../../stores/app-store.js';

export function TabBar() {
  const tabs = useAppStore((s) => s.tabs);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const closeTab = useAppStore((s) => s.closeTab);

  return (
    <div role="tablist" aria-label="Open documents" style={{
      display: 'flex',
      background: 'var(--tab-bg)',
      borderBottom: '1px solid var(--border)',
      overflow: 'auto hidden',
      minHeight: 32,
    }}>
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;
        return (
          <div
            key={tab.id}
            role="tab"
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            onClick={() => setActiveTab(tab.id)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '0 12px',
              height: 32,
              fontSize: '11px',
              cursor: 'pointer',
              borderRight: '1px solid var(--border)',
              background: isActive ? 'var(--tab-active)' : 'transparent',
              color: isActive ? 'var(--ink)' : 'var(--ink-dim)',
              whiteSpace: 'nowrap',
              position: 'relative',
            }}
          >
            {tab.isDirty && (
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)', flexShrink: 0 }} />
            )}
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 140 }}>
              {tab.title}
            </span>
            <button
              aria-label={`Close ${tab.title}`}
              onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--ink-faint)',
                cursor: 'pointer',
                fontSize: '12px',
                padding: '2px 4px',
                borderRadius: 3,
                lineHeight: 1,
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--ink)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--ink-faint)'; }}
            >
              &#x2715;
            </button>
            {isActive && (
              <div style={{
                position: 'absolute',
                bottom: 0,
                left: 0,
                right: 0,
                height: 2,
                background: 'var(--accent)',
              }} />
            )}
          </div>
        );
      })}
    </div>
  );
}
