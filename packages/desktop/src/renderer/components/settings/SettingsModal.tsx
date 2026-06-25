// Settings modal (W1-1) — tabs: General · Editor · Appearance · Hotkeys · About.
// Reads/writes through the settings store; main persists + broadcasts.

import { useState, useEffect, useCallback } from 'react';
import type { AppSettings, McpStatus, VaultRegistryEntry } from '../../../shared/ipc-types.js';
import { ipc, onIpc } from '../../lib/ipc-client.js'; // T3-3: Agent Memory tab
import { showToast } from '../../lib/toast.js';
import { useSettingsStore } from '../../stores/settings-store.js';
import { useAppStore } from '../../stores/app-store.js';
import { useUiStore, listCommands } from '../../lib/commands.js';
import { bindingFor, chordFromEvent, normalizeChord, formatChord, findConflicts, isEditorChord } from '../../lib/hotkeys.js';
import { Modal, ConfirmModal } from '../ui/Modal.js';
import { DEFAULT_MODELS, MODELS_BY_PROVIDER, OLLAMA_BASE_URL, PROVIDER_META, isLocalProviderUrl } from '../../../shared/ai-providers.js';
import { useT, type MsgKey } from '../../lib/i18n.js';

type TabId = 'general' | 'editor' | 'appearance' | 'ai' | 'agent' | 'hotkeys' | 'about';

const TABS: { id: TabId; labelKey: MsgKey }[] = [
  { id: 'general', labelKey: 'settings.tabs.general' },
  { id: 'editor', labelKey: 'settings.tabs.editor' },
  { id: 'appearance', labelKey: 'settings.tabs.appearance' },
  { id: 'ai', labelKey: 'settings.tabs.ai' }, // T3-2: provider + API key for LLM synthesis
  { id: 'agent', labelKey: 'settings.tabs.agent' }, // T3-3: embedded MCP server toggle + activity
  { id: 'hotkeys', labelKey: 'settings.tabs.hotkeys' },
  { id: 'about', labelKey: 'settings.tabs.about' },
];

const ACCENT_SWATCHES = ['#6366f1', '#8b5cf6', '#ec4899', '#ef4444', '#f59e0b', '#10b981', '#06b6d4', '#3b82f6'];

