// Stellavault Desktop — Sign in with ChatGPT (Track B, MAIN-PROCESS ONLY)
//
// OpenAI Codex device-code OAuth against auth.openai.com, used to drive the Responses API on
// chatgpt.com with a ChatGPT Plus/Pro subscription. EXPERIMENTAL, off-by-default, consent-gated.
//
// SECURITY (non-negotiable, from the spec's securityInvariants[]):
//  - Tokens (access/refresh/id) + device_auth_id live MAIN-ONLY. onProgress emits ONLY
//    {status,user_code,verification_url,expiresIn} — NEVER device_auth_id/tokens.
//  - NO-KEYCHAIN REFUSE: if !secretStore.isPersistent() → THROW before startDeviceFlow (the
//    long-lived refresh_token must never hit plaintext disk; memory-only is rejected for OAuth).
//  - Every call goes through the hardened POST helper (redirect:'error' + per-hop assertPublicUrl +
//    exact-host pin auth.openai.com BEFORE any token header). Never a raw net.request.
//  - id_token/access_token are NOT signature-verified — base64url payload decode only (routing hint).
//  - usercode-phase 404 = TERMINAL (device login disabled); poll-phase 403/404 = pending.
//  - Misconfig guard fires on RESPONSE SHAPE (first poll non-JSON/HTML/401/5xx), NOT wall-clock.
//  - Single-flight refresh + epoch guard; refresh_token re-read from the store at refresh time.
//  - WAF/Cloudflare 403 (auth-independent) must NOT nuke the refresh_token.
//  - Abort-aware poll sleep (signal-bound, re-checked AFTER the await); per-wcId AbortController
//    registry; in-memory blob zeroed on logout.
//
// KEY DEVIATION: no `zod` dependency (it repeatedly broke this app's electron-forge asar/ESM
// packaging). Hand-written tiny validators below return the typed object or throw a categorized Error.

import { safePostJson, safePostForm } from './outbound-fetch.js';
import { redactForLog } from './chat-engine.js';
import type { SecretStore, TokenBlob } from './secret-store.js';

// ─── Constants — ONE env-overridable block (a wrong guess is a one-line fix, never a silent hang) ──
const CLIENT_ID = process.env.CODEX_APP_SERVER_LOGIN_CLIENT_ID || 'app_EMoamEEZ73f0CkXaXp7hrann';
const ISSUER = (process.env.STELLAVAULT_OAUTH_ISSUER || 'https://auth.openai.com').replace(/\/+$/, '');
const DEVICE_PATH_PREFIX = process.env.STELLAVAULT_OAUTH_DEVICE_PREFIX ?? '/api/accounts';
// Exact host the OAuth POSTs are pinned to (derived from ISSUER so an override stays consistent).
const ISSUER_HOST = (() => { try { return new URL(ISSUER).hostname; } catch { return 'auth.openai.com'; } })();
const PROVIDER = 'openai-chatgpt';

const POLL_MIN_INTERVAL_MS = 2_000;   // floor 2s
const POLL_MAX_WAIT_MS = 900_000;     // 900s TTL
const REFRESH_SKEW_MS = 60_000;       // proactively refresh ~60s before expiry

// ─── Categorized error ──────────────────────────────────────────────────────
export type OAuthErrorKind =
  | 'no-keychain' | 'device-disabled' | 'misconfig' | 'invalid-response'
  | 'auth-expired' | 'network' | 'aborted' | 'generic';

export class OAuthError extends Error {
  kind: OAuthErrorKind;
  constructor(message: string, kind: OAuthErrorKind = 'generic') {
    super(message);
    this.name = 'OAuthError';
    this.kind = kind;
  }
}

/** Wrap redactForLog so token/PKCE/device material is scrubbed even if a future caller logs
 *  something here. We additionally NEVER log raw bodies (status + endpointId only). */
export function redactOAuth(s: string): string { return redactForLog(String(s)); }

// ─── base64url JWT claims decode (NO signature verification — routing hint only) ──────────────
function base64urlDecode(seg: string): string {
  const b64 = seg.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
  return Buffer.from(b64 + pad, 'base64').toString('utf-8');
}

/** Validator: decode a JWT's payload claims (no sig verify). Throws on a malformed token. */
export function decodeJwtClaims(jwt: string): Record<string, unknown> {
  if (typeof jwt !== 'string') throw new OAuthError('token not a string', 'invalid-response');
  const parts = jwt.split('.');
  if (parts.length < 2 || !parts[1]) throw new OAuthError('malformed JWT', 'invalid-response');
  let json: string;
  try { json = base64urlDecode(parts[1]); } catch { throw new OAuthError('malformed JWT payload', 'invalid-response'); }
  let claims: unknown;
  try { claims = JSON.parse(json); } catch { throw new OAuthError('JWT claims not JSON', 'invalid-response'); }
  if (!claims || typeof claims !== 'object') throw new OAuthError('JWT claims not an object', 'invalid-response');
  return claims as Record<string, unknown>;
}

