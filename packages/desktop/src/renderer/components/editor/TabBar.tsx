// Horizontal tab bar for open files.
// Stage D (W1-17) polish: middle-click close, dirty-close confirm
// (Save / Discard / Cancel), HTML5 drag-reorder (no lib).

import { useState } from 'react';
import { useAppStore } from '../../stores/app-store.js';
import { ipc } from '../../lib/ipc-client.js';
import { Modal } from '../ui/Modal.js';

export function TabBar() {
  const tabs = useAppStore((s) => s.tabs);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const closeTab = useAppStore((s) => s.closeTab);
  const reorderTabs = useAppStore((s) => s.reorderTabs);

  // Dirty-close confirmation (W1-17) — ConfirmModal is two-button, this needs
  // three (Save/Discard/Cancel), so we compose the base Modal directly.
  const [pendingCloseId, setPendingCloseId] = useState<string | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const pendingTab = tabs.find((t) => t.id === pendingCloseId) ?? null;

  function requestClose(id: string): void {
    const tab = useAppStore.getState().tabs.find((t) => t.id === id);
    if (!tab) return;
    if (tab.isDirty) {
      setPendingCloseId(id);
    } else {
      closeTab(id);
    }
  }

  async function saveAndClose(): Promise<void> {
    const tab = useAppStore.getState().tabs.find((t) => t.id === pendingCloseId);
    setPendingCloseId(null);
    if (!tab) return;
    try {
      // tab.content is markdown source (B1) — written verbatim.
      await ipc('vault:write-file', tab.filePath, tab.content);
      useAppStore.getState().markTabClean(tab.id);
      useAppStore.getState().closeTab(tab.id);
    } catch (err) {
      console.error('[tabs] save before close failed:', err);
    }
  }

  function discardAndClose(): void {
    if (pendingCloseId) closeTab(pendingCloseId);
    setPendingCloseId(null);
  }

  return (
    <>
      <div role="tablist" aria-label="Open documents" style={{
        display: 'flex',
        background: 'var(--tab-bg)',
        borderBottom: '1px solid var(--border)',
        overflow: 'auto hidden',
        minHeight: 32,
      }}>
        {tabs.map((tab, index) => {
          const isActive = tab.id === activeTabId;
          return (
            <div
              key={tab.id}
              role="tab"
              aria-selected={isActive}
              tabIndex={isActive ? 0 : -1}
              onClick={() => setActiveTab(tab.id)}
              // Middle-click close (W1-17). auxclick (not mousedown) so it
              // fires once and never collides with primary clicks.
              onAuxClick={(e) => {
                if (e.button === 1) { e.preventDefault(); requestClose(tab.id); }
              }}
              // Drag reorder (W1-17) — plain HTML5 DnD, index carried in state.
              draggable
              onDragStart={(e) => {
                setDragIndex(index);
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', tab.id); // required by some platforms
              }}
              onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragIndex !== null && dragIndex !== index) reorderTabs(dragIndex, index);
                setDragIndex(null);
              }}
              onDragEnd={() => setDragIndex(null)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '0 12px',
                height: 32,
                fontSize: '11px',
                cursor: 'pointer',
                borderRight: '1px solid var(--border)',
                background: isActive ? 'var(--tab-active)' : 'transparent',
                color: isActive ? 'var(--ink)' : 'var(--ink-dim)',
                whiteSpace: 'nowrap',
                position: 'relative',
                opacity: dragIndex === index ? 0.5 : 1,
              }}
            >
              {tab.isDirty && (
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)', flexShrink: 0 }} />
              )}
              {/* T1-8: changed-on-disk badge — file diverged from the open tab. */}
              {tab.externallyChanged && (
                <span
                  title="Changed on disk — open this tab to reload or keep yours"
                  style={{ fontSize: 11, lineHeight: 1, color: 'var(--accent-2, #f59e0b)', flexShrink: 0 }}
                >
                  &#x21bb;
                </span>
              )}
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 140 }}>
                {/* Wave 2: graph tab gets the ◉ glyph; center chat tab gets 💬 */}
                {tab.kind === 'graph' ? `◉ ${tab.title}` : tab.kind === 'chat' ? `💬 ${tab.title}` : tab.title}
              </span>
              <button
                aria-label={`Close ${tab.title}`}
                onClick={(e) => { e.stopPropagation(); requestClose(tab.id); }}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--ink-faint)',
                  cursor: 'pointer',
                  fontSize: '12px',
                  padding: '2px 4px',
                  borderRadius: 3,
                  lineHeight: 1,
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--ink)'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--ink-faint)'; }}
              >
                &#x2715;
              </button>
              {isActive && (
                <div style={{
                  position: 'absolute',
                  bottom: 0,
                  left: 0,
                  right: 0,
                  height: 2,
                  background: 'var(--accent)',
                }} />
              )}
            </div>
          );
        })}
      </div>

      {/* Dirty-close confirm: Save / Discard / Cancel */}
      <Modal
        open={pendingTab !== null}
        onClose={() => setPendingCloseId(null)}
        title="Unsaved changes"
        width={400}
      >
        <p style={{ fontSize: 13, color: 'var(--ink-dim)', lineHeight: 1.6, marginBottom: 16 }}>
          &quot;{pendingTab?.title}&quot; has unsaved changes. Save before closing?
        </p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            onClick={() => setPendingCloseId(null)}
            style={{ padding: '6px 14px', background: 'var(--hover)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--ink-dim)', cursor: 'pointer', fontSize: 12 }}
          >
            Cancel
          </button>
          <button
            onClick={discardAndClose}
            style={{ padding: '6px 14px', background: '#ef4444', border: 'none', borderRadius: 4, color: '#fff', cursor: 'pointer', fontSize: 12 }}
          >
            Discard
          </button>
          <button
            onClick={() => void saveAndClose()}
            style={{ padding: '6px 14px', background: 'var(--accent)', border: 'none', borderRadius: 4, color: '#fff', cursor: 'pointer', fontSize: 12 }}
          >
            Save &amp; Close
          </button>
        </div>
      </Modal>
    </>
  );
}
