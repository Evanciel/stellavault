// Recursive file tree component.
// Stage D (W1-3): right-click context menu, inline rename, trash/duplicate/
// bookmark — orchestration lives in file-ops.ts.

import { useCallback, useRef, useState } from 'react';
import { useAppStore } from '../../stores/app-store.js';
import { ipc } from '../../lib/ipc-client.js';
import { ConfirmModal, PromptModal } from '../ui/Modal.js';
import { ContextMenu, type MenuEntry } from './ContextMenu.js';
import {
  bookmarkNote,
  createFolder,
  createNote,
  deleteEntry,
  duplicateEntry,
  renameFolder,
  renameNote,
  type Confirm,
  type OpResult,
} from './file-ops.js';
import type { FileTreeNode } from '../../../shared/ipc-types.js';

interface Props {
  filter: string;
}

interface MenuState {
  x: number;
  y: number;
  node: FileTreeNode | null; // null = vault root (empty-area right-click)
}

interface ConfirmState {
  title: string;
  message: string;
  danger?: boolean;
  confirmLabel?: string;
  resolve: (ok: boolean) => void;
}

interface PromptState {
  title: string;
  placeholder: string;
  submitLabel: string;
  onSubmit: (value: string) => void;
}

export function FileTree({ filter }: Props) {
  const tree = useAppStore((s) => s.fileTree);
  const filterLower = filter.toLowerCase();

  const [menu, setMenu] = useState<MenuState | null>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [promptState, setPromptState] = useState<PromptState | null>(null);
  const [opError, setOpError] = useState<string | null>(null);
  // Vault root path cache for empty-area "New note/folder".
  const vaultPathRef = useRef<string>('');

  // Promise-based ConfirmModal bridge — passed into file-ops as `Confirm`.
  const confirm: Confirm = useCallback((title, message, opts) =>
    new Promise<boolean>((resolve) => {
      setConfirmState({ title, message, danger: opts?.danger, confirmLabel: opts?.confirmLabel, resolve });
    }), []);

  const showError = useCallback((res: OpResult) => {
    if (!res.ok && res.error) setOpError(res.error);
  }, []);

  const dirForNode = useCallback(async (node: FileTreeNode | null): Promise<string> => {
    if (node?.isDir) return node.path;
    if (!vaultPathRef.current) vaultPathRef.current = await ipc('vault:get-path');
    return vaultPathRef.current;
  }, []);

  const openContextMenu = useCallback((node: FileTreeNode | null, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, node });
  }, []);

  const handleRenameCommit = useCallback((node: FileTreeNode, newName: string) => {
    setRenamingPath(null);
    void (async () => {
      const res = node.isDir
        ? await renameFolder(node.path, newName)
        : await renameNote(node.path, newName, confirm);
      showError(res);
    })();
  }, [confirm, showError]);

  const buildEntries = useCallback((node: FileTreeNode | null): MenuEntry[] => {
    const newNote: MenuEntry = {
      label: 'New note',
      onClick: () => {
        void (async () => {
          const dir = await dirForNode(node);
          setPromptState({
            title: 'Create new note',
            placeholder: 'Note title...',
            submitLabel: 'Create',
            onSubmit: (name) => { void createNote(dir, name).then(showError); },
          });
        })();
      },
    };
    const newFolder: MenuEntry = {
      label: 'New folder',
      onClick: () => {
        void (async () => {
          const dir = await dirForNode(node);
          setPromptState({
            title: 'Create new folder',
            placeholder: 'Folder name...',
            submitLabel: 'Create',
            onSubmit: (name) => { void createFolder(dir, name).then(showError); },
          });
        })();
      },
    };

    if (!node) return [newNote, newFolder]; // empty-area menu

    const rename: MenuEntry = { label: 'Rename', onClick: () => setRenamingPath(node.path) };
    const trash: MenuEntry = {
      label: 'Delete',
      danger: true,
      onClick: () => { void deleteEntry(node.path, node.isDir, confirm).then(showError); },
    };

    if (node.isDir) {
      return [newNote, newFolder, 'separator', rename, trash];
    }
    return [
      newNote,
      'separator',
      rename,
      { label: 'Duplicate', onClick: () => { void duplicateEntry(node.path, false).then(showError); } },
      { label: 'Bookmark', onClick: () => bookmarkNote(node.path) },
      'separator',
      trash,
    ];
  }, [confirm, dirForNode, showError]);

  return (
    <div
      role="tree"
      aria-label="Vault files"
      style={{ padding: '4px 0', minHeight: '100%' }}
      onContextMenu={(e) => {
        // Only fires for empty-area right-clicks — TreeNode stops propagation.
        openContextMenu(null, e);
      }}
    >
      {tree.map((node) => (
        <TreeNode
          key={node.path}
          node={node}
          depth={0}
          filter={filterLower}
          renamingPath={renamingPath}
          onContextMenu={openContextMenu}
          onRenameCommit={handleRenameCommit}
          onRenameCancel={() => setRenamingPath(null)}
        />
      ))}
      {tree.length === 0 && (
        <div style={{ padding: '16px', color: 'var(--ink-faint)', fontSize: '11px', textAlign: 'center' }}>
          No .md files found
        </div>
      )}

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          entries={buildEntries(menu.node)}
          onClose={() => setMenu(null)}
        />
      )}

      <ConfirmModal
        open={!!confirmState}
        title={confirmState?.title ?? ''}
        message={confirmState?.message ?? ''}
        danger={confirmState?.danger}
        confirmLabel={confirmState?.confirmLabel}
        onConfirm={() => { confirmState?.resolve(true); setConfirmState(null); }}
        onClose={() => { confirmState?.resolve(false); setConfirmState(null); }}
      />

      <PromptModal
        open={!!promptState}
        title={promptState?.title ?? ''}
        placeholder={promptState?.placeholder}
        submitLabel={promptState?.submitLabel}
        onSubmit={(value) => promptState?.onSubmit(value)}
        onClose={() => setPromptState(null)}
      />

      <ConfirmModal
        open={!!opError}
        title="Operation failed"
        message={opError ?? ''}
        confirmLabel="OK"
        onConfirm={() => setOpError(null)}
        onClose={() => setOpError(null)}
      />
    </div>
  );
}

