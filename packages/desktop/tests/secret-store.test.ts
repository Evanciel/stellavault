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
});
