import { describe, it, expect } from 'vitest';
import { validateSettingsPatch } from '../src/main/settings-validate.js';
import { SettingsStore, getDefaults } from '../src/main/settings-store.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// T1-3 / T1-13: validate the settings patch sanitizer + the deepMerge/clamp path
// through the real SettingsStore (temp file, no Electron).

describe('validateSettingsPatch', () => {
  it('passes through a fully valid patch unchanged', () => {
    const patch = { theme: 'light' as const, accent: '#abcdef', window: { width: 1000, height: 700 } };
    const out = validateSettingsPatch(patch);
    expect(out).toEqual(patch);
  });

  it('drops an invalid theme', () => {
    const out = validateSettingsPatch({ theme: 'neon' as never });
    expect('theme' in out).toBe(false);
  });

  it('keeps all valid theme enum values', () => {
    for (const theme of ['dark', 'light', 'system'] as const) {
      expect(validateSettingsPatch({ theme }).theme).toBe(theme);
    }
  });

  it('drops a non-hex accent', () => {
    expect('accent' in validateSettingsPatch({ accent: 'red' as never })).toBe(false);
    expect('accent' in validateSettingsPatch({ accent: '#xyzxyz' as never })).toBe(false);
  });

  it('accepts #rgb, #rrggbb, and #rrggbbaa accents', () => {
    expect(validateSettingsPatch({ accent: '#fff' }).accent).toBe('#fff');
    expect(validateSettingsPatch({ accent: '#6366f1' }).accent).toBe('#6366f1');
    expect(validateSettingsPatch({ accent: '#6366f1cc' }).accent).toBe('#6366f1cc');
  });

  it('drops negative / zero / non-finite window dimensions', () => {
    expect(validateSettingsPatch({ window: { width: -100, height: 700 } }).window).toEqual({ height: 700 });
    expect(validateSettingsPatch({ window: { width: 0, height: 700 } }).window).toEqual({ height: 700 });
    expect(validateSettingsPatch({ window: { width: NaN, height: 700 } as never }).window).toEqual({ height: 700 });
  });

  it('keeps valid window dimensions and allows negative x/y (multi-monitor)', () => {
    const out = validateSettingsPatch({ window: { width: 1280, height: 800, x: -50, y: 0 } });
    expect(out.window).toEqual({ width: 1280, height: 800, x: -50, y: 0 });
  });

  it('drops a non-finite x/y', () => {
    expect(validateSettingsPatch({ window: { width: 1, height: 1, x: Infinity } as never }).window)
      .toEqual({ width: 1, height: 1 });
  });

  it('drops invalid editor numerics but keeps valid ones', () => {
    const out = validateSettingsPatch({ editor: { fontSize: -3, lineWidth: 800, spellcheck: 'yes' } as never });
    expect(out.editor).toEqual({ lineWidth: 800 });
  });

  it('strips a store-owned version field from any patch', () => {
    expect('version' in validateSettingsPatch({ version: 99 } as never)).toBe(false);
  });

  it('returns {} for a non-object patch', () => {
    expect(validateSettingsPatch(null as never)).toEqual({});
    expect(validateSettingsPatch(42 as never)).toEqual({});
  });
});

describe('SettingsStore deepMerge + clamp integration', () => {
  function freshStore() {
    const dir = mkdtempSync(join(tmpdir(), 'sv-settings-'));
    const file = join(dir, 'desktop-settings.json');
    return { store: new SettingsStore(file), dir };
  }

  it('deep-merges a nested patch without dropping sibling keys', () => {
    const { store, dir } = freshStore();
    try {
      store.set(validateSettingsPatch({ editor: { fontSize: 20 } as never }));
      const s = store.get();
      expect(s.editor.fontSize).toBe(20);
      // lineWidth / spellcheck from defaults must survive the partial merge.
      expect(s.editor.lineWidth).toBe(getDefaults().editor.lineWidth);
      expect(s.editor.spellcheck).toBe(getDefaults().editor.spellcheck);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a poisoned patch (negative width) never overwrites the good default', () => {
    const { store, dir } = freshStore();
    try {
      const before = store.get().window.width;
      store.set(validateSettingsPatch({ window: { width: -9999, height: 600 } }));
      const after = store.get();
      expect(after.window.width).toBe(before);     // invalid width dropped
      expect(after.window.height).toBe(600);       // valid height applied
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('version stays store-owned (=1) even if a patch tries to change it', () => {
    const { store, dir } = freshStore();
    try {
      store.set(validateSettingsPatch({ version: 7, theme: 'light' } as never));
      expect(store.get().version).toBe(1);
      expect(store.get().theme).toBe('light');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('arrays in a patch replace (not merge) — bookmarks', () => {
    const { store, dir } = freshStore();
    try {
      store.set({ bookmarks: [{ type: 'note', target: 'a.md', label: 'A' }] });
      store.set({ bookmarks: [{ type: 'search', target: 'q', label: 'Q' }] });
      expect(store.get().bookmarks).toEqual([{ type: 'search', target: 'q', label: 'Q' }]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
