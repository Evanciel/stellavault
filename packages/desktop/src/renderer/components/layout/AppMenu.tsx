// App menu (W2) — hamburger dropdown with File/View/Tools/Help submenus.
// All actions dispatch through the lib/commands.ts registry; shortcut hints
// reflect the user's actual hotkey bindings (settings.hotkeys overrides).
// Keyboard: Up/Down navigate, Right/Enter open submenu, Left closes submenu,
// Escape closes all. CSS-var themed for dark/light parity.

import { useState, useRef, useEffect, useCallback } from 'react';
import { runCommand, getCommand } from '../../lib/commands.js';
import { useSettingsStore } from '../../stores/settings-store.js';
import { bindingFor, formatChord } from '../../lib/hotkeys.js';

// Electron-only CSS property for frameless-window drag regions.
declare module 'react' {
  interface CSSProperties {
    WebkitAppRegion?: 'drag' | 'no-drag';
  }
}

type MenuItem =
  | { kind: 'item'; label: string; commandId: string; fallbackId?: string }
  | { kind: 'separator' };

interface MenuSection {
  label: string;
  items: MenuItem[];
}

const sep: MenuItem = { kind: 'separator' };
const item = (label: string, commandId: string, fallbackId?: string): MenuItem =>
  ({ kind: 'item', label, commandId, fallbackId });

const MENU: MenuSection[] = [
  {
    label: 'File',
    items: [
      item('New note', 'file.new-note'),
      item('New folder', 'file.new-folder'),
      item('New daily note', 'file.daily-note'),
      sep,
      item('Open vault folder in Explorer', 'file.open-vault-folder'),
      sep,
      item('Settings', 'app.open-settings'),
    ],
  },
  {
    label: 'View',
    items: [
      item('Toggle sidebar', 'view.toggle-sidebar'),
      item('Toggle right panel', 'view.toggle-right-panel'),
      sep,
      item('Search panel', 'panel.search'),
      item('Graph panel', 'panel.graph'),
      item('AI panel', 'panel.ai'),
      item('Backlinks panel', 'panel.backlinks'),
      item('Outline panel', 'panel.outline'),
      item('Tags panel', 'panel.tags'),
      sep,
      // Full graph view if the graph agent registered it; falls back to the panel.
      item('Open Graph view', 'graph.open-view', 'panel.graph'),
      sep,
      item('Toggle theme', 'view.toggle-theme'),
      sep,
      item('Zoom in', 'view.zoom-in'),
      item('Zoom out', 'view.zoom-out'),
      item('Reset zoom', 'view.zoom-reset'),
    ],
  },
  {
    label: 'Tools',
    items: [
      item('Re-index vault', 'vault.reindex'),
      item('Command palette', 'app.command-palette'),
      item('Keyboard shortcuts', 'app.keyboard-shortcuts'),
    ],
  },
  {
    label: 'Help',
    items: [
      item('About Stellavault', 'help.about'),
      item('GitHub', 'help.github'),
    ],
  },
];

function shortcutFor(commandId: string, hotkeys: Record<string, string>): string {
  const cmd = getCommand(commandId);
  if (!cmd) return '';
  return formatChord(bindingFor(cmd, hotkeys));
}

