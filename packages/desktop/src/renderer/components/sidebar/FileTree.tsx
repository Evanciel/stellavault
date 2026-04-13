// Recursive file tree component.

import { useCallback } from 'react';
import { useAppStore } from '../../stores/app-store.js';
import { ipc } from '../../lib/ipc-client.js';
import type { FileTreeNode } from '../../../shared/ipc-types.js';

interface Props {
  filter: string;
}

export function FileTree({ filter }: Props) {
  const tree = useAppStore((s) => s.fileTree);
  const filterLower = filter.toLowerCase();

  return (
    <div role="tree" aria-label="Vault files" style={{ padding: '4px 0' }}>
      {tree.map((node) => (
        <TreeNode key={node.path} node={node} depth={0} filter={filterLower} />
      ))}
      {tree.length === 0 && (
        <div style={{ padding: '16px', color: 'var(--ink-faint)', fontSize: '11px', textAlign: 'center' }}>
          No .md files found
        </div>
      )}
    </div>
  );
}

function TreeNode({ node, depth, filter }: { node: FileTreeNode; depth: number; filter: string }) {
  const expandedFolders = useAppStore((s) => s.expandedFolders);
  const toggleFolder = useAppStore((s) => s.toggleFolder);
  const openFile = useAppStore((s) => s.openFile);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const isExpanded = expandedFolders.has(node.path);

  const handleClick = useCallback(async () => {
    if (node.isDir) {
      toggleFolder(node.path);
    } else {
      const content = await ipc('vault:read-file', node.path);
      const title = node.name.replace(/\.md$/, '');
      openFile(node.path, title, content);
    }
  }, [node, toggleFolder, openFile]);

  // Filter: show file if name matches. Show folder if any child matches.
  if (filter) {
    if (node.isDir) {
      const hasMatch = node.children?.some((c) => matchesFilter(c, filter));
      if (!hasMatch) return null;
    } else {
      if (!node.name.toLowerCase().includes(filter)) return null;
    }
  }

  const isActive = !node.isDir && activeTabId === node.path;
  const indent = 8 + depth * 16;

  return (
    <>
      <div
        role="treeitem"
        aria-expanded={node.isDir ? isExpanded : undefined}
        aria-selected={isActive}
        tabIndex={isActive ? 0 : -1}
        onClick={() => void handleClick()}
        style={{
          padding: '3px 8px 3px 0',
          paddingLeft: indent,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          fontSize: '12px',
          color: isActive ? 'var(--accent-2)' : 'var(--ink-dim)',
          background: isActive ? 'var(--selection)' : 'transparent',
          borderRadius: 2,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = isActive ? 'var(--selection)' : 'var(--hover)'; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = isActive ? 'var(--selection)' : 'transparent'; }}
      >
        {node.isDir && (
          <span style={{ fontSize: '10px', width: 12, textAlign: 'center', color: 'var(--ink-faint)' }}>
            {isExpanded ? '\u25BC' : '\u25B6'}
          </span>
        )}
        {!node.isDir && <span style={{ width: 12 }} />}
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {node.isDir ? node.name : node.name.replace(/\.md$/, '')}
        </span>
      </div>

      {node.isDir && isExpanded && node.children?.map((child) => (
        <TreeNode key={child.path} node={child} depth={depth + 1} filter={filter} />
      ))}
    </>
  );
}

function matchesFilter(node: FileTreeNode, filter: string): boolean {
  if (node.name.toLowerCase().includes(filter)) return true;
  if (node.isDir && node.children) {
    return node.children.some((c) => matchesFilter(c, filter));
  }
  return false;
}