// ─── Hand-written validators (zod-free) — return the typed object or throw categorized ──────────
function asObject(v: unknown, what: string): Record<string, unknown> {
  if (!v || typeof v !== 'object') throw new OAuthError(`${what}: not an object`, 'invalid-response');
  return v as Record<string, unknown>;
}
function reqString(o: Record<string, unknown>, key: string, what: string): string {
  const v = o[key];
  if (typeof v !== 'string' || v.length === 0) throw new OAuthError(`${what}: missing ${key}`, 'invalid-response');
  return v;
}

export interface DeviceUsercodeResp { device_auth_id: string; user_code: string; interval: number; }
/** usercode response: {device_auth_id, user_code (serde alias "usercode"), interval}. */
export function validateUsercode(json: unknown): DeviceUsercodeResp {
  const o = asObject(json, 'usercode');
  const device_auth_id = reqString(o, 'device_auth_id', 'usercode');
  // serde alias: accept either "user_code" or "usercode".
  const user_code = typeof o.user_code === 'string' && o.user_code
    ? o.user_code
    : reqString(o, 'usercode', 'usercode');
  // Default to 0 (NOT a fixed 5) when missing/invalid — the poll-interval FLOOR (pollFloorMs, 2s in
  // prod) is the real lower bound, so a server interval of 0 still polls at the floor, never busy-loops.
  const interval = Number(o.interval);
  return { device_auth_id, user_code, interval: Number.isFinite(interval) && interval > 0 ? interval : 0 };
}

export interface PkceBundle { authorization_code: string; code_challenge: string; code_verifier: string; }
/** poll 200 response: PKCE bundle {authorization_code, code_challenge, code_verifier}. */
export function validatePkce(json: unknown): PkceBundle {
  const o = asObject(json, 'pkce');
  return {
    authorization_code: reqString(o, 'authorization_code', 'pkce'),
    code_challenge: reqString(o, 'code_challenge', 'pkce'),
    code_verifier: reqString(o, 'code_verifier', 'pkce'),
  };
}

export interface TokenExchangeResp { id_token: string; access_token: string; refresh_token: string; }
/** exchange response: {id_token, access_token, refresh_token}. access_token + refresh_token are
 *  required; id_token is OPTIONAL (accountId/plan/exp are read from access_token claims, preferred). */
export function validateTokenExchange(json: unknown): TokenExchangeResp {
  const o = asObject(json, 'exchange');
  return {
    id_token: typeof o.id_token === 'string' ? o.id_token : '',
    access_token: reqString(o, 'access_token', 'exchange'),
    refresh_token: reqString(o, 'refresh_token', 'exchange'),
  };
}

export interface RefreshResp { id_token?: string; access_token?: string; refresh_token?: string; }
/** refresh response: all fields optional (server may rotate only some). At least access_token. */
export function validateRefresh(json: unknown): RefreshResp {
  const o = asObject(json, 'refresh');
  const access_token = typeof o.access_token === 'string' ? o.access_token : undefined;
  if (!access_token) throw new OAuthError('refresh: missing access_token', 'invalid-response');
  return {
    access_token,
    id_token: typeof o.id_token === 'string' ? o.id_token : undefined,
    refresh_token: typeof o.refresh_token === 'string' ? o.refresh_token : undefined,
  };
}

// ─── Build a TokenBlob from an exchange/refresh result ───────────────────────
/** Extract accountId + plan + expires_at from access/id token claims (prefer access_token).
 *  account_id = claims["https://api.openai.com/auth"].chatgpt_account_id; plan = chatgpt_plan_type. */
export function blobFromTokens(t: { access_token: string; refresh_token: string; id_token: string }): TokenBlob {
  let accountId = '';
  let plan = '';
  let exp = 0;
  for (const jwt of [t.access_token, t.id_token]) {
    if (!jwt) continue;
    let claims: Record<string, unknown>;
    try { claims = decodeJwtClaims(jwt); } catch { continue; }
    const authNs = claims['https://api.openai.com/auth'];
    if (authNs && typeof authNs === 'object') {
      const a = authNs as Record<string, unknown>;
      if (!accountId && typeof a.chatgpt_account_id === 'string') accountId = a.chatgpt_account_id;
      if (!plan && typeof a.chatgpt_plan_type === 'string') plan = a.chatgpt_plan_type;
    }
    if (!exp && typeof claims.exp === 'number') exp = claims.exp * 1000;
  }
  if (!accountId) throw new OAuthError('no chatgpt_account_id in token claims', 'invalid-response');
  return {
    access_token: t.access_token,
    refresh_token: t.refresh_token,
    id_token: t.id_token,
    expires_at: exp || (Date.now() + 50 * 60_000), // exp missing → 50min + refresh-soon (proactive)
    accountId,
    plan,
  };
}

