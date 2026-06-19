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
import { DEFAULT_MODELS, MODELS_BY_PROVIDER, OLLAMA_BASE_URL, PROVIDER_META, modelsListRequest } from '../../../shared/ai-providers.js';
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

// ─── AI (T3-2) ───
// Provider + API key for LLM synthesis (Ask panel + Wiki Synthesis). The key is
// stored in SecretStore (safeStorage-backed) in the main process — it is NEVER
// sent back to the renderer via settings:get. Provider 'none' (or no key) →
// extractive fallback. keyDraft is local write-only state: the rendered value is
// always a placeholder/bullet mask showing whether a key exists (ai.hasKey).
// Full write-only UX (T6) wires 'secret:set-key'; for now the draft is passed
// inline to ai:list-models so live model fetching still works.

function AITab() {
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);
  const t = useT();
  const ai = settings.ai ?? { provider: 'none' as const, model: '', baseURL: '' };
  // keyDraft: local state for the key input — write-only, never populated from
  // settings (the renderer never receives the raw key). Placeholder shows whether
  // a key is already stored (ai.hasKey). Full T6 UX will wire 'secret:set-key'.
  const [keyDraft, setKeyDraft] = useState('');
  const [showKey, setShowKey] = useState(false);
  // AI model dropdown: live-fetched model ids + UI state. The list auto-loads from
  // the provider over the internet as soon as the key/base URL are sufficient, so it
  // shows ONLY models the account can actually use; the hardcoded list is just an
  // offline fallback (shown before the fetch / when it fails). "Custom…" still lets
  // the user type an id not in the list.
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
  // apiKey is intentionally absent — keys travel via secret:set-key (T4/T6).
  const patchAi = (patch: Partial<NonNullable<AppSettings['ai']>>) =>
    void update({ ai: { provider: ai.provider, model: ai.model, baseURL: ai.baseURL ?? '', ...patch } });

  // Switching provider resets the model to that provider's default, prefills the
  // local base URL for openai-compatible, and clears fetched/custom state.
  const onProvider = (provider: NonNullable<AppSettings['ai']>['provider']) => {
    setFetchedModels([]); setModelError(null); setCustomModel(false);
    patchAi({
      provider,
      model: DEFAULT_MODELS[provider],
      baseURL: provider === 'openai-compatible' ? (ai.baseURL || OLLAMA_BASE_URL) : (ai.baseURL ?? ''),
    });
  };

  // Fetch the provider's models (main-side: the renderer can't hit the provider
  // cross-origin under CSP). Local servers (Ollama / LM Studio) need no key; cloud
  // uses keyDraft (local write-only state — never read from settings). `silent`
  // suppresses errors for the background auto-load.
  const loadModels = useCallback(async (silent = false) => {
    setLoadingModels(true);
    if (!silent) setModelError(null);
    try {
      const models = await ipc('ai:list-models', { provider: ai.provider, apiKey: keyDraft, baseURL: ai.baseURL ?? '' });
      setFetchedModels(models);
      if (models.length === 0 && !silent) setModelError(t('settings.ai.model.error.noModels'));
    } catch (err) {
      if (!silent) setModelError(err instanceof Error ? err.message : t('settings.ai.model.error.failed'));
    } finally {
      setLoadingModels(false);
    }
  }, [ai.provider, keyDraft, ai.baseURL, t]);

  // Auto-load the real list over the internet as soon as the provider + key/base URL
  // are sufficient — debounced so typing a key doesn't fire a request per keystroke.
  // Failures fall back to the hardcoded list silently (no error spam while typing).
  useEffect(() => {
    if (ai.provider === 'none') { setFetchedModels([]); return; }
    if (!modelsListRequest(ai.provider, keyDraft, ai.baseURL ?? '')) return; // key/url missing → keep fallback
    const t = setTimeout(() => { void loadModels(true); }, 600);
    return () => clearTimeout(t);
  }, [ai.provider, keyDraft, ai.baseURL, loadModels]);

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

          <Field label={meta.needsKey ? t('settings.ai.apiKey.label') : t('settings.ai.apiKey.label.optional')} hint={`${t('settings.ai.apiKey.hint.prefix')}${meta.keyHint} ${t('settings.ai.apiKey.hint.suffix')}`}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input
                type={showKey ? 'text' : 'password'}
                value={keyDraft}
                aria-label="AI API key"
                placeholder={ai.hasKey ? '••••••••••••••••' : meta.keyPlaceholder}
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => setKeyDraft(e.target.value)}
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
            </div>
          </Field>

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
