// Command Palette — sources every action from the command registry (W1-12).
// Opened via the 'app.command-palette' command (mod+shift+p by default).

import { useState, useEffect, useRef, useCallback } from 'react';
import { useAppStore } from '../../stores/app-store.js';
import { useSettingsStore } from '../../stores/settings-store.js';
import { useUiStore, listCommands, type CommandDef } from '../../lib/commands.js';
import { bindingFor, formatChord } from '../../lib/hotkeys.js';
import { fuzzyFilter } from '../../lib/fuzzy.js';
import { ipc } from '../../lib/ipc-client.js';
import { Modal } from '../ui/Modal.js';

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

  const commands = listCommands();
  const filtered = fuzzyFilter(commands, query, (c) => `${c.category} ${c.title}`);

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

  const handleSelect = useCallback((cmd: CommandDef) => {
    // Commands that morph the palette (new-note) reopen it themselves.
    setPaletteOpen(false);
    void cmd.run();
  }, [setPaletteOpen]);

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
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIdx((i) => Math.min(i + 1, filtered.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIdx((i) => Math.max(i - 1, 0)); }
    if (e.key === 'Enter' && filtered[selectedIdx]) { e.preventDefault(); handleSelect(filtered[selectedIdx]); }
  }, [mode, query, filtered, selectedIdx, handleSelect, createNote, setPaletteOpen]);

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
          {filtered.map((cmd, i) => {
            const chord = bindingFor(cmd, hotkeys);
            return (
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
                <span>
                  <span style={{ fontSize: 10, color: 'var(--ink-faint)', marginRight: 8 }}>{cmd.category}</span>
                  {cmd.title}
                </span>
                {chord && (
                  <span style={{ fontSize: 10, color: 'var(--ink-faint)', fontFamily: 'monospace' }}>
                    {formatChord(chord)}
                  </span>
                )}
              </div>
            );
          })}
          {filtered.length === 0 && (
            <div style={{ padding: 16, textAlign: 'center', color: 'var(--ink-faint)', fontSize: 12 }}>
              No matching commands
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
