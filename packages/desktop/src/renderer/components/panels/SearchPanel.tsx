// Search Panel (Stage C, plan W1-4) — full-text search over the vault via
// core hybrid search. Supports `tag:x` / `path:y` operators (parsed in the
// renderer, plan §4-D), a [Hybrid|Keyword] mode toggle, debounced live search,
// grouped results with <mark> term highlighting, and a 'semantic' score badge.

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useAppStore } from '../../stores/app-store.js';
import { ipc, searchQuery, type SearchQueryOpts } from '../../lib/ipc-client.js';
import type { SearchResult } from '../../../shared/ipc-types.js';

type SearchMode = 'hybrid' | 'keyword';

interface ParsedQuery {
  text: string;
  tags: string[];
  pathPrefix?: string;
}

/** Extract `tag:xxx` / `path:yyy` operator tokens; the rest is the text query. */
export function parseSearchQuery(raw: string): ParsedQuery {
  const tags: string[] = [];
  let pathPrefix: string | undefined;
  const text = raw
    .replace(/(^|\s)tag:(\S+)/gi, (_m, lead: string, tag: string) => {
      tags.push(tag.replace(/^#/, ''));
      return lead;
    })
    .replace(/(^|\s)path:(\S+)/gi, (_m, lead: string, p: string) => {
      pathPrefix = p;
      return lead;
    })
    .replace(/\s+/g, ' ')
    .trim();
  return { text, tags, pathPrefix };
}

/** Plain-text term highlighting — React escapes text nodes, so no HTML injection. */
function Highlighted({ text, terms }: { text: string; terms: string[] }) {
  const clean = terms.map((t) => t.trim()).filter((t) => t.length > 1);
  if (clean.length === 0 || !text) return <>{text}</>;
  const escaped = clean.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  let parts: string[];
  try {
    parts = text.split(new RegExp(`(${escaped.join('|')})`, 'gi'));
  } catch {
    return <>{text}</>;
  }
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <mark
            key={i}
            style={{ background: 'var(--selection)', color: 'var(--accent-2)', padding: '0 1px', borderRadius: 2 }}
          >
            {p}
          </mark>
        ) : (
          p
        ),
      )}
    </>
  );
}

