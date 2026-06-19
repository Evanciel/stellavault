// AI Panel — ask vault, semantic search, draft, review queue (FSRS), stats.
// Connects to @stellavault/core via IPC.

import { useState, useCallback, useEffect } from 'react';
import { create } from 'zustand';
import { useAppStore } from '../../stores/app-store.js';
import { ipc } from '../../lib/ipc-client.js';
import { invokeIpcRaw } from '../../lib/runtime-sync.js';
import { registerCommand } from '../../lib/commands.js';
import { useT } from '../../lib/i18n.js';
import type { SearchResult, VaultStats, DecayItem } from '../../../shared/ipc-types.js';

type Tab = 'ask' | 'search' | 'express' | 'decay' | 'stats';

// ─── Cross-component tab requests (palette commands → panel) ───

interface AiPanelUiState {
  requestedTab: Tab | null;
  requestTab: (tab: Tab) => void;
  clearRequest: () => void;
}

const useAiPanelUi = create<AiPanelUiState>((set) => ({
  requestedTab: null,
  requestTab: (tab) => set({ requestedTab: tab }),
  clearRequest: () => set({ requestedTab: null }),
}));

// Stage C (W1-13/14): palette commands + default hotkey via the registry.
let aiCommandsRegistered = false;
function registerAiPanelCommands(): void {
  if (aiCommandsRegistered) return;
  aiCommandsRegistered = true;
  registerCommand({
    id: 'panel.ai-ask', title: 'Ask your vault (AI)', category: 'Panels',
    defaultKeys: 'mod+shift+a',
    run: () => {
      useAppStore.getState().setRightPanel('ai');
      useAiPanelUi.getState().requestTab('ask');
    },
  });
  registerCommand({
    id: 'panel.ai-review', title: 'Open review queue (Memory)', category: 'Panels',
    run: () => {
      useAppStore.getState().setRightPanel('ai');
      useAiPanelUi.getState().requestTab('decay');
    },
  });
}
registerAiPanelCommands();

export function AIPanel() {
  const t = useT();
  const [activeTab, setActiveTab] = useState<Tab>('ask');
  const coreReady = useAppStore((s) => s.coreReady);
  const requestedTab = useAiPanelUi((s) => s.requestedTab);
  const clearRequest = useAiPanelUi((s) => s.clearRequest);

  useEffect(() => {
    if (!requestedTab) return;
    setActiveTab(requestedTab);
    clearRequest();
  }, [requestedTab, clearRequest]);

  if (!coreReady) {
    return (
      <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-faint)', fontSize: 12 }}>
        <div style={{ fontSize: 24, marginBottom: 8, opacity: 0.3 }}>&#x2726;</div>
        {t('panel.ai.loadingAiEngine')}
        <div style={{ marginTop: 8, fontSize: 10 }}>{t('panel.ai.firstRunHint')}</div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Tab bar */}
      <div style={{
        display: 'flex',
        borderBottom: '1px solid var(--border)',
        fontSize: 11,
      }}>
        {(['ask', 'search', 'express', 'decay', 'stats'] as Tab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            aria-selected={activeTab === tab}
            role="tab"
            style={{
              flex: 1,
              padding: '8px 0',
              background: activeTab === tab ? 'var(--selection)' : 'transparent',
              border: 'none',
              color: activeTab === tab ? 'var(--accent-2)' : 'var(--ink-dim)',
              cursor: 'pointer',
              fontWeight: activeTab === tab ? 600 : 400,
              fontSize: 11,
            }}
          >
            {tab === 'ask' ? t('panel.ai.tabAsk') : tab === 'search' ? t('panel.ai.tabSearch') : tab === 'express' ? t('panel.ai.tabDraft') : tab === 'decay' ? t('panel.ai.tabMemory') : t('panel.ai.tabStats')}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'auto', padding: '12px' }}>
        {activeTab === 'ask' && <AskVault />}
        {activeTab === 'search' && <AISearch />}
        {activeTab === 'express' && <ExpressDraft />}
        {activeTab === 'decay' && <ReviewQueue />}
        {activeTab === 'stats' && <VaultStatsView />}
      </div>
    </div>
  );
}

