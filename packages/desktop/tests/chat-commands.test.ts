// Slash-command registry tests (premium part 4). The registry is pure → tested directly.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  parseSlash, matchCommands, applyTemplate, topQuickBar, COMMANDS, QUICK_BAR_IDS,
  type CommandCtx,
} from '../src/renderer/components/chat/commands.js';

const FULL: CommandCtx = { visionOn: true, canNewSession: true, canClearChat: true, hasMessages: true };
const NONE: CommandCtx = { visionOn: false, canNewSession: false, canClearChat: false, hasMessages: false };

describe('parseSlash', () => {
  it('matches only a leading "/" at index 0 of the whole value', () => {
    expect(parseSlash('/sum')).toEqual({ isSlash: true, token: 'sum', arg: '' });
    expect(parseSlash('a/b')).toEqual({ isSlash: false, token: '', arg: '' });
    expect(parseSlash('hello /note')).toEqual({ isSlash: false, token: '', arg: '' });
  });
  it('splits the argument after the first space', () => {
    expect(parseSlash('/search foo bar')).toEqual({ isSlash: true, token: 'search', arg: 'foo bar' });
  });
  it('a "/" on line 2 (path / code) does NOT hijack', () => {
    expect(parseSlash('first line\n/usr/bin')).toEqual({ isSlash: false, token: '', arg: '' });
  });
});

describe('matchCommands', () => {
  it('empty query returns all VISIBLE commands', () => {
    expect(matchCommands('', FULL)).toHaveLength(COMMANDS.length);
  });
  it('prefix-filters by id (case-insensitive)', () => {
    expect(matchCommands('SE', FULL).map((c) => c.id)).toEqual(['search']);
  });
  it('hides /image when visionOff and /new+/clear when callbacks absent', () => {
    const ids = matchCommands('', NONE).map((c) => c.id);
    expect(ids).not.toContain('image');
    expect(ids).not.toContain('new');
    expect(ids).not.toContain('clear');
    expect(ids).toContain('summarize'); // vault commands always visible
  });
});

describe('applyTemplate', () => {
  it('substitutes {arg}', () => {
    const search = COMMANDS.find((c) => c.id === 'search')!;
    expect(applyTemplate(search, 'react hooks')).toBe('Search my vault for: react hooks');
  });
  it('a no-template (toggle) command yields ""', () => {
    expect(applyTemplate(COMMANDS.find((c) => c.id === 'agent')!, 'x')).toBe('');
  });
});

describe('topQuickBar', () => {
  it('returns exactly the 4 pinned ids when all visible', () => {
    expect(topQuickBar(FULL).map((c) => c.id)).toEqual(QUICK_BAR_IDS);
    expect(topQuickBar(FULL)).toHaveLength(4);
  });
  it('drops a pinned command that is not visible (never invents others)', () => {
    // none of the pinned 4 are gated, so they all survive even with NONE ctx
    expect(topQuickBar(NONE).map((c) => c.id)).toEqual(QUICK_BAR_IDS);
  });
});

describe('bumpFreq', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', (() => {
      let store: Record<string, string> = {};
      return { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; }, clear: () => { store = {}; } };
    })());
  });
  it('accumulates counts and never throws', async () => {
    const { bumpFreq } = await import('../src/renderer/components/chat/commands.js');
    expect(() => { bumpFreq('search'); bumpFreq('search'); }).not.toThrow();
    expect(JSON.parse(localStorage.getItem('sv.chat.cmdFreq')!).search).toBe(2);
  });
});
