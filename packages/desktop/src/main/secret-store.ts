// Stellavault Desktop — Secret Store (main process)
// API keys (and later OAuth tokens) encrypted at rest via electron safeStorage.
// Design Ref: llm-auth-secret-storage-design.md §3 (Track A).
// safeStorage UNAVAILABLE (e.g. Linux without keyring → 'basic_text') ⇒ MEMORY-ONLY.
// We NEVER write plaintext secrets to disk. Atomic write mirrors settings-store.ts:113.
import { safeStorage, app } from 'electron';
import { join, dirname } from 'node:path';
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';

type SecretMap = Record<string, string>; // provider -> key (or token, later)

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