interface TreeNodeProps {
  node: FileTreeNode;
  depth: number;
  filter: string;
  renamingPath: string | null;
  onContextMenu: (node: FileTreeNode, e: React.MouseEvent) => void;
  onRenameCommit: (node: FileTreeNode, newName: string) => void;
  onRenameCancel: () => void;
}

function TreeNode({ node, depth, filter, renamingPath, onContextMenu, onRenameCommit, onRenameCancel }: TreeNodeProps) {
  const expandedFolders = useAppStore((s) => s.expandedFolders);
  const toggleFolder = useAppStore((s) => s.toggleFolder);
  const openFile = useAppStore((s) => s.openFile);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const isExpanded = expandedFolders.has(node.path);
  const isRenaming = renamingPath === node.path;

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
        onClick={() => { if (!isRenaming) void handleClick(); }}
        onContextMenu={(e) => onContextMenu(node, e)}
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
            {isExpanded ? '▼' : '▶'}
          </span>
        )}
        {!node.isDir && <span style={{ width: 12 }} />}
        {isRenaming ? (
          <RenameInput
            initial={node.isDir ? node.name : node.name.replace(/\.md$/, '')}
            onCommit={(value) => onRenameCommit(node, value)}
            onCancel={onRenameCancel}
          />
        ) : (
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {node.isDir ? node.name : node.name.replace(/\.md$/, '')}
          </span>
        )}
      </div>

      {node.isDir && isExpanded && node.children?.map((child) => (
        <TreeNode
          key={child.path}
          node={child}
          depth={depth + 1}
          filter={filter}
          renamingPath={renamingPath}
          onContextMenu={onContextMenu}
          onRenameCommit={onRenameCommit}
          onRenameCancel={onRenameCancel}
        />
      ))}
    </>
  );
}

// Inline rename input (W1-3) — Enter commits, Escape/blur cancels.
function RenameInput({ initial, onCommit, onCancel }: {
  initial: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  const committedRef = useRef(false);
  return (
    <input
      type="text"
      defaultValue={initial}
      autoFocus
      aria-label="Rename"
      onFocus={(e) => e.currentTarget.select()}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
          const value = (e.currentTarget as HTMLInputElement).value.trim();
          committedRef.current = true;
          if (value && value !== initial) onCommit(value);
          else onCancel();
        } else if (e.key === 'Escape') {
          committedRef.current = true;
          onCancel();
        }
      }}
      onBlur={() => { if (!committedRef.current) onCancel(); }}
      style={{
        flex: 1,
        minWidth: 0,
        background: 'var(--hover)',
        border: '1px solid var(--accent)',
        borderRadius: 3,
        padding: '1px 6px',
        fontSize: '12px',
        color: 'var(--ink)',
        outline: 'none',
      }}
    />
  );
}

function matchesFilter(node: FileTreeNode, filter: string): boolean {
  if (node.name.toLowerCase().includes(filter)) return true;
  if (node.isDir && node.children) {
    return node.children.some((c) => matchesFilter(c, filter));
  }
  return false;
}