function AISearch() {
  const t = useT();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const openFile = useAppStore((s) => s.openFile);

  const handleSearch = useCallback(async () => {
    if (!query.trim()) return;
    setLoading(true);
    const r = await ipc('core:search', query, 10);
    setResults(r);
    setLoading(false);
  }, [query]);

  return (
    <div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void handleSearch(); }}
          placeholder={t('panel.ai.searchPlaceholder')}
          style={{
            flex: 1,
            background: 'var(--hover)',
            border: '1px solid var(--border)',
            borderRadius: 4,
            padding: '6px 10px',
            fontSize: 12,
            color: 'var(--ink)',
            outline: 'none',
          }}
        />
        <button
          onClick={() => void handleSearch()}
          disabled={loading}
          style={{
            padding: '6px 14px',
            background: 'var(--accent)',
            border: 'none',
            borderRadius: 4,
            color: '#fff',
            fontSize: 11,
            cursor: 'pointer',
          }}
        >
          {loading ? '...' : t('panel.ai.searchButton')}
        </button>
      </div>

      {results.map((r) => (
        <div
          key={r.id}
          onClick={async () => {
            const content = await ipc('vault:read-file', r.filePath);
            openFile(r.filePath, r.title, content);
          }}
          style={{
            padding: '8px 10px',
            marginBottom: 4,
            borderRadius: 4,
            cursor: 'pointer',
            background: 'var(--hover)',
            border: '1px solid var(--border)',
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--accent)'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border)'; }}
        >
          <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink)', marginBottom: 2 }}>
            {r.title}
            <span style={{ float: 'right', fontSize: 10, color: 'var(--accent-2)' }}>
              {Math.round(r.score * 100)}%
            </span>
          </div>
          {r.snippet && (
            <div style={{ fontSize: 11, color: 'var(--ink-dim)', lineHeight: 1.4 }}>
              {r.snippet.slice(0, 120)}...
            </div>
          )}
          {r.tags.length > 0 && (
            <div style={{ marginTop: 4, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {r.tags.map((t) => (
                <span key={t} style={{
                  fontSize: 9,
                  padding: '1px 6px',
                  background: 'var(--selection)',
                  borderRadius: 3,
                  color: 'var(--accent-2)',
                }}>
                  #{t}
                </span>
              ))}
            </div>
          )}
        </div>
      ))}

      {results.length === 0 && query && !loading && (
        <div style={{ textAlign: 'center', color: 'var(--ink-faint)', fontSize: 11, padding: 20 }}>
          {t('panel.ai.noSearchResults')}
        </div>
      )}
    </div>
  );
}

// ─── Ask tab (W1-13) — question → answer + cited notes ───

interface AskResponse {
  answer: string;
  citations: { filePath: string; title: string; snippet: string }[];
}

