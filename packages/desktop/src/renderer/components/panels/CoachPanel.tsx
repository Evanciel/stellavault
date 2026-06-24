// Coach Panel (T2-6) — surfaces the dormant differentiators that have shipped in
// core but had zero IPC hits: knowledge gaps ("what you don't know yet") and a
// learning path ("review these next"). FSRS decay + gap detection is the
// retention engine no competitor surfaces; this panel is its front door.
//
// Two sections:
//   • Knowledge gaps  — isolated notes + weak cluster bridges + predicted topics
//   • Learning path   — fused review/explore/bridge list, clickable to open
//
// Data comes from the additive 'core:gaps' / 'core:learning-path' IPC channels
// (main wires detectKnowledgeGaps / predictKnowledgeGaps / generateLearningPath).

import { useState, useCallback, useEffect } from 'react';
import { useAppStore } from '../../stores/app-store.js';
import { ipc } from '../../lib/ipc-client.js';
import { registerCommand } from '../../lib/commands.js';
import { useT } from '../../lib/i18n.js';
import type { CoachGaps, CoachLearningPath, ContradictionNudge, DuplicateNudge } from '../../../shared/ipc-types.js';

// Palette command + default hotkey via the registry (mirrors AIPanel's pattern).
let coachCommandsRegistered = false;
function registerCoachCommands(): void {
  if (coachCommandsRegistered) return;
  coachCommandsRegistered = true;
  registerCommand({
    id: 'panel.coach', title: 'Open Coach (gaps + learning path)', category: 'Panels',
    defaultKeys: 'mod+shift+k',
    run: () => useAppStore.getState().setRightPanel('coach'),
  });
}
registerCoachCommands();

const PRIORITY_COLOR: Record<string, string> = {
  critical: '#e5484d',
  important: '#d97706',
  suggested: 'var(--ink-faint)',
};
const SEVERITY_COLOR: Record<string, string> = {
  high: '#e5484d',
  medium: '#d97706',
  low: 'var(--ink-faint)',
};
const CATEGORY_LABEL: Record<string, string> = {
  review: 'Review',
  explore: 'Explore',
  bridge: 'Bridge',
};

