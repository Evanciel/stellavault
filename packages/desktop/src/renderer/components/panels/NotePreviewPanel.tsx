// Note explorer panel — web/Obsidian-style. Clicking a graph node streams the
// note here (right panel) instead of stealing the main pane, so the graph stays
// visible. A segmented strip walks the note: Read / Edit (save to vault) /
// Backlinks / Outlinks / Local graph. Clicking a related/backlink/outlink/local
// node RE-CENTERS the preview in place (Ctrl/Cmd-click opens a real editor tab).
// Re-centering auto-saves any unsaved Edit changes first (the preview slice is a
// single object — swapping without saving would lose edits).

import { useState, useEffect, useCallback, useMemo } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { useAppStore } from '../../stores/app-store.js';
import { MarkdownEditor } from '../editor/MarkdownEditor.js';
import { parse as parseFrontmatter } from '../../lib/frontmatter.js';
import { ipc } from '../../lib/ipc-client.js';
import { showToast } from '../../lib/toast.js';
import { flushDirtyPreview } from '../../lib/preview-save.js';
import { RelationLists, NoteRow, type OnOpen } from './links-shared.js';
import { parseOutlinks, noteBasename } from '../../lib/outlinks.js';

type Segment = 'read' | 'edit' | 'backlinks' | 'outlinks';
const SEGMENTS: Segment[] = ['read', 'edit', 'backlinks', 'outlinks'];
const SEG_LABELS: Record<Segment, string> = {
  read: 'Read', edit: 'Edit', backlinks: 'Backlinks', outlinks: 'Outlinks',
};