export function SettingsModal() {
  const open = useUiStore((s) => s.settingsOpen);
  const setOpen = useUiStore((s) => s.setSettingsOpen);
  const [tab, setTab] = useState<TabId>('general');
  const t = useT();

  // App menu (W2): honor the requested tab (Hotkeys/About deep links).
  useEffect(() => { if (open) setTab(useUiStore.getState().settingsTab); }, [open]);

  return (
    <Modal open={open} onClose={() => setOpen(false)} title={t('settings.modal.title')} width={560}>
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
        {TABS.map((tb) => (
          <button
            key={tb.id}
            onClick={() => setTab(tb.id)}
            style={{
              padding: '5px 12px', fontSize: 12, border: 'none', borderRadius: 5, cursor: 'pointer',
              background: tab === tb.id ? 'var(--selection)' : 'transparent',
              color: tab === tb.id ? 'var(--accent-2)' : 'var(--ink-dim)',
            }}
          >
            {t(tb.labelKey)}
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

const pickBtnStyle: React.CSSProperties = {
  padding: '7px 10px', fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap',
  background: 'var(--hover)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--ink-dim)',
};

// ─── General ───

function GeneralTab() {
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);
  const vaultPath = useAppStore((s) => s.vaultPath);
  const t = useT();
  const [pendingVault, setPendingVault] = useState<VaultRegistryEntry | null>(null);

  // Always-on daemon (daemon-keepalive §5) — local state because daemon:set-enabled builds/destroys
  // the tray in main and returns the persisted value (it does not flow through the settings:changed
  // refresh). Optimistic toggle, reconciled by the IPC result.
  const [daemonOn, setDaemonOn] = useState<boolean>(settings.daemon?.enabled ?? false);
  const toggleDaemon = (on: boolean) => {
    setDaemonOn(on);
    void ipc('daemon:set-enabled', on).then((r) => setDaemonOn(r.enabled)).catch(() => setDaemonOn(!on));
  };

  // "Change…" on the vault path: pick a folder → register it → confirm a restart-switch
  // (a vault swap re-inits the whole core, so it routes through the same restart path
  // as the titlebar vault switcher).
  const onChangeVault = async () => {
    const added = await ipc('vault:add-to-registry');
    if (added && !added.active) setPendingVault(added);
  };
  // Folder picker for daily-notes / templates — returns a vault-relative path.
  const pickFolder = async (apply: (rel: string) => void) => {
    const r = await ipc('vault:pick-folder');
    if (!r) return;
    if (r.outside) { showToast(t('settings.general.folderOutsideVault'), 'error'); return; }
    if (r.rel != null) apply(r.rel);
  };

  return (
    <div>
      <Field label={t('settings.language')} hint={t('settings.language.hint')}>
        <select
          value={settings.language ?? 'en'}
          aria-label={t('settings.language')}
          onChange={(e) => void update({ language: e.target.value as 'en' | 'ko' })}
          style={{ ...textInputStyle, width: 180, cursor: 'pointer' }}
        >
          <option value="en">{t('settings.language.option.en')}</option>
          <option value="ko">한국어</option>
        </select>
      </Field>
      <Field label={t('settings.general.vaultPath.label')} hint={t('settings.general.vaultPath.hint')}>
        <div style={{ display: 'flex', gap: 6 }}>
          <input type="text" value={vaultPath} readOnly aria-label={t('settings.general.vaultPath.label')} style={{ ...textInputStyle, color: 'var(--ink-dim)', flex: 1 }} />
          <button onClick={() => void onChangeVault()} style={pickBtnStyle}>{t('settings.general.changeVault')}</button>
        </div>
      </Field>
      <Field label={t('settings.general.dailyNotes.folder.label')} hint={t('settings.general.relativeToVaultHint')}>
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            type="text"
            value={settings.dailyNotes.folder}
            aria-label={t('settings.general.dailyNotes.folder.label')}
            onChange={(e) => void update({ dailyNotes: { ...settings.dailyNotes, folder: e.target.value } })}
            style={{ ...textInputStyle, flex: 1 }}
          />
          <button onClick={() => void pickFolder((rel) => void update({ dailyNotes: { ...settings.dailyNotes, folder: rel } }))} title={t('settings.general.pickFolder')} style={pickBtnStyle}>📁</button>
        </div>
      </Field>
      <Field label={t('settings.general.dailyNotes.format.label')} hint={t('settings.general.dailyNotes.format.hint')}>
        <input
          type="text"
          value={settings.dailyNotes.format}
          aria-label={t('settings.general.dailyNotes.format.label')}
          onChange={(e) => void update({ dailyNotes: { ...settings.dailyNotes, format: e.target.value } })}
          style={textInputStyle}
        />
      </Field>
      <Field label={t('settings.general.templatesFolder.label')} hint={t('settings.general.relativeToVaultHint')}>
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            type="text"
            value={settings.templatesFolder}
            aria-label={t('settings.general.templatesFolder.label')}
            onChange={(e) => void update({ templatesFolder: e.target.value })}
            style={{ ...textInputStyle, flex: 1 }}
          />
          <button onClick={() => void pickFolder((rel) => void update({ templatesFolder: rel }))} title={t('settings.general.pickFolder')} style={pickBtnStyle}>📁</button>
        </div>
      </Field>
      <Field label={t('settings.general.daemon.label')} hint={t('settings.general.daemon.hint')}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
            <input type="checkbox" checked={daemonOn} onChange={(e) => toggleDaemon(e.target.checked)} aria-label={t('settings.general.daemon.toggle')} />
            <span style={{ fontSize: 13, color: 'var(--ink-dim)' }}>{t('settings.general.daemon.toggle')}</span>
          </label>
          <button onClick={() => void ipc('daemon:run-now')} style={pickBtnStyle}>{t('settings.general.daemon.compileNow')}</button>
        </div>
      </Field>

      <ConfirmModal
        open={!!pendingVault}
        onClose={() => setPendingVault(null)}
        onConfirm={() => { if (pendingVault) void ipc('vault:switch', pendingVault.id); }}
        title={t('settings.general.switchVault.title')}
        message={pendingVault ? t('settings.general.switchVault.message', { name: pendingVault.name }) : ''}
        confirmLabel={t('settings.general.switchVault.confirm')}
      />
    </div>
  );
}

// ─── Editor ───

function EditorTab() {
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);
  const t = useT();
  const patchEditor = (patch: Partial<AppSettings['editor']>) =>
    void update({ editor: { ...settings.editor, ...patch } });

  return (
    <div>
      <Field label={`${t('settings.editor.fontSize.label')}${settings.editor.fontSize}px`}>
        <input
          type="range" min={11} max={24} step={1}
          value={settings.editor.fontSize}
          aria-label="Editor font size"
          onChange={(e) => patchEditor({ fontSize: Number(e.target.value) })}
          style={{ width: '100%', accentColor: 'var(--accent)' }}
        />
      </Field>
      <Field label={`${t('settings.editor.lineWidth.label')}${settings.editor.lineWidth}px`} hint={t('settings.editor.lineWidth.hint')}>
        <input
          type="range" min={480} max={1200} step={20}
          value={settings.editor.lineWidth}
          aria-label="Editor line width"
          onChange={(e) => patchEditor({ lineWidth: Number(e.target.value) })}
          style={{ width: '100%', accentColor: 'var(--accent)' }}
        />
      </Field>
      <Field label={t('settings.editor.spellcheck.label')}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--ink-dim)', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={settings.editor.spellcheck}
            onChange={(e) => patchEditor({ spellcheck: e.target.checked })}
            style={{ accentColor: 'var(--accent)' }}
          />
          {t('settings.editor.spellcheck.checkbox')}
        </label>
      </Field>
    </div>
  );
}

// ─── Appearance ───

function AppearanceTab() {
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);
  const t = useT();

  return (
    <div>
      <Field label={t('settings.appearance.theme.label')}>
        <select
          value={settings.theme}
          aria-label={t('settings.appearance.theme.label')}
          onChange={(e) => void update({ theme: e.target.value as AppSettings['theme'] })}
          style={{ ...textInputStyle, width: 180, cursor: 'pointer' }}
        >
          <option value="dark">{t('settings.appearance.theme.option.dark')}</option>
          <option value="light">{t('settings.appearance.theme.option.light')}</option>
          <option value="system">{t('settings.appearance.theme.option.system')}</option>
        </select>
      </Field>
      <Field label={t('settings.appearance.accentColor.label')}>
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

// ─── AI (T3-2 / T6) ───
// Provider + API key for LLM synthesis (Ask panel + Wiki Synthesis). The key is
// stored in SecretStore (safeStorage-backed) in the main process — it is NEVER
// sent back to the renderer via settings:get. Provider 'none' (or no key) →
// extractive fallback.
//
// T6 write-only UX:
//  - When ai.hasKey → show "✓ Key saved" + [Clear] (no input field shown).
//  - When !ai.hasKey → show the key input + [Save key] button.
//  - On provider switch → query ai:has-secret for the newly-selected provider
//    (settings.ai.hasKey only reflects the persisted active provider).
//  - If ai.keychainAvailable === false → show a session-only warning banner.

// SP4: a self-contained optional-key field for a media-preprocessing secret (transcribe/video).
// Write-only: the key travels via ai:set-secret and is never read back into the renderer.
function MediaKeyField({ provider, label, hint, placeholder }: { provider: string; label: string; hint: string; placeholder: string }) {
  const t = useT();
  const [has, setHas] = useState<boolean | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { void ipc('ai:has-secret', provider).then(setHas).catch(() => setHas(false)); }, [provider]);
  const save = async () => {
    if (!draft.trim()) return;
    setBusy(true);
    try { await ipc('ai:set-secret', provider, draft.trim()); setDraft(''); setHas(await ipc('ai:has-secret', provider)); }
    catch (err) { console.error('[MediaKeyField] set-secret failed', err); }
    finally { setBusy(false); }
  };
  const clear = async () => {
    setBusy(true);
    try { await ipc('ai:clear-secret', provider); setHas(false); }
    catch (err) { console.error('[MediaKeyField] clear-secret failed', err); }
    finally { setBusy(false); }
  };
  return (
    <Field label={label} hint={hint}>
      {has ? (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: '#10b981', fontWeight: 600, padding: '4px 10px', background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: 4 }}>{t('settings.ai.apiKey.saved')}</span>
          <button onClick={() => void clear()} disabled={busy} style={{ padding: '4px 10px', fontSize: 11, cursor: busy ? 'default' : 'pointer', background: 'var(--hover)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--ink-dim)' }}>{t('settings.ai.apiKey.clear')}</button>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="password" value={draft} placeholder={placeholder} autoComplete="off" spellCheck={false} aria-label={label}
            onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && draft.trim()) void save(); }}
            style={{ ...textInputStyle, flex: 1 }} />
          <button onClick={() => void save()} disabled={busy || !draft.trim()} style={{ padding: '7px 12px', fontSize: 11, cursor: (busy || !draft.trim()) ? 'default' : 'pointer', background: 'var(--accent)', border: 'none', borderRadius: 4, color: '#fff', opacity: (busy || !draft.trim()) ? 0.5 : 1, fontWeight: 600 }}>{t('settings.ai.apiKey.save')}</button>
        </div>
      )}
    </Field>
  );
}

