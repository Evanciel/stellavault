// Backlinks panel — notes that link to the active note, plus semantically
// related notes (Stage C, W1-16: core getRelated via 'core:related'). The list
// UI itself now lives in links-shared.tsx (RelationLists) so the NotePreviewPanel
// explorer can mount the same lists centered on the PREVIEW note.

import { useAppStore } from '../../stores/app-store.js';
import { ipc } from '../../lib/ipc-client.js';
import { RelationLists, type OnOpen } from './links-shared.js';

export function BacklinksPanel() {
  const tabs = useAppStore((s) => s.tabs);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const openFile = useAppStore((s) => s.openFile);

  const activeTab = tabs.find((t) => t.id === activeTabId);
  const activeTitle = activeTab?.title ?? '';

  if (!activeTitle) {
    return (
      <div style={{ padding: 20, textAlign: 'center', color: 'var(--ink-faint)', fontSize: 11 }}>
        Open a note to see its backlinks
      </div>
    );
  }

  // In the editor-tab context, opening a backlink/related note opens a real tab.
  const onOpen: OnOpen = async (t) => {
    const content = await ipc('vault:read-file', t.filePath);
    openFile(t.filePath, t.title, content);
  };

  return <RelationLists title={activeTitle} filePath={activeTab?.filePath ?? ''} onOpen={onOpen} />;
}