// ─── Progress projection (renderer-safe) ─────────────────────────────────────
export interface OAuthProgress {
  status: 'pending' | 'authorized' | 'error';
  user_code?: string;
  verification_url?: string;
  expiresIn?: number;
  message?: string;
}
export type ProgressFn = (p: OAuthProgress) => void;

// ─── Status (non-secret) ─────────────────────────────────────────────────────
export interface OAuthStatus { hasToken: boolean; accountId?: string; expiresAt?: number; plan?: string; }

// ─── The module ──────────────────────────────────────────────────────────────
export interface OpenAiOAuthDeps {
  secretStore: Pick<SecretStore, 'isPersistent' | 'getToken' | 'setToken' | 'clearToken' | 'hasToken'>;
  // Hardened transport (injected so unit tests can mock without electron net). Defaults to the real ones.
  postJson?: typeof safePostJson;
  postForm?: typeof safePostForm;
  // Poll-interval floor in ms (prod: 2000 per spec). Tests pass 0 to avoid real multi-second sleeps;
  // it is NOT renderer-reachable, so loosening it in a unit test changes no production behavior.
  pollIntervalFloorMs?: number;
}

export class OpenAiOAuth {
  private readonly secretStore: OpenAiOAuthDeps['secretStore'];
  private readonly postJson: typeof safePostJson;
  private readonly postForm: typeof safePostForm;
  private readonly pollFloorMs: number;
  // Per-wcId abort controllers for an in-flight device flow.
  private readonly controllers = new Map<number, AbortController>();
  // Single-flight refresh: a shared in-flight Promise. epoch is bumped on every token swap so a
  // reactive-401 caller can detect "the stored token already changed → retry, don't refresh".
  private refreshing: Promise<TokenBlob> | null = null;
  private epoch = 0;

  constructor(deps: OpenAiOAuthDeps) {
    this.secretStore = deps.secretStore;
    this.postJson = deps.postJson ?? safePostJson;
    this.postForm = deps.postForm ?? safePostForm;
    this.pollFloorMs = deps.pollIntervalFloorMs ?? POLL_MIN_INTERVAL_MS;
  }