function AITab() {
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);
  const t = useT();
  const ai = settings.ai ?? { provider: 'none' as const, model: '', baseURL: '' };

  // T6: local key-state override — used when the provider dropdown changes (the
  // settings store's ai.hasKey only reflects the PERSISTED active provider, so we
  // query ai:has-secret whenever the user picks a different provider in the dropdown
  // before saving).  null = use ai.hasKey from store (initial / after save/clear).
  const [localHasKey, setLocalHasKey] = useState<boolean | null>(null);
  // keyDraft: write-only local state for the key input field. Never populated from
  // settings (the renderer never receives the raw key back).
  const [keyDraft, setKeyDraft] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [savingKey, setSavingKey] = useState(false);

  // Effective hasKey: prefer local override (set after provider switch / save / clear)
  // over the store value (set on mount via settings:get).
  const hasKey = localHasKey !== null ? localHasKey : (ai.hasKey ?? false);
  const keychainAvailable = ai.keychainAvailable !== false; // treat undefined as true

  // AI model dropdown: live-fetched model ids + UI state.
  const [fetchedModels, setFetchedModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelError, setModelError] = useState<string | null>(null);
  const [customModel, setCustomModel] = useState(false);
  const meta = PROVIDER_META[ai.provider];

  // Real, live-fetched models when available; otherwise the hardcoded fallback so
  // the dropdown is never empty (offline / before the key is entered).
  const modelOptions = fetchedModels.length > 0 ? fetchedModels : (MODELS_BY_PROVIDER[ai.provider] ?? []);
  const isCustom = customModel || (!!ai.model && !modelOptions.includes(ai.model));

  // patchAi: send only the safe non-secret fields to settings:set.
  // apiKey is intentionally absent — keys travel via ai:set-secret (T4/T6).
  const patchAi = (patch: Partial<NonNullable<AppSettings['ai']>>) =>
    void update({ ai: { provider: ai.provider, model: ai.model, baseURL: ai.baseURL ?? '', ...patch } });

  // Switching provider: reset model/base URL, clear fetched models, and query
  // ai:has-secret for the new provider (the store's ai.hasKey is for the old one).
  const onProvider = (provider: NonNullable<AppSettings['ai']>['provider']) => {
    setFetchedModels([]); setModelError(null); setCustomModel(false);
    setKeyDraft(''); setLocalHasKey(null);
    patchAi({
      provider,
      model: DEFAULT_MODELS[provider],
      baseURL: provider === 'openai-compatible' ? (ai.baseURL || OLLAMA_BASE_URL) : (ai.baseURL ?? ''),
    });
    if (provider !== 'none') {
      void ipc('ai:has-secret', provider).then((has) => setLocalHasKey(has)).catch(() => {});
    }
  };

  // Save key: call ai:set-secret, then confirm with ai:has-secret, clear draft.
  // I-2: if secretStore is unavailable main throws — surface that to the user.
  const saveKey = async () => {
    if (!keyDraft.trim()) return;
    setSavingKey(true);
    setModelError(null);
    try {
      await ipc('ai:set-secret', ai.provider, keyDraft.trim());
      setKeyDraft('');
      setShowKey(false);
      setLocalHasKey(true);
      // Re-fetch models now that a key is saved (silent — don't show error).
      void loadModels(true);
    } catch (err) {
      console.error('[AITab] ai:set-secret failed:', err);
      setModelError(err instanceof Error ? err.message : 'Failed to save key');
    } finally {
      setSavingKey(false);
    }
  };

  // Clear key: call ai:clear-secret and update local state.
  const clearKey = async () => {
    try {
      await ipc('ai:clear-secret', ai.provider);
      setLocalHasKey(false);
      setFetchedModels([]);
    } catch (err) {
      console.error('[AITab] ai:clear-secret failed:', err);
    }
  };

  // Fetch the provider's models (main-side: the renderer can't hit the provider
  // cross-origin under CSP). T5: the renderer no longer passes an API key — main
  // loads the stored key from secretStore. `silent` suppresses errors for the
  // background auto-load (before the user has saved a key the auto-load just keeps
  // the hardcoded fallback list without showing an error).
  const loadModels = useCallback(async (silent = false) => {
    setLoadingModels(true);
    if (!silent) setModelError(null);
    try {
      const models = await ipc('ai:list-models', { provider: ai.provider, baseURL: ai.baseURL ?? '' });
      setFetchedModels(models);
      if (models.length === 0 && !silent) setModelError(t('settings.ai.model.error.noModels'));
    } catch (err) {
      if (!silent) setModelError(err instanceof Error ? err.message : t('settings.ai.model.error.failed'));
    } finally {
      setLoadingModels(false);
    }
  }, [ai.provider, ai.baseURL, t]);

  // Auto-load the real list as soon as the provider is selected and a key is known to
  // be stored (hasKey) or the provider is keyless (openai-compatible with a baseURL).
  // T5/T6: we guard on the effective hasKey (local override or store value).
  // Failures fall back to the hardcoded list silently (no error spam before key saved).
  useEffect(() => {
    if (ai.provider === 'none') { setFetchedModels([]); return; }
    const isKeyless = ai.provider === 'openai-compatible';
    if (!isKeyless && !hasKey) return;
    if (isKeyless && !ai.baseURL) return;
    const timer = setTimeout(() => { void loadModels(true); }, 600);
    return () => clearTimeout(timer);
  }, [ai.provider, hasKey, ai.baseURL, loadModels]);

  // ─── "Start Ollama" affordance (local openai-compatible only) ───
  // When the user points the Local provider at a loopback host, surface whether the
  // server is up / installed and a one-tap start. Remote hosts (Groq/OpenRouter) are
  // never offered a start (isLocalProviderUrl gates it).
  const [ollama, setOllama] = useState<{ reachable: boolean; installed: boolean } | null>(null);
  const [startingOllama, setStartingOllama] = useState(false);
  const [ollamaMsg, setOllamaMsg] = useState<string | null>(null);
  // Compat (installed version vs current-model floor) + auto-download (button-prompt) state.
  const [compat, setCompat] = useState<
    { installed: boolean; version: string | null; minVersion: string; outdated: boolean } | null
  >(null);
  const [downloading, setDownloading] = useState(false);
  const [dlPct, setDlPct] = useState<number | null>(null);
  const isLocalOllama = ai.provider === 'openai-compatible' && isLocalProviderUrl(ai.baseURL ?? '');

  const refreshOllama = useCallback(async () => {
    if (!isLocalOllama) { setOllama(null); setCompat(null); return; }
    try {
      setOllama(await ipc('ollama:status', { baseURL: ai.baseURL ?? '' }));
      setCompat(await ipc('ollama:compat'));
    } catch { setOllama(null); setCompat(null); }
  }, [isLocalOllama, ai.baseURL]);

  // Auto-download the latest Ollama (button-prompt). Bytes stream via 'ollama:download-progress'.
  const handleDownloadOllama = useCallback(async () => {
    setDownloading(true); setOllamaMsg(null); setDlPct(0);
    const off = onIpc('ollama:download-progress', (p: unknown) => {
      const d = p as { phase: string; received?: number; total?: number };
      if (d.phase === 'downloading' && d.total) setDlPct(Math.round((d.received! / d.total) * 100));
      else if (d.phase === 'extracting') setDlPct(100);
    });
    try {
      const r = await ipc('ollama:download');
      if (r.ok) {
        setOllamaMsg(t('settings.ai.ollama.installed'));
        await refreshOllama();
        void loadModels(true);
      } else {
        setOllamaMsg(t('settings.ai.ollama.downloadFailed'));
      }
    } catch {
      setOllamaMsg(t('settings.ai.ollama.downloadFailed'));
    } finally {
      off(); setDownloading(false); setDlPct(null);
    }
  }, [t, refreshOllama, loadModels]);

  // Debounced re-check as the provider / baseURL changes.
  useEffect(() => {
    setOllamaMsg(null);
    const timer = setTimeout(() => { void refreshOllama(); }, 400);
    return () => clearTimeout(timer);
  }, [refreshOllama]);

  const handleStartOllama = useCallback(async () => {
    setStartingOllama(true);
    setOllamaMsg(null);
    try {
      const r = await ipc('ollama:start', { baseURL: ai.baseURL ?? '' });
      if (r.ok) {
        setOllamaMsg(t('settings.ai.ollama.started'));
        await refreshOllama();
        void loadModels(true); // models become listable once the server is up
      } else if (r.reason === 'not-installed') {
        setOllamaMsg(t('settings.ai.ollama.notInstalled'));
      } else if (r.reason === 'timeout') {
        setOllamaMsg(t('settings.ai.ollama.timeout'));
      } else {
        setOllamaMsg(t('settings.ai.ollama.failed'));
      }
    } catch {
      setOllamaMsg(t('settings.ai.ollama.failed'));
    } finally {
      setStartingOllama(false);
    }
  }, [ai.baseURL, t, refreshOllama, loadModels]);

  return (
    <div>
      <Field label={t('settings.ai.provider.label')} hint={t('settings.ai.provider.hint')}>
        <select
          value={ai.provider}
          aria-label={t('settings.ai.provider.label')}
          onChange={(e) => onProvider(e.target.value as NonNullable<AppSettings['ai']>['provider'])}
          style={{ ...textInputStyle, width: 260, cursor: 'pointer' }}
        >
          {(['none', 'anthropic', 'openai', 'google', 'openai-compatible'] as const).map((p) => (
            <option key={p} value={p}>{PROVIDER_META[p].label}</option>
          ))}
        </select>
      </Field>

      {ai.provider !== 'none' && (
        <>
          {meta.needsBaseURL && (
            <Field label={t('settings.ai.baseUrl.label')} hint={t('settings.ai.baseUrl.hint')}>
              <input
                type="text"
                value={ai.baseURL ?? ''}
                aria-label={t('settings.ai.baseUrl.label')}
                placeholder={OLLAMA_BASE_URL}
                spellCheck={false}
                onChange={(e) => patchAi({ baseURL: e.target.value })}
                style={{ ...textInputStyle, width: 360 }}
              />
            </Field>
          )}

          {/* Local server (Ollama) status + one-tap start — only for a loopback baseURL. */}
          {isLocalOllama && (
            <Field label={t('settings.ai.ollama.label')} hint={t('settings.ai.ollama.hint')}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                {ollama === null ? (
                  <span style={{ fontSize: 12, color: 'var(--ink-faint)' }}>{t('settings.ai.ollama.checking')}</span>
                ) : ollama.reachable ? (
                  <span style={{
                    fontSize: 12, color: '#10b981', fontWeight: 600,
                    padding: '4px 10px', background: 'rgba(16,185,129,0.1)',
                    border: '1px solid rgba(16,185,129,0.3)', borderRadius: 4,
                  }}>
                    {t('settings.ai.ollama.running')}
                  </span>
                ) : ollama.installed ? (
                  <>
                    <span style={{ fontSize: 12, color: 'var(--ink-dim)' }}>{t('settings.ai.ollama.notRunning')}</span>
                    <button
                      onClick={() => void handleStartOllama()}
                      disabled={startingOllama}
                      style={{
                        padding: '4px 12px', fontSize: 11,
                        cursor: startingOllama ? 'default' : 'pointer',
                        background: 'var(--accent)', border: 'none', borderRadius: 4,
                        color: '#fff', opacity: startingOllama ? 0.6 : 1,
                      }}
                    >
                      {startingOllama ? t('settings.ai.ollama.starting') : t('settings.ai.ollama.start')}
                    </button>
                  </>
                ) : (
                  <>
                    <span style={{ fontSize: 12, color: 'var(--ink-dim)' }}>{t('settings.ai.ollama.notInstalled')}</span>
                    {/* Button-prompt auto-download: fetches the latest Ollama and installs it
                        next to the models drive — never auto-runs (user must click). */}
                    <button
                      onClick={() => void handleDownloadOllama()}
                      disabled={downloading}
                      style={{
                        padding: '4px 12px', fontSize: 11,
                        cursor: downloading ? 'default' : 'pointer',
                        background: 'var(--accent)', border: 'none', borderRadius: 4,
                        color: '#fff', opacity: downloading ? 0.6 : 1,
                      }}
                    >
                      {downloading
                        ? `${t('settings.ai.ollama.downloading')}${dlPct !== null ? ` ${dlPct}%` : ''}`
                        : t('settings.ai.ollama.downloadInstall')}
                    </button>
                    <button
                      onClick={() => void ipc('shell:open-external', 'https://ollama.com/download')}
                      style={{
                        padding: '4px 12px', fontSize: 11, cursor: 'pointer',
                        background: 'var(--hover)', border: '1px solid var(--border)',
                        borderRadius: 4, color: 'var(--ink-dim)',
                      }}
                    >
                      {t('settings.ai.ollama.download')}
                    </button>
                  </>
                )}
              </div>
              {/* Compat warning: installed but older than the current-model floor → offer update. */}
              {compat?.installed && compat.outdated && (
                <div style={{
                  marginTop: 8, fontSize: 11, color: 'var(--ink-dim)',
                  display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap',
                  padding: '6px 10px', background: 'rgba(245,158,11,0.1)',
                  border: '1px solid rgba(245,158,11,0.3)', borderRadius: 4,
                }}>
                  <span>
                    ⚠ {t('settings.ai.ollama.outdated')} (v{compat.version} → v{compat.minVersion}+)
                  </span>
                  <button
                    onClick={() => void handleDownloadOllama()}
                    disabled={downloading}
                    style={{
                      padding: '3px 10px', fontSize: 11,
                      cursor: downloading ? 'default' : 'pointer',
                      background: 'var(--accent)', border: 'none', borderRadius: 4,
                      color: '#fff', opacity: downloading ? 0.6 : 1,
                    }}
                  >
                    {downloading
                      ? `${t('settings.ai.ollama.downloading')}${dlPct !== null ? ` ${dlPct}%` : ''}`
                      : t('settings.ai.ollama.update')}
                  </button>
                </div>
              )}
              {ollamaMsg && (
                <div style={{ marginTop: 6, fontSize: 11, color: 'var(--ink-faint)' }}>{ollamaMsg}</div>
              )}
            </Field>
          )}

          {/* T6: key-state indicator — show saved state OR the input field */}
          <Field
            label={meta.needsKey ? t('settings.ai.apiKey.label') : t('settings.ai.apiKey.label.optional')}
            hint={keychainAvailable ? t('settings.ai.apiKey.hint.secure') : t('settings.ai.apiKey.hint.session')}
          >
            {hasKey ? (
              /* Saved state: show "✓ Key saved" pill + Clear button */
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{
                  fontSize: 12, color: '#10b981', fontWeight: 600,
                  padding: '4px 10px', background: 'rgba(16,185,129,0.1)',
                  border: '1px solid rgba(16,185,129,0.3)', borderRadius: 4,
                }}>
                  {t('settings.ai.apiKey.saved')}
                </span>
                <button
                  onClick={() => void clearKey()}
                  aria-label={t('settings.ai.apiKey.clear.aria')}
                  style={{
                    padding: '4px 10px', fontSize: 11, cursor: 'pointer',
                    background: 'var(--hover)', border: '1px solid var(--border)',
                    borderRadius: 4, color: 'var(--ink-dim)',
                  }}
                >
                  {t('settings.ai.apiKey.clear')}
                </button>
              </div>
            ) : (
              /* Input state: text field + Show/Hide + Save button */
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input
                  type={showKey ? 'text' : 'password'}
                  value={keyDraft}
                  aria-label={t('settings.ai.apiKey.label')}
                  placeholder={meta.keyPlaceholder}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(e) => setKeyDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && keyDraft.trim()) void saveKey(); }}
                  style={{ ...textInputStyle, flex: 1 }}
                />
                <button
                  onClick={() => setShowKey((v) => !v)}
                  aria-label={showKey ? t('settings.ai.apiKey.button.hide.aria') : t('settings.ai.apiKey.button.show.aria')}
                  style={{
                    padding: '7px 10px', fontSize: 11, cursor: 'pointer',
                    background: 'var(--hover)', border: '1px solid var(--border)',
                    borderRadius: 4, color: 'var(--ink-dim)', whiteSpace: 'nowrap',
                  }}
                >
                  {showKey ? t('settings.ai.apiKey.button.hide') : t('settings.ai.apiKey.button.show')}
                </button>
                <button
                  onClick={() => void saveKey()}
                  disabled={savingKey || !keyDraft.trim()}
                  aria-label={t('settings.ai.apiKey.save.aria')}
                  style={{
                    padding: '7px 12px', fontSize: 11, cursor: (savingKey || !keyDraft.trim()) ? 'default' : 'pointer',
                    background: 'var(--accent)', border: 'none',
                    borderRadius: 4, color: '#fff', whiteSpace: 'nowrap',
                    opacity: (savingKey || !keyDraft.trim()) ? 0.5 : 1,
                    fontWeight: 600,
                  }}
                >
                  {savingKey ? t('settings.ai.apiKey.saving') : t('settings.ai.apiKey.save')}
                </button>
              </div>
            )}

            {/* T6: keychain warning banner when safeStorage is not persistent */}
            {!keychainAvailable && (
              <div style={{
                marginTop: 8, fontSize: 11, color: '#f59e0b',
                padding: '6px 10px', background: 'rgba(245,158,11,0.08)',
                border: '1px solid rgba(245,158,11,0.3)', borderRadius: 4,
              }}>
                {t('settings.ai.apiKey.warning.keychain')}
              </div>
            )}
          </Field>

          {/* SP4: optional dedicated keys for audio (OpenAI Whisper) + video (Gemini) chat
              attachments — independent of the chat provider, enable the 🎤/🎬 buttons. */}
          <MediaKeyField provider="transcribeApiKey" label={t('settings.ai.transcribeKey.label')} hint={t('settings.ai.transcribeKey.hint')} placeholder="sk-…" />
          <MediaKeyField provider="videoApiKey" label={t('settings.ai.videoKey.label')} hint={t('settings.ai.videoKey.hint')} placeholder="AIza…" />

          <Field label={t('settings.ai.model.label')} hint={meta.modelHint}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <select
                value={isCustom ? '__custom__' : (ai.model || '')}
                aria-label={t('settings.ai.model.label')}
                onChange={(e) => {
                  if (e.target.value === '__custom__') setCustomModel(true);
                  else { setCustomModel(false); patchAi({ model: e.target.value }); }
                }}
                style={{ ...textInputStyle, width: 240, cursor: 'pointer' }}
              >
                {modelOptions.length === 0 && <option value="">{DEFAULT_MODELS[ai.provider] || t('settings.ai.model.none')}</option>}
                {modelOptions.map((m) => <option key={m} value={m}>{m}</option>)}
                <option value="__custom__">{t('settings.ai.model.custom')}</option>
              </select>
              <button
                onClick={() => void loadModels()}
                disabled={loadingModels}
                title={t('settings.ai.model.loadButton.title')}
                style={{
                  padding: '7px 10px', fontSize: 11, cursor: loadingModels ? 'default' : 'pointer',
                  background: 'var(--hover)', border: '1px solid var(--border)',
                  borderRadius: 4, color: 'var(--ink-dim)', whiteSpace: 'nowrap', opacity: loadingModels ? 0.6 : 1,
                }}
              >
                {loadingModels ? '…' : t('settings.ai.model.loadButton.text')}
              </button>
            </div>
            {isCustom && (
              <input
                type="text"
                value={ai.model || ''}
                aria-label="Custom model id"
                placeholder={DEFAULT_MODELS[ai.provider]}
                spellCheck={false}
                onChange={(e) => patchAi({ model: e.target.value })}
                style={{ ...textInputStyle, width: 320, marginTop: 6 }}
              />
            )}
            {modelError && <div style={{ fontSize: 10, color: '#ef4444', marginTop: 4 }}>{modelError}</div>}
          </Field>

          {/* P0-1 (hermes-port-audit §4): opt-in "review every vault write" gate. OFF by default —
              ChatView reads settings.confirmWrites and sends it on chat:send; the main loop pauses
              every regular write for approval when set (core_memory_replace always confirms). */}
          <Field label={t('settings.ai.confirmWrites.label')} hint={t('settings.ai.confirmWrites.hint')}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--ink-dim)', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={!!settings.confirmWrites}
                onChange={(e) => void update({ confirmWrites: e.target.checked })}
                style={{ accentColor: 'var(--accent)' }}
              />
              {t('settings.ai.confirmWrites.label')}
            </label>
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
  const t = useT();
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
        {t('settings.hotkeys.instructions')}
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
            {isConflict && <span title={t('settings.hotkeys.conflict.title')} style={{ color: '#ef4444', fontSize: 10 }}>{t('settings.hotkeys.conflict.badge')}</span>}
            {!isConflict && isEditorConflict && (
              <span
                title={t('settings.hotkeys.editorConflict.title')}
                style={{ color: '#f59e0b', fontSize: 10 }}
              >
                {t('settings.hotkeys.editorConflict.badge')}
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
              {isCapturing ? t('settings.hotkeys.button.capturing') : chord ? formatChord(chord) : t('settings.hotkeys.button.notSet')}
            </button>
            <button
              onClick={() => setBinding(cmd.id, null)}
              disabled={!isCustom}
              title={t('settings.hotkeys.reset.title')}
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
  const t = useT();
  return (
    <div style={{ fontSize: 12, color: 'var(--ink-dim)', lineHeight: 1.8 }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)', marginBottom: 4 }}>{t('settings.about.appTitle')}</div>
      <p style={{ margin: '0 0 12px' }}>{t('settings.about.description')}</p>
      <div>{t('settings.about.github.label')}<span style={{ color: 'var(--accent-2)' }}>github.com/Evanciel/stellavault</span></div>
      <div style={{ marginTop: 8, fontSize: 10, color: 'var(--ink-faint)' }}>
        {t('settings.about.settingsFile')}
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
  const t = useT();

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
        label={t('settings.agent.label')}
        hint={t('settings.agent.hint')}
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
            {busy ? '…' : running ? t('settings.agent.button.stop') : t('settings.agent.button.start')}
          </button>
          <span style={{ fontSize: 12, color: running ? '#10b981' : 'var(--ink-faint)' }}>
            {running ? `${t('settings.agent.status.running')}${status?.port}` : t('settings.agent.status.stopped')}
          </span>
          <span style={{ fontSize: 10, color: 'var(--ink-faint)' }}>
            {status?.toolCount ?? 21} {t('settings.agent.toolCount')}
          </span>
        </div>
        {status?.error && (
          <div style={{ fontSize: 10, color: '#ef4444', marginTop: 6 }}>{status.error}</div>
        )}
      </Field>

      <Field label={t('settings.agent.autoStart.label')}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--ink-dim)', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={!!settings.mcpAutoStart}
            onChange={(e) => void update({ mcpAutoStart: e.target.checked })}
            style={{ accentColor: 'var(--accent)' }}
          />
          {t('settings.agent.autoStart.checkbox')}
        </label>
      </Field>

      <Field label={t('settings.agent.activity.label')} hint={t('settings.agent.activity.hint')}>
        {(!status || status.recent.length === 0) ? (
          <div style={{ fontSize: 11, color: 'var(--ink-faint)', padding: '8px 0' }}>
            {running ? t('settings.agent.activity.empty.running') : t('settings.agent.activity.empty.stopped')}
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