export function AppMenu() {
  const [open, setOpen] = useState(false);
  const [activeTop, setActiveTop] = useState(0);
  const [subOpen, setSubOpen] = useState(false);
  const [activeSub, setActiveSub] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const hotkeys = useSettingsStore((s) => s.settings.hotkeys);

  const closeAll = useCallback(() => {
    setOpen(false);
    setSubOpen(false);
    setActiveTop(0);
    setActiveSub(0);
  }, []);

  // Click-outside closes the menu.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) closeAll();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open, closeAll]);

  const activate = useCallback((mi: MenuItem) => {
    if (mi.kind !== 'item') return;
    closeAll();
    if (mi.fallbackId && !getCommand(mi.commandId)) {
      runCommand(mi.fallbackId);
    } else {
      runCommand(mi.commandId);
    }
  }, [closeAll]);

  // Indices of selectable (non-separator) submenu entries.
  const subItems = MENU[activeTop].items;
  const selectableSub = subItems
    .map((mi, i) => (mi.kind === 'item' ? i : -1))
    .filter((i) => i >= 0);

  const moveSub = useCallback((dir: 1 | -1) => {
    if (selectableSub.length === 0) return;
    const pos = selectableSub.indexOf(activeSub);
    const next = pos === -1
      ? (dir === 1 ? 0 : selectableSub.length - 1)
      : (pos + dir + selectableSub.length) % selectableSub.length;
    setActiveSub(selectableSub[next]);
  }, [selectableSub, activeSub]);

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!open) return;
    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        if (subOpen) { setSubOpen(false); } else { closeAll(); }
        break;
      case 'ArrowDown':
        e.preventDefault();
        if (subOpen) moveSub(1);
        else setActiveTop((t) => (t + 1) % MENU.length);
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (subOpen) moveSub(-1);
        else setActiveTop((t) => (t - 1 + MENU.length) % MENU.length);
        break;
      case 'ArrowRight':
        e.preventDefault();
        if (!subOpen) { setSubOpen(true); setActiveSub(selectableSub[0] ?? 0); }
        break;
      case 'ArrowLeft':
        e.preventDefault();
        setSubOpen(false);
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (subOpen) {
          const mi = subItems[activeSub];
          if (mi) activate(mi);
        } else {
          setSubOpen(true);
          setActiveSub(selectableSub[0] ?? 0);
        }
        break;
      case 'Tab':
        closeAll();
        break;
    }
  }, [open, subOpen, activeSub, subItems, selectableSub, moveSub, activate, closeAll]);

  return (
    <div
      ref={rootRef}
      onKeyDown={onKeyDown}
      style={{ position: 'relative', WebkitAppRegion: 'no-drag' }}
    >
      <button
        onClick={() => (open ? closeAll() : setOpen(true))}
        title="Menu"
        aria-label="Application menu"
        aria-haspopup="menu"
        aria-expanded={open}
        style={{
          background: open ? 'var(--selection)' : 'transparent',
          border: 'none',
          color: open ? 'var(--accent-2)' : 'var(--ink-dim)',
          cursor: 'pointer',
          padding: '4px 8px',
          borderRadius: 4,
          fontSize: 13,
        }}
      >
        <span aria-hidden="true" style={{ fontSize: 14, lineHeight: 1 }}>&#9776;</span>
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Application menu"
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            marginTop: 4,
            minWidth: 130,
            background: 'var(--bg-2, var(--tab-bg))',
            border: '1px solid var(--border)',
            borderRadius: 8,
            boxShadow: '0 8px 28px rgba(0,0,0,0.35)',
            padding: 4,
            zIndex: 1000,
            fontSize: 12.5,
          }}
        >
          {MENU.map((section, ti) => (
            <div
              key={section.label}
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={subOpen && activeTop === ti}
              tabIndex={-1}
              onMouseEnter={() => { setActiveTop(ti); setSubOpen(true); setActiveSub(-1); }}
              onClick={() => { setActiveTop(ti); setSubOpen(true); }}
              style={{
                position: 'relative',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 16,
                padding: '6px 10px',
                borderRadius: 5,
                cursor: 'pointer',
                color: activeTop === ti ? 'var(--ink)' : 'var(--ink-dim)',
                background: activeTop === ti ? 'var(--selection)' : 'transparent',
              }}
            >
              <span>{section.label}</span>
              <span aria-hidden="true" style={{ fontSize: 10, color: 'var(--ink-faint)' }}>&#9656;</span>

              {subOpen && activeTop === ti && (
                <div
                  role="menu"
                  aria-label={section.label}
                  style={{
                    position: 'absolute',
                    top: -5,
                    left: '100%',
                    marginLeft: 2,
                    minWidth: 230,
                    background: 'var(--bg-2, var(--tab-bg))',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    boxShadow: '0 8px 28px rgba(0,0,0,0.35)',
                    padding: 4,
                    zIndex: 1001,
                  }}
                >
                  {section.items.map((mi, si) =>
                    mi.kind === 'separator' ? (
                      <div key={`sep-${si}`} style={{ height: 1, background: 'var(--border)', margin: '4px 6px' }} />
                    ) : (
                      <div
                        key={mi.commandId}
                        role="menuitem"
                        tabIndex={-1}
                        onMouseEnter={() => setActiveSub(si)}
                        onClick={(e) => { e.stopPropagation(); activate(mi); }}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 20,
                          padding: '6px 10px',
                          borderRadius: 5,
                          cursor: 'pointer',
                          whiteSpace: 'nowrap',
                          color: activeSub === si ? 'var(--ink)' : 'var(--ink-dim)',
                          background: activeSub === si ? 'var(--selection)' : 'transparent',
                        }}
                      >
                        <span>{mi.label}</span>
                        <span style={{ fontSize: 10.5, color: 'var(--ink-faint)', fontFamily: 'inherit' }}>
                          {shortcutFor(mi.commandId, hotkeys)}
                        </span>
                      </div>
                    ),
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