export function NotePreviewPanel() {
  const preview = useAppStore((s) => s.previewNote);
  const openFile = useAppStore((s) => s.openFile);
  const setPreviewNote = useAppStore((s) => s.setPreviewNote);
  const updatePreviewContent = useAppStore((s) => s.updatePreviewContent);
  const markPreviewClean = useAppStore((s) => s.markPreviewClean);
  const goPreviewBack = useAppStore((s) => s.goPreviewBack);
  const goPreviewFwd = useAppStore((s) => s.goPreviewFwd);
  const canBack = useAppStore((s) => s.previewBack.length > 0);
  const canFwd = useAppStore((s) => s.previewFwd.length > 0);
  const [segment, setSegment] = useState<Segment>('read');

  // Re-center the preview on another note. Auto-save current dirty edits first
  // (abort the swap if the save fails so edits aren't lost).
  const recenter = useCallback(async (filePath: string, title: string) => {
    try { await flushDirtyPreview(); } catch { return; }
    try {
      const content = await ipc('vault:read-file', filePath);
      setPreviewNote({ filePath, title, content });
    } catch (err) {
      console.error('[preview] read failed:', err);
    }
  }, [setPreviewNote]);

  // Related/backlink/outlink click: plain click re-centers; Ctrl/Cmd-click opens a tab.
  const onOpen: OnOpen = useCallback(async (t, ev) => {
    if (ev.ctrlKey || ev.metaKey) {
      try { await flushDirtyPreview(); } catch { return; }
      const content = await ipc('vault:read-file', t.filePath);
      openFile(t.filePath, t.title, content);
    } else {
      void recenter(t.filePath, t.title);
    }
  }, [openFile, recenter]);

  // Body edit → recompose with the CURRENT frontmatter block (read fresh from the
  // store — the editor's onChange closure binds once at mount, so any captured
  // fmBlock would go stale after a re-center). Mirrors EditorArea.handleBodyChange.
  const handleBodyChange = useCallback((bodyMd: string) => {
    const cur = useAppStore.getState().previewNote;
    if (!cur) return;
    const fmBlock = parseFrontmatter(cur.content).fmBlock;
    updatePreviewContent(fmBlock + bodyMd);
  }, [updatePreviewContent]);

  const handleSave = useCallback(async () => {
    const p = useAppStore.getState().previewNote;
    if (!p || !p.isDirty) return;
    try {
      await ipc('vault:write-file', p.filePath, p.content); // content is markdown source (B1)
      markPreviewClean();
      showToast('Saved', 'success');
    } catch (err) {
      console.error('[preview] save failed:', err);
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`Save failed: ${p.title} — ${msg}`, 'error', 0);
    }
  }, [markPreviewClean]);

  // "Open in editor" — flush dirty edits first so the new tab + disk agree.
  const openInEditor = useCallback(async () => {
    const p = useAppStore.getState().previewNote;
    if (!p) return;
    try { await flushDirtyPreview(); } catch { return; }
    openFile(p.filePath, p.title, p.content);
  }, [openFile]);

  // Browser-style history: flush dirty edits, walk the back/forward stacks, then
  // RE-READ the restored note from disk. The stacks hold an in-memory snapshot that
  // may be stale (the same note could have been edited in a tab); showing it as
  // clean risks a later save silently overwriting newer disk content. Mirror
  // recenter()'s disk read so Back/Forward always reflect disk truth.
  const handleHistory = useCallback(async (dir: 'back' | 'fwd') => {
    try { await flushDirtyPreview(); } catch { return; }
    if (dir === 'back') goPreviewBack(); else goPreviewFwd();
    const cur = useAppStore.getState().previewNote;
    if (!cur) return;
    try {
      const content = await ipc('vault:read-file', cur.filePath);
      useAppStore.getState().setPreviewNoteInPlace({ filePath: cur.filePath, title: cur.title, content });
    } catch (err) {
      console.error('[preview] history disk read failed:', err);
    }
  }, [goPreviewBack, goPreviewFwd]);

  if (!preview) {
    return (
      <div style={{ padding: 20, textAlign: 'center', color: 'var(--ink-faint)', fontSize: 11 }}>
        Click a note in the graph to explore it here
      </div>
    );
  }

  // B1/W1-7: split the YAML so it never enters TipTap (matches EditorArea).
  const body = parseFrontmatter(preview.content).body;
  // Wikilinks resolve by file BASENAME, not the (truncated, entity-decoded) graph
  // label — use the basename for backlink/outlink lookups so >40-char titles still
  // resolve (review: high). The header still shows the human title.
  const lookupTitle = noteBasename(preview.filePath);

  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', height: '100%' }}
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); void handleSave(); }
      }}
    >
      {/* Header — title (+ dirty dot) + Save (when dirty) + "open in editor". */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', borderBottom: '1px solid var(--border)' }}>
        <button onClick={() => void handleHistory('back')} disabled={!canBack} title="Back" style={{ background: 'transparent', border: 'none', cursor: canBack ? 'pointer' : 'default', color: 'var(--ink-dim)', fontSize: 14, lineHeight: 1, padding: '0 2px', opacity: canBack ? 1 : 0.35 }}>←</button>
        <button onClick={() => void handleHistory('fwd')} disabled={!canFwd} title="Forward" style={{ background: 'transparent', border: 'none', cursor: canFwd ? 'pointer' : 'default', color: 'var(--ink-dim)', fontSize: 14, lineHeight: 1, padding: '0 2px', opacity: canFwd ? 1 : 0.35 }}>→</button>
        <span title={preview.title} style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {preview.isDirty && <span style={{ color: 'var(--accent)', marginRight: 4 }}>●</span>}
          {preview.title}
        </span>
        {preview.isDirty && (
          <button onClick={() => void handleSave()} title="Save (Ctrl+S)" style={{ padding: '3px 10px', fontSize: 11, borderRadius: 4, cursor: 'pointer', border: 'none', background: 'var(--accent)', color: '#fff', whiteSpace: 'nowrap' }}>
            Save
          </button>
        )}
        <button onClick={() => void openInEditor()} title="Open in editor" style={{ padding: '3px 10px', fontSize: 11, borderRadius: 4, cursor: 'pointer', border: '1px solid var(--border)', background: 'transparent', color: 'var(--accent-2)', whiteSpace: 'nowrap' }}>
          Open ↗
        </button>
      </div>

      {/* Segment strip */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', fontSize: 11 }}>
        {SEGMENTS.map((s) => (
          <button
            key={s}
            onClick={() => setSegment(s)}
            aria-selected={segment === s}
            role="tab"
            style={{ flex: 1, padding: '7px 0', background: segment === s ? 'var(--selection)' : 'transparent', border: 'none', color: segment === s ? 'var(--accent-2)' : 'var(--ink-dim)', cursor: 'pointer', fontWeight: segment === s ? 600 : 400, fontSize: 11 }}
          >
            {SEG_LABELS[s]}
          </button>
        ))}
      </div>

      {/* Body — one segment at a time. key={filePath...} forces a fresh editor per
          note (TipTap binds content at mount). */}
      <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
        {segment === 'read' && (
          <MarkdownEditor key={`${preview.filePath}:read`} content={body} onChange={() => {}} readOnly />
        )}
        {segment === 'edit' && (
          <div style={{ padding: '4px 12px' }}>
            <MarkdownEditor key={`${preview.filePath}:edit`} content={body} onChange={handleBodyChange} />
          </div>
        )}
        {segment === 'backlinks' && (
          <RelationLists title={lookupTitle} filePath={preview.filePath} onOpen={onOpen} />
        )}
        {segment === 'outlinks' && (
          <OutlinksList content={preview.content} onOpen={onOpen} />
        )}
      </div>
    </div>
  );
}

