// Agent "Agent" tab — manage durable MEMORY blocks + vault SKILLS (§B).
// Consumes ONLY the existing data IPC (memory:list/get/delete, skill:list/set-promoted). The
// renderer carries opaque UUIDs / skill names — main id-validates every mutation (§B2/§B3). The
// raw memory text is shown (not injection-scanned at source) so the user can SEE + DELETE even a
// hand-planted block; an injection-shaped block gets a visible ⚠ badge via the pure scanner so
// it is identifiable for remediation (§B2). No memory:* read handler is changed in main.

import { useState, useCallback, useEffect, type CSSProperties } from 'react';
import { ipc } from '../../lib/ipc-client.js';
import { useT } from '../../lib/i18n.js';
import { scanForInjection } from '../../../main/injection-scan.js';
import type { MemoryBlockMeta, SkillMeta } from '../../../shared/ipc-types.js';

// Local, self-contained (AIPanel's daysSince is not exported). updated is an epoch-ms number.
function daysSince(epochMs: number): number {
  if (!Number.isFinite(epochMs) || epochMs <= 0) return 0;
  return Math.max(0, Math.floor((Date.now() - epochMs) / 86_400_000));
}

// A block is "flagged" if the pure injection scanner finds a stripped span (§B2 remediation hint).
// scanForInjection is electron-free by design, so the renderer may import it directly.
function isFlagged(text: string): boolean {
  return scanForInjection(text).blocked.length > 0;
}

const rowStyle: CSSProperties = {
  padding: '8px 10px', marginBottom: 6, borderRadius: 4,
  background: 'var(--hover)', border: '1px solid var(--border)',
};

export function MemorySkillsPanel() {
  const t = useT();
  const [blocks, setBlocks] = useState<MemoryBlockMeta[] | null>(null);
  const [skills, setSkills] = useState<SkillMeta[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [b, s] = await Promise.all([ipc('memory:list'), ipc('skill:list')]);
      setBlocks(Array.isArray(b) ? b : []);
      setSkills(Array.isArray(s) ? s : []);
      setError(null);
    } catch (err) {
      // Never leave state at null (stuck spinner) on reject — empty + surface the error.
      setBlocks([]); setSkills([]);
      setError(err instanceof Error ? err.message : 'Failed to load.');
    }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  // Delete by opaque UUID — main re-validates (isMemoryId + must-exist), then re-list (no optimistic
  // mutate, so the UI always reflects the store even if the delete no-op'd).
  const handleDelete = useCallback(async (id: string) => {
    try {
      const { ok } = await ipc('memory:delete', id);
      if (ok) await refresh();
    } catch { await refresh(); }
  }, [refresh]);

  // Promote/un-promote a skill by name — main returns the PERSISTED value (content-hash gate may
  // reject → snap back). Optimistic update reconciled by the returned value; reject → re-list.
  const handlePromote = useCallback(async (name: string, next: boolean) => {
    try {
      const { promoted } = await ipc('skill:set-promoted', name, next);
      setSkills((prev) => prev?.map((s) => (s.name === name ? { ...s, promoted } : s)) ?? prev);
    } catch { await refresh(); }
  }, [refresh]);

  if (blocks === null || skills === null) {
    return <div style={{ padding: 20, textAlign: 'center', color: 'var(--ink-faint)', fontSize: 11 }}>{t('panel.ai.loadingManage')}</div>;
  }

  return (
    <div>
      {error && (
        <div style={{ fontSize: 11, color: 'var(--ink-dim)', padding: 10, background: 'var(--hover)', borderRadius: 4, marginBottom: 8 }}>
          {error}
        </div>
      )}

      {/* ── Durable memory ── */}
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4, color: 'var(--ink)' }}>{t('panel.ai.manageMemoryTitle')}</div>
      <div style={{ fontSize: 10, color: 'var(--ink-faint)', marginBottom: 12 }}>{t('panel.ai.manageMemoryHint')}</div>

      {blocks.length === 0 && (
        <div style={{ textAlign: 'center', color: 'var(--ink-faint)', fontSize: 11, padding: 16 }}>{t('panel.ai.noMemoryBlocks')}</div>
      )}
      {blocks.map((b) => {
        const flagged = isFlagged(b.text);
        return (
          <div key={b.id} style={rowStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {flagged && <span title={t('panel.ai.flaggedBadge')} style={{ color: '#e5854d', marginRight: 4 }}>⚠</span>}
                {b.text}
              </div>
              <span style={{ fontSize: 9, color: 'var(--ink-faint)', flexShrink: 0 }}>{daysSince(b.updated)}{t('panel.ai.daysAgo')}</span>
            </div>
            <div style={{ marginTop: 6, display: 'flex', gap: 6, alignItems: 'center' }}>
              <span style={{ fontSize: 9, color: 'var(--ink-faint)' }}>{b.provenance}{b.pinned ? ' · 📌' : ''}</span>
              <button
                onClick={() => void handleDelete(b.id)}
                aria-label={`${t('panel.ai.deleteMemory')} ${b.text}`}
                style={{ marginLeft: 'auto', padding: '2px 10px', fontSize: 10, cursor: 'pointer', background: 'transparent', border: '1px solid var(--border)', borderRadius: 3, color: 'var(--ink-dim)' }}
              >
                {t('panel.ai.deleteMemory')}
              </button>
            </div>
          </div>
        );
      })}

      {/* ── Skills ── */}
      <div style={{ fontSize: 12, fontWeight: 600, margin: '16px 0 4px', color: 'var(--ink)' }}>{t('panel.ai.manageSkillsTitle')}</div>
      <div style={{ fontSize: 10, color: 'var(--ink-faint)', marginBottom: 12 }}>{t('panel.ai.manageSkillsHint')}</div>

      {skills.length === 0 && (
        <div style={{ textAlign: 'center', color: 'var(--ink-faint)', fontSize: 11, padding: 16 }}>{t('panel.ai.noSkills')}</div>
      )}
      {skills.map((s) => (
        <div key={s.name} style={rowStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</div>
            <label style={{ fontSize: 10, color: 'var(--ink-dim)', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
              <input type="checkbox" checked={s.promoted} onChange={(e) => void handlePromote(s.name, e.target.checked)} />
              {t('panel.ai.promote')}
            </label>
          </div>
          <div style={{ fontSize: 10, color: 'var(--ink-faint)', marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.description}</div>
        </div>
      ))}
    </div>
  );
}
