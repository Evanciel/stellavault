// Shared relationship lists — backlinks + semantically-related notes for a given
// note, parameterized by {title, filePath, onOpen} instead of reading activeTabId.
// Used by BacklinksPanel (right-panel 'backlinks', centered on the active editor
// tab) and the NotePreviewPanel explorer's Backlinks segment (centered on the
// PREVIEW note). Extracted from BacklinksPanel so both contexts share one source.

import { useEffect, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { ipc } from '../../lib/ipc-client.js';
import { invokeIpcRaw } from '../../lib/runtime-sync.js';
import type { SearchResult } from '../../../shared/ipc-types.js';

export interface OpenTarget { filePath: string; title: string; }
// ev is forwarded so callers can branch on modifier keys (Ctrl/Cmd-click = open a
// real editor tab; plain click = re-center the preview).
export type OnOpen = (target: OpenTarget, ev: ReactMouseEvent) => void;

interface Backlink { filePath: string; name: string; line: string; }
type Mode = 'backlinks' | 'related';

// Backlinks + Related as a two-tab strip — the exact UI BacklinksPanel had,
// now driven by props so the preview explorer can mount it on the preview note.
export function RelationLists({ title, filePath, onOpen }: { title: string; filePath: string; onOpen: OnOpen }) {
  const [mode, setMode] = useState<Mode>('backlinks');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
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
          ? <BacklinksList title={title} filePath={filePath} onOpen={onOpen} />
          : <RelatedList title={title} filePath={filePath} onOpen={onOpen} />}
      </div>
    </div>
  );
}

// A clickable note row (title + optional snippet + optional score). Exported so the
// Outlinks segment can reuse the same visual for resolved wikilink targets.
export function NoteRow({ title, snippet, score, onOpen }: {
  title: string;
  snippet?: string;
  score?: number;
  onOpen: (ev: ReactMouseEvent) => void;
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

export function BacklinksList({ title, filePath, onOpen }: { title: string; filePath: string; onOpen: OnOpen }) {
  const [backlinks, setBacklinks] = useState<Backlink[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!title) { setBacklinks([]); return; }
    let alive = true;
    setLoading(true);
    void ipc('backlinks:find', title).then((results) => {
      if (!alive) return; // a newer re-center superseded this fetch
      setBacklinks(results.filter((r) => r.filePath !== filePath)); // exclude self
      setLoading(false);
    });
    return () => { alive = false; };
  }, [title, filePath]);

  return (
    <div style={{ padding: 12 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)', marginBottom: 8 }}>
        Backlinks to "{title}"
      </div>

      {loading && (
        <div style={{ color: 'var(--ink-faint)', fontSize: 11 }}>Scanning vault...</div>
      )}

      {!loading && backlinks.length === 0 && (
        <div style={{ color: 'var(--ink-faint)', fontSize: 11, padding: 12, textAlign: 'center' }}>
          No notes link to this note yet.
          <div style={{ marginTop: 4, fontSize: 10 }}>
            Use [[{title}]] in other notes to create backlinks.
          </div>
        </div>
      )}

      {backlinks.map((bl) => (
        <NoteRow
          key={bl.filePath}
          title={bl.name}
          snippet={bl.line || undefined}
          onOpen={(ev) => onOpen({ filePath: bl.filePath, title: bl.name }, ev)}
        />
      ))}

      {backlinks.length > 0 && (
        <div style={{ marginTop: 12, fontSize: 10, color: 'var(--ink-faint)' }}>
          {backlinks.length} backlink{backlinks.length !== 1 ? 's' : ''}
        </div>
      )}
    </div>
  );
}

export function RelatedList({ title, filePath, onOpen }: { title: string; filePath: string; onOpen: OnOpen }) {
  const [related, setRelated] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!filePath) { setRelated([]); return; }
    let alive = true;
    setLoading(true);
    setError(null);
    invokeIpcRaw<SearchResult[]>('core:related', filePath, 10)
      .then((results) => {
        if (!alive) return;
        setRelated(results.filter((r) => r.filePath !== filePath));
        setLoading(false);
      })
      .catch((err) => {
        if (!alive) return;
        setRelated([]);
        setError(err instanceof Error ? err.message : 'Failed to load related notes.');
        setLoading(false);
      });
    return () => { alive = false; };
  }, [filePath]);

  return (
    <div style={{ padding: 12 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)', marginBottom: 8 }}>
        Related to "{title}"
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
          onOpen={(ev) => onOpen({ filePath: r.filePath, title: r.title }, ev)}
        />
      ))}
    </div>
  );
}