export function SearchPanel() {
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<SearchMode>('hybrid');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const requestSeq = useRef(0);

  const openFile = useAppStore((s) => s.openFile);
  const pendingSearchQuery = useAppStore((s) => s.pendingSearchQuery);
  const clearPendingSearchQuery = useAppStore((s) => s.clearPendingSearchQuery);
  const coreReady = useAppStore((s) => s.coreReady);

  const parsed = useMemo(() => parseSearchQuery(query), [query]);
  const highlightTerms = useMemo(
    () => parsed.text.split(/\s+/).filter(Boolean),
    [parsed.text],
  );

  const runSearch = useCallback(async (raw: string, m: SearchMode) => {
    const { text, tags, pathPrefix } = parseSearchQuery(raw);
    if (!text && tags.length === 0 && !pathPrefix) {
      setResults([]);
      setSearched(false);
      setError(null);
      return;
    }
    const seq = ++requestSeq.current;
    setLoading(true);
    setError(null);
    try {
      const opts: SearchQueryOpts = {
        mode: m,
        limit: 30,
        ...(tags.length > 0 ? { tags } : {}),
        ...(pathPrefix ? { pathPrefix } : {}),
      };
      const r = await searchQuery(text, opts);
      if (seq !== requestSeq.current) return; // stale response
      setResults(r);
      setSearched(true);
    } catch (err) {
      if (seq !== requestSeq.current) return;
      setError(err instanceof Error ? err.message : String(err));
      setResults([]);
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, []);

  // Autofocus on mount.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Consume a cross-panel query hand-off (e.g. TagsPanel tag click).
  useEffect(() => {
    if (pendingSearchQuery == null) return;
    setQuery(pendingSearchQuery);
    clearPendingSearchQuery();
    void runSearch(pendingSearchQuery, mode);
    inputRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingSearchQuery]);

  // Debounced live search (300ms); Enter triggers immediately.
  useEffect(() => {
    const t = setTimeout(() => void runSearch(query, mode), 300);
    return () => clearTimeout(t);
  }, [query, mode, runSearch]);

  // Group results by file (a file can yield multiple chunk hits).
  const groups = useMemo(() => {
    const byFile = new Map<string, { title: string; filePath: string; items: SearchResult[] }>();
    for (const r of results) {
      const g = byFile.get(r.filePath);
      if (g) g.items.push(r);
      else byFile.set(r.filePath, { title: r.title, filePath: r.filePath, items: [r] });
    }
    return [...byFile.values()];
  }, [results]);

  const openResult = useCallback(async (r: SearchResult) => {
    try {
      const content = await ipc('vault:read-file', r.filePath);
      openFile(r.filePath, r.title, content);
    } catch (err) {
      console.error('[SearchPanel] Failed to open file:', err);
      setError(`Could not open ${r.filePath}`);
    }
  }, [openFile]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: 10, borderBottom: '1px solid var(--border)' }}>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void runSearch(query, mode); }}
          placeholder="Search… (tag:x path:y operators)"
          aria-label="Search vault"
          style={{
            width: '100%',
            boxSizing: 'border-box',
            background: 'var(--hover)',
            border: '1px solid var(--border)',
            borderRadius: 4,
            padding: '6px 10px',
            fontSize: 12,
            color: 'var(--ink)',
            outline: 'none',
          }}
        />
        <div style={{ display: 'flex', gap: 6, marginTop: 8, alignItems: 'center' }}>
          {(['hybrid', 'keyword'] as SearchMode[]).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              aria-pressed={mode === m}
              style={{
                padding: '3px 12px',
                fontSize: 11,
                border: 'none',
                borderRadius: 4,
                cursor: 'pointer',
                background: mode === m ? 'var(--selection)' : 'var(--hover)',
                color: mode === m ? 'var(--accent-2)' : 'var(--ink-dim)',
                fontWeight: mode === m ? 600 : 400,
              }}
            >
              {m === 'hybrid' ? 'Hybrid' : 'Keyword'}
            </button>
          ))}
          {(parsed.tags.length > 0 || parsed.pathPrefix) && (
            <span style={{ marginLeft: 'auto', fontSize: 9, color: 'var(--ink-faint)' }}>
              {parsed.tags.map((t) => `#${t}`).join(' ')}
              {parsed.pathPrefix ? ` path:${parsed.pathPrefix}` : ''}
            </span>
          )}
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: 10 }}>
        {!coreReady && (
          <div style={{ textAlign: 'center', color: 'var(--ink-faint)', fontSize: 11, padding: 20 }}>
            AI engine is still loading — search will be available shortly.
          </div>
        )}

        {error && (
          <div style={{
            padding: '8px 10px', marginBottom: 8, borderRadius: 4, fontSize: 11,
            background: 'var(--hover)', border: '1px solid #ef4444', color: '#ef4444',
          }}>
            {error}
          </div>
        )}

        {loading && (
          <div style={{ textAlign: 'center', color: 'var(--ink-faint)', fontSize: 11, padding: 20 }}>
            Searching…
          </div>
        )}

        {!loading && !error && groups.map((g) => (
          <div key={g.filePath} style={{ marginBottom: 8 }}>
            <div
              onClick={() => void openResult(g.items[0])}
              style={{
                padding: '8px 10px',
                borderRadius: 4,
                cursor: 'pointer',
                background: 'var(--hover)',
                border: '1px solid var(--border)',
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--accent)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border)'; }}
            >
              <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink)', display: 'flex', alignItems: 'baseline', gap: 6 }}>
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  <Highlighted text={g.title} terms={highlightTerms} />
                </span>
                {mode === 'hybrid' && (
                  <span style={{
                    fontSize: 9, padding: '1px 6px', borderRadius: 3,
                    background: 'var(--selection)', color: 'var(--accent-2)', flexShrink: 0,
                  }}>
                    semantic
                  </span>
                )}
                <span style={{ fontSize: 10, color: 'var(--accent-2)', flexShrink: 0 }}>
                  {Math.round((g.items[0]?.score ?? 0) * 100)}%
                </span>
              </div>
              <div style={{ fontSize: 9, color: 'var(--ink-faint)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {g.filePath}
              </div>
              {g.items.map((r, i) => r.snippet ? (
                <div key={`${r.id}-${i}`} style={{ fontSize: 11, color: 'var(--ink-dim)', lineHeight: 1.4, marginTop: 4 }}>
                  <Highlighted text={r.snippet.slice(0, 180)} terms={highlightTerms} />
                </div>
              ) : null)}
            </div>
          </div>
        ))}

        {!loading && !error && searched && groups.length === 0 && (
          <div style={{ textAlign: 'center', color: 'var(--ink-faint)', fontSize: 11, padding: 20 }}>
            No results. Try different keywords, or remove tag:/path: filters.
          </div>
        )}

        {!loading && !error && !searched && !query && (
          <div style={{ textAlign: 'center', color: 'var(--ink-faint)', fontSize: 11, padding: 20, lineHeight: 1.7 }}>
            Hybrid search combines semantic + keyword signals.<br />
            Operators: <code style={{ fontSize: 10 }}>tag:project</code>{' '}
            <code style={{ fontSize: 10 }}>path:Daily/</code>
          </div>
        )}
      </div>
    </div>
  );
}
