// Editor area — tab bar + properties grid + markdown editor + split view.
// B1: tab.content is ALWAYS the FULL markdown source (frontmatter + body) and
// is what vault:write-file persists, unchanged from Wave 0.
// W1-7 layering on top: per render we SPLIT content via lib/frontmatter.ts —
// the YAML never enters TipTap (it would corrupt serialization, plan §0):
//   vault:read-file → tab.content ─┬→ parse().body  → MarkdownEditor
//                                  └→ parse().frontmatter → PropertiesEditor
//   body edit  → recompose fmBlock + newBody          → updateTabContent
//   prop edit  → recompose stringify(body, newFm)     → updateTabFrontmatter
//   Ctrl+S     → vault:write-file(tab.content)  (save path intact)

import { useCallback, useRef, useState } from 'react';
import { useAppStore } from '../../stores/app-store.js';
import { TabBar } from './TabBar.js';
import { MarkdownEditor } from './MarkdownEditor.js';
import { PropertiesEditor } from './PropertiesEditor.js';
import { DailyBrief } from '../shared/DailyBrief.js';
import { GraphView } from '../graph/GraphView.js';
import { ipc } from '../../lib/ipc-client.js';
import { showToast } from '../../lib/toast.js';
import { parse as parseFrontmatter, stringify as stringifyFrontmatter } from '../../lib/frontmatter.js';

/** Body edit → recompose with the CURRENT frontmatter block (read fresh from
 *  the store — the editor's onUpdate closure is bound once at mount, so any
 *  captured fmBlock would go stale after a Properties edit). */
function handleBodyChange(tabId: string, bodyMd: string) {
  const state = useAppStore.getState();
  const tab = state.tabs.find((t) => t.id === tabId);
  const fmBlock = tab ? parseFrontmatter(tab.content).fmBlock : '';
  state.updateTabContent(tabId, fmBlock + bodyMd);
}

/** Properties edit → re-stringify YAML (key order preserved) + current body. */
function handleFrontmatterChange(tabId: string, fm: Record<string, unknown>) {
  const state = useAppStore.getState();
  const tab = state.tabs.find((t) => t.id === tabId);
  if (!tab) return;
  const body = parseFrontmatter(tab.content).body;
  state.updateTabFrontmatter(tabId, fm, stringifyFrontmatter(body, fm));
}

