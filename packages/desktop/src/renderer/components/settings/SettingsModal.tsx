// Settings modal (W1-1) — tabs: General · Editor · Appearance · Hotkeys · About.
// Reads/writes through the settings store; main persists + broadcasts.

import { useState, useEffect, useCallback } from 'react';
import type { AppSettings } from '../../../shared/ipc-types.js';
import { useSettingsStore } from '../../stores/settings-store.js';
import { useAppStore } from '../../stores/app-store.js';
import { useUiStore, listCommands } from '../../lib/commands.js';
import { bindingFor, chordFromEvent, normalizeChord, formatChord, findConflicts, isEditorChord } from '../../lib/hotkeys.js';
import { Modal } from '../ui/Modal.js';

type TabId = 'general' | 'editor' | 'appearance' | 'hotkeys' | 'about';

const TABS: { id: TabId; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'editor', label: 'Editor' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'hotkeys', label: 'Hotkeys' },
  { id: 'about', label: 'About' },
];

const ACCENT_SWATCHES = ['#6366f1', '#8b5cf6', '#ec4899', '#ef4444', '#f59e0b', '#10b981', '#06b6d4', '#3b82f6'];

export function SettingsModal() {
  const open = useUiStore((s) => s.settingsOpen);
  const setOpen = useUiStore((s) => s.setSettingsOpen);
  const [tab, setTab] = useState<TabId>('general');

  // App menu (W2): honor the requested tab (Hotkeys/About deep links).
  useEffect(() => { if (open) setTab(useUiStore.getState().settingsTab); }, [open]);

  return (
    <Modal open={open} onClose={() => setOpen(false)} title="Settings" width={560}>
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding: '5px 12px', fontSize: 12, border: 'none', borderRadius: 5, cursor: 'pointer',
              background: tab === t.id ? 'var(--selection)' : 'transparent',
              color: tab === t.id ? 'var(--accent-2)' : 'var(--ink-dim)',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div style={{ minHeight: 260 }}>
        {tab === 'general' && <GeneralTab />}
        {tab === 'editor' && <EditorTab />}
        {tab === 'appearance' && <AppearanceTab />}
        {tab === 'hotkeys' && <HotkeysTab />}
        {tab === 'about' && <AboutTab />}
      </div>
    </Modal>
  );
}

// ─── Shared field primitives ───

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)', marginBottom: 6 }}>{label}</div>
      {children}
      {hint && <div style={{ fontSize: 10, color: 'var(--ink-faint)', marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

const textInputStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', background: 'var(--hover)',
  border: '1px solid var(--border)', borderRadius: 4, padding: '7px 10px',
  fontSize: 12, color: 'var(--ink)', outline: 'none',
};

// ─── General ───

function GeneralTab() {
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);
  const vaultPath = useAppStore((s) => s.vaultPath);

  return (
    <div>
      <Field label="Vault path" hint='Managed by ~/.stellavault.json — change via "stellavault setup" and restart.'>
        <input type="text" value={vaultPath} readOnly aria-label="Vault path" style={{ ...textInputStyle, color: 'var(--ink-dim)' }} />
      </Field>
      <Field label="Daily notes folder" hint="Relative to the vault root.">
        <input
          type="text"
          value={settings.dailyNotes.folder}
          aria-label="Daily notes folder"
          onChange={(e) => void update({ dailyNotes: { ...settings.dailyNotes, folder: e.target.value } })}
          style={textInputStyle}
        />
      </Field>
      <Field label="Daily note format" hint="Tokens: YYYY, MM, DD.">
        <input
          type="text"
          value={settings.dailyNotes.format}
          aria-label="Daily note format"
          onChange={(e) => void update({ dailyNotes: { ...settings.dailyNotes, format: e.target.value } })}
          style={textInputStyle}
        />
      </Field>
      <Field label="Templates folder" hint="Relative to the vault root.">
        <input
          type="text"
          value={settings.templatesFolder}
          aria-label="Templates folder"
          onChange={(e) => void update({ templatesFolder: e.target.value })}
          style={textInputStyle}
        />
      </Field>
    </div>
  );
}

// ─── Editor ───

function EditorTab() {
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);
  const patchEditor = (patch: Partial<AppSettings['editor']>) =>
    void update({ editor: { ...settings.editor, ...patch } });

  return (
    <div>
      <Field label={`Font size — ${settings.editor.fontSize}px`}>
        <input
          type="range" min={11} max={24} step={1}
          value={settings.editor.fontSize}
          aria-label="Editor font size"
          onChange={(e) => patchEditor({ fontSize: Number(e.target.value) })}
          style={{ width: '100%', accentColor: 'var(--accent)' }}
        />
      </Field>
      <Field label={`Line width — ${settings.editor.lineWidth}px`} hint="Maximum width of the editing column.">
        <input
          type="range" min={480} max={1200} step={20}
          value={settings.editor.lineWidth}
          aria-label="Editor line width"
          onChange={(e) => patchEditor({ lineWidth: Number(e.target.value) })}
          style={{ width: '100%', accentColor: 'var(--accent)' }}
        />
      </Field>
      <Field label="Spellcheck">
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--ink-dim)', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={settings.editor.spellcheck}
            onChange={(e) => patchEditor({ spellcheck: e.target.checked })}
            style={{ accentColor: 'var(--accent)' }}
          />
          Check spelling while typing
        </label>
      </Field>
    </div>
  );
}

