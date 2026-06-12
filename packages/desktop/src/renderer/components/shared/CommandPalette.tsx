// Command Palette — Ctrl+Shift+P, lists all available actions.

import { useState, useEffect, useRef, useCallback } from 'react';
import { useAppStore } from '../../stores/app-store.js';
import { ipc } from '../../lib/ipc-client.js';
import { Modal } from '../ui/Modal.js';

interface Command {
  id: string;
  label: string;
  shortcut?: string;
  /** Keeps the palette open after running (e.g. morphs into input mode). */
  keepOpen?: boolean;
  action: () => void;
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  // 'command' = normal list; 'new-note' = palette morphs into a title input.
  const [mode, setMode] = useState<'command' | 'new-note'>('command');
  const [statsText, setStatsText] = useState<string | null>(null);
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
    // Palette morphs into a title input — prompt() freezes Electron.
    { id: 'new-note', label: 'Create new note', keepOpen: true, action: () => {
      setMode('new-note');
      setQuery('');
      setSelectedIdx(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }},
    { id: 'reindex', label: 'Re-index vault', action: () => {
      void ipc('core:index');
    }},
    { id: 'doctor', label: 'Run diagnostics', action: () => {
      void ipc('core:get-stats').then((stats) => {
        // Modal instead of alert() — alert() freezes Electron.
        setStatsText(`Vault: ${stats.documentCount} docs, ${stats.chunkCount} chunks\nDB: ${(stats.dbSizeBytes / 1024 / 1024).toFixed(1)}MB\nLast indexed: ${stats.lastIndexed || 'Never'}`);
      });
    }},
  ];

  const createNote = useCallback((name: string) => {
    void (async () => {
      const vp = await ipc('vault:get-path');
      const safeName = name.replace(/[<>:"/\\|?*]/g, '');
      const path = `${vp}/${safeName}.md`;
      await ipc('vault:create-file', path, `# ${name}\n\n`);
      const content = await ipc('vault:read-file', path);
      store.getState().openFile(path, name, content);
      const tree = await ipc('vault:read-tree');
      store.getState().setFileTree(tree);
    })();
  }, [store]);

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
      setMode('command');
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  const handleSelect = useCallback((cmd: Command) => {
    if (!cmd.keepOpen) setOpen(false);
    cmd.action();
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (mode === 'new-note') {
      if (e.key === 'Escape') {
        // Back to command list instead of closing; stop the window
        // listener (which closes the palette) from seeing this key.
        e.preventDefault();
        e.stopPropagation();
        setMode('command');
        setQuery('');
        setSelectedIdx(0);
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        const name = query.trim();
        if (!name) return;
        setOpen(false);
        createNote(name);
      }
      return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIdx((i) => Math.min(i + 1, filtered.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIdx((i) => Math.max(i - 1, 0)); }
    if (e.key === 'Enter' && filtered[selectedIdx]) { e.preventDefault(); handleSelect(filtered[selectedIdx]); }
  }, [mode, query, filtered, selectedIdx, handleSelect, createNote]);

  const statsModal = (
    <Modal open={statsText !== null} onClose={() => setStatsText(null)} title="Vault diagnostics" width={360}>
      <pre style={{
        margin: 0, fontSize: 12, lineHeight: 1.7, color: 'var(--ink-dim)',
        fontFamily: 'inherit', whiteSpace: 'pre-wrap',
      }}>
        {statsText}
      </pre>
    </Modal>
  );

  if (!open) return statsModal;

  return (<>
    {statsModal}
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
            role={mode === 'command' ? 'combobox' : undefined}
            aria-label={mode === 'command' ? 'Command palette' : 'New note title'}
            aria-expanded={mode === 'command' ? true : undefined}
            aria-controls={mode === 'command' ? 'sv-cmd-list' : undefined}
            aria-activedescendant={mode === 'command' && filtered[selectedIdx] ? `sv-cmd-${filtered[selectedIdx].id}` : undefined}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSelectedIdx(0); }}
            onKeyDown={handleKeyDown}
            placeholder={mode === 'command' ? 'Type a command...' : 'Note title...'}
            style={{
              width: '100%', background: 'transparent', border: 'none',
              outline: 'none', fontSize: 14, color: 'var(--ink)',
            }}
          />
        </div>
        {mode === 'new-note' ? (
          <div style={{ padding: '12px 14px', fontSize: 12, color: 'var(--ink-faint)' }}>
            Press Enter to create the note.
          </div>
        ) : (
        <div id="sv-cmd-list" role="listbox" style={{ flex: 1, overflowY: 'auto', padding: 4 }}>
          {filtered.map((cmd, i) => (
            <div
              key={cmd.id}
              id={`sv-cmd-${cmd.id}`}
              role="option"
              aria-selected={i === selectedIdx}
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
        )}
        <div style={{
          padding: '6px 14px', borderTop: '1px solid var(--border)',
          fontSize: 10, color: 'var(--ink-faint)', display: 'flex', gap: 16,
        }}>
          {mode === 'new-note' ? (
            <>
              <span>↵ create</span>
              <span>esc back</span>
            </>
          ) : (
            <>
              <span>↑↓ navigate</span>
              <span>↵ run</span>
              <span>esc close</span>
            </>
          )}
        </div>
      </div>
    </div>
  </>);
}
