import { describe, it, expect } from 'vitest';
import { redactSecrets } from '../src/main/redact-secrets.js';
import type { AppSettings } from '../src/shared/ipc-types.js';

// Security regression gate — settings:get output must NEVER leak API keys/tokens
// to the renderer. If these tests fail, a secret is escaping to the renderer process.

describe('redactSecrets', () => {
  it('settings:get output never contains apiKey/token', () => {
    const raw = {
      ai: { provider: 'anthropic', apiKey: 'sk-ant-SECRET', model: 'claude-opus-4-5' },
    } as unknown as AppSettings;

    const out = redactSecrets(raw, () => true, true);
    expect(JSON.stringify(out)).not.toContain('sk-ant-SECRET');
    expect(JSON.stringify(out)).not.toMatch(/"apiKey"|access_token|refresh_token/);
    expect(out.ai?.hasKey).toBe(true);
  });

  it('hasKey reflects whether secretStore has a key for the provider', () => {
    const raw = {
      ai: { provider: 'anthropic', apiKey: 'irrelevant', model: 'x' },
    } as unknown as AppSettings;

    const withKey = redactSecrets(raw, () => true, false);
    expect(withKey.ai?.hasKey).toBe(true);

    const withoutKey = redactSecrets(raw, () => false, false);
    expect(withoutKey.ai?.hasKey).toBe(false);
  });

  it('keychainAvailable is reflected in the output', () => {
    const raw = {
      ai: { provider: 'anthropic', apiKey: 'sk-test', model: 'x' },
    } as unknown as AppSettings;

    expect(redactSecrets(raw, () => true, true).ai?.keychainAvailable).toBe(true);
    expect(redactSecrets(raw, () => true, false).ai?.keychainAvailable).toBe(false);
  });

  it('returns the same settings structure when ai is absent', () => {
    const raw = { theme: 'dark' } as unknown as AppSettings;
    const out = redactSecrets(raw, () => false, false);
    expect(out.ai).toBeUndefined();
    expect(JSON.stringify(out)).not.toMatch(/"apiKey"|access_token|refresh_token/);
  });

  it('does not mutate the input settings object', () => {
    const raw = {
      ai: { provider: 'anthropic', apiKey: 'sk-ant-MUST-NOT-MUTATE', model: 'x' },
    } as unknown as AppSettings;

    redactSecrets(raw, () => true, true);
    // Input should still have apiKey (we only strip from the returned clone)
    expect((raw.ai as Record<string, unknown>).apiKey).toBe('sk-ant-MUST-NOT-MUTATE');
  });

  it('strips apiKey even when ai has unknown extra fields', () => {
    const raw = {
      ai: {
        provider: 'openai',
        apiKey: 'sk-openai-SECRET',
        model: 'gpt-4o',
        baseURL: 'https://api.openai.com',
        someUnknownField: 'value',
      },
    } as unknown as AppSettings;

    const out = redactSecrets(raw, () => true, true);
    expect(JSON.stringify(out)).not.toContain('sk-openai-SECRET');
    expect(out.ai?.provider).toBe('openai');
    expect(out.ai?.model).toBe('gpt-4o');
    expect(out.ai?.baseURL).toBe('https://api.openai.com');
  });

  // ─── Track B: positive-allowlist construction drops ANY injected token sibling ───
  it('an injected ai.refresh_token / access_token / id_token is DROPPED (allowlist, not denylist)', () => {
    const raw = {
      ai: {
        provider: 'openai-chatgpt',
        model: 'gpt-5',
        // attacker/buggy injection of token siblings into the stored settings:
        refresh_token: 'rt-LEAK',
        access_token: 'at-LEAK',
        id_token: 'eyJ-LEAK',
        oauthToken: 'tok-LEAK',
      },
    } as unknown as AppSettings;

    // Even WITHOUT passing an oauth status, the allowlist construction must drop the tokens —
    // they are not in the named field set, so they never reach the output (not merely "removed by name").
    const out = redactSecrets(raw, () => false, true);
    const json = JSON.stringify(out);
    expect(json).not.toContain('rt-LEAK');
    expect(json).not.toContain('at-LEAK');
    expect(json).not.toContain('eyJ-LEAK');
    expect(json).not.toContain('tok-LEAK');
    expect(json).not.toMatch(/refresh_token|access_token|"id_token"|oauthToken/);
    expect(out.ai?.provider).toBe('openai-chatgpt');
    expect(out.ai?.hasToken).toBe(false);
  });

  it('the non-secret OAuth status (hasToken/accountId/plan/expiresAt/experimental) IS reflected', () => {
    const raw = { ai: { provider: 'openai-chatgpt', model: 'gpt-5' } } as unknown as AppSettings;
    const out = redactSecrets(raw, () => false, true, {
      hasToken: true, accountId: 'acct-9', plan: 'pro', expiresAt: 1700, experimental: true,
    });
    expect(out.ai?.hasToken).toBe(true);
    expect(out.ai?.oauthAccountId).toBe('acct-9');
    expect(out.ai?.oauthPlan).toBe('pro');
    expect(out.ai?.oauthExpiresAt).toBe(1700);
    expect(out.ai?.oauthExperimental).toBe(true);
  });

  it('non-ai settings (theme, editor, etc.) pass through unchanged', () => {
    const raw = {
      theme: 'light',
      accent: '#6366f1',
      editor: { fontSize: 16, lineWidth: 720, spellcheck: true },
      ai: { provider: 'anthropic', apiKey: 'sk-ant-SECRET', model: 'x' },
    } as unknown as AppSettings;

    const out = redactSecrets(raw, () => true, true);
    expect(out.theme).toBe('light');
    expect(out.accent).toBe('#6366f1');
    expect(out.editor?.fontSize).toBe(16);
    expect(out.editor?.spellcheck).toBe(true);
  });
});