  // ── abort-aware sleep (signal-bound; re-checked AFTER the await by the caller) ──
  private sleep(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise<void>((resolve) => {
      if (signal.aborted) { resolve(); return; }
      const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(); }, ms);
      const onAbort = () => { clearTimeout(timer); resolve(); };
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  // ── DEVICE FLOW ──────────────────────────────────────────────────────────
  /** Start the full device flow for a webContents (wcId). Streams {status,user_code,verification_url}
   *  via onProgress. THROWS on no-keychain / device-disabled / misconfig / network. */
  async startDeviceFlow(wcId: number, onProgress: ProgressFn): Promise<TokenBlob> {
    // NO-KEYCHAIN REFUSE (mandatory) — refuse BEFORE any network call.
    if (!this.secretStore.isPersistent()) {
      throw new OAuthError('No OS keychain available — cannot securely store your ChatGPT session', 'no-keychain');
    }
    // Per-wcId controller (abort on window close / logout / before-quit).
    this.controllers.get(wcId)?.abort();
    const controller = new AbortController();
    this.controllers.set(wcId, controller);
    const signal = controller.signal;

    try {
      // 1. usercode
      const ucRes = await this.postJson(`${ISSUER}${DEVICE_PATH_PREFIX}/deviceauth/usercode`, ISSUER_HOST, { client_id: CLIENT_ID });
      if (ucRes.status === 404) {
        throw new OAuthError('ChatGPT device login is not enabled for this account', 'device-disabled');
      }
      if (ucRes.status < 200 || ucRes.status >= 300) {
        throw new OAuthError(`device usercode failed (HTTP ${ucRes.status})`, 'network');
      }
      const uc = validateUsercode(parseJsonOrThrow(ucRes.body));
      const verificationUrl = `${ISSUER}/codex/device`;
      const intervalMs = Math.max(uc.interval * 1000, this.pollFloorMs);
      onProgress({ status: 'pending', user_code: uc.user_code, verification_url: verificationUrl, expiresIn: Math.floor(POLL_MAX_WAIT_MS / 1000) });

      // 3. poll
      const deadline = Date.now() + POLL_MAX_WAIT_MS;
      let firstPoll = true;
      let pkce: PkceBundle | null = null;
      while (Date.now() < deadline) {
        await this.sleep(intervalMs, signal);
        if (signal.aborted) throw new OAuthError('aborted', 'aborted'); // re-check AFTER the await

        const pollRes = await this.postJson(
          `${ISSUER}${DEVICE_PATH_PREFIX}/deviceauth/token`, ISSUER_HOST,
          { device_auth_id: uc.device_auth_id, user_code: uc.user_code },
        );
        // MISCONFIG GUARD (response-shape, NOT wall-clock): the FIRST poll returning non-JSON / HTML /
        // 401 / 5xx is a probable wrong endpoint. A well-formed pending 403/404 keeps polling to TTL.
        if (firstPoll && (pollRes.status === 401 || pollRes.status >= 500)) {
          throw new OAuthError('device login endpoint misconfigured (unexpected response)', 'misconfig');
        }
        if (pollRes.status === 403 || pollRes.status === 404) {
          // genuine pending — validate the body is well-formed JSON on the first poll (shape guard).
          if (firstPoll) {
            try { JSON.parse(pollRes.body || '{}'); }
            catch { throw new OAuthError('device login endpoint misconfigured (non-JSON pending)', 'misconfig'); }
          }
          firstPoll = false;
          continue;
        }
        firstPoll = false;
        if (pollRes.status >= 200 && pollRes.status < 300) {
          pkce = validatePkce(parseJsonOrThrow(pollRes.body));
          break;
        }
        throw new OAuthError(`device poll failed (HTTP ${pollRes.status})`, 'network');
      }
      if (!pkce) throw new OAuthError('device authorization timed out', 'generic');

      // 4. exchange (form first; on 4xx retry once as JSON — content-type unconfirmed)
      const exchangeFields = {
        grant_type: 'authorization_code',
        code: pkce.authorization_code,
        redirect_uri: `${ISSUER}/deviceauth/callback`,
        client_id: CLIENT_ID,
        code_verifier: pkce.code_verifier,
      };
      let exRes = await this.postForm(`${ISSUER}/oauth/token`, ISSUER_HOST, exchangeFields);
      if (exRes.status >= 400 && exRes.status < 500) {
        exRes = await this.postJson(`${ISSUER}/oauth/token`, ISSUER_HOST, exchangeFields);
      }
      if (exRes.status < 200 || exRes.status >= 300) {
        throw new OAuthError(`token exchange failed (HTTP ${exRes.status})`, 'network');
      }
      const tokens = validateTokenExchange(parseJsonOrThrow(exRes.body));

      // 5. claims → blob (throws if no chatgpt_account_id) → store
      const blob = blobFromTokens(tokens);
      if (!this.secretStore.setToken(PROVIDER, blob)) {
        throw new OAuthError('No OS keychain available — cannot securely store your ChatGPT session', 'no-keychain');
      }
      this.epoch++;
      onProgress({ status: 'authorized' });
      return blob;
    } catch (err) {
      const kind = err instanceof OAuthError ? err.kind : 'generic';
      // Status-only on the projection — NEVER the underlying token/device material.
      onProgress({ status: 'error', message: kind });
      throw err;
    } finally {
      if (this.controllers.get(wcId) === controller) this.controllers.delete(wcId);
    }
  }

  /** Abort an in-flight device flow for a wcId (window close / logout / before-quit). */
  cancel(wcId: number): void {
    this.controllers.get(wcId)?.abort();
    this.controllers.delete(wcId);
  }

  /** Abort every in-flight device flow (before-quit). */
  cancelAll(): void {
    for (const c of this.controllers.values()) { try { c.abort(); } catch { /* */ } }
    this.controllers.clear();
  }

  // ── TOKEN LIFECYCLE ────────────────────────────────────────────────────────
  /** Return valid auth headers, refreshing proactively (~60s before expiry). THROWS 'auth-expired'
   *  on a terminal refresh failure (caller must force re-login). */
  async getValidAccessHeaders(): Promise<{ Authorization: string; 'ChatGPT-Account-ID': string }> {
    let blob = this.secretStore.getToken(PROVIDER);
    if (!blob) throw new OAuthError('not signed in to ChatGPT', 'auth-expired');
    if (blob.expires_at - Date.now() < REFRESH_SKEW_MS) {
      blob = await this.refresh();
    }
    return { Authorization: `Bearer ${blob.access_token}`, 'ChatGPT-Account-ID': blob.accountId };
  }

  /** Reactive-401 path: the request that 401'd carried `staleToken`. If the stored access_token has
   *  ALREADY changed (epoch/version mismatch) just RETRY with the new token — do NOT refresh (that
   *  would hit refresh_token_reused). Otherwise refresh once. Returns fresh headers. */
  async refreshAfter401(staleToken: string): Promise<{ Authorization: string; 'ChatGPT-Account-ID': string }> {
    const current = this.secretStore.getToken(PROVIDER);
    if (current && current.access_token !== staleToken) {
      // someone already refreshed — retry with the new token, no second refresh.
      return { Authorization: `Bearer ${current.access_token}`, 'ChatGPT-Account-ID': current.accountId };
    }
    const blob = await this.refresh();
    return { Authorization: `Bearer ${blob.access_token}`, 'ChatGPT-Account-ID': blob.accountId };
  }

  /** Single-flight refresh. The refresh_token is RE-READ from the store at refresh time (never
   *  captured at request build). Terminal errors (expired/reused/invalidated | 401) clear the token
   *  and force re-login (no retry loop). Transient → one retry then surface. */
  refresh(): Promise<TokenBlob> {
    if (this.refreshing) return this.refreshing;
    this.refreshing = this.doRefresh().finally(() => { this.refreshing = null; });
    return this.refreshing;
  }

  private async doRefresh(retried = false): Promise<TokenBlob> {
    const stored = this.secretStore.getToken(PROVIDER);
    if (!stored) throw new OAuthError('not signed in to ChatGPT', 'auth-expired');
    const res = await this.postJson(`${ISSUER}/oauth/token`, ISSUER_HOST, {
      client_id: CLIENT_ID,
      grant_type: 'refresh_token',
      refresh_token: stored.refresh_token, // re-read from store, never request-build captured
    });
    if (res.status === 401) {
      this.secretStore.clearToken(PROVIDER);
      this.epoch++;
      throw new OAuthError('ChatGPT session expired — please sign in again', 'auth-expired');
    }
    if (res.status >= 200 && res.status < 300) {
      const refreshed = validateRefresh(parseJsonOrThrow(res.body));
      const merged = blobFromTokens({
        access_token: refreshed.access_token!,
        refresh_token: refreshed.refresh_token ?? stored.refresh_token,
        id_token: refreshed.id_token ?? stored.id_token,
      });
      this.secretStore.setToken(PROVIDER, merged);
      this.epoch++;
      return merged;
    }
    // Terminal error codes in the body → clear + force re-login (no loop).
    const code = extractErrorCode(res.body);
    if (code === 'refresh_token_expired' || code === 'refresh_token_reused' || code === 'refresh_token_invalidated') {
      this.secretStore.clearToken(PROVIDER);
      this.epoch++;
      throw new OAuthError('ChatGPT session expired — please sign in again', 'auth-expired');
    }
    // Transient → one retry then surface (do NOT nuke the refresh_token).
    if (!retried) return this.doRefresh(true);
    throw new OAuthError(`token refresh failed (HTTP ${res.status})`, 'network');
  }

  /** Log out: zero the in-memory + stored blob. Best-effort server revoke is DEFERRED (scope cut #5). */
  logout(): void {
    this.secretStore.clearToken(PROVIDER);
    this.epoch++;
  }

  /** Non-secret status — NEVER returns tokens. */
  status(): OAuthStatus {
    const blob = this.secretStore.getToken(PROVIDER);
    if (!blob) return { hasToken: false };
    return { hasToken: true, accountId: blob.accountId, expiresAt: blob.expires_at, plan: blob.plan };
  }
}

// ─── helpers ─────────────────────────────────────────────────────────────────
/** Parse a response body as JSON, throwing a categorized 'invalid-response' on non-JSON/HTML. */
function parseJsonOrThrow(body: string): unknown {
  try { return JSON.parse(body || ''); }
  catch { throw new OAuthError('non-JSON response from auth server', 'invalid-response'); }
}

/** Pull an OAuth error.code from a (possibly non-JSON) response body, '' if absent. */
function extractErrorCode(body: string): string {
  try {
    const o = JSON.parse(body || '{}');
    if (o && typeof o === 'object') {
      const e = (o as Record<string, unknown>).error;
      if (typeof e === 'string') return e;
      if (e && typeof e === 'object' && typeof (e as Record<string, unknown>).code === 'string') {
        return (e as Record<string, string>).code;
      }
    }
  } catch { /* non-JSON */ }
  return '';
}
