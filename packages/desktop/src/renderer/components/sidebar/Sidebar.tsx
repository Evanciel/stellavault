// Left sidebar — file tree + search input.

import { useState, useCallback } from 'react';
import { useAppStore } from '../../stores/app-store.js';
import { FileTree } from './FileTree.js';
import { ipc } from '../../lib/ipc-client.js';

export function Sidebar() {
  const [filter, setFilter] = useState('');
  const setFileTree = useAppStore((s) => s.setFileTree);

  const handleRefresh = useCallback(async () => {
    const tree = await ipc('vault:read-tree');
    setFileTree(tree);
  }, [setFileTree]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Search / filter */}
      <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)' }}>
        <input
          type="text"
          placeholder="Filter files..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{
            width: '100%',
            background: 'var(--hover)',
            border: '1px solid var(--border)',
            borderRadius: 4,
            padding: '5px 8px',
            fontSize: '11px',
            color: 'var(--ink)',
            outline: 'none',
          }}
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
        fontSize: '10px',
      }}>
        <button onClick={() => void handleRefresh()} style={actionBtnStyle}>
          Refresh
        </button>
        <button onClick={() => {
          const name = prompt('New note title:');
          if (!name) return;
          void (async () => {
            const vp = await ipc('vault:get-path');
            const path = `${vp}/${name.replace(/[<>:"/\\|?*]/g, '')}.md`;
            await ipc('vault:create-file', path, `# ${name}\n\n`);
            await handleRefresh();
            const content = await ipc('vault:read-file', path);
            useAppStore.getState().openFile(path, name, content);
          })();
        }} style={actionBtnStyle}>
          + Note
        </button>
      </div>
    </div>
  );
}

const actionBtnStyle: React.CSSProperties = {
  background: 'var(--hover)',
  border: '1px solid var(--border)',
  borderRadius: 3,
  padding: '3px 8px',
  color: 'var(--ink-dim)',
  cursor: 'pointer',
  fontSize: '10px',
};
