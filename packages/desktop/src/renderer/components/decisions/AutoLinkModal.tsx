// T3-6: auto-link review modal. The "Suggest links for this note" command scans
// the active note's body for plain-text mentions of existing vault titles and
// offers to convert them to [[wikilinks]]. This modal shows the proposed links
// for confirmation; on accept it applies ALL of them.
//
// Apply strategy (decoupled from TipTap internals): switch the tab to Source
// mode and write the recomposed `fmBlock + linkedBody` into the tab via the
// store. SourceView re-syncs from content immediately, the tab goes dirty, and a
// normal Ctrl+S persists it — round-trip safe, no editor-agent coupling.

import { Modal } from '../ui/Modal.js';
import { useAppStore } from '../../stores/app-store.js';
import { useUiStore } from '../../lib/commands.js';
import { parse as parseFrontmatter } from '../../lib/frontmatter.js';
import { showToast } from '../../lib/toast.js';
import { useDecisionsUi } from './decisions-store.js';

export function AutoLinkModal() {
  const review = useDecisionsUi((s) => s.autoLinkReview);
  const close = useDecisionsUi((s) => s.closeAutoLinkReview);

  if (!review) return null;

  const { tabId, suggestions, linkedBody } = review;
  const hasAny = suggestions.length > 0;

  function apply() {
    const state = useAppStore.getState();
    const tab = state.tabs.find((t) => t.id === tabId);
    if (!tab) { close(); return; }
    // Recompose with the CURRENT frontmatter block (read fresh — body-only edit).
    const fmBlock = parseFrontmatter(tab.content).fmBlock;
    state.updateTabContent(tabId, fmBlock + linkedBody);
    // Switch to Source mode so the inserted [[wikilinks]] are visible/verifiable;
    // SourceView re-syncs from the new content immediately (no remount needed).
    useUiStore.getState().setViewMode(tabId, 'source');
    showToast(`Linked ${suggestions.length} mention${suggestions.length === 1 ? '' : 's'} — review in Source, then save`, 'success');
    close();
  }

  return (
    <Modal open={true} onClose={close} title="Suggest links for this note" width={480}>
      {!hasAny ? (
        <div style={{ textAlign: 'center', color: 'var(--ink-faint)', fontSize: 12, padding: 20 }}>
          No new links found — no plain-text mentions of other vault notes in this note.
        </div>
      ) : (
        <>
          <div style={{ fontSize: 11, color: 'var(--ink-dim)', marginBottom: 12, lineHeight: 1.5 }}>
            {suggestions.length} mention{suggestions.length === 1 ? '' : 's'} of existing notes can become wikilinks:
          </div>
          <div style={{ maxHeight: '34vh', overflow: 'auto', marginBottom: 14 }}>
            {suggestions.map((s, i) => (
              <div
                key={`${s.target}-${s.phrase}-${i}`}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '6px 10px', marginBottom: 4, borderRadius: 4,
                  background: 'var(--hover)', border: '1px solid var(--border)',
                }}
              >
                <span style={{ fontSize: 12, color: 'var(--ink)' }}>{s.phrase}</span>
                <span style={{ fontSize: 11, color: 'var(--ink-faint)' }}>→</span>
                <span style={{ fontSize: 12, color: 'var(--accent-2)', fontFamily: 'monospace' }}>[[{s.target}]]</span>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button
              onClick={close}
              style={{ padding: '6px 14px', background: 'var(--hover)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--ink-dim)', cursor: 'pointer', fontSize: 12 }}
            >
              Cancel
            </button>
            <button
              onClick={apply}
              style={{ padding: '6px 14px', background: 'var(--accent)', border: 'none', borderRadius: 4, color: '#fff', cursor: 'pointer', fontSize: 12 }}
            >
              Convert all
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
