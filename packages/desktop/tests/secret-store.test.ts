import { describe, it, expect, vi, beforeEach } from 'vitest';
// safeStorage mock: encryptString/decryptString round-trip + availability toggle
const enc = vi.fn((s: string) => Buffer.from('ENC:' + s));
const dec = vi.fn((b: Buffer) => b.toString().replace(/^ENC:/, ''));
let available = true;
vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => available,
    getSelectedStorageBackend: () => (available ? 'kwallet' : 'basic_text'),
    encryptString: enc, decryptString: dec,
  },
  app: { getPath: () => process.env.TEMP || '/tmp' },
}));

describe('secret-store', () => {
  beforeEach(() => { available = true; vi.clearAllMocks(); });

  it('round-trips a key through safeStorage to disk', async () => {
    const { SecretStore } = await import('../src/main/secret-store.js');
    const path = `${process.env.TEMP || '/tmp'}/sv-secrets-test-${Math.random().toString(36).slice(2)}.enc`;
    const s = new SecretStore(path);
    s.setSecret('anthropic', 'sk-ant-xyz');
    expect(s.hasSecret('anthropic')).toBe(true);
    expect(s.getSecret('anthropic')).toBe('sk-ant-xyz'); // in-memory read
    expect(enc).toHaveBeenCalled(); // never plaintext

    // Reload round-trip: second instance reads from disk and decrypts
    vi.clearAllMocks();
    const s2 = new SecretStore(path); // same path as s
    expect(s2.getSecret('anthropic')).toBe('sk-ant-xyz');
    expect(dec).toHaveBeenCalled(); // decryptString path exercised
  });

  it('clearSecret removes the key from store and does not persist it', async () => {
    const { SecretStore } = await import('../src/main/secret-store.js');
    const path = `${process.env.TEMP || '/tmp'}/sv-secrets-clear-${Math.random().toString(36).slice(2)}.enc`;
    const s = new SecretStore(path);
    s.setSecret('anthropic', 'sk-ant-xyz');
    expect(s.hasSecret('anthropic')).toBe(true);
    s.clearSecret('anthropic');
    expect(s.hasSecret('anthropic')).toBe(false);
    expect(s.getSecret('anthropic')).toBeUndefined();
  });

  it('when encryption unavailable: memory-only, NEVER writes plaintext to disk', async () => {
    available = false;
    const { SecretStore } = await import('../src/main/secret-store.js');
    const path = `${process.env.TEMP || '/tmp'}/sv-secrets-noenc-${Math.random().toString(36).slice(2)}.enc`;
    const s = new SecretStore(path);
    s.setSecret('openai', 'sk-mem');
    expect(s.getSecret('openai')).toBe('sk-mem'); // available in-session
    expect(enc).not.toHaveBeenCalled();
    const fs = await import('node:fs');
    expect(fs.existsSync(path)).toBe(false); // nothing on disk
    expect(s.isPersistent()).toBe(false);
  });

  // ─── Track B: OAuth token blob round-trip + basic_text refuse ───
  it('setToken/getToken round-trips a token blob through safeStorage; clearToken removes it', async () => {
    const { SecretStore } = await import('../src/main/secret-store.js');
    const path = `${process.env.TEMP || '/tmp'}/sv-token-${Math.random().toString(36).slice(2)}.enc`;
    const s = new SecretStore(path);
    const blob = {
      access_token: 'at-1', refresh_token: 'rt-1', id_token: 'id-1',
      expires_at: 1234, accountId: 'acct-x', plan: 'plus',
    };
    expect(s.setToken('openai-chatgpt', blob)).toBe(true);
    expect(s.hasToken('openai-chatgpt')).toBe(true);
    expect(s.getToken('openai-chatgpt')).toEqual(blob);
    expect(enc).toHaveBeenCalled(); // never plaintext

    // Reload round-trip — a second instance decrypts the blob.
    vi.clearAllMocks();
    const s2 = new SecretStore(path);
    expect(s2.getToken('openai-chatgpt')).toEqual(blob);

    s2.clearToken('openai-chatgpt');
    expect(s2.hasToken('openai-chatgpt')).toBe(false);
    expect(s2.getToken('openai-chatgpt')).toBeUndefined();
  });

  it('token blob and api key live under distinct keys (no collision)', async () => {
    const { SecretStore } = await import('../src/main/secret-store.js');
    const path = `${process.env.TEMP || '/tmp'}/sv-token-iso-${Math.random().toString(36).slice(2)}.enc`;
    const s = new SecretStore(path);
    s.setSecret('openai-chatgpt', 'sk-should-not-collide');
    s.setToken('openai-chatgpt', { access_token: 'at', refresh_token: 'rt', id_token: '', expires_at: 0, accountId: 'a', plan: '' });
    // getSecret (api-key slot) and getToken (oauth: slot) are independent.
    expect(s.getSecret('openai-chatgpt')).toBe('sk-should-not-collide');
    expect(s.getToken('openai-chatgpt')?.access_token).toBe('at');
  });

  it('basic_text backend BLOCKS setToken — refresh_token never on plaintext disk', async () => {
    available = false; // basic_text / no keyring → not persistent
    const { SecretStore } = await import('../src/main/secret-store.js');
    const path = `${process.env.TEMP || '/tmp'}/sv-token-noenc-${Math.random().toString(36).slice(2)}.enc`;
    const s = new SecretStore(path);
    const ok = s.setToken('openai-chatgpt', { access_token: 'at', refresh_token: 'rt', id_token: '', expires_at: 0, accountId: 'a', plan: '' });
    expect(ok).toBe(false);            // refused
    expect(s.hasToken('openai-chatgpt')).toBe(false);
    expect(enc).not.toHaveBeenCalled();
    const fs = await import('node:fs');
    expect(fs.existsSync(path)).toBe(false); // nothing on disk
  });
});
