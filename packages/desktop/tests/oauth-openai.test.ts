// Track B — OpenAiOAuth device flow + token lifecycle (Plan B9).
// The hardened transport (safePostJson/safePostForm) is INJECTED so these tests run without
// electron net / DNS. We still mock electron (oauth-openai → chat-engine/outbound-fetch import it).
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('electron', () => ({
  net: { request: vi.fn() },
}));

// ── base64url JWT builder (no sig) — claims carry the chatgpt account + plan + exp ──
function jwt(claims: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${b64({ alg: 'none' })}.${b64(claims)}.sig`;
}
const accessClaims = (exp: number) => jwt({
  exp,
  'https://api.openai.com/auth': { chatgpt_account_id: 'acct-123', chatgpt_plan_type: 'plus' },
});

// ── In-memory SecretStore stub (persistent toggle + token slot) ──
function makeStore(persistent = true) {
  let blob: any = undefined;
  return {
    isPersistent: () => persistent,
    getToken: () => blob,
    setToken: (_p: string, b: any) => { if (!persistent) return false; blob = b; return true; },
    clearToken: () => { blob = undefined; },
    hasToken: () => !!blob,
    _peek: () => blob,
  };
}

const HTTP = (status: number, body: unknown) => ({ status, body: typeof body === 'string' ? body : JSON.stringify(body) });

beforeEach(() => vi.clearAllMocks());

describe('OpenAiOAuth — device flow', () => {
  it('no-keychain: REFUSES to start (refresh_token must never hit plaintext disk)', async () => {
    const { OpenAiOAuth, OAuthError } = await import('../src/main/oauth-openai.js');
    const store = makeStore(false); // basic_text / no keyring
    const oauth = new OpenAiOAuth({ secretStore: store as any, postJson: vi.fn(), postForm: vi.fn() });
    const progress: any[] = [];
    await expect(oauth.startDeviceFlow(1, (p) => progress.push(p))).rejects.toBeInstanceOf(OAuthError);
    // and no network call was made
  });

  it('happy path: usercode → poll(403×2 → 200 PKCE) → exchange → token blob stored', async () => {
    const { OpenAiOAuth } = await import('../src/main/oauth-openai.js');
    const store = makeStore(true);
    let pollN = 0;
    const postJson = vi.fn(async (url: string) => {
      if (url.includes('/deviceauth/usercode')) return HTTP(200, { device_auth_id: 'D1', user_code: 'WXYZ-1', interval: 0 });
      if (url.includes('/deviceauth/token')) { pollN++; return pollN < 3 ? HTTP(403, {}) : HTTP(200, { authorization_code: 'AC', code_challenge: 'CC', code_verifier: 'CV' }); }
      return HTTP(500, {});
    });
    const postForm = vi.fn(async () => HTTP(200, { id_token: '', access_token: accessClaims(2_000_000_000), refresh_token: 'RT' }));
    const oauth = new OpenAiOAuth({ secretStore: store as any, postJson, postForm, pollIntervalFloorMs: 0 });
    const progress: any[] = [];
    const blob = await oauth.startDeviceFlow(1, (p) => progress.push(p));
    expect(blob.accountId).toBe('acct-123');
    expect(blob.plan).toBe('plus');
    expect(store._peek()?.refresh_token).toBe('RT');
    // first progress is the pending projection with user_code + verification_url, NO tokens.
    const pending = progress.find((p) => p.status === 'pending');
    expect(pending.user_code).toBe('WXYZ-1');
    expect(pending.verification_url).toContain('/codex/device');
    expect(JSON.stringify(progress)).not.toContain('D1');   // device_auth_id never projected
    expect(JSON.stringify(progress)).not.toContain('RT');   // tokens never projected
  });

  it('usercode 404 is TERMINAL (device login disabled), distinct from a poll 404 (pending)', async () => {
    const { OpenAiOAuth } = await import('../src/main/oauth-openai.js');
    // usercode 404 → terminal device-disabled
    const store = makeStore(true);
    const oauth = new OpenAiOAuth({
      secretStore: store as any,
      postJson: vi.fn(async () => HTTP(404, 'not found')),
      postForm: vi.fn(),
      pollIntervalFloorMs: 0,
    });
    await expect(oauth.startDeviceFlow(1, () => {})).rejects.toMatchObject({ kind: 'device-disabled' });

    // poll 404 (after a valid usercode) is PENDING, not terminal — it keeps polling until 200.
    const store2 = makeStore(true);
    let pollN = 0;
    const oauth2 = new OpenAiOAuth({
      secretStore: store2 as any,
      postJson: vi.fn(async (url: string) => {
        if (url.includes('/usercode')) return HTTP(200, { device_auth_id: 'D', user_code: 'U', interval: 0 });
        pollN++;
        return pollN < 2 ? HTTP(404, {}) : HTTP(200, { authorization_code: 'AC', code_challenge: 'CC', code_verifier: 'CV' });
      }),
      postForm: vi.fn(async () => HTTP(200, { id_token: '', access_token: accessClaims(2_000_000_000), refresh_token: 'RT2' })),
      pollIntervalFloorMs: 0,
    });
    const blob = await oauth2.startDeviceFlow(1, () => {});
    expect(blob.refresh_token).toBe('RT2'); // poll-404 did NOT terminate — flow completed
  });

  it('response-shape misconfig: first poll returns HTML/non-JSON 401 → probable-misconfig error', async () => {
    const { OpenAiOAuth } = await import('../src/main/oauth-openai.js');
    const store = makeStore(true);
    const oauth = new OpenAiOAuth({
      secretStore: store as any,
      postJson: vi.fn(async (url: string) => {
        if (url.includes('/usercode')) return HTTP(200, { device_auth_id: 'D', user_code: 'U', interval: 0 });
        return { status: 401, body: '<html>nope</html>' }; // wrong endpoint shape
      }),
      postForm: vi.fn(),
      pollIntervalFloorMs: 0,
    });
    await expect(oauth.startDeviceFlow(1, () => {})).rejects.toMatchObject({ kind: 'misconfig' });
  });

  it('abort-aware: cancelling mid-interval fires NO stray token-bearing POST', async () => {
    const { OpenAiOAuth } = await import('../src/main/oauth-openai.js');
    const store = makeStore(true);
    let pollCalls = 0;
    const postJson = vi.fn(async (url: string) => {
      if (url.includes('/usercode')) return HTTP(200, { device_auth_id: 'D', user_code: 'U', interval: 5 }); // 5s interval
      pollCalls++;
      return HTTP(403, {});
    });
    const oauth = new OpenAiOAuth({ secretStore: store as any, postJson, postForm: vi.fn() });
    const p = oauth.startDeviceFlow(7, () => {});
    // cancel during the (long) poll sleep, before any /token POST is issued.
    await new Promise((r) => setTimeout(r, 0));
    oauth.cancel(7);
    await expect(p).rejects.toMatchObject({ kind: 'aborted' });
    expect(pollCalls).toBe(0); // the abort-aware sleep re-checked AFTER the await → no /token POST
  });

  it('validator-reject: a malformed exchange response → no storage, categorized error', async () => {
    const { OpenAiOAuth } = await import('../src/main/oauth-openai.js');
    const store = makeStore(true);
    const oauth = new OpenAiOAuth({
      secretStore: store as any,
      postJson: vi.fn(async (url: string) =>
        url.includes('/usercode') ? HTTP(200, { device_auth_id: 'D', user_code: 'U', interval: 0 }) : HTTP(200, { authorization_code: 'AC', code_challenge: 'CC', code_verifier: 'CV' })),
      postForm: vi.fn(async () => HTTP(200, { access_token: accessClaims(2_000_000_000) /* MISSING refresh_token */ })),
      pollIntervalFloorMs: 0,
    });
    await expect(oauth.startDeviceFlow(1, () => {})).rejects.toMatchObject({ kind: 'invalid-response' });
    expect(store._peek()).toBeUndefined(); // nothing stored
  });
});

describe('OpenAiOAuth — refresh (single-flight + epoch guard)', () => {
  function storeWith(blob: any, persistent = true) {
    let b = blob;
    return {
      isPersistent: () => persistent,
      getToken: () => b,
      setToken: (_p: string, nb: any) => { b = nb; return true; },
      clearToken: () => { b = undefined; },
      hasToken: () => !!b,
      _peek: () => b,
    };
  }

  it('single-flight: two concurrent refresh() callers → ONE network call', async () => {
    const { OpenAiOAuth } = await import('../src/main/oauth-openai.js');
    const store = storeWith({ access_token: 'old', refresh_token: 'RT', id_token: '', expires_at: 0, accountId: 'a', plan: '' });
    const postJson = vi.fn(async () => HTTP(200, { access_token: accessClaims(2_000_000_000), refresh_token: 'RT2' }));
    const oauth = new OpenAiOAuth({ secretStore: store as any, postJson, postForm: vi.fn() });
    const [a, b] = await Promise.all([oauth.refresh(), oauth.refresh()]);
    expect(postJson).toHaveBeenCalledTimes(1);
    expect(a.access_token).toBe(b.access_token);
  });

  it('epoch guard: a reactive-401 that finds the stored token already changed RETRIES (no 2nd refresh)', async () => {
    const { OpenAiOAuth } = await import('../src/main/oauth-openai.js');
    // The store already holds a NEWER access token than the one the failing request sent.
    const store = storeWith({ access_token: 'NEW', refresh_token: 'RT', id_token: '', expires_at: 0, accountId: 'a', plan: '' });
    const postJson = vi.fn();
    const oauth = new OpenAiOAuth({ secretStore: store as any, postJson, postForm: vi.fn() });
    const headers = await oauth.refreshAfter401('STALE'); // stale != stored NEW → retry, no refresh
    expect(headers.Authorization).toBe('Bearer NEW');
    expect(postJson).not.toHaveBeenCalled(); // no refresh_token_reused risk
  });

  it('terminal refresh error (refresh_token_reused) clears the token + no retry loop', async () => {
    const { OpenAiOAuth } = await import('../src/main/oauth-openai.js');
    const store = storeWith({ access_token: 'old', refresh_token: 'RT', id_token: '', expires_at: 0, accountId: 'a', plan: '' });
    const postJson = vi.fn(async () => HTTP(400, { error: { code: 'refresh_token_reused' } }));
    const oauth = new OpenAiOAuth({ secretStore: store as any, postJson, postForm: vi.fn() });
    await expect(oauth.refresh()).rejects.toMatchObject({ kind: 'auth-expired' });
    expect(store._peek()).toBeUndefined();      // cleared
    expect(postJson).toHaveBeenCalledTimes(1);  // no retry loop on a terminal code
  });

  it('WAF/transient (non-terminal) refresh: ONE retry then surface — does NOT nuke refresh_token', async () => {
    const { OpenAiOAuth } = await import('../src/main/oauth-openai.js');
    const store = storeWith({ access_token: 'old', refresh_token: 'RT', id_token: '', expires_at: 0, accountId: 'a', plan: '' });
    const postJson = vi.fn(async () => HTTP(503, 'service unavailable'));
    const oauth = new OpenAiOAuth({ secretStore: store as any, postJson, postForm: vi.fn() });
    await expect(oauth.refresh()).rejects.toMatchObject({ kind: 'network' });
    expect(postJson).toHaveBeenCalledTimes(2);  // one retry
    expect(store._peek()?.refresh_token).toBe('RT'); // refresh_token preserved (not nuked)
  });
});

describe('OpenAiOAuth — status / logout', () => {
  it('status() returns non-secret fields only; logout() zeroes the blob', async () => {
    const { OpenAiOAuth } = await import('../src/main/oauth-openai.js');
    let b: any = { access_token: 'AT', refresh_token: 'RT', id_token: '', expires_at: 1700, accountId: 'acct-1', plan: 'pro' };
    const store = {
      isPersistent: () => true, getToken: () => b, setToken: () => true, clearToken: () => { b = undefined; }, hasToken: () => !!b,
    };
    const oauth = new OpenAiOAuth({ secretStore: store as any, postJson: vi.fn(), postForm: vi.fn() });
    const s = oauth.status();
    expect(s).toEqual({ hasToken: true, accountId: 'acct-1', expiresAt: 1700, plan: 'pro' });
    expect(JSON.stringify(s)).not.toContain('AT');
    expect(JSON.stringify(s)).not.toContain('RT');
    oauth.logout();
    expect(oauth.status().hasToken).toBe(false);
  });
});
