// Stellavault Desktop — Settings secret redaction (pure, testable)
// Design Ref: §T3 — settings:get must never leak apiKey/tokens to the renderer.
// Plan SC: renderer receives hasKey + keychainAvailable instead of raw key material.
//
// This module is intentionally free of Electron imports so it can run in unit
// tests (vitest) without the Electron runtime.

import type { AppSettings } from '../shared/ipc-types.js';

/** Optional OAuth status mirror (Track B) — non-secret metadata derived in main from the stored
 *  token blob. NEVER contains tokens. Passed in so this module stays Electron-free. */
export interface OAuthRedactStatus {
  hasToken: boolean;
  accountId?: string;
  expiresAt?: number;
  plan?: string;
  experimental?: boolean;
}

/**
 * Return a clone of `settings` with the `ai` sub-object reconstructed from a POSITIVE ALLOWLIST —
 * it is built field-by-field, NEVER spread from the source. This is the security-load-bearing
 * change: a `...spread` is allow-by-default, so any future token sibling (ai.refresh_token,
 * ai.access_token, ai.oauthToken, …) injected into the stored settings would silently leak to the
 * renderer. By naming ONLY the safe fields, an injected secret is dropped because it is not in the
 * allowlist — not merely because it is named in a denylist.
 *
 * Allowlisted ai fields: provider, model, baseURL, hasKey, hasToken, expiresAt (oauthExpiresAt),
 * accountId (oauthAccountId), plan (oauthPlan), oauthExperimental, keychainAvailable.
 *
 * @param settings          Raw AppSettings from SettingsStore.get()
 * @param hasKeyFor         Predicate: does SecretStore have an api key for this provider?
 * @param keychainAvailable True when safeStorage is persistent (OS keychain backed)
 * @param oauth             Optional Track B OAuth status (hasToken + non-secret metadata)
 */
export function redactSecrets(
  settings: AppSettings,
  hasKeyFor: (provider: string) => boolean,
  keychainAvailable: boolean,
  oauth?: OAuthRedactStatus,
): AppSettings {
  // Shallow-clone top level to avoid mutating the store's in-memory settings.
  const out: AppSettings = { ...settings };

  if (out.ai) {
    const src = out.ai as NonNullable<AppSettings['ai']>;
    // POSITIVE ALLOWLIST — construct explicitly, never `...src`.
    const safeAi: NonNullable<AppSettings['ai']> = {
      provider: src.provider,
      model: src.model,
      baseURL: src.baseURL,
      hasKey: hasKeyFor(src.provider ?? ''),
      keychainAvailable,
      hasToken: oauth?.hasToken ?? false,
      oauthAccountId: oauth?.accountId,
      oauthExpiresAt: oauth?.expiresAt,
      oauthPlan: oauth?.plan,
      oauthExperimental: oauth?.experimental ?? false,
    };
    out.ai = safeAi;
  }

  return out;
}
