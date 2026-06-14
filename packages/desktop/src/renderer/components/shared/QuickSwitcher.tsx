// Quick Switcher — fuzzy file switching (opened via the 'app.quick-switcher'
// command, mod+p by default). Shift+Enter creates a note named after the query.

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { FileTreeNode } from '../../../shared/ipc-types.js';
import { useAppStore } from '../../stores/app-store.js';
import { useUiStore } from '../../lib/commands.js';
import { fuzzyFilter } from '../../lib/fuzzy.js';
import { ipc } from '../../lib/ipc-client.js';

// T2-16: exported so the command palette can reuse the same fuzzy file list
// (one entry point — mod+p — finds both commands and files). QuickSwitcher stays.
export interface NoteEntry {
  title: string;        // file name without .md
  filePath: string;     // absolute path
  relPath: string;      // vault-relative path (disambiguates same titles)
}

export function collectNotes(nodes: FileTreeNode[], vaultPath: string, out: NoteEntry[] = []): NoteEntry[] {
  for (const node of nodes) {
    if (node.isDir) {
      if (node.children) collectNotes(node.children, vaultPath, out);
    } else if (node.name.endsWith('.md')) {
      const rel = node.path.startsWith(vaultPath)
        ? node.path.slice(vaultPath.length).replace(/^[/\\]/, '')
        : node.path;
      out.push({
        title: node.name.replace(/\.md$/, ''),
        filePath: node.path,
        relPath: rel.replace(/\\/g, '/'),
      });
    }
  }
  return out;
}

export function QuickSwitcher() {
  const open = useUiStore((s) => s.switcherOpen);
  const setOpen = useUiStore((s) => s.setSwitcherOpen);
  const [query, setQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const openFile = useAppStore((s) => s.openFile);
  const fileTree = useAppStore((s) => s.fileTree);
  const vaultPath = useAppStore((s) => s.vaultPath);

  const allNotes = useMemo(
    () => (open ? collectNotes(fileTree, vaultPath) : []),
    [open, fileTree, vaultPath],
  );

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setSelectedIdx(0);
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  // Fuzzy subsequence over the vault-relative path (matches folders too).
  const results = useMemo(
    () => fuzzyFilter(allNotes, query, (n) => n.relPath).slice(0, 20),
    [allNotes, query],
  );

  useEffect(() => { setSelectedIdx(0); }, [query]);

  const handleSelect = useCallback(async (note: NoteEntry) => {
    setOpen(false);
    const content = await ipc('vault:read-file', note.filePath);
    openFile(note.filePath, note.title, content);
  }, [openFile, setOpen]);

  const handleCreate = useCallback(async (name: string) => {
    setOpen(false);
    const safeName = name.replace(/[<>:"/\\|?*]/g, '').trim();
    if (!safeName) return;
    const vp = vaultPath || await ipc('vault:get-path');
    const filePath = `${vp}/${safeName}.md`;
    await ipc('vault:create-file', filePath, `# ${safeName}\n\n`);
    const content = await ipc('vault:read-file', filePath);
    openFile(filePath, safeName, content);
    const tree = await ipc('vault:read-tree');
    useAppStore.getState().setFileTree(tree);
  }, [vaultPath, openFile, setOpen]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIdx((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault();
      if (query.trim()) void handleCreate(query);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (results[selectedIdx]) void handleSelect(results[selectedIdx]);
    }
  }, [results, selectedIdx, query, handleSelect, handleCreate, setOpen]);

  if (!open) return null;

  return (
    <div
      onClick={() => setOpen(false)}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        zIndex: 10000,
        display: 'flex',
        justifyContent: 'center',
        paddingTop: '15vh',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 520,
          maxHeight: 400,
          background: 'var(--bg-2)',
          border: '1px solid var(--border)',
          borderRadius: 10,
          boxShadow: '0 16px 48px rgba(0,0,0,0.5)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)' }}>
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-label="Quick switcher"
            aria-expanded={true}
            aria-controls="sv-qs-list"
            aria-activedescendant={results[selectedIdx] ? `sv-qs-${selectedIdx}` : undefined}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Open a note..."
            style={{
              width: '100%',
              background: 'transparent',
              border: 'none',
              outline: 'none',
              fontSize: '15px',
              color: 'var(--ink)',
            }}
          />
        </div>

        <div id="sv-qs-list" role="listbox" style={{ flex: 1, overflowY: 'auto', padding: '4px' }}>
          {results.map((note, i) => (
            <div
              key={note.filePath}
              id={`sv-qs-${i}`}
              role="option"
              aria-selected={i === selectedIdx}
              onClick={() => void handleSelect(note)}
              onMouseEnter={() => setSelectedIdx(i)}
              style={{
                padding: '7px 14px',
                fontSize: '13px',
                cursor: 'pointer',
                borderRadius: 5,
                color: i === selectedIdx ? 'var(--accent-2)' : 'var(--ink-dim)',
                background: i === selectedIdx ? 'var(--selection)' : 'transparent',
              }}
            >
              <div>{note.title}</div>
              <div style={{ fontSize: 10, color: 'var(--ink-faint)', marginTop: 1 }}>
                {note.relPath}
              </div>
            </div>
          ))}
          {results.length === 0 && (
            <div style={{ padding: '16px', textAlign: 'center', color: 'var(--ink-faint)', fontSize: '12px' }}>
              {query.trim()
                ? <>No notes found — Shift+↵ creates &ldquo;{query.trim()}&rdquo;</>
                : 'No notes found'}
            </div>
          )}
        </div>

        <div style={{
          padding: '6px 14px',
          borderTop: '1px solid var(--border)',
          fontSize: '10px',
          color: 'var(--ink-faint)',
          display: 'flex',
          gap: 16,
        }}>
          <span>↑↓ navigate</span>
          <span>↵ open</span>
          <span>shift+↵ create</span>
          <span>esc close</span>
        </div>
      </div>
    </div>
  );
}
