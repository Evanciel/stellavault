// Stellavault Desktop — Settings Store (main process)
// Design Ref: §4-B — own JSON store at ~/.stellavault/desktop-settings.json,
// no electron-store dependency. Atomic write (tmp + rename), version field +
// migration stub, deep-merge set(patch). The legacy ~/.stellavault.json
// (vaultPath/dbPath) is intentionally NOT touched — different lifecycle.

import { join, dirname } from 'node:path';
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { homedir } from 'node:os';
import type { AppSettings } from '../shared/ipc-types.js';

const SETTINGS_PATH = join(homedir(), '.stellavault', 'desktop-settings.json');

export function getDefaults(): AppSettings {
  return {
    version: 1,
    theme: 'dark',
    accent: '#6366f1', // matches theme.css --accent (renderer default mirror)
    editor: { fontSize: 15, lineWidth: 720, spellcheck: false },
    hotkeys: {},
    dailyNotes: { folder: 'Daily', format: 'YYYY-MM-DD', templatePath: '' },
    templatesFolder: 'Templates',
    bookmarks: [],
    session: { openTabs: [], activeTab: null },
    window: { width: 1400, height: 900 },
  };
}

// ─── Migration stub ──────────────────────────────────
// When the schema changes, bump `version` in getDefaults() and add a step here.
function migrate(raw: Record<string, unknown>): Record<string, unknown> {
  // v1 is the initial schema — nothing to migrate yet.
  return raw;
}

// ─── Deep merge (plain objects only; arrays replace) ─

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function deepMerge<T extends Record<string, unknown>>(base: T, patch: Record<string, unknown>): T {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (isPlainObject(value) && isPlainObject(out[key])) {
      out[key] = deepMerge(out[key] as Record<string, unknown>, value);
    } else {
      out[key] = value;
    }
  }
  return out as T;
}

// ─── Store ───────────────────────────────────────────

export class SettingsStore {
  private settings: AppSettings;
  private readonly filePath: string;

  constructor(filePath: string = SETTINGS_PATH) {
    this.filePath = filePath;
    this.settings = this.load();
  }

  get(): AppSettings {
    return this.settings;
  }

  /** Deep-merge a partial patch, persist atomically, return the merged settings. */
  set(patch: Partial<AppSettings>): AppSettings {
    this.settings = deepMerge(
      this.settings as unknown as Record<string, unknown>,
      patch as Record<string, unknown>
    ) as unknown as AppSettings;
    this.settings.version = 1; // version is store-owned, never patched from renderer
    this.save();
    return this.settings;
  }

  private load(): AppSettings {
    try {
      if (existsSync(this.filePath)) {
        const raw = JSON.parse(readFileSync(this.filePath, 'utf-8'));
        if (isPlainObject(raw)) {
          const migrated = migrate(raw);
          // Merge over defaults so missing keys (older files) fill in.
          return deepMerge(
            getDefaults() as unknown as Record<string, unknown>,
            migrated
          ) as unknown as AppSettings;
        }
      }
    } catch (err) {
      console.error('[settings-store] Load failed, using defaults:', err);
    }
    return getDefaults();
  }

  /** Atomic write: write to tmp file then rename over the target. */
  private save(): void {
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      const tmp = `${this.filePath}.tmp`;
      writeFileSync(tmp, JSON.stringify(this.settings, null, 2), 'utf-8');
      renameSync(tmp, this.filePath);
    } catch (err) {
      console.error('[settings-store] Save failed:', err);
    }
  }
}