export function CoachPanel() {
  const t = useT();
  const coreReady = useAppStore((s) => s.coreReady);
  const openFile = useAppStore((s) => s.openFile);

  const [gaps, setGaps] = useState<CoachGaps | null>(null);
  const [path, setPath] = useState<CoachLearningPath | null>(null);
  // T3-8: duplicate + contradiction nudges (additive — own fetch, never blocks the
  // gaps/path render if these fail or the core lacks the engines).
  const [dupes, setDupes] = useState<DuplicateNudge[]>([]);
  const [contradictions, setContradictions] = useState<ContradictionNudge[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [g, p] = await Promise.all([
        ipc('core:gaps'),
        ipc('core:learning-path', 15),
      ]);
      setGaps(g);
      setPath(p);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Coach analysis failed. Is the vault indexed?');
    } finally {
      setLoading(false);
    }
    // T3-8: fetch nudges independently — a failure here must not surface as a
    // Coach error or block the gaps/path above. Empty arrays on failure.
    try {
      const [d, c] = await Promise.all([
        ipc('core:duplicates', 8),
        ipc('core:contradictions', 8),
      ]);
      setDupes(d);
      setContradictions(c);
    } catch {
      setDupes([]);
      setContradictions([]);
    }
  }, []);

  // Load once the core is ready; recompute on demand via the refresh button.
  useEffect(() => {
    if (coreReady && gaps === null && !loading) void refresh();
  }, [coreReady, gaps, loading, refresh]);

  const open = useCallback(async (filePath: string, title: string) => {
    if (!filePath) return;
    const content = await ipc('vault:read-file', filePath);
    openFile(filePath, title, content);
  }, [openFile]);

  if (!coreReady) {
    return (
      <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-faint)', fontSize: 12 }}>
        <div style={{ fontSize: 24, marginBottom: 8, opacity: 0.3 }}>&#x2726;</div>
        {t('panel.coach.loading')}
      </div>
    );
  }

  const isEmpty =
    !loading &&
    gaps !== null &&
    path !== null &&
    gaps.gaps.length === 0 &&
    gaps.isolated.length === 0 &&
    gaps.predicted.length === 0 &&
    path.items.length === 0 &&
    dupes.length === 0 &&
    contradictions.length === 0;

  return (
    <div style={{ padding: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)' }}>{t('panel.coach.title')}</div>
        <button
          onClick={() => void refresh()}
          disabled={loading}
          title={t('panel.coach.refreshTooltip')}
          style={{
            padding: '2px 10px', fontSize: 10, cursor: loading ? 'default' : 'pointer',
            background: 'transparent', border: '1px solid var(--border)', borderRadius: 3,
            color: 'var(--ink-dim)', opacity: loading ? 0.5 : 1,
          }}
        >
          {loading ? '...' : t('panel.coach.refreshButton')}
        </button>
      </div>
      <div style={{ fontSize: 10, color: 'var(--ink-faint)', marginBottom: 12, lineHeight: 1.5 }}>
        {t('panel.coach.description')}
      </div>

      {error && (
        <div style={{ fontSize: 11, color: 'var(--ink-dim)', padding: 10, background: 'var(--hover)', borderRadius: 4, marginBottom: 8 }}>
          {error}
        </div>
      )}

      {loading && gaps === null && (
        <div style={{ marginTop: 8 }} aria-label="Analyzing vault">
          {[100, 88, 72].map((w, i) => (
            <div key={i} style={{
              height: 10, width: `${w}%`, marginBottom: 8, borderRadius: 4,
              background: 'var(--hover)', opacity: 0.8 - i * 0.2,
            }} />
          ))}
        </div>
      )}

      {isEmpty && (
        <div style={{ textAlign: 'center', color: 'var(--ink-faint)', fontSize: 11, padding: 20 }}>
          {t('panel.coach.noGaps')} &#x2726;
        </div>
      )}

      {/* ─── Learning path ("review these next") ─── */}
      {path && path.items.length > 0 && (
        <section style={{ marginBottom: 18 }}>
          <SectionHeader
            title={t('panel.coach.learningPathTitle')}
            hint={t('panel.coach.learningPathSummary', {
              reviewCount: path.summary.reviewCount,
              bridgeCount: path.summary.bridgeCount,
              estimatedMinutes: path.summary.estimatedMinutes,
            })}
          />
          {path.items.map((it, i) => {
            const clickable = !!it.filePath;
            return (
              <div
                key={`${it.documentId || it.title}-${i}`}
                onClick={clickable ? () => void open(it.filePath, it.title) : undefined}
                role={clickable ? 'button' : undefined}
                tabIndex={clickable ? 0 : undefined}
                onKeyDown={clickable ? (e) => { if (e.key === 'Enter') void open(it.filePath, it.title); } : undefined}
                style={{
                  padding: '8px 10px', marginBottom: 6, borderRadius: 4,
                  background: 'var(--hover)', border: '1px solid var(--border)',
                  cursor: clickable ? 'pointer' : 'default',
                }}
                onMouseEnter={clickable ? (e) => { (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--accent)'; } : undefined}
                onMouseLeave={clickable ? (e) => { (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border)'; } : undefined}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                  <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {it.title}
                  </div>
                  <span style={{ fontSize: 9, color: 'var(--ink-faint)', flexShrink: 0, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    {CATEGORY_LABEL[it.category] ?? it.category}
                  </span>
                </div>
                <div style={{ fontSize: 10, color: 'var(--ink-dim)', marginTop: 3, lineHeight: 1.4 }}>
                  {it.reason}
                </div>
                <div style={{ marginTop: 5, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{
                    fontSize: 9, padding: '1px 6px', borderRadius: 3,
                    color: '#fff', background: PRIORITY_COLOR[it.priority] ?? 'var(--ink-faint)',
                  }}>
                    {it.priority}
                  </span>
                  {!clickable && (
                    <span style={{ fontSize: 9, color: 'var(--ink-faint)', fontStyle: 'italic' }}>
                      {t('panel.coach.noNoteYet')}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </section>
      )}

      {/* ─── Knowledge gaps ("what you don't know yet") ─── */}
      {gaps && (gaps.isolated.length > 0 || gaps.gaps.length > 0 || gaps.predicted.length > 0) && (
        <section>
          <SectionHeader
            title={t('panel.coach.gapsTitle')}
            hint={gaps.totalGaps > 0 ? t('panel.coach.gapsSummary', { totalGaps: gaps.totalGaps, totalClusters: gaps.totalClusters }) : undefined}
          />

          {gaps.isolated.length > 0 && (
            <>
              <SubLabel>{t('panel.coach.isolatedNotesLabel')}</SubLabel>
              {gaps.isolated.map((n, i) => {
                const clickable = !!n.filePath;
                return (
                  <div
                    key={`${n.documentId || n.title}-${i}`}
                    onClick={clickable ? () => void open(n.filePath, n.title) : undefined}
                    role={clickable ? 'button' : undefined}
                    tabIndex={clickable ? 0 : undefined}
                    onKeyDown={clickable ? (e) => { if (e.key === 'Enter') void open(n.filePath, n.title); } : undefined}
                    style={{
                      padding: '6px 10px', marginBottom: 4, borderRadius: 4,
                      background: 'var(--hover)', border: '1px solid var(--border)',
                      cursor: clickable ? 'pointer' : 'default',
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
                    }}
                    onMouseEnter={clickable ? (e) => { (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--accent)'; } : undefined}
                    onMouseLeave={clickable ? (e) => { (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border)'; } : undefined}
                  >
                    <span style={{ fontSize: 11, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {n.title}
                    </span>
                    <span style={{ fontSize: 9, color: 'var(--ink-faint)', flexShrink: 0 }}>
                      {t('panel.coach.connectionCount', { count: n.connections })}
                    </span>
                  </div>
                );
              })}
            </>
          )}

          {gaps.gaps.length > 0 && (
            <>
              <SubLabel>{t('panel.coach.missingBridgesLabel')}</SubLabel>
              {gaps.gaps.map((g, i) => (
                <div
                  key={`${g.clusterA}-${g.clusterB}-${i}`}
                  style={{
                    padding: '6px 10px', marginBottom: 4, borderRadius: 4,
                    background: 'var(--hover)', border: '1px solid var(--border)',
                  }}
                >
                  <div style={{ fontSize: 11, color: 'var(--ink)' }}>
                    {t('panel.coach.clusterPair', { clusterA: g.clusterA, clusterB: g.clusterB })}
                  </div>
                  {g.suggestedTopic && (
                    <div style={{ fontSize: 10, color: 'var(--ink-dim)', marginTop: 2 }}>
                      {t('panel.coach.suggestedBridge', { suggestedTopic: g.suggestedTopic })}
                    </div>
                  )}
                  <span style={{ fontSize: 9, color: SEVERITY_COLOR[g.severity] ?? 'var(--ink-faint)' }}>
                    {t('panel.coach.bridgeCountLabel', { severity: g.severity, bridgeCount: g.bridgeCount })}
                  </span>
                </div>
              ))}
            </>
          )}

          {gaps.predicted.length > 0 && (
            <>
              <SubLabel>{t('panel.coach.topicsWorthExploringLabel')}</SubLabel>
              {gaps.predicted.map((p, i) => (
                <div
                  key={`${p.topic}-${i}`}
                  style={{
                    padding: '6px 10px', marginBottom: 4, borderRadius: 4,
                    background: 'var(--hover)', border: '1px solid var(--border)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                    <span style={{ fontSize: 11, color: 'var(--ink)' }}>{p.topic}</span>
                    <span style={{ fontSize: 9, color: 'var(--ink-faint)', flexShrink: 0 }}>
                      {t('panel.coach.confidencePercent', { confidence: Math.round(p.confidence * 100) })}
                    </span>
                  </div>
                  {p.reason && (
                    <div style={{ fontSize: 10, color: 'var(--ink-dim)', marginTop: 2, lineHeight: 1.4 }}>
                      {p.reason}
                    </div>
                  )}
                </div>
              ))}
            </>
          )}
        </section>
      )}

      {/* ─── T3-8: Review — possible duplicates / contradictions ─── */}
      {(dupes.length > 0 || contradictions.length > 0) && (
        <section style={{ marginTop: 18 }}>
          <SectionHeader
            title={t('panel.coach.reviewDupesTitle')}
            hint={t('panel.coach.reviewDupesHint')}
          />

          {dupes.length > 0 && (
            <>
              <SubLabel>{t('panel.coach.possibleDupesLabel')}</SubLabel>
              {dupes.map((d, i) => (
                <div
                  key={`dup-${i}`}
                  style={{
                    padding: '6px 10px', marginBottom: 4, borderRadius: 4,
                    background: 'var(--hover)', border: '1px solid var(--border)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <PairLink title={d.docA.title} filePath={d.docA.filePath} open={open} />
                    <span style={{ color: 'var(--ink-faint)', fontSize: 10 }}>&harr;</span>
                    <PairLink title={d.docB.title} filePath={d.docB.filePath} open={open} />
                    <span style={{ marginLeft: 'auto', fontSize: 9, color: 'var(--ink-faint)' }}>
                      {t('panel.coach.similarityPercent', { similarity: Math.round(d.similarity * 100) })}
                    </span>
                  </div>
                </div>
              ))}
            </>
          )}

          {contradictions.length > 0 && (
            <>
              <SubLabel>{t('panel.coach.possibleContradictionsLabel')}</SubLabel>
              {contradictions.map((c, i) => (
                <div
                  key={`con-${i}`}
                  style={{
                    padding: '6px 10px', marginBottom: 4, borderRadius: 4,
                    background: 'var(--hover)', border: '1px solid var(--border)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <PairLink title={c.docA.title} filePath={c.docA.filePath} open={open} />
                    <span style={{ color: '#e5484d', fontSize: 10 }}>&ne;</span>
                    <PairLink title={c.docB.title} filePath={c.docB.filePath} open={open} />
                    <span style={{ marginLeft: 'auto', fontSize: 9, color: 'var(--ink-faint)' }}>
                      {t('panel.coach.contradictionConfidence', { confidence: Math.round(c.confidence * 100), type: c.type })}
                    </span>
                  </div>
                  {(c.docA.statement || c.docB.statement) && (
                    <div style={{ fontSize: 10, color: 'var(--ink-dim)', marginTop: 3, lineHeight: 1.4 }}>
                      &ldquo;{(c.docA.statement || '').slice(0, 90)}&rdquo; vs &ldquo;{(c.docB.statement || '').slice(0, 90)}&rdquo;
                    </div>
                  )}
                </div>
              ))}
            </>
          )}
        </section>
      )}
    </div>
  );
}

// One side of a duplicate/contradiction pair — clickable when a note backs it.
function PairLink({ title, filePath, open }: { title: string; filePath: string; open: (fp: string, t: string) => void }) {
  const clickable = !!filePath;
  return (
    <span
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={clickable ? () => open(filePath, title) : undefined}
      onKeyDown={clickable ? (e) => { if (e.key === 'Enter') open(filePath, title); } : undefined}
      title={clickable ? `Open ${title}` : title}
      style={{
        fontSize: 11, color: clickable ? 'var(--accent-2)' : 'var(--ink)',
        cursor: clickable ? 'pointer' : 'default',
        textDecoration: clickable ? 'underline' : 'none',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 130,
      }}
    >
      {title}
    </span>
  );
}

function SectionHeader({ title, hint }: { title: string; hint?: string }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 10, color: 'var(--ink-faint)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
        {title}
      </div>
      {hint && (
        <div style={{ fontSize: 9, color: 'var(--ink-faint)', marginTop: 2 }}>{hint}</div>
      )}
    </div>
  );
}

function SubLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 10, color: 'var(--ink-dim)', margin: '8px 0 4px', fontWeight: 500 }}>
      {children}
    </div>
  );
}
