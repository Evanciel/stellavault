// Unit tests for migrateLegacyApiKey (T2-Task2).
// Pure function — no Electron, no disk I/O needed; SecretStore is injected via its
// Pick<SecretStore, 'setSecret'> interface so we can use a plain spy object.
import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// migrateLegacyApiKey is exported from index.ts but index.ts imports Electron modules
// at the top level, so we can't import it directly in tests without mocking Electron.
// Instead, the helper is re-exported from a small, Electron-free module for testability.
import { migrateLegacyApiKey } from '../src/main/migrate-legacy-api-key.js';
import { SettingsStore } from '../src/main/settings-store.js';

describe('migrateLegacyApiKey', () => {
  it('moves a plaintext apiKey into SecretStore and returns a patch that strips it', () => {
    const setSecret = vi.fn();
    const store = { setSecret };

    const ai = { provider: 'anthropic', apiKey: 'sk-ant-test', model: 'claude-opus-4-5' };
    const patch = migrateLegacyApiKey(ai, store);

    // Key must be stored in SecretStore
    expect(setSecret).toHaveBeenCalledOnce();
    expect(setSecret).toHaveBeenCalledWith('anthropic', 'sk-ant-test');

    // Patch must remove apiKey from the ai sub-object.
    // The patch uses null (not undefined) so deepMerge actually deletes the key.
    expect(patch).not.toBeNull();
    expect((patch as any).ai.apiKey).toBeNull();
    // Other fields survive
    expect((patch as any).ai.provider).toBe('anthropic');
    expect((patch as any).ai.model).toBe('claude-opus-4-5');
  });

  it('returns null when no apiKey is present (nothing to migrate)', () => {
    const setSecret = vi.fn();
    const patch = migrateLegacyApiKey({ provider: 'anthropic', model: 'claude-opus-4-5' }, { setSecret });
    expect(patch).toBeNull();
    expect(setSecret).not.toHaveBeenCalled();
  });

  it('returns null when apiKey is an empty string', () => {
    const setSecret = vi.fn();
    const patch = migrateLegacyApiKey({ provider: 'anthropic', apiKey: '', model: 'claude' }, { setSecret });
    expect(patch).toBeNull();
    expect(setSecret).not.toHaveBeenCalled();
  });

  it('returns null when apiKey is only whitespace', () => {
    const setSecret = vi.fn();
    const patch = migrateLegacyApiKey({ provider: 'openai', apiKey: '   ', model: 'gpt-4' }, { setSecret });
    expect(patch).toBeNull();
    expect(setSecret).not.toHaveBeenCalled();
  });

  it('returns null when ai settings are undefined', () => {
    const setSecret = vi.fn();
    const patch = migrateLegacyApiKey(undefined, { setSecret });
    expect(patch).toBeNull();
    expect(setSecret).not.toHaveBeenCalled();
  });

  it('falls back to provider "anthropic" when provider field is missing', () => {
    const setSecret = vi.fn();
    const patch = migrateLegacyApiKey({ apiKey: 'sk-ant-noprovider', model: 'claude' }, { setSecret });
    expect(setSecret).toHaveBeenCalledWith('anthropic', 'sk-ant-noprovider');
    expect(patch).not.toBeNull();
  });

  it('trims whitespace from the api key before storing', () => {
    const setSecret = vi.fn();
    migrateLegacyApiKey({ provider: 'openai', apiKey: '  sk-openai-123  ', model: 'gpt-4' }, { setSecret });
    expect(setSecret).toHaveBeenCalledWith('openai', 'sk-openai-123');
  });

  // Integration: verify the patch actually removes apiKey from SettingsStore on disk.
  it('patch applied to SettingsStore actually removes apiKey from persisted settings', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sv-migrate-'));
    const file = join(dir, 'desktop-settings.json');
    try {
      // Seed a store with a legacy plaintext apiKey (simulates pre-migration state).
      const store = new SettingsStore(file);
      store.set({ ai: { provider: 'anthropic', apiKey: 'sk-ant-plaintext', model: 'claude-opus-4-5' } } as never);

      // Confirm apiKey is in the store before migration.
      const before = (store.get() as never as Record<string, unknown> & { ai?: Record<string, unknown> }).ai;
      expect(before?.apiKey).toBe('sk-ant-plaintext');

      // Run migration.
      const setSecret = vi.fn();
      const patch = migrateLegacyApiKey(before as { apiKey: string }, { setSecret });
      expect(patch).not.toBeNull();
      expect(setSecret).toHaveBeenCalledWith('anthropic', 'sk-ant-plaintext');

      // Apply the patch (mirrors what index.ts does).
      store.set(patch as Parameters<typeof store.set>[0]);

      // apiKey must be gone from the in-memory store.
      const afterMem = (store.get() as never as Record<string, unknown> & { ai?: Record<string, unknown> }).ai;
      expect(afterMem?.apiKey).toBeUndefined();

      // apiKey must also be absent from a freshly reloaded store (disk was updated).
      const reloaded = new SettingsStore(file);
      const afterDisk = (reloaded.get() as never as Record<string, unknown> & { ai?: Record<string, unknown> }).ai;
      expect(afterDisk?.apiKey).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
