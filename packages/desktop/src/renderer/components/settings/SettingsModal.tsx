// Settings modal (W1-1) — tabs: General · Editor · Appearance · Hotkeys · About.
// Reads/writes through the settings store; main persists + broadcasts.

import { useState, useEffect, useCallback } from 'react';
import type { AppSettings, McpStatus } from '../../../shared/ipc-types.js';
import { ipc, onIpc } from '../../lib/ipc-client.js'; // T3-3: Agent Memory tab
import { useSettingsStore } from '../../stores/settings-store.js';
import { useAppStore } from '../../stores/app-store.js';
import { useUiStore, listCommands } from '../../lib/commands.js';
import { bindingFor, chordFromEvent, normalizeChord, formatChord, findConflicts, isEditorChord } from '../../lib/hotkeys.js';
import { Modal } from '../ui/Modal.js';

type TabId = 'general' | 'editor' | 'appearance' | 'ai' | 'agent' | 'hotkeys' | 'about';

const TABS: { id: TabId; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'editor', label: 'Editor' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'ai', label: 'AI' }, // T3-2: provider + API key for LLM synthesis
  { id: 'agent', label: 'Agent Memory' }, // T3-3: embedded MCP server toggle + activity
  { id: 'hotkeys', label: 'Hotkeys' },
  { id: 'about', label: 'About' },
];

// T3-2: default Claude model id for the anthropic provider (claude-api skill —
// latest widely-released model). Mirrors main/llm-synthesizer DEFAULT_ANTHROPIC_MODEL.
const DEFAULT_AI_MODEL = 'claude-fable-5';

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
        {tab === 'ai' && <AITab />}
        {tab === 'agent' && <AgentMemoryTab />}
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

// ─── AI (T3-2) ───
// Provider + API key for LLM synthesis (Ask panel + Wiki Synthesis). The key is
// stored in desktop-settings.json (main process) and only sent to the provider's
// API — it is never logged. Provider 'none' (or empty key) → extractive fallback.

function AITab() {
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);
  const ai = settings.ai ?? { provider: 'none' as const, apiKey: '', model: DEFAULT_AI_MODEL };
  const [showKey, setShowKey] = useState(false);

  const patchAi = (patch: Partial<NonNullable<AppSettings['ai']>>) =>
    void update({ ai: { provider: ai.provider, apiKey: ai.apiKey, model: ai.model || DEFAULT_AI_MODEL, ...patch } });

  return (
    <div>
      <Field label="AI provider" hint="Used to synthesize answers in Ask and compile articles in Synthesis. Without a key, both fall back to an extractive (search-based) summary.">
        <select
          value={ai.provider}
          aria-label="AI provider"
          onChange={(e) => patchAi({ provider: e.target.value as NonNullable<AppSettings['ai']>['provider'] })}
          style={{ ...textInputStyle, width: 220, cursor: 'pointer' }}
        >
          <option value="none">None (extractive only)</option>
          <option value="anthropic">Anthropic (Claude)</option>
        </select>
      </Field>

      {ai.provider === 'anthropic' && (
        <>
          <Field label="API key" hint="Stored locally in ~/.stellavault/desktop-settings.json and sent only to api.anthropic.com. Never logged.">
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input
                type={showKey ? 'text' : 'password'}
                value={ai.apiKey}
                aria-label="Anthropic API key"
                placeholder="sk-ant-..."
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => patchAi({ apiKey: e.target.value })}
                style={{ ...textInputStyle, flex: 1 }}
              />
              <button
                onClick={() => setShowKey((v) => !v)}
                aria-label={showKey ? 'Hide API key' : 'Show API key'}
                style={{
                  padding: '7px 10px', fontSize: 11, cursor: 'pointer',
                  background: 'var(--hover)', border: '1px solid var(--border)',
                  borderRadius: 4, color: 'var(--ink-dim)', whiteSpace: 'nowrap',
                }}
              >
                {showKey ? 'Hide' : 'Show'}
              </button>
            </div>
          </Field>

          <Field label="Model" hint={`Claude model id. Defaults to ${DEFAULT_AI_MODEL}.`}>
            <input
              type="text"
              value={ai.model || ''}
              aria-label="Claude model id"
              placeholder={DEFAULT_AI_MODEL}
              spellCheck={false}
              onChange={(e) => patchAi({ model: e.target.value })}
              style={{ ...textInputStyle, width: 280 }}
            />
          </Field>
        </>
      )}
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

