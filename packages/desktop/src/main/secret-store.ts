// Stellavault Desktop — Secret Store (main process)
// API keys (and later OAuth tokens) encrypted at rest via electron safeStorage.
// Design Ref: llm-auth-secret-storage-design.md §3 (Track A).
// safeStorage UNAVAILABLE (e.g. Linux without keyring → 'basic_text') ⇒ MEMORY-ONLY.
// We NEVER write plaintext secrets to disk. Atomic write mirrors settings-store.ts:113.
import { safeStorage, app } from 'electron';
import { join, dirname } from 'node:path';
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';

type SecretMap = Record<string, string>; // provider -> key (and, under `oauth:<provider>`, a token blob JSON)

// Track B: the OAuth token blob persisted (JSON-stringified) under the `oauth:<provider>` key in the
// SAME encrypted map as api keys. access/refresh/id_token are bearer-equivalent to the ChatGPT
// subscription, so this NEVER hits plaintext disk — setToken refuses unless isPersistent() (the
// caller, oauth-openai.ts, also gate-refuses before starting the flow).
export interface TokenBlob {
  access_token: string;
  refresh_token: string;
  id_token: string;
  expires_at: number; // epoch ms (access_token exp*1000)
  accountId: string;  // chatgpt_account_id routing hint (id_token claims; NOT signature-verified)
  plan: string;       // chatgpt_plan_type
}

/** Storage key for a provider's OAuth token blob — a distinct prefix so it never collides with the
 *  api-key entry (which is keyed by the bare provider name). */
function tokenKey(provider: string): string { return `oauth:${provider}`; }

export class SecretStore {
  private mem: SecretMap = {};
  private readonly filePath: string;
  private readonly persistent: boolean;

  constructor(filePath?: string) {
    this.filePath = filePath ?? join(app.getPath('home'), '.stellavault', 'secrets.enc');
    // basic_text backend = plaintext fallback ⇒ treat as NOT persistent (memory-only).
    this.persistent =
      safeStorage.isEncryptionAvailable() &&
      // `?.` is a defensive guard: getSelectedStorageBackend is absent in Electron <15 and test shims.
      safeStorage.getSelectedStorageBackend?.() !== 'basic_text';
    if (this.persistent) this.mem = this.load();
  }

  isPersistent(): boolean { return this.persistent; }
  hasSecret(provider: string): boolean { return !!this.mem[provider]; }
  getSecret(provider: string): string | undefined { return this.mem[provider]; }

  setSecret(provider: string, value: string): void {
    const v = (value ?? '').trim();
    if (!v) { this.clearSecret(provider); return; }
    this.mem[provider] = v;
    if (this.persistent) this.save();
  }

  clearSecret(provider: string): void {
    delete this.mem[provider];
    if (this.persistent) this.save();
  }

  // ─── Track B: OAuth token blob (JSON in the same encrypted map under `oauth:<provider>`) ───
  // setToken refuses on a non-persistent (basic_text / no keyring) backend — the long-lived
  // refresh_token must never land in plaintext. Returns false when refused so the caller can
  // surface it. clearToken zeroes the entry. getToken parses defensively (corrupt → undefined).
  setToken(provider: string, blob: TokenBlob): boolean {
    if (!this.persistent) return false; // NO-KEYCHAIN: never persist a bearer token unencrypted
    this.mem[tokenKey(provider)] = JSON.stringify(blob);
    this.save();
    return true;
  }

  getToken(provider: string): TokenBlob | undefined {
    const raw = this.mem[tokenKey(provider)];
    if (!raw) return undefined;
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return undefined;
      const p = parsed as Partial<TokenBlob>;
      if (typeof p.access_token !== 'string' || typeof p.refresh_token !== 'string') return undefined;
      return {
        access_token: p.access_token,
        refresh_token: p.refresh_token,
        id_token: typeof p.id_token === 'string' ? p.id_token : '',
        expires_at: Number(p.expires_at) || 0,
        accountId: typeof p.accountId === 'string' ? p.accountId : '',
        plan: typeof p.plan === 'string' ? p.plan : '',
      };
    } catch {
      return undefined;
    }
  }

  hasToken(provider: string): boolean { return !!this.mem[tokenKey(provider)]; }

  clearToken(provider: string): void {
    delete this.mem[tokenKey(provider)];
    if (this.persistent) this.save();
  }

  private load(): SecretMap {
    try {
      if (!existsSync(this.filePath)) return {};
      const buf = readFileSync(this.filePath);
      const json = safeStorage.decryptString(buf);
      const parsed = JSON.parse(json);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (err) {
      console.error('[secret-store] load failed (resetting):', err instanceof Error ? err.message : err);
      return {};
    }
  }

  private save(): void {
    try {
      const enc = safeStorage.encryptString(JSON.stringify(this.mem)); // throws ⇒ caught, no plaintext
      mkdirSync(dirname(this.filePath), { recursive: true });
      const tmp = `${this.filePath}.tmp`;
      writeFileSync(tmp, enc);
      renameSync(tmp, this.filePath);
    } catch (err) {
      console.error('[secret-store] save failed (NOT writing plaintext):', err instanceof Error ? err.message : err);
    }
  }
}
