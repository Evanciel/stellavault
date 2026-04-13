// Editor area — tab bar + markdown editor.

import { useCallback } from 'react';
import { useAppStore } from '../../stores/app-store.js';
import { TabBar } from './TabBar.js';
import { MarkdownEditor } from './MarkdownEditor.js';
import { ipc } from '../../lib/ipc-client.js';

export function EditorArea() {
  const tabs = useAppStore((s) => s.tabs);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const updateTabContent = useAppStore((s) => s.updateTabContent);
  const markTabClean = useAppStore((s) => s.markTabClean);

  const activeTab = tabs.find((t) => t.id === activeTabId);

  const handleSave = useCallback(async () => {
    if (!activeTab || !activeTab.isDirty) return;
    await ipc('vault:write-file', activeTab.filePath, activeTab.content);
    markTabClean(activeTab.id);
  }, [activeTab, markTabClean]);

  // Ctrl+S / Cmd+S to save
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      void handleSave();
    }
  }, [handleSave]);

  if (tabs.length === 0) {
    return (
      <div style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'column',
        gap: 12,
        color: 'var(--ink-faint)',
        fontSize: '14px',
        background: 'var(--editor-bg)',
      }}>
        <span style={{ fontSize: 48, opacity: 0.3 }}>&#x2726;</span>
        <span>Open a note from the sidebar</span>
        <span style={{ fontSize: '11px', opacity: 0.6 }}>or press Ctrl+P to quick-switch</span>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }} onKeyDown={handleKeyDown}>
      <TabBar />
      {activeTab && (
        <div style={{ flex: 1, overflow: 'auto', background: 'var(--editor-bg)', padding: '24px 48px' }}>
          <MarkdownEditor
            key={activeTab.id}
            content={activeTab.content}
            onChange={(content) => updateTabContent(activeTab.id, content)}
          />
        </div>
      )}
    </div>
  );
}
