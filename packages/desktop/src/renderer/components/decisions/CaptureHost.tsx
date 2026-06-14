// T3-5 / T3-6: capture & automation modal host. Mounts the decision-capture
// modal, the decisions browser, and the auto-link review modal, and registers
// the palette commands that open them (mirrors CoachPanel's command-registration
// pattern). A single <CaptureHost /> is mounted from App.tsx near the other
// global modals.

import { registerCommand } from '../../lib/commands.js';
import { useAppStore } from '../../stores/app-store.js';
import { useUiStore } from '../../lib/commands.js';
import { ipc } from '../../lib/ipc-client.js';
import { showToast } from '../../lib/toast.js';
import { parse as parseFrontmatter } from '../../lib/frontmatter.js';
import { useDecisionsUi } from './decisions-store.js';
import { DecisionCaptureModal } from './DecisionCaptureModal.js';
import { DecisionsBrowser } from './DecisionsBrowser.js';
import { AutoLinkModal } from './AutoLinkModal.js';

// ─── T3-6: "Suggest links for this note" ─────────────────────────────────────
// Reads the active note's body, asks main for wikilink suggestions, then opens
// the review modal. Runs against whatever tab is active (no editor coupling).
async function suggestLinksForActiveNote(): Promise<void> {
  const state = useAppStore.getState();
  const tab = state.tabs.find((t) => t.id === state.activeTabId);
  if (!tab || tab.kind === 'graph') {
    showToast('Open a note first', 'info');
    return;
  }
  const ui = useDecisionsUi.getState();
  ui.setAutoLinkLoading(true);
  try {
    const body = parseFrontmatter(tab.content).body;
    const result = await ipc('autolink:suggest', body, tab.title);
    ui.openAutoLinkReview({
      tabId: tab.id,
      selfTitle: tab.title,
      suggestions: result.suggestions,
      linkedBody: result.linkedBody,
    });
  } catch (err) {
    console.error('[autolink] suggest failed:', err);
    const msg = err instanceof Error ? err.message : String(err);
    showToast(`Link suggestions failed — ${msg}`, 'error', 0);
    ui.setAutoLinkLoading(false);
  }
}

// ─── Command registration (idempotent — mirrors CoachPanel) ──────────────────
let captureCommandsRegistered = false;
function registerCaptureCommands(): void {
  if (captureCommandsRegistered) return;
  captureCommandsRegistered = true;

  registerCommand({
    id: 'decision.log', title: 'Log a decision (ADR)', category: 'Capture',
    defaultKeys: 'mod+shift+l',
    run: () => useDecisionsUi.getState().openCapture(),
  });
  registerCommand({
    id: 'decision.browse', title: 'Browse decisions', category: 'Capture',
    run: () => useDecisionsUi.getState().openBrowser(),
  });
  registerCommand({
    id: 'editor.suggest-links', title: 'Suggest links for this note', category: 'Edit',
    run: () => void suggestLinksForActiveNote(),
  });
}
registerCaptureCommands();

// Keep useUiStore referenced (AutoLinkModal uses it to flip Source mode); this
// import also ensures the command module is initialized before first render.
void useUiStore;

export function CaptureHost() {
  return (
    <>
      <DecisionCaptureModal />
      <DecisionsBrowser />
      <AutoLinkModal />
    </>
  );
}
