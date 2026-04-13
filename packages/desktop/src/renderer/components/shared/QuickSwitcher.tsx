// Quick Switcher — Ctrl+P modal for fuzzy file switching.

import { useState, useEffect, useRef, useCallback } from 'react';
import { useAppStore } from '../../stores/app-store.js';
import { ipc } from '../../lib/ipc-client.js';

export function QuickSwitcher() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<string[]>([]);
  const [allNotes, setAllNotes] = useState<string[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const openFile = useAppStore((s) => s.openFile);
  const vaultPath = useAppStore((s) => s.vaultPath);

  // Ctrl+P / Cmd+P opens the switcher
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'p') {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === 'Escape' && open) {
        setOpen(false);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  // Load all notes when opened
  useEffect(() => {
    if (!open) return;
    void ipc('vault:list-notes').then((notes) => {
      setAllNotes(notes);
      setResults(notes.slice(0, 20));
    });
    setQuery('');
    setSelectedIdx(0);
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  // Filter on query change
  useEffect(() => {
    if (!query) {
      setResults(allNotes.slice(0, 20));
      setSelectedIdx(0);
      return;
    }
    const q = query.toLowerCase();
    const filtered = allNotes.filter((n) => n.toLowerCase().includes(q)).slice(0, 20);
    setResults(filtered);
    setSelectedIdx(0);
  }, [query, allNotes]);

  const handleSelect = useCallback(async (title: string) => {
    setOpen(false);
    // Find full path by searching vault
    const tree = useAppStore.getState().fileTree;
    const filePath = findFilePath(tree, title);
    if (!filePath) return;
    const content = await ipc('vault:read-file', filePath);
    openFile(filePath, title, content);
  }, [openFile]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIdx((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (results[selectedIdx]) void handleSelect(results[selectedIdx]);
    }
  }, [results, selectedIdx, handleSelect]);

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

        <div style={{ flex: 1, overflowY: 'auto', padding: '4px' }}>
          {results.map((title, i) => (
            <div
              key={title}
              onClick={() => void handleSelect(title)}
              onMouseEnter={() => setSelectedIdx(i)}
              style={{
                padding: '8px 14px',
                fontSize: '13px',
                cursor: 'pointer',
                borderRadius: 5,
                color: i === selectedIdx ? 'var(--accent-2)' : 'var(--ink-dim)',
                background: i === selectedIdx ? 'var(--selection)' : 'transparent',
              }}
            >
              {title}
            </div>
          ))}
          {results.length === 0 && (
            <div style={{ padding: '16px', textAlign: 'center', color: 'var(--ink-faint)', fontSize: '12px' }}>
              No notes found
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
          <span>esc close</span>
        </div>
      </div>
    </div>
  );
}

// Recursively find file path from tree by title
import type { FileTreeNode } from '../../../shared/ipc-types.js';

function findFilePath(nodes: FileTreeNode[], title: string): string | null {
  for (const node of nodes) {
    if (!node.isDir && node.name.replace(/\.md$/, '') === title) return node.path;
    if (node.isDir && node.children) {
      const found = findFilePath(node.children, title);
      if (found) return found;
    }
  }
  return null;
}