function AskVault() {
  const t = useT();
  const [question, setQuestion] = useState('');
  const [response, setResponse] = useState<AskResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const openFile = useAppStore((s) => s.openFile);

  const handleAsk = useCallback(async () => {
    const q = question.trim();
    if (!q || loading) return;
    setLoading(true);
    setError(null);
    setResponse(null);
    try {
      const r = await invokeIpcRaw<AskResponse>('core:ask', q);
      setResponse(r);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ask failed. Is the vault indexed?');
    } finally {
      setLoading(false);
    }
  }, [question, loading]);

  return (
    <div>
      <textarea
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            void handleAsk();
          }
        }}
        placeholder={t('panel.ai.askPlaceholder')}
        aria-label="Ask your vault"
        rows={3}
        style={{
          width: '100%',
          boxSizing: 'border-box',
          background: 'var(--hover)',
          border: '1px solid var(--border)',
          borderRadius: 4,
          padding: '8px 10px',
          fontSize: 12,
          color: 'var(--ink)',
          outline: 'none',
          resize: 'vertical',
          fontFamily: 'inherit',
          lineHeight: 1.5,
        }}
      />
      <button
        onClick={() => void handleAsk()}
        disabled={loading || !question.trim()}
        style={{
          marginTop: 6,
          width: '100%',
          padding: '6px',
          background: 'var(--accent)',
          border: 'none',
          borderRadius: 4,
          color: '#fff',
          fontSize: 11,
          cursor: 'pointer',
          opacity: loading || !question.trim() ? 0.5 : 1,
        }}
      >
        {loading ? t('panel.ai.asking') : t('panel.ai.askButton')}
      </button>

      {/* Loading skeleton */}
      {loading && (
        <div style={{ marginTop: 12 }} aria-label="Loading answer">
          {[100, 92, 78].map((w, i) => (
            <div key={i} style={{
              height: 10,
              width: `${w}%`,
              marginBottom: 8,
              borderRadius: 4,
              background: 'var(--hover)',
              opacity: 0.8 - i * 0.2,
            }} />
          ))}
        </div>
      )}

      {error && (
        <div style={{ marginTop: 12, fontSize: 11, color: 'var(--ink-dim)', padding: 10, background: 'var(--hover)', borderRadius: 4 }}>
          {error}
        </div>
      )}

      {response && !loading && (
        <div style={{ marginTop: 12 }}>
          <pre style={{
            whiteSpace: 'pre-wrap',
            fontFamily: 'inherit',
            margin: 0,
            padding: 12,
            background: 'var(--hover)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            fontSize: 12,
            lineHeight: 1.6,
            color: 'var(--ink)',
          }}>
            {response.answer}
          </pre>

          {response.citations.length > 0 && (
            <>
              <div style={{ marginTop: 12, marginBottom: 6, fontSize: 10, color: 'var(--ink-faint)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                {t('panel.ai.sourcesList', { count: response.citations.length })}
              </div>
              {response.citations.map((c) => (
                <div
                  key={c.filePath}
                  onClick={async () => {
                    const content = await ipc('vault:read-file', c.filePath);
                    openFile(c.filePath, c.title, content);
                  }}
                  style={{
                    padding: '8px 10px',
                    marginBottom: 4,
                    borderRadius: 4,
                    cursor: 'pointer',
                    background: 'var(--hover)',
                    border: '1px solid var(--border)',
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--accent)'; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border)'; }}
                >
                  <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink)' }}>{c.title}</div>
                  {c.snippet && (
                    <div style={{ fontSize: 10, color: 'var(--ink-dim)', marginTop: 2, lineHeight: 1.4 }}>
                      {c.snippet.slice(0, 120)}...
                    </div>
                  )}
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {!response && !loading && !error && (
        <div style={{ textAlign: 'center', color: 'var(--ink-faint)', fontSize: 11, padding: 20 }}>
          {t('panel.ai.askHint')}
        </div>
      )}
    </div>
  );
}

// ─── Memory tab (W1-14) — FSRS review queue ───

function daysSince(iso: string): number {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
}

// T2-5: FSRS recall grades surfaced as buttons. Color ramps from "forgot" (red)
// to "effortless" (green) so the judgement reads at a glance.
const GRADE_BUTTONS: { grade: 1 | 2 | 3 | 4; label: string; bg: string }[] = [
  { grade: 1, label: 'Again', bg: '#e5484d' },
  { grade: 2, label: 'Hard', bg: '#d97706' },
  { grade: 3, label: 'Good', bg: 'var(--accent)' },
  { grade: 4, label: 'Easy', bg: '#30a46c' },
];

function ReviewQueue() {
  const t = useT();
  const [items, setItems] = useState<DecayItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const openFile = useAppStore((s) => s.openFile);

  const refresh = useCallback(async () => {
    try {
      // Stage C contract channel; fall back to the legacy core:decay-top.
      const list = await invokeIpcRaw<DecayItem[]>('core:decay-list', 20)
        .catch(() => ipc('core:decay-top', 20));
      setItems(list);
      setError(null);
    } catch (err) {
      setItems([]);
      setError(err instanceof Error ? err.message : 'Failed to load review queue.');
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  // T2-5: grade the recall (1 Again / 2 Hard / 3 Good / 4 Easy). The grade is
  // passed through to core's FSRS recordAccess — Again resets stability, the
  // others raise it progressively. Await directly (refresh would race the write).
  const handleGrade = useCallback(async (filePath: string, grade: 1 | 2 | 3 | 4) => {
    await invokeIpcRaw<void>('core:record-access', filePath, 'review', grade).catch((err) => {
      console.warn('[AIPanel] record-access(review) failed:', err);
    });
    await refresh();
  }, [refresh]);

  if (items === null) {
    return <div style={{ padding: 20, textAlign: 'center', color: 'var(--ink-faint)', fontSize: 11 }}>{t('panel.ai.loadingReviewQueue')}</div>;
  }

  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4, color: 'var(--ink)' }}>
        {t('panel.ai.reviewQueueTitle')}
      </div>
      <div style={{ fontSize: 10, color: 'var(--ink-faint)', marginBottom: 12 }}>
        {t('panel.ai.reviewQueueHint')}
      </div>

      {error && (
        <div style={{ fontSize: 11, color: 'var(--ink-dim)', padding: 10, background: 'var(--hover)', borderRadius: 4, marginBottom: 8 }}>
          {error}
        </div>
      )}

      {items.length === 0 && !error && (
        <div style={{ textAlign: 'center', color: 'var(--ink-faint)', fontSize: 11, padding: 20 }}>
          {t('panel.ai.noReviewItems')}
        </div>
      )}

      {items.map((item) => {
        const pct = Math.round(Math.max(0, Math.min(1, item.retrievability)) * 100);
        const overdueDays = daysSince(item.lastAccess);
        return (
          <div
            key={item.documentId}
            style={{
              padding: '8px 10px',
              marginBottom: 6,
              borderRadius: 4,
              background: 'var(--hover)',
              border: '1px solid var(--border)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {item.title}
              </div>
              <span style={{ fontSize: 9, color: 'var(--ink-faint)', flexShrink: 0 }}>
                {overdueDays}{t('panel.ai.daysAgo')}
              </span>
            </div>

            {/* Retrievability gauge */}
            <div
              role="progressbar"
              aria-valuenow={pct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`Retrievability ${pct}%`}
              style={{ marginTop: 6, height: 4, borderRadius: 2, background: 'var(--selection)', overflow: 'hidden' }}
            >
              <div style={{
                width: `${pct}%`,
                height: '100%',
                borderRadius: 2,
                background: pct < 50 ? '#e5484d' : 'var(--accent)',
              }} />
            </div>

            <div style={{ marginTop: 6, display: 'flex', gap: 6, alignItems: 'center' }}>
              <span style={{ fontSize: 9, color: pct < 50 ? '#e5484d' : 'var(--ink-faint)' }}>
                {pct}{t('panel.ai.percentRetained')}
              </span>
              <button
                onClick={async () => {
                  const content = await ipc('vault:read-file', item.filePath);
                  openFile(item.filePath, item.title, content);
                }}
                style={{
                  marginLeft: 'auto', padding: '2px 10px', fontSize: 10, cursor: 'pointer',
                  background: 'transparent', border: '1px solid var(--border)', borderRadius: 3, color: 'var(--ink-dim)',
                }}
              >
                {t('common.open')}
              </button>
            </div>

            {/* T2-5: FSRS grade buttons — how well did you recall this note?
                Again resets decay; Hard/Good/Easy strengthen it progressively. */}
            <div style={{ marginTop: 6, display: 'flex', gap: 4 }}>
              {GRADE_BUTTONS.map(({ grade, label, bg }) => (
                <button
                  key={grade}
                  onClick={() => void handleGrade(item.filePath, grade)}
                  title={`Mark recall as "${label}"`}
                  aria-label={`Grade ${item.title} as ${label}`}
                  style={{
                    flex: 1, padding: '3px 0', fontSize: 10, cursor: 'pointer',
                    background: bg, border: 'none', borderRadius: 3, color: '#fff',
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function VaultStatsView() {
  const t = useT();
  const [stats, setStats] = useState<VaultStats | null>(null);

  // P0 fix: move IPC call into useEffect (was firing on every render)
  useEffect(() => {
    if (stats) return;
    void ipc('core:get-stats').then(setStats).catch(() => {});
  }, [stats]);

  if (!stats) return <div style={{ padding: 20, textAlign: 'center', color: 'var(--ink-faint)', fontSize: 11 }}>{t('panel.ai.loadingStats')}</div>;

  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 16, color: 'var(--ink)' }}>
        {t('panel.ai.vaultStatsTitle')}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {[
          { label: t('panel.ai.statsDocuments'), value: stats.documentCount },
          { label: t('panel.ai.statsChunks'), value: stats.chunkCount },
          { label: t('panel.ai.statsDbSize'), value: `${(stats.dbSizeBytes / 1024 / 1024).toFixed(1)}MB` },
          { label: t('panel.ai.statsLastIndexed'), value: stats.lastIndexed ? new Date(stats.lastIndexed).toLocaleDateString() : t('panel.ai.statsNeverIndexed') },
        ].map((s) => (
          <div key={s.label} style={{
            padding: '12px',
            background: 'var(--hover)',
            borderRadius: 6,
            border: '1px solid var(--border)',
          }}>
            <div style={{ fontSize: 10, color: 'var(--ink-faint)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
              {s.label}
            </div>
            <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--accent-2)' }}>
              {s.value}
            </div>
          </div>
        ))}
      </div>

      <button
        onClick={async () => {
          const result = await ipc('core:index');
          setStats(null); // Refresh
        }}
        style={{
          marginTop: 16,
          width: '100%',
          padding: '8px',
          background: 'var(--accent)',
          border: 'none',
          borderRadius: 4,
          color: '#fff',
          fontSize: 12,
          cursor: 'pointer',
        }}
      >
        {t('panel.ai.reindexButton')}
      </button>
    </div>
  );
}

function ExpressDraft() {
  const t = useT();
  const [topic, setTopic] = useState('');
  const [format, setFormat] = useState<'outline' | 'blog'>('outline');
  const [draft, setDraft] = useState<{ title: string; content: string; sources: string[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const openFile = useAppStore((s) => s.openFile);

  const handleGenerate = useCallback(async () => {
    if (!topic.trim()) return;
    setLoading(true);
    const result = await ipc('core:draft', topic, format);
    setDraft(result);
    setLoading(false);
  }, [topic, format]);

  const handleSave = useCallback(async () => {
    if (!draft) return;
    const vp = await ipc('vault:get-path');
    const safeName = draft.title.replace(/[<>:"/\\|?*]/g, '').slice(0, 80);
    const path = `${vp}/_drafts/${safeName}.md`;
    await ipc('vault:create-file', path, draft.content);
    openFile(path, `Draft: ${draft.title}`, draft.content);
  }, [draft, openFile]);

  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, color: 'var(--ink)' }}>
        {t('panel.ai.expressTitle')}
      </div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
        <input
          type="text"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void handleGenerate(); }}
          placeholder={t('panel.ai.draftPlaceholder')}
          aria-label="Draft topic"
          style={{
            flex: 1, background: 'var(--hover)', border: '1px solid var(--border)',
            borderRadius: 4, padding: '6px 10px', fontSize: 12, color: 'var(--ink)', outline: 'none',
          }}
        />
      </div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        {(['outline', 'blog'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFormat(f)}
            style={{
              padding: '4px 12px', fontSize: 11, border: 'none', borderRadius: 4, cursor: 'pointer',
              background: format === f ? 'var(--selection)' : 'var(--hover)',
              color: format === f ? 'var(--accent-2)' : 'var(--ink-dim)',
            }}
          >
            {f === 'outline' ? t('panel.ai.formatOutline') : t('panel.ai.formatBlogPost')}
          </button>
        ))}
        <button
          onClick={() => void handleGenerate()}
          disabled={loading || !topic.trim()}
          style={{
            marginLeft: 'auto', padding: '4px 14px', background: 'var(--accent)',
            border: 'none', borderRadius: 4, color: '#fff', fontSize: 11, cursor: 'pointer',
            opacity: loading || !topic.trim() ? 0.5 : 1,
          }}
        >
          {loading ? t('panel.ai.generating') : t('panel.ai.generateButton')}
        </button>
      </div>

      {draft && (
        <div style={{
          background: 'var(--hover)', border: '1px solid var(--border)',
          borderRadius: 6, padding: 12, fontSize: 12, lineHeight: 1.6,
        }}>
          <pre style={{
            whiteSpace: 'pre-wrap', fontFamily: 'inherit', margin: 0,
            color: 'var(--ink)', maxHeight: 300, overflowY: 'auto',
          }}>
            {draft.content}
          </pre>
          <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
            <button
              onClick={() => void handleSave()}
              style={{
                padding: '6px 14px', background: 'var(--accent)', border: 'none',
                borderRadius: 4, color: '#fff', fontSize: 11, cursor: 'pointer',
              }}
            >
              {t('panel.ai.saveDraftButton')}
            </button>
            <span style={{ fontSize: 10, color: 'var(--ink-faint)', alignSelf: 'center' }}>
              {draft.sources.length} {t('panel.ai.sourcesUsed')}
            </span>
          </div>
        </div>
      )}

      {!draft && !loading && (
        <div style={{ textAlign: 'center', color: 'var(--ink-faint)', fontSize: 11, padding: 20 }}>
          {t('panel.ai.draftHint')}
        </div>
      )}
    </div>
  );
}
