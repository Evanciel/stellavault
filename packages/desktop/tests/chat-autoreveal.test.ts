// Regression for the SP-H/I split-view auto-reveal guards (adversarial review w7w3a0687).
import { describe, it, expect } from 'vitest';
import { shouldAutoRevealGraph, AGENT_WRITE_TOOLS } from '../src/renderer/components/chat/autoreveal.js';

const base = { ok: true, toolName: 'create_note', alreadyOpened: false, variant: 'main' as const, rightPanel: 'none' };

describe('shouldAutoRevealGraph', () => {
  it('reveals on a successful write in the main (center-tab) chat with nothing else open', () => {
    expect(shouldAutoRevealGraph(base)).toBe(true);
    for (const w of AGENT_WRITE_TOOLS) expect(shouldAutoRevealGraph({ ...base, toolName: w })).toBe(true);
  });

  it('NEVER reveals in the panel variant — would unmount the chat and abort its own stream (bug #1)', () => {
    expect(shouldAutoRevealGraph({ ...base, variant: 'panel' })).toBe(false);
  });

  it('does not steal a panel the user already has open / chose (rightPanel !== none) (bug #6/#7)', () => {
    expect(shouldAutoRevealGraph({ ...base, rightPanel: 'ai' })).toBe(false);
    expect(shouldAutoRevealGraph({ ...base, rightPanel: 'graph' })).toBe(false);
    expect(shouldAutoRevealGraph({ ...base, rightPanel: 'note-graph' })).toBe(false);
    expect(shouldAutoRevealGraph({ ...base, rightPanel: 'backlinks' })).toBe(false);
  });

  it('ignores read tools and failed writes', () => {
    expect(shouldAutoRevealGraph({ ...base, toolName: 'search_vault' })).toBe(false);
    expect(shouldAutoRevealGraph({ ...base, toolName: 'read_note' })).toBe(false);
    expect(shouldAutoRevealGraph({ ...base, ok: false })).toBe(false);
  });

  it('fires at most once (alreadyOpened short-circuits)', () => {
    expect(shouldAutoRevealGraph({ ...base, alreadyOpened: true })).toBe(false);
  });
});
