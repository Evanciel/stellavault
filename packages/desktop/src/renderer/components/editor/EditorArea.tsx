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

import { useCallback, useState } from 'react';
import { useAppStore } from '../../stores/app-store.js';
import { TabBar } from './TabBar.js';
import { MarkdownEditor } from './MarkdownEditor.js';
import { PropertiesEditor } from './PropertiesEditor.js';
import { DailyBrief } from '../shared/DailyBrief.js';
import { ipc } from '../../lib/ipc-client.js';
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

  const activeTab = tabs.find((t) => t.id === activeTabId);
  const splitTab = splitTabId ? tabs.find((t) => t.id === splitTabId) : null;

  const handleSave = useCallback(async () => {
    if (!activeTab || !activeTab.isDirty) return;
    // tab.content is markdown source (B1) — safe to write to the .md file as-is.
    await ipc('vault:write-file', activeTab.filePath, activeTab.content);
    markTabClean(activeTab.id);
  }, [activeTab, markTabClean]);

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

  if (tabs.length === 0) {
    return <DailyBrief />;
  }

  const editorPane = (tab: typeof activeTab | null, isPrimary: boolean) => {
    if (!tab) return null;
    // Split per render — cheap (YAML head only). MarkdownEditor is keyed by
    // tab.id and only consumes `content` at mount, so this does NOT re-feed
    // TipTap on every keystroke.
    const parsed = parseFrontmatter(tab.content);
    return (
      <div style={{ flex: 1, overflow: 'auto', background: 'var(--editor-bg)', padding: '24px 48px', minWidth: 0 }}>
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
