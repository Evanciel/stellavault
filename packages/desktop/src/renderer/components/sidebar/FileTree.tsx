// Recursive file tree component.
// Stage D (W1-3): right-click context menu, inline rename, trash/duplicate/
// bookmark — orchestration lives in file-ops.ts.
// T2-11: keyboard nav (arrows/Enter), drag-drop move into folders, "Move to…".

import { useCallback, useMemo, useRef, useState } from 'react';
import { useAppStore } from '../../stores/app-store.js';
import { ipc } from '../../lib/ipc-client.js';
import { Modal, ConfirmModal, PromptModal } from '../ui/Modal.js';
import { ContextMenu, type MenuEntry } from './ContextMenu.js';
import {
  bookmarkNote,
  createFolder,
  createNote,
  deleteEntry,
  duplicateEntry,
  moveEntry,
  renameFolder,
  renameNote,
  type Confirm,
  type OpResult,
} from './file-ops.js';
import type { FileTreeNode } from '../../../shared/ipc-types.js';

interface Props {
  filter: string;
}

// ─── T2-11: visible-row flattening for keyboard nav ───
// Depth-first walk honoring expand state + the active filter, mirroring the
// render tree exactly so ArrowUp/Down step through what's actually on screen.

interface FlatRow {
  node: FileTreeNode;
  depth: number;
}

function flattenVisible(
  nodes: FileTreeNode[],
  expanded: Set<string>,
  filter: string,
  depth = 0,
  out: FlatRow[] = [],
): FlatRow[] {
  for (const node of nodes) {
    if (filter) {
      if (node.isDir) {
        if (!matchesFilter(node, filter)) continue;
      } else if (!node.name.toLowerCase().includes(filter)) {
        continue;
      }
    }
    out.push({ node, depth });
    if (node.isDir && expanded.has(node.path) && node.children) {
      flattenVisible(node.children, expanded, filter, depth + 1, out);
    }
  }
  return out;
}

// Collect every folder path (+ the vault root) for the "Move to…" picker.
function collectFolders(nodes: FileTreeNode[], out: { path: string; depth: number }[] = [], depth = 0): { path: string; depth: number }[] {
  for (const node of nodes) {
    if (node.isDir) {
      out.push({ path: node.path, depth });
      if (node.children) collectFolders(node.children, out, depth + 1);
    }
  }
  return out;
}

function parentOf(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return i === -1 ? p : p.slice(0, i);
}

