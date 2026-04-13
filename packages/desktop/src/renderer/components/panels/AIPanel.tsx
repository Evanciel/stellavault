// AI Panel — semantic search, decay dashboard, ask vault.
// Connects to @stellavault/core via IPC.

import { useState, useCallback, useEffect } from 'react';
import { useAppStore } from '../../stores/app-store.js';
import { ipc } from '../../lib/ipc-client.js';
import type { SearchResult, VaultStats } from '../../../shared/ipc-types.js';

type Tab = 'search' | 'express' | 'decay' | 'stats';

export function AIPanel() {
  const [activeTab, setActiveTab] = useState<Tab>('search');
  const coreReady = useAppStore((s) => s.coreReady);

  if (!coreReady) {
    return (
      <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-faint)', fontSize: 12 }}>
        <div style={{ fontSize: 24, marginBottom: 8, opacity: 0.3 }}>&#x2726;</div>
        Loading AI engine...
        <div style={{ marginTop: 8, fontSize: 10 }}>First run downloads ~30MB model</div>
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
        {(['search', 'express', 'decay', 'stats'] as Tab[]).map((tab) => (
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
            {tab === 'search' ? 'Search' : tab === 'express' ? 'Draft' : tab === 'decay' ? 'Memory' : 'Stats'}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'auto', padding: '12px' }}>
        {activeTab === 'search' && <AISearch />}
        {activeTab === 'express' && <ExpressDraft />}
        {activeTab === 'decay' && <DecayDashboard />}
        {activeTab === 'stats' && <VaultStatsView />}
      </div>
    </div>
  );
}

function AISearch() {
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
          placeholder="Ask your knowledge..."
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
          {loading ? '...' : 'Search'}
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
          No results. Try different keywords.
        </div>
      )}
    </div>
  );
}

function DecayDashboard() {
  const [loaded, setLoaded] = useState(false);

  // P0 fix: move IPC call into useEffect (was firing on every render)
  useEffect(() => {
    if (loaded) return;
    void (async () => {
      try {
        await ipc('core:search', '__decay__', 1);
      } catch { /* ignore */ }
      setLoaded(true);
    })();
  }, [loaded]);

  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 12, color: 'var(--ink)' }}>
        Memory decay
      </div>
      <div style={{ fontSize: 11, color: 'var(--ink-dim)', lineHeight: 1.6 }}>
        Notes you haven't visited recently are fading from memory.
        Use <code style={{ fontSize: 10 }}>stellavault decay</code> in the CLI for the full report.
      </div>
      <div style={{ marginTop: 16, padding: 16, background: 'var(--hover)', borderRadius: 6, textAlign: 'center', fontSize: 11, color: 'var(--ink-faint)' }}>
        Full decay dashboard coming in v0.2
      </div>
    </div>
  );
}

function VaultStatsView() {
  const [stats, setStats] = useState<VaultStats | null>(null);

  // P0 fix: move IPC call into useEffect (was firing on every render)
  useEffect(() => {
    if (stats) return;
    void ipc('core:get-stats').then(setStats).catch(() => {});
  }, [stats]);

  if (!stats) return <div style={{ padding: 20, textAlign: 'center', color: 'var(--ink-faint)', fontSize: 11 }}>Loading...</div>;

  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 16, color: 'var(--ink)' }}>
        Vault statistics
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {[
          { label: 'Documents', value: stats.documentCount },
          { label: 'Chunks', value: stats.chunkCount },
          { label: 'DB size', value: `${(stats.dbSizeBytes / 1024 / 1024).toFixed(1)}MB` },
          { label: 'Last indexed', value: stats.lastIndexed ? new Date(stats.lastIndexed).toLocaleDateString() : 'Never' },
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
        Re-index vault
      </button>
    </div>
  );
}

function ExpressDraft() {
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
        Express — draft from your knowledge
      </div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
        <input
          type="text"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void handleGenerate(); }}
          placeholder="Topic or question..."
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
            {f === 'outline' ? 'Outline' : 'Blog post'}
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
          {loading ? 'Generating...' : 'Generate'}
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
              Save to vault & edit
            </button>
            <span style={{ fontSize: 10, color: 'var(--ink-faint)', alignSelf: 'center' }}>
              {draft.sources.length} sources used
            </span>
          </div>
        </div>
      )}

      {!draft && !loading && (
        <div style={{ textAlign: 'center', color: 'var(--ink-faint)', fontSize: 11, padding: 20 }}>
          Enter a topic and click Generate to create a draft from your vault knowledge.
        </div>
      )}
    </div>
  );
}
