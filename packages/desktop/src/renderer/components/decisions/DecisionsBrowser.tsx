// T3-5: Decisions browser — lists past decisions (from <vault>/decisions/) with
// search, plus the knowledge-evolution timeline (which notes changed most
// recently — a proxy for how the knowledge base is drifting). Both are read via
// the 'decision:list' / 'decision:evolution' IPC. Clicking a decision opens it.

import { useState, useEffect, useCallback } from 'react';
import { Modal } from '../ui/Modal.js';
import { ipc } from '../../lib/ipc-client.js';
import { useAppStore } from '../../stores/app-store.js';
import { useDecisionsUi } from './decisions-store.js';
import type { DecisionEntry, EvolutionEntry } from '../../../shared/ipc-types.js';

export function DecisionsBrowser() {
  const open = useDecisionsUi((s) => s.browserOpen);
  const close = useDecisionsUi((s) => s.closeBrowser);
  const openCapture = useDecisionsUi((s) => s.openCapture);
  const openFile = useAppStore((s) => s.openFile);

  const [tab, setTab] = useState<'decisions' | 'evolution'>('decisions');
  const [query, setQuery] = useState('');
  const [decisions, setDecisions] = useState<DecisionEntry[]>([]);
  const [evolution, setEvolution] = useState<EvolutionEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const loadDecisions = useCallback(async (q: string) => {
    setLoading(true);
    try {
      setDecisions(await ipc('decision:list', q || undefined));
    } catch (err) {
      console.error('[decisions] list failed:', err);
      setDecisions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadEvolution = useCallback(async () => {
    setLoading(true);
    try {
      setEvolution(await ipc('decision:evolution', 12));
    } catch (err) {
      console.error('[decisions] evolution failed:', err);
      setEvolution([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Load on open + whenever the tab changes.
  useEffect(() => {
    if (!open) return;
    if (tab === 'decisions') void loadDecisions(query);
    else void loadEvolution();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tab]);

  const openEntry = useCallback(async (filePath: string, title: string) => {
    if (!filePath) return;
    try {
      const content = await ipc('vault:read-file', filePath);
      openFile(filePath, title, content);
      close();
    } catch (err) {
      console.error('[decisions] open failed:', err);
    }
  }, [openFile, close]);

  return (
    <Modal open={open} onClose={close} title="Decisions" width={560}>
      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 12, borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
        {(['decisions', 'evolution'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: '5px 12px', fontSize: 12, border: 'none', borderRadius: 5, cursor: 'pointer',
              background: tab === t ? 'var(--selection)' : 'transparent',
              color: tab === t ? 'var(--accent-2)' : 'var(--ink-dim)',
            }}
          >
            {t === 'decisions' ? 'Decision log' : 'Evolution'}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button
          onClick={() => { close(); openCapture(); }}
          style={{ padding: '5px 12px', fontSize: 12, background: 'var(--accent)', border: 'none', borderRadius: 5, color: '#fff', cursor: 'pointer' }}
        >
          + Log decision
        </button>
      </div>

      {tab === 'decisions' && (
        <>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void loadDecisions(query); }}
            placeholder="Search decisions… (Enter)"
            aria-label="Search decisions"
            style={{
              width: '100%', boxSizing: 'border-box', background: 'var(--hover)',
              border: '1px solid var(--border)', borderRadius: 4, padding: '7px 10px',
              fontSize: 12, color: 'var(--ink)', outline: 'none', marginBottom: 10,
            }}
          />
          {loading && <Skeleton />}
          {!loading && decisions.length === 0 && (
            <Empty text="No decisions yet. Log one to start your ADR history." />
          )}
          {decisions.map((d) => (
            <Row
              key={d.fileName}
              onClick={() => void openEntry(d.filePath, d.title)}
              title={d.title}
              meta={[d.date, d.project].filter(Boolean).join(' · ')}
              sub={firstBodyLine(d.snippet)}
            />
          ))}
        </>
      )}

      {tab === 'evolution' && (
        <>
          <div style={{ fontSize: 10, color: 'var(--ink-faint)', marginBottom: 10, lineHeight: 1.5 }}>
            Notes whose meaning has shifted most recently — where your knowledge is actively evolving.
          </div>
          {loading && <Skeleton />}
          {!loading && evolution.length === 0 && (
            <Empty text="Nothing to show — index the vault first." />
          )}
          {evolution.map((e) => (
            <Row
              key={e.documentId || e.title}
              onClick={e.filePath ? () => void openEntry(e.filePath, e.title) : undefined}
              title={e.title}
              meta={`${e.daysSinceModified}d ago${e.tags.length ? ' · ' + e.tags.slice(0, 3).join(', ') : ''}`}
            />
          ))}
        </>
      )}
    </Modal>
  );
}

function firstBodyLine(snippet: string): string {
  // Skip frontmatter + heading to show a meaningful preview line.
  const lines = snippet.split('\n').map((l) => l.trim());
  for (const l of lines) {
    if (!l || l === '---' || l.startsWith('title:') || l.startsWith('date:') ||
        l.startsWith('project:') || l.startsWith('type:') || l.startsWith('#')) continue;
    return l.slice(0, 120);
  }
  return '';
}

function Row({ title, meta, sub, onClick }: { title: string; meta?: string; sub?: string; onClick?: () => void }) {
  const clickable = !!onClick;
  return (
    <div
      onClick={onClick}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={clickable ? (e) => { if (e.key === 'Enter') onClick!(); } : undefined}
      style={{
        padding: '8px 10px', marginBottom: 6, borderRadius: 4,
        background: 'var(--hover)', border: '1px solid var(--border)',
        cursor: clickable ? 'pointer' : 'default',
      }}
      onMouseEnter={clickable ? (e) => { (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--accent)'; } : undefined}
      onMouseLeave={clickable ? (e) => { (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border)'; } : undefined}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {title}
        </span>
        {meta && <span style={{ fontSize: 9, color: 'var(--ink-faint)', flexShrink: 0 }}>{meta}</span>}
      </div>
      {sub && <div style={{ fontSize: 10, color: 'var(--ink-dim)', marginTop: 3, lineHeight: 1.4 }}>{sub}</div>}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div style={{ textAlign: 'center', color: 'var(--ink-faint)', fontSize: 11, padding: 24 }}>{text}</div>;
}

function Skeleton() {
  return (
    <div aria-label="Loading">
      {[100, 88, 72].map((w, i) => (
        <div key={i} style={{ height: 12, width: `${w}%`, marginBottom: 8, borderRadius: 4, background: 'var(--hover)', opacity: 0.8 - i * 0.2 }} />
      ))}
    </div>
  );
}
