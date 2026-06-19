// Stellavault Desktop — Legacy API-key migration helper (T2-Task2)
// Pure function: no Electron, no FS I/O — takes settings + a SecretStore-compatible
// sink (Pick<SecretStore, 'setSecret'>) and returns the settings patch to apply, or
// null when there is nothing to migrate. Exported standalone so tests don't need to
// mock the entire Electron environment.
//
// Design Ref: llm-auth-secret-storage-design.md §4-B (one-time plaintext migration)

/**
 * If `aiSettings` contains a non-empty plaintext `apiKey`, move it into `store`
 * and return a settings patch object that strips the key from the ai sub-object.
 * Returns null when there is nothing to migrate (no key, empty key, undefined).
 */
export function migrateLegacyApiKey(
  aiSettings: { provider?: string; apiKey?: string; [key: string]: unknown } | undefined,
  store: Pick<{ setSecret(provider: string, value: string): void }, 'setSecret'>,
): Record<string, unknown> | null {
  if (!aiSettings || typeof aiSettings.apiKey !== 'string' || !aiSettings.apiKey.trim()) {
    return null; // nothing to migrate
  }
  const provider = typeof aiSettings.provider === 'string' ? aiSettings.provider : 'anthropic';
  store.setSecret(provider, aiSettings.apiKey.trim());
  // Return a settings patch that strips apiKey from the ai sub-object.
  // deepMerge treats null as an explicit delete, so apiKey: null removes the key
  // from the persisted file (apiKey: undefined would be silently skipped).
  const { apiKey: _removed, ...rest } = aiSettings;
  return { ai: { ...rest, apiKey: null } };
}
