// Vault switcher (T3-9) — titlebar dropdown listing the registered vaults.
// Wires core's multi-vault registry (add/remove/list) into the desktop, which
// was hardwired single-vault. Picking a different vault re-points the bootstrap
// config and prompts a restart (core re-init is heavy — see main vault:switch).
// "Add vault…" opens a folder picker in main; the active vault can't be removed.

import { useState, useEffect, useRef, useCallback } from 'react';
import { ipc } from '../../lib/ipc-client.js';
import type { VaultRegistryEntry } from '../../../shared/ipc-types.js';

// Electron-only CSS property for frameless-window drag regions.
declare module 'react' {
  interface CSSProperties {
    WebkitAppRegion?: 'drag' | 'no-drag';
  }
}

export function VaultSwitcher() {
  const [open, setOpen] = useState(false);
  const [vaults, setVaults] = useState<VaultRegistryEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const active = vaults.find((v) => v.active);

  const refresh = useCallback(async () => {
    try {
      setVaults(await ipc('vault:list-registry'));
    } catch (err) {
      console.error('[VaultSwitcher] list failed:', err);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  // Click-outside closes the dropdown.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const onAdd = useCallback(async () => {
    setBusy(true);
    try {
      const added = await ipc('vault:add-to-registry');
      if (added) await refresh();
    } catch (err) {
      console.error('[VaultSwitcher] add failed:', err);
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const onRemove = useCallback(async (e: React.MouseEvent, v: VaultRegistryEntry) => {
    e.stopPropagation();
    if (v.active || busy) return;
    setBusy(true);
    try {
      setVaults(await ipc('vault:remove-from-registry', v.id));
    } catch (err) {
      console.error('[VaultSwitcher] remove failed:', err);
    } finally {
      setBusy(false);
    }
  }, [busy]);

  // Switching rewrites the bootstrap config in main and returns restartRequired
  // (always true — core re-init is heavy). We surface a non-blocking restart hint
  // rather than alert() (which freezes Electron).
  const [needsRestart, setNeedsRestart] = useState(false);
  const switchAndFlag = useCallback(async (v: VaultRegistryEntry) => {
    if (v.active || busy) return;
    setBusy(true);
    try {
      const { restartRequired } = await ipc('vault:switch', v.id);
      setOpen(false);
      await refresh();
      if (restartRequired) setNeedsRestart(true);
    } catch (err) {
      console.error('[VaultSwitcher] switch failed:', err);
    } finally {
      setBusy(false);
    }
  }, [busy, refresh]);

  return (
    <div ref={rootRef} style={{ position: 'relative', WebkitAppRegion: 'no-drag' }}>
      <button
        onClick={() => setOpen((o) => !o)}
        title="Switch vault"
        aria-label="Switch vault"
        aria-haspopup="menu"
        aria-expanded={open}
        style={{
          background: open ? 'var(--selection)' : 'transparent',
          border: 'none',
          color: open ? 'var(--accent-2)' : 'var(--ink-dim)',
          cursor: 'pointer',
          padding: '4px 8px',
          borderRadius: 4,
          fontSize: 11,
          maxWidth: 160,
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          overflow: 'hidden',
        }}
      >
        <span aria-hidden="true" style={{ fontSize: 12, lineHeight: 1 }}>&#x1F5C4;</span>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {active?.name ?? 'Vault'}
        </span>
        <span aria-hidden="true" style={{ fontSize: 8, color: 'var(--ink-faint)' }}>&#9662;</span>
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Vaults"
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            marginTop: 4,
            minWidth: 240,
            background: 'var(--bg-2, var(--tab-bg))',
            border: '1px solid var(--border)',
            borderRadius: 8,
            boxShadow: '0 8px 28px rgba(0,0,0,0.35)',
            padding: 4,
            zIndex: 1000,
            fontSize: 12,
          }}
        >
          {vaults.map((v) => (
            <div
              key={v.id}
              role="menuitemradio"
              aria-checked={v.active}
              tabIndex={-1}
              onClick={() => void switchAndFlag(v)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 10px',
                borderRadius: 5,
                cursor: v.active ? 'default' : 'pointer',
                color: v.active ? 'var(--accent-2)' : 'var(--ink-dim)',
                background: v.active ? 'var(--selection)' : 'transparent',
              }}
              onMouseEnter={(e) => { if (!v.active) (e.currentTarget as HTMLDivElement).style.background = 'var(--hover)'; }}
              onMouseLeave={(e) => { if (!v.active) (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
            >
              <span aria-hidden="true" style={{ width: 12, flexShrink: 0 }}>{v.active ? '✓' : ''}</span>
              <span style={{ flex: 1, overflow: 'hidden' }}>
                <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.name}</div>
                <div style={{ fontSize: 9, color: 'var(--ink-faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.path}</div>
              </span>
              {!v.active && (
                <button
                  onClick={(e) => void onRemove(e, v)}
                  title="Remove from list"
                  aria-label={`Remove ${v.name} from vault list`}
                  style={{ background: 'transparent', border: 'none', color: 'var(--ink-faint)', cursor: 'pointer', fontSize: 12, padding: '0 2px', flexShrink: 0 }}
                >
                  &#x2715;
                </button>
              )}
            </div>
          ))}

          <div style={{ height: 1, background: 'var(--border)', margin: '4px 6px' }} />

          <div
            role="menuitem"
            tabIndex={-1}
            onClick={() => void onAdd()}
            style={{ padding: '6px 10px', borderRadius: 5, cursor: 'pointer', color: 'var(--ink-dim)' }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'var(--hover)'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
          >
            + Add vault…
          </div>

          {needsRestart && (
            <div style={{ padding: '8px 10px', marginTop: 4, borderRadius: 5, fontSize: 10.5, lineHeight: 1.5, color: 'var(--accent-2)', background: 'var(--selection)' }}>
              Vault switched. Restart Stellavault to load the new vault.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
