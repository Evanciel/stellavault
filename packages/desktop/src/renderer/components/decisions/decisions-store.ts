// T3-5 / T3-6: shared open-state for the capture/automation modals.
// Kept in its own zustand store (mirrors AIPanel's local UI store) so the
// commands in lib/commands.ts and the modal components stay decoupled — a
// command flips a flag, the host renders the matching modal.

import { create } from 'zustand';
import type { LinkSuggestion } from '../../../shared/ipc-types.js';

// T3-6: pending auto-link review — the suggestions + the fully-linked body the
// renderer applies if the user accepts. tabId/selfTitle identify the target note.
export interface AutoLinkReview {
  tabId: string;
  selfTitle: string;
  suggestions: LinkSuggestion[];
  linkedBody: string;   // body with ALL suggestions applied (fmBlock prepended on apply)
}

interface DecisionsUiState {
  // T3-5: ADR capture modal. prefill seeds the title (e.g. from selected text).
  captureOpen: boolean;
  capturePrefillTitle: string;
  // T3-5: Decisions browser (past decisions + evolution timeline).
  browserOpen: boolean;
  // T3-6: auto-link review modal payload (null = closed).
  autoLinkReview: AutoLinkReview | null;
  autoLinkLoading: boolean;

  openCapture: (prefillTitle?: string) => void;
  closeCapture: () => void;
  openBrowser: () => void;
  closeBrowser: () => void;
  setAutoLinkLoading: (loading: boolean) => void;
  openAutoLinkReview: (review: AutoLinkReview) => void;
  closeAutoLinkReview: () => void;
}

export const useDecisionsUi = create<DecisionsUiState>((set) => ({
  captureOpen: false,
  capturePrefillTitle: '',
  browserOpen: false,
  autoLinkReview: null,
  autoLinkLoading: false,

  openCapture: (prefillTitle = '') => set({ captureOpen: true, capturePrefillTitle: prefillTitle }),
  closeCapture: () => set({ captureOpen: false, capturePrefillTitle: '' }),
  openBrowser: () => set({ browserOpen: true }),
  closeBrowser: () => set({ browserOpen: false }),
  setAutoLinkLoading: (loading) => set({ autoLinkLoading: loading }),
  openAutoLinkReview: (review) => set({ autoLinkReview: review, autoLinkLoading: false }),
  closeAutoLinkReview: () => set({ autoLinkReview: null }),
}));