// Outgoing [[wikilinks]] for the preview note, resolved to files by BASENAME against
// the graph node list. Resolved links open/re-center; unresolved show greyed.
function OutlinksList({ content, onOpen }: { content: string; onOpen: OnOpen }) {
  const coreReady = useAppStore((s) => s.coreReady);
  const vaultPath = useAppStore((s) => s.vaultPath);
  const [paths, setPaths] = useState<string[]>([]);

  useEffect(() => {
    if (!coreReady) return;
    let alive = true;
    void (async () => {
      try {
        const data = await ipc('graph:build', 'semantic') as unknown as {
          nodes: Array<{ filePath: string }>;
        };
        if (alive) setPaths((data.nodes ?? []).map((n) => n.filePath).filter(Boolean));
      } catch {
        if (alive) setPaths([]);
      }
    })();
    return () => { alive = false; };
  }, [coreReady]);

  const links = useMemo(() => parseOutlinks(content), [content]);
  const index = useMemo(() => {
    const m = new Map<string, string>(); // lowercased basename -> (relative) filePath
    for (const fp of paths) { const k = noteBasename(fp).toLowerCase(); if (k && !m.has(k)) m.set(k, fp); }
    return m;
  }, [paths]);

  const resolved = useMemo(
    () => links.map((l) => ({ ...l, filePath: index.get(l.target.toLowerCase()) })),
    [links, index],
  );
  const present = resolved.filter((l) => l.filePath);
  const missing = resolved.filter((l) => !l.filePath);

  if (links.length === 0) {
    return <div style={{ padding: 16, textAlign: 'center', color: 'var(--ink-faint)', fontSize: 11 }}>No outgoing [[links]] in this note.</div>;
  }

  const toFull = (rel: string) => (/^([a-zA-Z]:[\\/]|\/)/.test(rel) ? rel : `${vaultPath}/${rel}`);

  return (
    <div style={{ padding: 12 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)', marginBottom: 8 }}>Outgoing links</div>
      {present.map((l, i) => (
        <NoteRow
          key={`p-${l.target}-${i}`}
          title={l.alias ?? l.target}
          onOpen={(ev: ReactMouseEvent) => onOpen({ filePath: toFull(l.filePath!), title: l.target }, ev)}
        />
      ))}
      {missing.length > 0 && (
        <>
          <div style={{ fontSize: 10, color: 'var(--ink-faint)', margin: '12px 0 4px' }}>Unresolved</div>
          {missing.map((l, i) => (
            <div key={`m-${l.target}-${i}`} style={{ padding: '6px 10px', marginBottom: 4, borderRadius: 4, fontSize: 12, color: 'var(--ink-faint)', border: '1px dashed var(--border)' }}>
              {l.alias ?? l.target}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
