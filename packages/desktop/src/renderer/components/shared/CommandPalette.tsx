// Command Palette — sources every action from the command registry (W1-12).
// Opened via the 'app.command-palette' command (mod+shift+p by default).

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useAppStore } from '../../stores/app-store.js';
import { useSettingsStore } from '../../stores/settings-store.js';
import { useUiStore, listCommands, type CommandDef } from '../../lib/commands.js';
import { bindingFor, formatChord } from '../../lib/hotkeys.js';
import { fuzzyFilter } from '../../lib/fuzzy.js';
import { ipc } from '../../lib/ipc-client.js';
import { Modal } from '../ui/Modal.js';
import { collectNotes, type NoteEntry } from './QuickSwitcher.js';

// T2-16: the palette is now a single entry point (mod+p) for both commands AND
// files — it reuses QuickSwitcher's fuzzy file list so users don't have to learn
// two modals. QuickSwitcher (mod+shift+p kept) still exists as the files-only view.
// A palette row is either a registered command or a "go to file" result.
type PaletteItem =
  | { kind: 'command'; cmd: CommandDef }
  | { kind: 'file'; note: NoteEntry };

export function CommandPalette() {
  const open = useUiStore((s) => s.paletteOpen);
  // 'command' = normal list; 'new-note' = palette morphs into a title input.
  const mode = useUiStore((s) => s.paletteMode);
  const setPaletteOpen = useUiStore((s) => s.setPaletteOpen);
  const statsText = useUiStore((s) => s.statsText);
  const setStatsText = useUiStore((s) => s.setStatsText);
  const hotkeys = useSettingsStore((s) => s.settings.hotkeys);

  const [query, setQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const store = useAppStore;
  const fileTree = useAppStore((s) => s.fileTree);
  const vaultPath = useAppStore((s) => s.vaultPath);

  const commands = listCommands();
  const filteredCommands = fuzzyFilter(commands, query, (c) => `${c.category} ${c.title}`);

  // T2-16: fuzzy "go to file" results (same source/algorithm as QuickSwitcher).
  // Only when the palette is open and there's a query — an empty query shows the
  // full command list (the palette's primary purpose), not the whole vault.
  const allNotes = useMemo(
    () => (open && mode === 'command' ? collectNotes(fileTree, vaultPath) : []),
    [open, mode, fileTree, vaultPath],
  );
  const filteredFiles = useMemo(
    () => (query.trim() ? fuzzyFilter(allNotes, query, (n) => n.relPath).slice(0, 8) : []),
    [allNotes, query],
  );

  // Unified, index-addressable list: commands first, then file results.
  const items: PaletteItem[] = useMemo(() => [
    ...filteredCommands.map((cmd) => ({ kind: 'command', cmd }) as PaletteItem),
    ...filteredFiles.map((note) => ({ kind: 'file', note }) as PaletteItem),
  ], [filteredCommands, filteredFiles]);

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

  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIdx(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open, mode]);

  // T2-16: a palette row is either a command (run it) or a file (open it).
  const handleSelect = useCallback((item: PaletteItem) => {
    // Commands that morph the palette (new-note) reopen it themselves.
    setPaletteOpen(false);
    if (item.kind === 'command') {
      void item.cmd.run();
    } else {
      void (async () => {
        const content = await ipc('vault:read-file', item.note.filePath);
        store.getState().openFile(item.note.filePath, item.note.title, content);
      })();
    }
  }, [setPaletteOpen, store]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (mode === 'new-note') {
        // Back to command list instead of closing.
        setPaletteOpen(true, 'command');
        setQuery('');
        setSelectedIdx(0);
      } else {
        setPaletteOpen(false);
      }
      return;
    }
    if (mode === 'new-note') {
      if (e.key === 'Enter') {
        e.preventDefault();
        const name = query.trim();
        if (!name) return;
        setPaletteOpen(false);
        createNote(name);
      }
      return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIdx((i) => Math.min(i + 1, items.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIdx((i) => Math.max(i - 1, 0)); }
    if (e.key === 'Enter' && items[selectedIdx]) { e.preventDefault(); handleSelect(items[selectedIdx]); }
  }, [mode, query, items, selectedIdx, handleSelect, createNote, setPaletteOpen]);

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
      onClick={() => setPaletteOpen(false)}
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
            aria-activedescendant={mode === 'command' && items[selectedIdx] ? `sv-cmd-${selectedIdx}` : undefined}
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
          {items.map((item, i) => {
            // T2-16: a thin "Files" divider where the file results begin so the
            // two kinds read distinctly in one list.
            const firstFile = item.kind === 'file'
              && (i === 0 || items[i - 1].kind !== 'file');
            const selected = i === selectedIdx;
            return (
              <div key={item.kind === 'command' ? `c-${item.cmd.id}` : `f-${item.note.filePath}`}>
                {firstFile && (
                  <div style={{
                    padding: '6px 14px 2px', fontSize: 9, color: 'var(--ink-faint)',
                    textTransform: 'uppercase', letterSpacing: '0.08em',
                  }}>
                    Files
                  </div>
                )}
                <div
                  id={`sv-cmd-${i}`}
                  role="option"
                  aria-selected={selected}
                  onClick={() => handleSelect(item)}
                  onMouseEnter={() => setSelectedIdx(i)}
                  style={{
                    padding: '8px 14px', fontSize: 13, cursor: 'pointer', borderRadius: 5,
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    color: selected ? 'var(--accent-2)' : 'var(--ink-dim)',
                    background: selected ? 'var(--selection)' : 'transparent',
                  }}
                >
                  {item.kind === 'command' ? (
                    <>
                      <span>
                        <span style={{ fontSize: 10, color: 'var(--ink-faint)', marginRight: 8 }}>{item.cmd.category}</span>
                        {item.cmd.title}
                      </span>
                      {(() => { const chord = bindingFor(item.cmd, hotkeys); return chord && (
                        <span style={{ fontSize: 10, color: 'var(--ink-faint)', fontFamily: 'monospace' }}>
                          {formatChord(chord)}
                        </span>
                      ); })()}
                    </>
                  ) : (
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {item.note.title}
                      <span style={{ fontSize: 10, color: 'var(--ink-faint)', marginLeft: 8 }}>{item.note.relPath}</span>
                    </span>
                  )}
                </div>
              </div>
            );
          })}
          {items.length === 0 && (
            <div style={{ padding: 16, textAlign: 'center', color: 'var(--ink-faint)', fontSize: 12 }}>
              No matching commands or files
            </div>
          )}
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