// ─── [capture/automation agent owned block — T3-3 Agent Memory] ──────────────
// Toggle the embedded MCP server ("Agent Memory") on/off, set auto-start, and
// watch a live activity feed of what an agent (Claude) searched/wrote. The MCP
// server exposes 21 tools over a loopback HTTP endpoint; it is OFF by default.
// Status + activity come from 'mcp:status' (poll on open) + the
// 'mcp:status-changed' push event. Disjoint from the AI provider tab (T3-2).
function AgentMemoryTab() {
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);

  const [status, setStatus] = useState<McpStatus | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void ipc('mcp:status').then((s) => { if (alive) setStatus(s); }).catch(() => { /* server not ready */ });
    const off = onIpc('mcp:status-changed', (s) => setStatus(s as McpStatus));
    return () => { alive = false; off(); };
  }, []);

  const running = !!status?.running;

  const toggle = useCallback(async () => {
    setBusy(true);
    try {
      setStatus(running ? await ipc('mcp:stop') : await ipc('mcp:start'));
    } catch (err) {
      console.error('[settings] MCP toggle failed:', err);
    } finally {
      setBusy(false);
    }
  }, [running]);

  return (
    <div>
      <Field
        label="Agent Memory (MCP server)"
        hint="Local, loopback-only. Lets an agent (Claude) read & write your FSRS-pruned vault over MCP. Off by default."
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            onClick={() => void toggle()}
            disabled={busy}
            style={{
              padding: '7px 16px', fontSize: 12, borderRadius: 5, cursor: busy ? 'default' : 'pointer',
              border: 'none', color: '#fff',
              background: running ? '#ef4444' : 'var(--accent)', opacity: busy ? 0.6 : 1,
            }}
          >
            {busy ? '…' : running ? 'Stop server' : 'Start server'}
          </button>
          <span style={{ fontSize: 12, color: running ? '#10b981' : 'var(--ink-faint)' }}>
            {running ? `Running · 127.0.0.1:${status?.port}` : 'Stopped'}
          </span>
          <span style={{ fontSize: 10, color: 'var(--ink-faint)' }}>
            {status?.toolCount ?? 21} tools
          </span>
        </div>
        {status?.error && (
          <div style={{ fontSize: 10, color: '#ef4444', marginTop: 6 }}>{status.error}</div>
        )}
      </Field>

      <Field label="Auto-start on launch">
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--ink-dim)', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={!!settings.mcpAutoStart}
            onChange={(e) => void update({ mcpAutoStart: e.target.checked })}
            style={{ accentColor: 'var(--accent)' }}
          />
          Start Agent Memory automatically when the app opens
        </label>
      </Field>

      <Field label="Activity" hint="What the agent recently searched or fetched. Titles/queries only — never full note text.">
        {(!status || status.recent.length === 0) ? (
          <div style={{ fontSize: 11, color: 'var(--ink-faint)', padding: '8px 0' }}>
            {running ? 'No activity yet — waiting for the agent.' : 'Start the server to see activity.'}
          </div>
        ) : (
          <div style={{ maxHeight: 180, overflow: 'auto' }}>
            {status.recent.map((a, i) => (
              <div
                key={`${a.ts}-${i}`}
                style={{
                  display: 'flex', alignItems: 'baseline', gap: 8,
                  padding: '5px 8px', marginBottom: 3, borderRadius: 4,
                  background: 'var(--hover)', border: '1px solid var(--border)',
                }}
              >
                <span style={{ fontSize: 10, fontFamily: 'monospace', color: 'var(--accent-2)', flexShrink: 0 }}>{a.tool}</span>
                <span style={{ fontSize: 11, color: 'var(--ink-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.detail}</span>
                <span style={{ fontSize: 9, color: 'var(--ink-faint)', marginLeft: 'auto', flexShrink: 0 }}>
                  {new Date(a.ts).toLocaleTimeString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </Field>
    </div>
  );
}
// ─── [end capture/automation agent block] ────────────────────────────────────
