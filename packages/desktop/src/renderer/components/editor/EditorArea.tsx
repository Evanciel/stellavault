// Editor area — tab bar + markdown editor.

import { useCallback } from 'react';
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
    return <DailyBrief />;
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