// ─── Appearance ───

function AppearanceTab() {
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);

  return (
    <div>
      <Field label="Theme">
        <select
          value={settings.theme}
          aria-label="Theme"
          onChange={(e) => void update({ theme: e.target.value as AppSettings['theme'] })}
          style={{ ...textInputStyle, width: 180, cursor: 'pointer' }}
        >
          <option value="dark">Dark</option>
          <option value="light">Light</option>
          <option value="system">System</option>
        </select>
      </Field>
      <Field label="Accent color">
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {ACCENT_SWATCHES.map((hex) => (
            <button
              key={hex}
              onClick={() => void update({ accent: hex })}
              title={hex}
              aria-label={`Accent color ${hex}`}
              style={{
                width: 24, height: 24, borderRadius: '50%', cursor: 'pointer', background: hex,
                border: settings.accent.toLowerCase() === hex ? '2px solid var(--ink)' : '2px solid transparent',
              }}
            />
          ))}
          <input
            type="color"
            value={settings.accent}
            aria-label="Custom accent color"
            onChange={(e) => void update({ accent: e.target.value })}
            style={{ width: 28, height: 28, padding: 0, border: '1px solid var(--border)', borderRadius: 4, background: 'transparent', cursor: 'pointer' }}
          />
        </div>
      </Field>
    </div>
  );
}

// ─── Hotkeys ───

