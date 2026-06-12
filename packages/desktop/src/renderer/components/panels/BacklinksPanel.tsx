// Backlinks panel — notes that link to the active note, plus semantically
// related notes (Stage C, W1-16: core getRelated via 'core:related').

import { useEffect, useState } from 'react';
import { useAppStore } from '../../stores/app-store.js';
import { ipc } from '../../lib/ipc-client.js';
import { invokeIpcRaw } from '../../lib/runtime-sync.js';
import type { SearchResult } from '../../../shared/ipc-types.js';

interface Backlink {
  filePath: string;
  name: string;
  line: string;
}

type Mode = 'backlinks' | 'related';

export function BacklinksPanel() {
  const tabs = useAppStore((s) => s.tabs);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const [mode, setMode] = useState<Mode>('backlinks');

  const activeTab = tabs.find((t) => t.id === activeTabId);
  const activeTitle = activeTab?.title ?? '';

  if (!activeTitle) {
    return (
      <div style={{ padding: 20, textAlign: 'center', color: 'var(--ink-faint)', fontSize: 11 }}>
        Open a note to see its backlinks
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Tab bar — same pattern as AIPanel */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', fontSize: 11 }}>
        {(['backlinks', 'related'] as Mode[]).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            aria-selected={mode === m}
            role="tab"
            style={{
              flex: 1,
              padding: '8px 0',
              background: mode === m ? 'var(--selection)' : 'transparent',
              border: 'none',
              color: mode === m ? 'var(--accent-2)' : 'var(--ink-dim)',
              cursor: 'pointer',
              fontWeight: mode === m ? 600 : 400,
              fontSize: 11,
            }}
          >
            {m === 'backlinks' ? 'Backlinks' : 'Related'}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflow: 'auto' }}>
        {mode === 'backlinks'
          ? <BacklinksList activeTitle={activeTitle} activeFilePath={activeTab?.filePath ?? ''} />
          : <RelatedList activeTitle={activeTitle} activeFilePath={activeTab?.filePath ?? ''} />}
      </div>
    </div>
  );
}

function NoteRow({ title, snippet, onOpen, score }: {
  title: string;
  snippet?: string;
  score?: number;
  onOpen: () => void;
}) {
  return (
    <div
      onClick={onOpen}
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
      <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink)' }}>
        {title}
        {score !== undefined && (
          <span style={{ float: 'right', fontSize: 10, color: 'var(--accent-2)' }}>
            {Math.round(score * 100)}%
          </span>
        )}
      </div>
      {snippet && (
        <div style={{ fontSize: 10, color: 'var(--ink-dim)', marginTop: 2, lineHeight: 1.4 }}>
          ...{snippet.slice(0, 100)}...
        </div>
      )}
    </div>
  );
}

function BacklinksList({ activeTitle, activeFilePath }: { activeTitle: string; activeFilePath: string }) {
  const openFile = useAppStore((s) => s.openFile);
  const [backlinks, setBacklinks] = useState<Backlink[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!activeTitle) { setBacklinks([]); return; }
    setLoading(true);
    void ipc('backlinks:find', activeTitle).then((results) => {
      // Exclude self
      setBacklinks(results.filter((r) => r.filePath !== activeFilePath));
      setLoading(false);
    });
  }, [activeTitle, activeFilePath]);

  return (
    <div style={{ padding: 12 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)', marginBottom: 8 }}>
        Backlinks to "{activeTitle}"
      </div>

      {loading && (
        <div style={{ color: 'var(--ink-faint)', fontSize: 11 }}>Scanning vault...</div>
      )}

      {!loading && backlinks.length === 0 && (
        <div style={{ color: 'var(--ink-faint)', fontSize: 11, padding: 12, textAlign: 'center' }}>
          No notes link to this note yet.
          <div style={{ marginTop: 4, fontSize: 10 }}>
            Use [[{activeTitle}]] in other notes to create backlinks.
          </div>
        </div>
      )}

      {backlinks.map((bl) => (
        <NoteRow
          key={bl.filePath}
          title={bl.name}
          snippet={bl.line || undefined}
          onOpen={async () => {
            const content = await ipc('vault:read-file', bl.filePath);
            openFile(bl.filePath, bl.name, content);
          }}
        />
      ))}

      <div style={{ marginTop: 12, fontSize: 10, color: 'var(--ink-faint)' }}>
        {backlinks.length} backlink{backlinks.length !== 1 ? 's' : ''}
      </div>
    </div>
  );
}

function RelatedList({ activeTitle, activeFilePath }: { activeTitle: string; activeFilePath: string }) {
  const openFile = useAppStore((s) => s.openFile);
  const [related, setRelated] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!activeFilePath) { setRelated([]); return; }
    setLoading(true);
    setError(null);
    invokeIpcRaw<SearchResult[]>('core:related', activeFilePath, 10)
      .then((results) => {
        setRelated(results.filter((r) => r.filePath !== activeFilePath));
        setLoading(false);
      })
      .catch((err) => {
        setRelated([]);
        setError(err instanceof Error ? err.message : 'Failed to load related notes.');
        setLoading(false);
      });
  }, [activeFilePath]);

  return (
    <div style={{ padding: 12 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)', marginBottom: 8 }}>
        Related to "{activeTitle}"
      </div>

      {loading && (
        <div style={{ color: 'var(--ink-faint)', fontSize: 11 }}>Finding related notes...</div>
      )}

      {error && !loading && (
        <div style={{ color: 'var(--ink-dim)', fontSize: 11, padding: 10, background: 'var(--hover)', borderRadius: 4 }}>
          {error}
        </div>
      )}

      {!loading && !error && related.length === 0 && (
        <div style={{ color: 'var(--ink-faint)', fontSize: 11, padding: 12, textAlign: 'center' }}>
          No related notes found.
          <div style={{ marginTop: 4, fontSize: 10 }}>
            New notes appear here after indexing.
          </div>
        </div>
      )}

      {related.map((r) => (
        <NoteRow
          key={r.id}
          title={r.title}
          snippet={r.snippet || undefined}
          score={r.score}
          onOpen={async () => {
            const content = await ipc('vault:read-file', r.filePath);
            openFile(r.filePath, r.title, content);
          }}
        />
      ))}
    </div>
  );
}
