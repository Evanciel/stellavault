// Command Palette — Ctrl+Shift+P, lists all available actions.

import { useState, useEffect, useRef, useCallback } from 'react';
import { useAppStore } from '../../stores/app-store.js';
import { ipc } from '../../lib/ipc-client.js';

interface Command {
  id: string;
  label: string;
  shortcut?: string;
  action: () => void;
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const store = useAppStore;
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const toggleTheme = useAppStore((s) => s.toggleTheme);
  const setRightPanel = useAppStore((s) => s.setRightPanel);

  const commands: Command[] = [
    { id: 'toggle-sidebar', label: 'Toggle sidebar', shortcut: 'Ctrl+B', action: toggleSidebar },
    { id: 'toggle-theme', label: 'Toggle dark/light theme', shortcut: 'T', action: toggleTheme },
    { id: 'panel-ai', label: 'Open AI panel', action: () => setRightPanel('ai') },
    { id: 'panel-graph', label: 'Open 3D graph', action: () => setRightPanel('graph') },
    { id: 'panel-backlinks', label: 'Open backlinks', action: () => setRightPanel('backlinks') },
    { id: 'panel-close', label: 'Close right panel', action: () => setRightPanel('none') },
    { id: 'new-note', label: 'Create new note', action: () => {
      const name = prompt('Note title:');
      if (!name) return;
      void (async () => {
        const vp = await ipc('vault:get-path');
        const path = `${vp}/${name.replace(/[<>:"/\\|?*]/g, '')}.md`;
        await ipc('vault:create-file', path, `# ${name}\n\n`);
        const content = await ipc('vault:read-file', path);
        store.getState().openFile(path, name, content);
        const tree = await ipc('vault:read-tree');
        store.getState().setFileTree(tree);
      })();
    }},
    { id: 'reindex', label: 'Re-index vault', action: () => {
      void ipc('core:index');
    }},
    { id: 'doctor', label: 'Run diagnostics', action: () => {
      void ipc('core:get-stats').then((stats) => {
        alert(`Vault: ${stats.documentCount} docs, ${stats.chunkCount} chunks\nDB: ${(stats.dbSizeBytes / 1024 / 1024).toFixed(1)}MB\nLast indexed: ${stats.lastIndexed || 'Never'}`);
      });
    }},
  ];

  const filtered = query
    ? commands.filter((c) => c.label.toLowerCase().includes(query.toLowerCase()))
    : commands;

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'P') {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === 'Escape' && open) setOpen(false);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIdx(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  const handleSelect = useCallback((cmd: Command) => {
    setOpen(false);
    cmd.action();
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIdx((i) => Math.min(i + 1, filtered.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIdx((i) => Math.max(i - 1, 0)); }
    if (e.key === 'Enter' && filtered[selectedIdx]) { e.preventDefault(); handleSelect(filtered[selectedIdx]); }
  }, [filtered, selectedIdx, handleSelect]);

  if (!open) return null;

  return (
    <div
      onClick={() => setOpen(false)}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 10000,
        display: 'flex', justifyContent: 'center', paddingTop: '15vh',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 480, maxHeight: 360, background: 'var(--bg-2)',
          border: '1px solid var(--border)', borderRadius: 10,
          boxShadow: '0 16px 48px rgba(0,0,0,0.5)', overflow: 'hidden',
          display: 'flex', flexDirection: 'column',
        }}
      >
        <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)' }}>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSelectedIdx(0); }}
            onKeyDown={handleKeyDown}
            placeholder="Type a command..."
            style={{
              width: '100%', background: 'transparent', border: 'none',
              outline: 'none', fontSize: 14, color: 'var(--ink)',
            }}
          />
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: 4 }}>
          {filtered.map((cmd, i) => (
            <div
              key={cmd.id}
              onClick={() => handleSelect(cmd)}
              onMouseEnter={() => setSelectedIdx(i)}
              style={{
                padding: '8px 14px', fontSize: 13, cursor: 'pointer', borderRadius: 5,
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                color: i === selectedIdx ? 'var(--accent-2)' : 'var(--ink-dim)',
                background: i === selectedIdx ? 'var(--selection)' : 'transparent',
              }}
            >
              <span>{cmd.label}</span>
              {cmd.shortcut && (
                <span style={{ fontSize: 10, color: 'var(--ink-faint)', fontFamily: 'monospace' }}>
                  {cmd.shortcut}
                </span>
              )}
            </div>
          ))}
        </div>
        <div style={{
          padding: '6px 14px', borderTop: '1px solid var(--border)',
          fontSize: 10, color: 'var(--ink-faint)', display: 'flex', gap: 16,
        }}>
          <span>↑↓ navigate</span>
          <span>↵ run</span>
          <span>esc close</span>
        </div>
      </div>
    </div>
  );
}
