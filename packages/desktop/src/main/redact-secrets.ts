// Stellavault Desktop — Settings secret redaction (pure, testable)
// Design Ref: §T3 — settings:get must never leak apiKey/tokens to the renderer.
// Plan SC: renderer receives hasKey + keychainAvailable instead of raw key material.
//
// This module is intentionally free of Electron imports so it can run in unit
// tests (vitest) without the Electron runtime.

import type { AppSettings } from '../shared/ipc-types.js';

/**
 * Return a deep-clone of `settings` with all secret material removed and
 * replaced by safe display indicators.
 *
 * - `ai.apiKey`  → deleted (never reaches the renderer)
 * - `ai.hasKey`  → set from `hasKeyFor(provider)` (SecretStore.hasSecret)
 * - `ai.keychainAvailable` → set from the `keychainAvailable` argument
 *
 * All other settings fields are forwarded unchanged.
 *
 * @param settings         Raw AppSettings from SettingsStore.get()
 * @param hasKeyFor        Predicate: does SecretStore have a key for this provider?
 * @param keychainAvailable True when safeStorage is persistent (OS keychain backed)
 */
export function redactSecrets(
  settings: AppSettings,
  hasKeyFor: (provider: string) => boolean,
  keychainAvailable: boolean,
): AppSettings {
  // Shallow-clone top level to avoid mutating the store's in-memory settings.
  const out: AppSettings = { ...settings };

  if (out.ai) {
    // Clone the ai sub-object and strip all secret fields.
    // We destructure to explicitly discard apiKey (and any future key fields).
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { apiKey: _discardedKey, ...safeAi } = out.ai as typeof out.ai & { apiKey?: string };
    out.ai = {
      ...safeAi,
      hasKey: hasKeyFor(safeAi.provider ?? ''),
      keychainAvailable,
    };
  }

  return out;
}