function HotkeysTab() {
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);
  const [capturingId, setCapturingId] = useState<string | null>(null);

  const commands = listCommands().sort((a, b) =>
    a.category === b.category ? a.title.localeCompare(b.title) : a.category.localeCompare(b.category));
  const conflicts = findConflicts(settings.hotkeys);

  const setBinding = useCallback((id: string, chord: string | null) => {
    const next = { ...settings.hotkeys };
    if (chord === null) delete next[id];   // reset to default
    else next[id] = chord;
    void update({ hotkeys: next });
  }, [settings.hotkeys, update]);

  // Capture the next keychord while rebinding.
  useEffect(() => {
    if (!capturingId) return;
    function onKeyDown(e: KeyboardEvent) {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') { setCapturingId(null); return; }
      const chord = chordFromEvent(e);
      if (!chord || !chord.includes('+')) return;   // require a modifier
      setBinding(capturingId!, normalizeChord(chord));
      setCapturingId(null);
    }
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [capturingId, setBinding]);

  return (
    <div>
      <div style={{ fontSize: 11, color: 'var(--ink-faint)', marginBottom: 10 }}>
        Click a binding, then press the new key combination. Esc cancels.
      </div>
      {commands.map((cmd) => {
        const chord = bindingFor(cmd, settings.hotkeys);
        const isConflict = chord !== '' && (conflicts.get(chord)?.length ?? 0) > 1;
        // T2-17: a command bound to a TipTap-owned chord silently does nothing
        // while the editor is focused — UNLESS the command runs in the editor
        // (allowInEditor), in which case there's no conflict to warn about.
        const isEditorConflict = chord !== '' && !cmd.allowInEditor && isEditorChord(chord);
        const isCustom = settings.hotkeys[cmd.id] !== undefined;
        const isCapturing = capturingId === cmd.id;
        // Visual emphasis: hard conflict (red) takes precedence over the softer
        // editor-chord warning (amber).
        const warnColor = isConflict ? '#ef4444' : isEditorConflict ? '#f59e0b' : 'var(--border)';
        return (
          <div
            key={cmd.id}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px',
              borderRadius: 5, fontSize: 12,
              background: isConflict
                ? 'rgba(239, 68, 68, 0.08)'
                : isEditorConflict ? 'rgba(245, 158, 11, 0.08)' : 'transparent',
            }}
          >
            <span style={{ flex: 1, color: 'var(--ink-dim)' }}>
              <span style={{ color: 'var(--ink-faint)', fontSize: 10, marginRight: 6 }}>{cmd.category}</span>
              {cmd.title}
            </span>
            {isConflict && <span title="Conflicts with another command" style={{ color: '#ef4444', fontSize: 10 }}>conflict</span>}
            {!isConflict && isEditorConflict && (
              <span
                title="Conflicts with the editor — will do nothing while editing"
                style={{ color: '#f59e0b', fontSize: 10 }}
              >
                editor
              </span>
            )}
            <button
              onClick={() => setCapturingId(isCapturing ? null : cmd.id)}
              aria-label={`Rebind ${cmd.title}`}
              style={{
                minWidth: 110, padding: '3px 10px', fontSize: 11, fontFamily: 'monospace',
                background: isCapturing ? 'var(--selection)' : 'var(--hover)',
                border: `1px solid ${warnColor}`,
                borderRadius: 4, cursor: 'pointer',
                color: isCapturing ? 'var(--accent-2)' : chord ? 'var(--ink)' : 'var(--ink-faint)',
              }}
            >
              {isCapturing ? 'Press keys…' : chord ? formatChord(chord) : 'Not set'}
            </button>
            <button
              onClick={() => setBinding(cmd.id, null)}
              disabled={!isCustom}
              title="Reset to default"
              aria-label={`Reset ${cmd.title} binding`}
              style={{
                padding: '3px 8px', fontSize: 11, background: 'transparent',
                border: 'none', borderRadius: 4,
                cursor: isCustom ? 'pointer' : 'default',
                color: isCustom ? 'var(--ink-dim)' : 'var(--ink-faint)',
                opacity: isCustom ? 1 : 0.4,
              }}
            >
              ↺
            </button>
          </div>
        );
      })}
    </div>
  );
}

// ─── About ───

function AboutTab() {
  return (
    <div style={{ fontSize: 12, color: 'var(--ink-dim)', lineHeight: 1.8 }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)', marginBottom: 4 }}>Stellavault Desktop</div>
      <p style={{ margin: '0 0 12px' }}>Self-compiling knowledge base — local embeddings, FSRS memory decay, zero API keys.</p>
      <div>GitHub: <span style={{ color: 'var(--accent-2)' }}>github.com/Evanciel/stellavault</span></div>
      <div style={{ marginTop: 8, fontSize: 10, color: 'var(--ink-faint)' }}>
        Settings file: ~/.stellavault/desktop-settings.json
      </div>
    </div>
  );
}
