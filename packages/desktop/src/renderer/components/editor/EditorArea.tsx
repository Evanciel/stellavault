// Editor area — tab bar + markdown editor + split view.

import { useCallback, useState } from 'react';
import { useAppStore } from '../../stores/app-store.js';
import { TabBar } from './TabBar.js';
import { MarkdownEditor } from './MarkdownEditor.js';
import { DailyBrief } from '../shared/DailyBrief.js';
import { ipc } from '../../lib/ipc-client.js';

export function EditorArea() {
  const tabs = useAppStore((s) => s.tabs);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const updateTabContent = useAppStore((s) => s.updateTabContent);
  const markTabClean = useAppStore((s) => s.markTabClean);
  const [splitMode, setSplitMode] = useState<'none' | 'horizontal' | 'vertical'>('none');
  const [splitTabId, setSplitTabId] = useState<string | null>(null);

  const activeTab = tabs.find((t) => t.id === activeTabId);
  const splitTab = splitTabId ? tabs.find((t) => t.id === splitTabId) : null;

  const handleSave = useCallback(async () => {
    if (!activeTab || !activeTab.isDirty) return;
    await ipc('vault:write-file', activeTab.filePath, activeTab.content);
    markTabClean(activeTab.id);
  }, [activeTab, markTabClean]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      void handleSave();
    }
    // Ctrl+\ toggles split
    if ((e.ctrlKey || e.metaKey) && e.key === '\\') {
      e.preventDefault();
      if (splitMode === 'none' && tabs.length >= 2) {
        setSplitMode('vertical');
        // Pick the second-most-recent tab for split
        const other = tabs.find((t) => t.id !== activeTabId);
        if (other) setSplitTabId(other.id);
      } else {
        setSplitMode('none');
        setSplitTabId(null);
      }
    }
  }, [handleSave, splitMode, tabs, activeTabId]);

  if (tabs.length === 0) {
    return <DailyBrief />;
  }

  const editorPane = (tab: typeof activeTab, isPrimary: boolean) => {
    if (!tab) return null;
    return (
      <div style={{ flex: 1, overflow: 'auto', background: 'var(--editor-bg)', padding: '24px 48px', minWidth: 0 }}>
        {!isPrimary && (
          <div style={{
            fontSize: 10, color: 'var(--ink-faint)', marginBottom: 8,
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <span>{tab.title}</span>
            <select
              value={tab.id}
              onChange={(e) => setSplitTabId(e.target.value)}
              aria-label="Split pane file"
              style={{
                background: 'var(--hover)', border: '1px solid var(--border)',
                borderRadius: 3, padding: '2px 6px', fontSize: 10, color: 'var(--ink-dim)',
              }}
            >
              {tabs.filter((t) => t.id !== activeTabId).map((t) => (
                <option key={t.id} value={t.id}>{t.title}</option>
              ))}
            </select>
          </div>
        )}
        <MarkdownEditor
          key={tab.id}
          content={tab.content}
          onChange={(content) => updateTabContent(tab.id, content)}
        />
      </div>
    );
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }} onKeyDown={handleKeyDown}>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <div style={{ flex: 1 }}><TabBar /></div>
        {/* Split toggle */}
        <div style={{ display: 'flex', gap: 2, padding: '0 8px', borderBottom: '1px solid var(--border)', background: 'var(--tab-bg)' }}>
          <button
            onClick={() => { setSplitMode(splitMode === 'vertical' ? 'none' : 'vertical'); if (splitMode === 'none') { const o = tabs.find(t => t.id !== activeTabId); if (o) setSplitTabId(o.id); } }}
            title="Split vertical (Ctrl+\\)"
            aria-label="Toggle vertical split"
            style={{
              padding: '4px 6px', fontSize: 10, border: 'none', borderRadius: 3, cursor: 'pointer',
              background: splitMode === 'vertical' ? 'var(--selection)' : 'transparent',
              color: splitMode === 'vertical' ? 'var(--accent-2)' : 'var(--ink-faint)',
            }}
          >▐▌</button>
          <button
            onClick={() => { setSplitMode(splitMode === 'horizontal' ? 'none' : 'horizontal'); if (splitMode === 'none') { const o = tabs.find(t => t.id !== activeTabId); if (o) setSplitTabId(o.id); } }}
            title="Split horizontal"
            aria-label="Toggle horizontal split"
            style={{
              padding: '4px 6px', fontSize: 10, border: 'none', borderRadius: 3, cursor: 'pointer',
              background: splitMode === 'horizontal' ? 'var(--selection)' : 'transparent',
              color: splitMode === 'horizontal' ? 'var(--accent-2)' : 'var(--ink-faint)',
            }}
          >▄▀</button>
        </div>
      </div>

      {splitMode === 'none' ? (
        editorPane(activeTab, true)
      ) : (
        <div style={{
          flex: 1, display: 'flex', overflow: 'hidden',
          flexDirection: splitMode === 'horizontal' ? 'column' : 'row',
        }}>
          {editorPane(activeTab, true)}
          <div style={{
            [splitMode === 'horizontal' ? 'height' : 'width']: 1,
            background: 'var(--accent)',
            flexShrink: 0,
          }} />
          {editorPane(splitTab, false)}
        </div>
      )}
    </div>
  );
}
