// Hotkey system (W1-12) — single window keydown listener, ~no deps (plan §4-C).
// Chords are normalized as 'mod+alt+shift+key' (mod = Ctrl, or Cmd on macOS).

import { listCommands, runCommand, type CommandDef } from './commands.js';

const MODIFIER_KEYS = new Set(['control', 'meta', 'shift', 'alt']);

/** Normalize a chord string: lowercase, canonical modifier order. */
export function normalizeChord(chord: string): string {
  const parts = chord.toLowerCase().split('+').map((p) => p.trim()).filter(Boolean);
  const mods = { mod: false, alt: false, shift: false };
  let key = '';
  for (const p of parts) {
    if (p === 'mod' || p === 'ctrl' || p === 'cmd' || p === 'meta') mods.mod = true;
    else if (p === 'alt' || p === 'option') mods.alt = true;
    else if (p === 'shift') mods.shift = true;
    else key = p;
  }
  if (!key) return '';
  const out: string[] = [];
  if (mods.mod) out.push('mod');
  if (mods.alt) out.push('alt');
  if (mods.shift) out.push('shift');
  out.push(key);
  return out.join('+');
}

/** Build a normalized chord from a KeyboardEvent; null if only modifiers held. */
export function chordFromEvent(e: KeyboardEvent): string | null {
  const key = e.key.toLowerCase();
  if (MODIFIER_KEYS.has(key)) return null;
  const out: string[] = [];
  if (e.ctrlKey || e.metaKey) out.push('mod');
  if (e.altKey) out.push('alt');
  if (e.shiftKey) out.push('shift');
  out.push(key === ' ' ? 'space' : key);
  return out.join('+');
}

/** Human display: 'mod+shift+p' → 'Ctrl+Shift+P' (or '⌘⇧P' on macOS). */
export function formatChord(chord: string): string {
  if (!chord) return '';
  const isMac = typeof window !== 'undefined' && window.stellavault?.platform === 'darwin';
  return normalizeChord(chord).split('+').map((p) => {
    if (p === 'mod') return isMac ? '⌘' : 'Ctrl';
    if (p === 'shift') return isMac ? '⇧' : 'Shift';
    if (p === 'alt') return isMac ? '⌥' : 'Alt';
    return p.length === 1 ? p.toUpperCase() : p[0].toUpperCase() + p.slice(1);
  }).join(isMac ? '' : '+');
}

/** Effective binding for a command: settings override, else its default. */
export function bindingFor(cmd: CommandDef, hotkeys: Record<string, string>): string {
  const bound = hotkeys[cmd.id] !== undefined ? hotkeys[cmd.id] : (cmd.defaultKeys ?? '');
  return normalizeChord(bound);
}

/** Conflict detection for the settings UI: chord → ids bound to it (>1 = conflict). */
export function findConflicts(hotkeys: Record<string, string>): Map<string, string[]> {
  const byChord = new Map<string, string[]>();
  for (const cmd of listCommands()) {
    const chord = bindingFor(cmd, hotkeys);
    if (!chord) continue;
    const ids = byChord.get(chord) ?? [];
    ids.push(cmd.id);
    byChord.set(chord, ids);
  }
  const conflicts = new Map<string, string[]>();
  for (const [chord, ids] of byChord) {
    if (ids.length > 1) conflicts.set(chord, ids);
  }
  return conflicts;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return true;
  return target.isContentEditable;
}

/**
 * Install the global listener. `getHotkeys` reads the live settings keymap so
 * rebinds apply without re-installing. Returns cleanup.
 */
export function initHotkeys(getHotkeys: () => Record<string, string>): () => void {
  function onKeyDown(e: KeyboardEvent): void {
    const chord = chordFromEvent(e);
    if (!chord) return;
    // Bare keys (no modifier) are never global hotkeys — avoids eating typing.
    if (!chord.includes('+')) return;

    const hotkeys = getHotkeys();
    const inEditor = isEditableTarget(e.target);
    for (const cmd of listCommands()) {
      if (bindingFor(cmd, hotkeys) !== chord) continue;
      if (inEditor && !cmd.allowInEditor) continue;
      e.preventDefault();
      runCommand(cmd.id);
      return;
    }
  }

  window.addEventListener('keydown', onKeyDown);
  return () => window.removeEventListener('keydown', onKeyDown);
}
