// Left sidebar — file tree + search input.

import { useState, useCallback } from 'react';
import { useAppStore } from '../../stores/app-store.js';
import { FileTree } from './FileTree.js';
import { Input } from '../ui/Input.js';
import { Button } from '../ui/Button.js';
import { PromptModal } from '../ui/Modal.js';
import { ipc } from '../../lib/ipc-client.js';

export function Sidebar() {
  const [filter, setFilter] = useState('');
  const [newNoteOpen, setNewNoteOpen] = useState(false);
  const setFileTree = useAppStore((s) => s.setFileTree);

  const handleRefresh = useCallback(async () => {
    const tree = await ipc('vault:read-tree');
    setFileTree(tree);
  }, [setFileTree]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Search / filter */}
      <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)' }}>
        <Input
          placeholder="Filter files..."
          aria-label="Filter files in sidebar"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>

      {/* File tree */}
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
        <FileTree filter={filter} />
      </div>

      {/* Bottom actions */}
      <div style={{
        padding: '6px 10px',
        borderTop: '1px solid var(--border)',
        display: 'flex',
        gap: 6,
      }}>
        <Button onClick={() => void handleRefresh()} size="sm">Refresh</Button>
        <Button onClick={() => setNewNoteOpen(true)} size="sm">+ Note</Button>
      </div>

      {/* New Note modal — replaces prompt() which freezes Electron */}
      <PromptModal
        open={newNoteOpen}
        onClose={() => setNewNoteOpen(false)}
        title="Create new note"
        placeholder="Note title..."
        onSubmit={(name) => {
          void (async () => {
            const vp = await ipc('vault:get-path');
            const safeName = name.replace(/[<>:"/\\|?*]/g, '');
            const path = `${vp}/${safeName}.md`;
            await ipc('vault:create-file', path, `# ${name}\n\n`);
            await handleRefresh();
            const content = await ipc('vault:read-file', path);
            useAppStore.getState().openFile(path, name, content);
          })();
        }}
      />
    </div>
  );
}
