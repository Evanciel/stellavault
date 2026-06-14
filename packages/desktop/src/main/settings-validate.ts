// Stellavault Desktop — Settings patch validation (pure, testable)
// T1-13: a poisoned settings:set patch (negative window size, garbage theme,
// non-hex accent) must NOT persist or re-apply. This sanitizer drops invalid
// fields from a patch BEFORE it reaches the deep-merge in SettingsStore.set.
// Valid fields pass through untouched; invalid ones are removed (not coerced),
// so the previous good value (or default) is retained.

import type { AppSettings } from '../shared/ipc-types.js';

const VALID_THEMES = new Set(['dark', 'light', 'system']);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** A finite number strictly greater than 0. */
function isPositive(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}

/** A finite integer (window x/y may be 0 or negative — multi-monitor). */
function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** #rgb / #rrggbb / #rrggbbaa hex color. */
function isHexColor(v: unknown): v is string {
  return typeof v === 'string' && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(v);
}

/**
 * Return a shallow-cloned patch with invalid scalar fields removed.
 * Only validates the fields that carry hard constraints (theme, accent, window
 * dimensions, editor numerics); everything else passes through. Nested objects
 * are cloned so the caller never mutates the renderer-supplied input.
 */
export function validateSettingsPatch(patch: Partial<AppSettings>): Partial<AppSettings> {
  if (!isPlainObject(patch)) return {};
  const out: Record<string, unknown> = { ...patch };

  // version is store-owned — never accept it from a patch.
  delete out.version;

  if ('theme' in out && !VALID_THEMES.has(out.theme as string)) {
    delete out.theme;
  }

  if ('accent' in out && !isHexColor(out.accent)) {
    delete out.accent;
  }

  if ('window' in out) {
    if (isPlainObject(out.window)) {
      const w = { ...out.window } as Record<string, unknown>;
      if ('width' in w && !isPositive(w.width)) delete w.width;
      if ('height' in w && !isPositive(w.height)) delete w.height;
      if ('x' in w && !isFiniteNumber(w.x)) delete w.x;
      if ('y' in w && !isFiniteNumber(w.y)) delete w.y;
      out.window = w;
    } else {
      delete out.window;
    }
  }

  if ('editor' in out) {
    if (isPlainObject(out.editor)) {
      const e = { ...out.editor } as Record<string, unknown>;
      if ('fontSize' in e && !isPositive(e.fontSize)) delete e.fontSize;
      if ('lineWidth' in e && !isPositive(e.lineWidth)) delete e.lineWidth;
      if ('spellcheck' in e && typeof e.spellcheck !== 'boolean') delete e.spellcheck;
      out.editor = e;
    } else {
      delete out.editor;
    }
  }

  return out as Partial<AppSettings>;
}