export function EditorArea() {
  const tabs = useAppStore((s) => s.tabs);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const markTabClean = useAppStore((s) => s.markTabClean);
  const [splitMode, setSplitMode] = useState<'none' | 'horizontal' | 'vertical'>('none');
  const [splitTabId, setSplitTabId] = useState<string | null>(null);
  // T1-7: which pane last received focus. Ctrl+S must save THAT pane's tab, not
  // always the primary tab (split-view silent data loss). Defaults to primary.
  const focusedTabIdRef = useRef<string | null>(null);

  const activeTab = tabs.find((t) => t.id === activeTabId);
  const splitTab = splitTabId ? tabs.find((t) => t.id === splitTabId) : null;

  const handleSave = useCallback(async () => {
    // T1-7: resolve the focused pane's tab from the store (read fresh — the
    // ref is set on pane focus). Fall back to the active/primary tab.
    const state = useAppStore.getState();
    const focusedId = focusedTabIdRef.current;
    const tab =
      (focusedId ? state.tabs.find((t) => t.id === focusedId) : undefined) ??
      state.tabs.find((t) => t.id === state.activeTabId);
    if (!tab || tab.kind === 'graph' || !tab.isDirty) return;
    // T1-12: vault:write-file can reject (disk full, perms, external lock) —
    // surface it instead of silently dropping the save. tab.content is markdown
    // source (B1, Wave 0) — safe to write to the .md file as-is.
    try {
      await ipc('vault:write-file', tab.filePath, tab.content);
      markTabClean(tab.id);
    } catch (err) {
      console.error('[editor] save failed:', err);
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`Save failed: ${tab.title} — ${msg}`, 'error', 0);
    }
  }, [markTabClean]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      void handleSave();
    }
    // Ctrl+\ toggles split
    if ((e.ctrlKey || e.metaKey) && e.key === '\\') {
      e.preventDefault();
      if (splitMode === 'none' && tabs.length >= 2) {
        setSplitMode('vertical');
        // Pick the second-most-recent tab for split
        const other = tabs.find((t) => t.id !== activeTabId);
        if (other) setSplitTabId(other.id);
      } else {
        setSplitMode('none');
        setSplitTabId(null);
      }
    }
  }, [handleSave, splitMode, tabs, activeTabId]);

  // T1-8: reload an externally-changed tab from disk, discarding local edits.
  const handleReloadFromDisk = useCallback(async (tabId: string, filePath: string) => {
    try {
      const content = await ipc('vault:read-file', filePath);
      useAppStore.getState().reloadTab(tabId, content);
      showToast('Reloaded from disk', 'success');
    } catch (err) {
      console.error('[editor] reload from disk failed:', err);
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`Reload failed — ${msg}`, 'error', 0);
    }
  }, []);

  // T1-8: "Keep mine" — dismiss the badge/bar without touching content. The
  // next Ctrl+S will overwrite the on-disk version (last-write-wins, but now
  // an explicit user choice rather than a silent one).
  const handleKeepMine = useCallback((tabId: string) => {
    useAppStore.getState().clearExternallyChanged(tabId);
  }, []);

  if (tabs.length === 0) {
    return <DailyBrief />;
  }

  const editorPane = (tab: typeof activeTab | null, isPrimary: boolean) => {
    if (!tab) return null;
    // Wave 2: special tab kind — full main-pane graph view (no file content).
    if (tab.kind === 'graph') {
      return (
        <div style={{ flex: 1, minWidth: 0, minHeight: 0, overflow: 'hidden', display: 'flex' }}>
          <GraphView />
        </div>
      );
    }
    // Split per render — cheap (YAML head only). MarkdownEditor is keyed by
    // tab.id and only consumes `content` at mount, so this does NOT re-feed
    // TipTap on every keystroke.
    const parsed = parseFrontmatter(tab.content);
    return (
      <div
        // T1-7: record which pane is focused so Ctrl+S saves THIS pane's tab.
        // Capture phase so it fires for focus on any descendant (TipTap, inputs).
        onFocusCapture={() => { focusedTabIdRef.current = tab.id; }}
        onMouseDownCapture={() => { focusedTabIdRef.current = tab.id; }}
        style={{ flex: 1, overflow: 'auto', background: 'var(--editor-bg)', padding: '24px 48px', minWidth: 0 }}
      >
        {/* T1-8: external-change reload bar — file changed on disk while open. */}
        {tab.externallyChanged && (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            gap: 12, marginBottom: 12, padding: '8px 12px',
            background: 'var(--hover)', border: '1px solid var(--accent)',
            borderRadius: 6, fontSize: 12, color: 'var(--ink-dim)',
          }}>
            <span>⟳ This file changed on disk{tab.isDirty ? ' — you have unsaved edits.' : '.'}</span>
            <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
              <button
                onClick={() => void handleReloadFromDisk(tab.id, tab.filePath)}
                style={{ padding: '4px 12px', background: 'var(--accent)', border: 'none', borderRadius: 4, color: '#fff', cursor: 'pointer', fontSize: 12 }}
              >
                Reload
              </button>
              <button
                onClick={() => handleKeepMine(tab.id)}
                style={{ padding: '4px 12px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--ink-dim)', cursor: 'pointer', fontSize: 12 }}
              >
                Keep mine
              </button>
            </div>
          </div>
        )}
        {!isPrimary && (
          <div style={{
            fontSize: 10, color: 'var(--ink-faint)', marginBottom: 8,
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <span>{tab.title}</span>
            <select
              value={tab.id}
              onChange={(e) => setSplitTabId(e.target.value)}
              aria-label="Split pane file"
              style={{
                background: 'var(--hover)', border: '1px solid var(--border)',
                borderRadius: 3, padding: '2px 6px', fontSize: 10, color: 'var(--ink-dim)',
              }}
            >
              {tabs.filter((t) => t.id !== activeTabId).map((t) => (
                <option key={t.id} value={t.id}>{t.title}</option>
              ))}
            </select>
          </div>
        )}
        <div style={{ maxWidth: 780, margin: '0 auto' }}>
          <PropertiesEditor
            key={tab.id}
            frontmatter={parsed.frontmatter}
            onChange={(fm) => handleFrontmatterChange(tab.id, fm)}
          />
        </div>
        <MarkdownEditor
          key={tab.id}
          content={parsed.body}
          onChange={(bodyMd) => handleBodyChange(tab.id, bodyMd)}
        />
      </div>
    );
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }} onKeyDown={handleKeyDown}>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <div style={{ flex: 1 }}><TabBar /></div>
        {/* Split toggle */}
        <div style={{ display: 'flex', gap: 2, padding: '0 8px', borderBottom: '1px solid var(--border)', background: 'var(--tab-bg)' }}>
          <button
            onClick={() => { setSplitMode(splitMode === 'vertical' ? 'none' : 'vertical'); if (splitMode === 'none') { const o = tabs.find(t => t.id !== activeTabId); if (o) setSplitTabId(o.id); } }}
            title="Split vertical (Ctrl+\\)"
            aria-label="Toggle vertical split"
            style={{
              padding: '4px 6px', fontSize: 10, border: 'none', borderRadius: 3, cursor: 'pointer',
              background: splitMode === 'vertical' ? 'var(--selection)' : 'transparent',
              color: splitMode === 'vertical' ? 'var(--accent-2)' : 'var(--ink-faint)',
            }}
          >▐▌</button>
          <button
            onClick={() => { setSplitMode(splitMode === 'horizontal' ? 'none' : 'horizontal'); if (splitMode === 'none') { const o = tabs.find(t => t.id !== activeTabId); if (o) setSplitTabId(o.id); } }}
            title="Split horizontal"
            aria-label="Toggle horizontal split"
            style={{
              padding: '4px 6px', fontSize: 10, border: 'none', borderRadius: 3, cursor: 'pointer',
              background: splitMode === 'horizontal' ? 'var(--selection)' : 'transparent',
              color: splitMode === 'horizontal' ? 'var(--accent-2)' : 'var(--ink-faint)',
            }}
          >▄▀</button>
        </div>
      </div>

      {splitMode === 'none' ? (
        editorPane(activeTab, true)
      ) : (
        <div style={{
          flex: 1, display: 'flex', overflow: 'hidden',
          flexDirection: splitMode === 'horizontal' ? 'column' : 'row',
        }}>
          {editorPane(activeTab, true)}
          <div style={{
            [splitMode === 'horizontal' ? 'height' : 'width']: 1,
            background: 'var(--accent)',
            flexShrink: 0,
          }} />
          {editorPane(splitTab, false)}
        </div>
      )}
    </div>
  );
}