function leafName(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return i === -1 ? p : p.slice(i + 1);
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
  const expandedFolders = useAppStore((s) => s.expandedFolders);
  const toggleFolder = useAppStore((s) => s.toggleFolder);
  const openFile = useAppStore((s) => s.openFile);
  const filterLower = filter.toLowerCase();

  const [menu, setMenu] = useState<MenuState | null>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [promptState, setPromptState] = useState<PromptState | null>(null);
  const [opError, setOpError] = useState<string | null>(null);
  // T2-11: keyboard selection (independent of the active tab) + drag-drop state.
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [dragOverPath, setDragOverPath] = useState<string | null>(null); // '' = root
  const [moveState, setMoveState] = useState<FileTreeNode | null>(null);
  // Vault root path cache for empty-area "New note/folder".
  const vaultPathRef = useRef<string>('');

  // T2-11: flattened visible rows — recomputed when tree/expand/filter change.
  const flatRows = useMemo(
    () => flattenVisible(tree, expandedFolders, filterLower),
    [tree, expandedFolders, filterLower],
  );

  // Promise-based ConfirmModal bridge — passed into file-ops as `Confirm`.
  const confirm: Confirm = useCallback((title, message, opts) =>
    new Promise<boolean>((resolve) => {
      setConfirmState({ title, message, danger: opts?.danger, confirmLabel: opts?.confirmLabel, resolve });
    }), []);

  const showError = useCallback((res: OpResult) => {
    if (!res.ok && res.error) setOpError(res.error);
  }, []);

  // T2-11: open a leaf file (used by Enter + click) — reads then opens a tab.
  const openLeaf = useCallback(async (node: FileTreeNode) => {
    const content = await ipc('vault:read-file', node.path);
    openFile(node.path, node.name.replace(/\.md$/, ''), content);
  }, [openFile]);

  // T2-11: keyboard navigation over the visible rows. Bare arrows/Enter only —
  // ignored while inline-renaming so the rename input keeps the keys.
  const onTreeKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (renamingPath) return;
    if (flatRows.length === 0) return;
    const idx = flatRows.findIndex((r) => r.node.path === selectedPath);

    const select = (i: number) => {
      const clamped = Math.max(0, Math.min(flatRows.length - 1, i));
      setSelectedPath(flatRows[clamped].node.path);
    };

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        select(idx === -1 ? 0 : idx + 1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        select(idx === -1 ? 0 : idx - 1);
        break;
      case 'ArrowRight': {
        if (idx === -1) { select(0); break; }
        e.preventDefault();
        const { node } = flatRows[idx];
        if (node.isDir && !expandedFolders.has(node.path)) toggleFolder(node.path);
        else if (node.isDir) select(idx + 1); // already open → step into first child
        break;
      }
      case 'ArrowLeft': {
        if (idx === -1) { select(0); break; }
        e.preventDefault();
        const { node, depth } = flatRows[idx];
        if (node.isDir && expandedFolders.has(node.path)) {
          toggleFolder(node.path);
        } else {
          // Jump to the parent folder row (closest preceding row with lower depth).
          for (let i = idx - 1; i >= 0; i--) {
            if (flatRows[i].depth < depth) { setSelectedPath(flatRows[i].node.path); break; }
          }
        }
        break;
      }
      case 'Enter': {
        if (idx === -1) break;
        e.preventDefault();
        const { node } = flatRows[idx];
        if (node.isDir) toggleFolder(node.path);
        else void openLeaf(node);
        break;
      }
      default:
        break;
    }
  }, [renamingPath, flatRows, selectedPath, expandedFolders, toggleFolder, openLeaf]);

  // T2-11: drop a dragged entry onto a folder (or '' = vault root).
  const handleDrop = useCallback((srcPath: string, srcIsDir: boolean, destDir: string) => {
    setDragOverPath(null);
    void moveEntry(srcPath, srcIsDir, destDir).then(showError);
  }, [showError]);

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
    const moveTo: MenuEntry = { label: 'Move to…', onClick: () => setMoveState(node) };
    const trash: MenuEntry = {
      label: 'Delete',
      danger: true,
      onClick: () => { void deleteEntry(node.path, node.isDir, confirm).then(showError); },
    };

    if (node.isDir) {
      return [newNote, newFolder, 'separator', rename, moveTo, trash];
    }
    return [
      newNote,
      'separator',
      rename,
      moveTo,
      { label: 'Duplicate', onClick: () => { void duplicateEntry(node.path, false).then(showError); } },
      { label: 'Bookmark', onClick: () => bookmarkNote(node.path) },
      'separator',
      trash,
    ];
  }, [confirm, dirForNode, showError]);

  // Vault root for the empty-area drop target — derived from a top-level node's
  // parent (avoids an extra IPC round-trip; tree paths are absolute).
  const rootDir = tree.length > 0 ? parentOf(tree[0].path) : '';

  return (
    <div
      role="tree"
      aria-label="Vault files"
      tabIndex={0}
      onKeyDown={onTreeKeyDown}
      style={{ padding: '4px 0', minHeight: '100%', outline: 'none' }}
      onContextMenu={(e) => {
        // Only fires for empty-area right-clicks — TreeNode stops propagation.
        openContextMenu(null, e);
      }}
      // T2-11: dropping on empty area moves the entry to the vault root.
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('application/x-sv-path')) {
          e.preventDefault();
          if (e.target === e.currentTarget) setDragOverPath('');
        }
      }}
      onDragLeave={(e) => { if (e.target === e.currentTarget) setDragOverPath((p) => (p === '' ? null : p)); }}
      onDrop={(e) => {
        if (e.target !== e.currentTarget) return; // a folder row handled it
        const srcPath = e.dataTransfer.getData('application/x-sv-path');
        if (!srcPath || !rootDir) { setDragOverPath(null); return; }
        const srcIsDir = e.dataTransfer.getData('application/x-sv-isdir') === '1';
        e.preventDefault();
        handleDrop(srcPath, srcIsDir, rootDir);
      }}
    >
      {tree.map((node) => (
        <TreeNode
          key={node.path}
          node={node}
          depth={0}
          filter={filterLower}
          renamingPath={renamingPath}
          selectedPath={selectedPath}
          dragOverPath={dragOverPath}
          onSelect={setSelectedPath}
          onDragOverFolder={setDragOverPath}
          onDropEntry={handleDrop}
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

      {moveState && (
        <MoveToModal
          node={moveState}
          folders={collectFolders(tree)}
          rootDir={rootDir}
          onClose={() => setMoveState(null)}
          onPick={(destDir) => {
            const n = moveState;
            setMoveState(null);
            void moveEntry(n.path, n.isDir, destDir).then(showError);
          }}
        />
      )}
    </div>
  );
}

// ─── T2-11: "Move to…" folder picker ───
// Lists the vault root + every folder; disables the entry's current parent and
// (for a folder) itself + its descendants. Pure list + click → onPick(destDir).
function MoveToModal({ node, folders, rootDir, onClose, onPick }: {
  node: FileTreeNode;
  folders: { path: string; depth: number }[];
  rootDir: string;
  onClose: () => void;
  onPick: (destDir: string) => void;
}) {
  const sep = node.path.includes('\\') ? '\\' : '/';
  const currentParent = parentOf(node.path);
  const isInvalid = (dir: string): boolean => {
    if (dir === currentParent) return true; // already there
    if (node.isDir && (dir === node.path || dir.startsWith(node.path + sep))) return true; // self / descendant
    return false;
  };

  const rows: { path: string; label: string; depth: number; disabled: boolean }[] = [
    { path: rootDir, label: '/ (vault root)', depth: 0, disabled: isInvalid(rootDir) },
    ...folders.map((f) => ({ path: f.path, label: leafName(f.path), depth: f.depth + 1, disabled: isInvalid(f.path) })),
  ];

  return (
    <Modal open onClose={onClose} title={`Move "${node.name.replace(/\.md$/, '')}" to…`} width={420}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        {rows.map((r) => (
          <button
            key={r.path || '__root__'}
            disabled={r.disabled}
            onClick={() => onPick(r.path)}
            style={{
              textAlign: 'left', padding: '6px 8px', paddingLeft: 8 + r.depth * 14,
              background: 'transparent', border: 'none', borderRadius: 4,
              fontSize: 12, color: r.disabled ? 'var(--ink-faint)' : 'var(--ink-dim)',
              cursor: r.disabled ? 'default' : 'pointer', opacity: r.disabled ? 0.5 : 1,
            }}
            onMouseEnter={(e) => { if (!r.disabled) e.currentTarget.style.background = 'var(--hover)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
          >
            {r.depth > 0 && '📁 '}{r.label}
          </button>
        ))}
      </div>
    </Modal>
  );
}

interface TreeNodeProps {
  node: FileTreeNode;
  depth: number;
  filter: string;
  renamingPath: string | null;
  selectedPath: string | null;
  dragOverPath: string | null;
  onSelect: (path: string) => void;
  onDragOverFolder: (path: string | null) => void;
  onDropEntry: (srcPath: string, srcIsDir: boolean, destDir: string) => void;
  onContextMenu: (node: FileTreeNode, e: React.MouseEvent) => void;
  onRenameCommit: (node: FileTreeNode, newName: string) => void;
  onRenameCancel: () => void;
}

function TreeNode({
  node, depth, filter, renamingPath, selectedPath, dragOverPath,
  onSelect, onDragOverFolder, onDropEntry,
  onContextMenu, onRenameCommit, onRenameCancel,
}: TreeNodeProps) {
  const expandedFolders = useAppStore((s) => s.expandedFolders);
  const toggleFolder = useAppStore((s) => s.toggleFolder);
  const openFile = useAppStore((s) => s.openFile);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const isExpanded = expandedFolders.has(node.path);
  const isRenaming = renamingPath === node.path;

  const handleClick = useCallback(async () => {
    onSelect(node.path); // T2-11: click also sets keyboard selection
    if (node.isDir) {
      toggleFolder(node.path);
    } else {
      const content = await ipc('vault:read-file', node.path);
      const title = node.name.replace(/\.md$/, '');
      openFile(node.path, title, content);
    }
  }, [node, toggleFolder, openFile, onSelect]);

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
  const isSelected = selectedPath === node.path;
  const isDropTarget = node.isDir && dragOverPath === node.path;
  const indent = 8 + depth * 16;

  // Background precedence: drop target > active tab > keyboard selection > none.
  const baseBg = isDropTarget
    ? 'var(--hover)'
    : isActive
      ? 'var(--selection)'
      : isSelected
        ? 'var(--hover)'
        : 'transparent';

  return (
    <>
      <div
        role="treeitem"
        aria-expanded={node.isDir ? isExpanded : undefined}
        aria-selected={isActive || isSelected}
        tabIndex={isActive ? 0 : -1}
        draggable={!isRenaming}
        onDragStart={(e) => {
          e.dataTransfer.setData('application/x-sv-path', node.path);
          e.dataTransfer.setData('application/x-sv-isdir', node.isDir ? '1' : '0');
          e.dataTransfer.effectAllowed = 'move';
        }}
        onDragOver={node.isDir ? (e) => {
          if (e.dataTransfer.types.includes('application/x-sv-path')) {
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = 'move';
            onDragOverFolder(node.path);
          }
        } : undefined}
        onDragLeave={node.isDir ? (e) => { e.stopPropagation(); onDragOverFolder(null); } : undefined}
        onDrop={node.isDir ? (e) => {
          const srcPath = e.dataTransfer.getData('application/x-sv-path');
          if (!srcPath) return;
          e.preventDefault();
          e.stopPropagation();
          const srcIsDir = e.dataTransfer.getData('application/x-sv-isdir') === '1';
          onDropEntry(srcPath, srcIsDir, node.path);
        } : undefined}
        onClick={() => { if (!isRenaming) void handleClick(); }}
        onContextMenu={(e) => { onSelect(node.path); onContextMenu(node, e); }}
        style={{
          padding: '3px 8px 3px 0',
          paddingLeft: indent,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          fontSize: '12px',
          color: isActive ? 'var(--accent-2)' : 'var(--ink-dim)',
          background: baseBg,
          // Drop target ring so the destination folder is obvious mid-drag.
          boxShadow: isDropTarget ? 'inset 0 0 0 1px var(--accent)' : 'none',
          borderRadius: 2,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
        onMouseEnter={(e) => { if (!isDropTarget) (e.currentTarget as HTMLDivElement).style.background = isActive ? 'var(--selection)' : 'var(--hover)'; }}
        onMouseLeave={(e) => { if (!isDropTarget) (e.currentTarget as HTMLDivElement).style.background = baseBg; }}
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
          selectedPath={selectedPath}
          dragOverPath={dragOverPath}
          onSelect={onSelect}
          onDragOverFolder={onDragOverFolder}
          onDropEntry={onDropEntry}
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
