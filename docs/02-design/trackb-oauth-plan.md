# Track B Implementation Plan — OpenAI ChatGPT device-code OAuth (EXPERIMENTAL) — FINAL

> Branch base: `feat/multimedia-chat` (HEAD `11e90dd`) · Design authority: `docs/02-design/llm-auth-secret-storage-design.md` §4–§7 · Foundation: Track A (merged `574debd`)
> Status: FINAL plan, self-contained for subagent execution. All file paths absolute-rooted at `packages/desktop/src/` unless noted.
> Verification posture: where this plan and the design spec §4.1 disagree, **the live `codex-rs@main` source is authoritative and was re-fetched during finalization** (see §2). Several "VERIFIED" claims in the prior draft were demonstrably wrong and are corrected here.

---

## 1. Overview & Posture

### 1.1 What this builds
A second authentication path for the existing **OpenAI** integration that lets a user sign in with their **ChatGPT subscription** via OpenAI's Codex CLI device-code flow, instead of pasting an API key. The resulting OAuth token is used against OpenAI's **Responses API** (`chatgpt.com/backend-api/codex/responses`) — *not* the Chat Completions endpoint, where these tokens return 401/403.

This is a **new provider** (`openai-chatgpt`), not a change to the existing `openai` API-key provider. The two coexist; the user picks one.

### 1.2 Experimental / off-by-default / consent posture (non-negotiable, design §4.3, §6 #3)
- **Off by default.** Gated behind env `STELLAVAULT_OAUTH_EXPERIMENTAL=1`, read **once in main** at startup. Unset (default) ⇒ `openai-chatgpt` absent from the dropdown, IPC handlers reject, zero OAuth code runs.
- **In-UI consent required, MAIN-AUTHORITATIVE.** Even with the gate on, the device flow cannot start until the user accepts a consent dialog. **Consent is NOT a renderer-writable settings flag** (see B6/§5 — the prior draft made it spoofable). It is recorded in a main-only file by an intentful IPC and independently re-checked in main before every device call.
- **API key stays the recommended default.** The `openai` (BYO key) provider remains the documented, first-class path. Track B is explicitly labeled experimental in the UI.
- **Single-point-of-failure acknowledged.** Depends on one public `client_id` (`app_EMoamEEZ73f0CkXaXp7hrann`, now env-overridable upstream via `CODEX_APP_SERVER_LOGIN_CLIENT_ID`). On rotation/revoke the data-driven `authMethod` design means the fallback is the existing API-key path with **no code change** — the user switches provider back to `openai`.

### 1.3 What stays untouched (invariants)
- **`@stellavault/core` signatures**: unchanged. All OAuth + Responses code lives in `desktop/main`.
- **All existing API-key providers** (`anthropic`, `openai`, `google`, `openai-compatible`): no behavior change; they satisfy the new async-auth seam via a synchronously-built, pre-resolved header map (see B1).
- **Track A security machinery** (`secret-store.ts`, `redact-secrets.ts`, write-only `ai:*-secret` IPC, `settings:set` whitelist): reused and *extended*, never weakened.
- **`chatStream` net.request lifecycle** (`chat-engine.ts` connect/idle timeouts, AbortController, finished/settled guards, `redactForLog`): reused. Only `buildChatBody` + `parserFor` gain a new case, and the OAuth runtime call is routed through the hardened outbound path (B5/§5).
- **`outbound-fetch.ts` (SP0)**: the existing `redirect:'manual'` + per-hop `assertPublicUrl` + abort-and-reissue + `maxRedirects` primitive — **reused as the transport for all OAuth + Responses calls** (see §5).

---

## 2. Device-code flow values — CORRECTED & confidence-graded (vs spec §4.1)

> **Confidence is now graded honestly.** Rows marked `LIVE-SOURCE` were re-fetched from `codex-rs@main` during finalization. Rows marked `CAPTURE-REQUIRED` are NOT byte-confirmed and **block B3/B5 sign-off** until a live capture (Q-B) lands.

| Item | Value to implement | Confidence | Source |
|---|---|---|---|
| `client_id` | `app_EMoamEEZ73f0CkXaXp7hrann` (env-overridable upstream `CODEX_APP_SERVER_LOGIN_CLIENT_ID`) | LIVE-SOURCE | `login/src/auth/manager.rs` |
| auth_base | `https://auth.openai.com` (`DEFAULT_ISSUER`) | LIVE-SOURCE | `login/src/server.rs` |
| **usercode endpoint** | **`POST {auth_base}/deviceauth/usercode`** — **NO `/api/accounts` prefix** | **LIVE-SOURCE (CORRECTED)** | `device_code_auth.rs` `format!("{auth_base_url}/deviceauth/usercode")` |
| **token-poll endpoint** | **`POST {auth_base}/deviceauth/token`** — **NO `/api/accounts` prefix** | **LIVE-SOURCE (CORRECTED)** | `device_code_auth.rs` `format!("{auth_base_url}/deviceauth/token")` |
| token-poll response | **PKCE bundle** `{authorization_code, code_challenge, code_verifier}` (`CodeSuccessResp`) — NOT tokens. Flow is two-step. | LIVE-SOURCE | `device_code_auth.rs` |
| token exchange (step 2) | `POST {auth_base}/oauth/token` form `grant_type=authorization_code&code=&redirect_uri=&client_id=&code_verifier=` → `{access_token, refresh_token, id_token, expires_in}` | LIVE-SOURCE (path/fields); **redirect_uri value = CAPTURE-REQUIRED** | `server.rs` `format!("{}/oauth/token", issuer)` |
| **redirect_uri (device path)** | **DO NOT hardcode `https://auth.openai.com/deviceauth/callback`.** `server.rs` shows the *loopback* flow uses `http://localhost:{port}/auth/callback` — a DIFFERENT flow. The device-path redirect_uri must be read from the live capture. | **CAPTURE-REQUIRED** | unconfirmed |
| pending signal | HTTP 403/404 → keep polling (`FORBIDDEN \|\| NOT_FOUND`). No RFC-8628 JSON. | LIVE-SOURCE | `device_code_auth.rs` |
| poll interval | server-supplied `interval` from usercode response (`deserialize_interval`); **NO hardcoded default**. Honor server value; clamp to a sane floor (e.g. 2s). | LIVE-SOURCE | `device_code_auth.rs` |
| max wait / TTL | `Duration::from_secs(15*60)` = 15 min | LIVE-SOURCE | `device_code_auth.rs` |
| verification page | `{auth_base}/codex/device` | LIVE-SOURCE | `device_code_auth.rs` |
| scope | `openid profile email offline_access api.connectors.read api.connectors.invoke` is the *authorization-URL* scope; the **device usercode body sends `{client_id}` only — no scope param**. | LIVE-SOURCE | `server.rs` |
| refresh | `POST /oauth/token grant_type=refresh_token`; terminal failure codes `refresh_token_expired`/`_reused`/`_invalidated` | LIVE-SOURCE | `manager.rs` |
| revoke | `POST {auth_base}/oauth/revoke` (best-effort logout) | LIVE-SOURCE | `manager.rs` |
| account-id | `claims['https://api.openai.com/auth'].chatgpt_account_id` from id_token JWT payload | LIVE-SOURCE | `token_data.rs` |
| **Responses body shape / full header set** | `instructions` top-level + `input[]` + `store:false` + `stream` is the read-from-source shape; **NOT captured from a live 200**. Model presence, exact UA version, `OpenAI-Beta`, session/originator-version headers, and whether `stream:false` is honored = unknown. | **CAPTURE-REQUIRED** | corroborated prose only |

**Net effect of the correction:** the prior draft's confidently-"verified" `/api/accounts/deviceauth/*` paths were WRONG (the spec it overrode was right). Because a 403/404 IS the keep-polling signal, a wrong endpoint causes a **silent infinite-pending hang to the 900s TTL** — the worst failure mode. B3 must additionally treat *sustained 403/404 with zero successful state change within ~30s of a fresh usercode* as a probable misconfig/wrong-endpoint error and surface it, rather than perpetual "pending."

---

## 3. Responses adapter design (design §4.2)

### 3.1 Runtime endpoint + headers (each header is a 401/403 trap)
- **URL**: `https://chatgpt.com/backend-api/codex/responses`.
- **Headers** (pin the FULL set from the §2 live capture, not prose):
  - `authorization: Bearer <access_token>`
  - `ChatGPT-Account-Id: <account_id>` — **PascalCase exactly.** Lowercase ⇒ 403.
  - `originator: codex_cli_rs` — backend whitelists `codex_cli_rs`/`codex_vscode`/`codex_sdk_ts`/`^Codex`.
  - `User-Agent: codex_cli_rs/<ver>` — exact `<ver>` and any session/originator-version headers come from the capture. Keep `originator` + UA version in ONE constant block so a rotation is a one-line change alongside `client_id`.
  - `OpenAI-Beta`: omit unless the capture shows codex sends it.

### 3.2 Request body (`wire_api='responses'`)
```jsonc
{
  "model": "<configurable; default = whatever the live capture shows; see §8 Q-D>",
  "instructions": "<system prompt — TOP-LEVEL string, NOT an input[] system message>",
  "input": [ { "role": "user|assistant", "content": "<text>" }, ... ],
  "stream": true,            // buffered path: see §3.4 — do NOT assume false is honored
  "store": false
}
```
Differences from the existing `openai` branch: (1) system → top-level `instructions`; (2) `input[]` not `messages[]`; (3) no `max_tokens`.

### 3.3 Streaming SSE parse (`parseResponsesSse`, new pure parser)
Per-frame `JSON.parse`, switch on `obj.type`:
- `response.output_text.delta` → push `obj.delta` (flat top-level `.delta`).
- `response.refusal.delta` / `response.refusal.done` → `refusal:true` (maps to existing `'refused'` category).
- `response.completed` → `done:true`.
- `response.failed` / out-of-band `error` → throw `ChatStreamError`, reading `obj.error?.code/message` AND `obj.response?.error`; 401/403 → region/account category (§8 Q-E), 429 → `rate-limited`.
- `response.created` + unknown → ignore (idle reset only).
- Malformed JSON → skip line, never throw out of loop (mirrors `parseAnthropicSse`).

### 3.4 Buffered parse (Ask/Wiki, `callOpenAiChatGpt`)
Walk `response.output[].content[]` concatenating `content.type === 'output_text'` parts. **DECISION GATE (feasibility-high):** the codex Responses backend is stream-first; there is no evidence `stream:false` buffered POST is honored. The §2 live capture MUST confirm. If `stream:false` is NOT honored, the buffered path must **consume the SSE stream and accumulate** (reuse `parseResponsesSse` in a buffered-collect wrapper) rather than `postJson`. Build B5 to branch on the capture result.

### 3.5 Reuse map
| Existing symbol | Action |
|---|---|
| `chat-engine.ts` `buildChatBody` | add `case 'openai-chatgpt'` (Responses body) |
| `chat-engine.ts` `parserFor` | add `case 'openai-chatgpt': return parseResponsesSse` |
| `chat-engine.ts` `chatStream` loop/timers/abort/`redactForLog` | unchanged, BUT the request goes through the hardened outbound transport (§5) |
| `llm-synthesizer.ts` `postJson` | reused only if capture confirms `stream:false`; in all cases routed redirect-hardened (§5) |
| `llm-synthesizer.ts` `makeSynthesizer` | gains a pre-resolved `authHeaders` param (B1) + `case 'openai-chatgpt'` (B5) |

---

## 4. Decomposed task list (B1…B9)

> Ordering: **B1 (async auth-header seam + resolved-fork decision)** lands first. Then provider type (B2), OAuth module (B3), token store (B4, parallel with B3), adapters (B5), IPC (B6), UI (B7), security hardening (B8), tests (B9).
> **HARD GATE:** a live capture (Q-B) is a **blocking prerequisite for B3 sign-off AND B5 sign-off** (not merely "nice for B1"). Without one captured real device-flow trace + one captured Responses 200, the endpoint paths, redirect_uri, body shape, full header set, and stream-mode are unverified — and at least one (paths) was already demonstrably wrong.

---

### B1 — Async auth-header seam + RESOLVE the makeSynthesizer fork (do not defer)
**Verified:** `ProviderMeta` has **no** `authMethod`; `makeSynthesizer(ai: LlmConfig|undefined|null)` is **sync** and bakes `cfg` into per-call closures. Track A did NOT build the §3.1.3 async seam.

**MODIFIED:**
- `src/shared/ai-providers.ts` — add `authMethod: 'apikey' | 'baseurl' | 'oauth-device'` to `ProviderMeta`; populate for every existing provider (`anthropic/openai/google` → `apikey`, `openai-compatible` → `baseurl`, `none` → `apikey` sentinel). No electron import.
- `src/main/llm-synthesizer.ts` — change `makeSynthesizer` to accept an optional **pre-resolved header map**: `makeSynthesizer(ai, authHeaders?: Record<string,string>)`. For apikey providers, main passes the synchronously-built headers (byte-identical to today). For `openai-chatgpt`, the index.ts call sites await fresh headers (B5) and pass them in. **This resolves the draft's unresolved "await OR pre-resolved" fork — choose pre-resolved map.**
- `src/main/index.ts` — add `async function getAuthHeaders(provider, cfg): Promise<Record<string,string>>` near `getAiConfig`. apikey/baseurl → `Promise.resolve(<sync headers built today>)`. The oauth branch (wired in B5) awaits the token module.

**Does:** Single injection point for an expiring OAuth token in both buffered + streaming paths, without touching core. Existing providers absorb it with zero behavior change.
**Deps:** none.
**Acceptance:** `tsc` clean; desktop vitest green; **explicit criterion: all 4 existing providers pass byte-identical headers through the new `authHeaders` param**; chat + Ask/Wiki byte-identical (no token path yet).

---

### B2 — Add `openai-chatgpt` to the provider type & fix all exhaustive switches
**MODIFIED:**
- `src/shared/ai-providers.ts` — add `'openai-chatgpt'` to `AiProvider`. `tsc` enumerates non-exhaustive switches — fix each: `DEFAULT_MODELS` (`''`, see §8 Q-D), `PROVIDER_META` (`authMethod:'oauth-device'`, `needsKey:false`, `needsBaseURL:false`), `MODELS_BY_PROVIDER` (`[]`), `KEY_PROVIDERS`/`isValidProvider` (**exclude** from key providers → not allowed on `ai:set-secret`), `modelsListRequest` (`null`), `parseModelsResponse`.
- `src/shared/ipc-types.ts` — `AppSettings.ai.provider` union is a literal duplicate; add `'openai-chatgpt'`. Add optional non-secret meta `oauthAccountId?`, `oauthExpiresAt?`, `hasToken?`. **Do NOT add `oauthConsentAccepted` here** (consent is main-only, see B6/§5).
- `src/main/llm-synthesizer.ts`, `src/main/chat-engine.ts` — add `case 'openai-chatgpt'` stubs that throw `'not yet implemented'` (real bodies B5) so `tsc` passes.

**Deps:** B1.
**Acceptance:** `tsc` clean ×3.

---

### B3 — Device-code OAuth flow module (main-only)
**Sub-task B3.0 (blocking, do FIRST):** add `zod` to `packages/desktop/package.json` dependencies (matching the root-pinned version) and `npm install` at workspace root; verify `packages/desktop/node_modules/zod` resolves. **Verified gap:** zod is only root-hoisted today, NOT declared in desktop. Given prior asar/ESM packaging fragility, after adding it run the packaging smoke. (Alternative if packaging breaks: hand-write the small validators to avoid a new main-bundle dep.)

**NEW:** `src/main/oauth-openai.ts` — whole device flow, main-only. Exports `OpenAiOAuth` with `startDeviceFlow(onProgress)`, `cancel()`, `getValidAccessHeaders()` (single-flight refresh), `logout()`.

**Does (CORRECTED flow from §2):**
1. **usercode**: `POST {auth_base}/deviceauth/usercode` body `{client_id}` → Zod-validate `{device_auth_id, user_code, interval, verification_uri?}`. Verification page `{auth_base}/codex/device`.
2. Emit `oauth:progress` with **only** `{status:'pending', user_code, verification_uri, expiresIn}` (never `device_auth_id`).
3. **poll**: `POST {auth_base}/deviceauth/token` body `{device_auth_id, user_code}` in an `await sleep(interval) → fetch → branch` loop (NOT `setInterval`), bound to an `AbortController`; 403/404 → continue; cap 900s; honor server `interval` (floor 2s). **Distinguish usercode-PHASE 4xx (device-login-disabled / unsupported account → distinct terminal message) from poll-PHASE 403/404 (genuine pending)** — they share 403 but mean opposite things; never treat a usercode-phase failure as "pending." Also: sustained poll 403/404 with no state change within ~30s of a fresh usercode → surface a probable-misconfig error.
4. On 2xx → Zod-validate the **PKCE bundle** `{authorization_code, code_challenge, code_verifier}`.
5. **exchange (step 2)**: `POST {auth_base}/oauth/token` form `grant_type=authorization_code&code=&redirect_uri=<FROM LIVE CAPTURE>&client_id=&code_verifier=` → Zod-validate `{access_token, refresh_token, id_token, expires_in}`. **redirect_uri is NOT hardcoded** (§2: the `deviceauth/callback` string is unconfirmed; `server.rs` shows a *loopback* value for a different flow). Surface `invalid_grant` on the exchange as a distinct categorized error.
6. **id_token**: base64url-decode payload only (no signature verify — account_id treated as a non-authoritative routing hint, NOT a trust decision). **Zod-validate** `claims['https://api.openai.com/auth'].chatgpt_account_id` is a non-empty string matching the expected id charset; reject (no storage, categorized error) otherwise. Malformed/truncated id_token → reject.
7. Hand the token blob to the token store (B4).
- **refresh**: `POST /oauth/token {client_id, grant_type:refresh_token, refresh_token}` behind a **single-flight mutex** (shared in-flight Promise); refresh proactively ~60s before `expiresAt`. On `refresh_token_expired/_reused/_invalidated` → delete tokens, force reauth, **no retry loop**.
- **logout**: best-effort `POST {auth_base}/oauth/revoke` then local delete; **zero the in-memory blob** (B4).
- **Transport**: ALL network via the hardened outbound path (§5: `redirect:'manual'` + final-host assertion + abort-and-reissue), NOT raw `net.request`. All responses Zod-validated. Status-only logging via the extended OAuth redactor (B8); never log `device_auth_id`/codes/tokens/bodies.
- **Registry/teardown** (see B8): the active flow's AbortController is held in a main-side registry keyed by `wcId`; aborted on close/logout/expiry/`before-quit` AND on webContents `destroyed`/`did-start-navigation`.

**Deps:** B4 (parallel), B1.
**Acceptance:** Unit-tested with mocked hardened transport: usercode→poll(403×N→2xx)→exchange→token blob; AbortController cancels cleanly; single-flight refresh (2 callers → 1 call); terminal refresh errors don't loop; Zod-reject on malformed device/exchange/refresh response AND malformed id_token; usercode-phase vs poll-phase 403 produce different errors. **Live capture (§2) confirms paths/redirect_uri/wire encoding before sign-off.**

---

### B4 — Extend secret-store for token blobs (refresh + expiry) + explicit no-keychain policy
**MODIFIED:** `src/main/secret-store.ts` — add `setToken(provider, blob)` / `getToken(provider): TokenBlob|undefined` / `clearToken(provider)` that `JSON.stringify`/`JSON.parse` over the existing string map (reusing the `isEncryptionAvailable() && backend!=='basic_text'` gate, atomic write, memory-only fallback). `TokenBlob = { access_token, refresh_token, id_token, expiresAt, accountId }`. Reuses the **same encrypt/decrypt API path as Track A api keys** (and therefore inherits any `shouldReEncrypt` re-persist handling — closes §7 Q5; if Track A used the sync API, this does too).

**Explicit no-keychain policy (security-high — was under-specified):** when `!isPersistent()` (basic_text / no keyring), **REFUSE to start the device flow** with a clear message *"No OS keychain available — cannot securely store your ChatGPT session."* (Recommended over memory-only, because the refresh_token is long-lived.) The UI surfaces this. Non-secret meta (`expiresAt`, `accountId`, `hasToken`) persists via the settings whitelist (B6) so the UI shows status without decrypting.

**Deps:** none (parallel with B3).
**Acceptance:** Round-trip blob through safeStorage mock; on `basic_text` the device flow is **blocked** (not memory-only) and refresh_token never touches disk; in-memory blob is **zeroed on logout AND `before-quit`**; existing string `getSecret`/`setSecret` unaffected (regression).

---

### B5 — Responses-API adapter (streaming + buffered)
**MODIFIED:**
- `src/main/chat-engine.ts` — flesh out `buildChatBody case 'openai-chatgpt'` per §3.2; write new pure `parseResponsesSse` per §3.3; register in `parserFor`. Headers come from the B1 resolved map (token+account-id stay main-only). The net.request loop/idle/abort are unchanged BUT the request is issued through the hardened transport (§5: `redirect:'error'`/`'manual'` + final-host assertion to `chatgpt.com`).
- `src/main/llm-synthesizer.ts` — add `callOpenAiChatGpt(headers, prompt)`. Per §3.4 DECISION GATE: if the capture shows `stream:false` is honored, reuse `postJson` (redirect-hardened, §5); else implement a buffered-collect over `parseResponsesSse`. Wire `makeSynthesizer case`.
- `src/main/index.ts` — the chat guard `!cfg.apiKey && cfg.provider !== 'openai-compatible'` **rejects OAuth** (no apiKey). For `openai-chatgpt`, gate on `hasToken` (await `getValidAccessHeaders`) instead of `apiKey`. Ask/Wiki handlers similarly `await getAuthHeaders` for this provider, then pass the resolved map into `makeSynthesizer` (B1).

**Deps:** B1, B2, B3, B4, **+ live capture (HARD GATE)**.
**Acceptance:** stubbed token + mocked transport: streaming yields deltas from `response.output_text.delta`, ends on `response.completed`, throws categorized on `response.failed`; buffered Ask works in whichever mode the capture dictates; **a 302 redirect on any token-bearing request → assert NO second request carries Bearer/refresh/code_verifier** (redirect regression); the extended OAuth redactor verified to redact Bearer + refresh/code_verifier/JWT in all new log lines. Region rejection (401 region / 403 `unsupported_country_region_territory`) → clear, non-looping message (§8 Q-E). Budget explicit post-capture iteration on first live 400/403.

---

### B6 — IPC channels (start / progress / status / logout) + allowlist + MAIN-ONLY consent
**MODIFIED:**
- `src/main/index.ts` — add `oauth:start-device` (invoke; carries an explicit `consentAccepted:true` arg that main records to a **main-only consent file**; calls B3; streams `oauth:progress`), `oauth:status` (invoke; returns `{hasToken, accountId, expiresAt}` — never the token), `oauth:logout` (invoke). Gate **every handler** on `STELLAVAULT_OAUTH_EXPERIMENTAL` + the **independently re-checked main-only consent flag**. 
- **Consent is NOT in the `settings:set` whitelist** (security-high fix). A compromised renderer cannot flip it via `settings:set`; only the intentful `oauth:start-device` with the dialog-driven arg records it, and main re-verifies.
- **Payload projection (security-medium):** build `oauth:progress`/`oauth:status` payloads via an explicit allowlisted projection function picking ONLY `{status,user_code,verification_uri,expiresIn}` / `{hasToken,accountId,expiresAt}` — never spread flow state. `device_auth_id` + tokens live in a separate main-only object that is never an argument to `e.sender.send`. **Field-lifetime note:** `oauth:progress.expiresIn` = device-code TTL (relative seconds); `oauth:status.expiresAt` = stored-token absolute expiry (epoch ms) — distinct fields.
- `src/main/index.ts` `settings:set` whitelist — extend `safeAi` to accept ONLY the non-secret scalars `oauthAccountId`, `oauthExpiresAt`, `hasToken` (booleans/scalars; drops unknowns/nulls). NOT consent.
- `src/main/redact-secrets.ts` — **Verified gap:** the destructure only strips the literal `apiKey` (the "any future key fields" comment is aspirational — destructuring does not remove other fields). Extend to explicitly discard any token field (`access_token`, `refresh_token`, `id_token`, `oauthToken`) as defense-in-depth even though tokens are never in `AppSettings`. Update comment + regression test (B9).
- `src/preload/index.ts` — add `oauth:start-device`/`oauth:status`/`oauth:logout` to `ALLOWED_CHANNELS`, `oauth:progress` to `ALLOWED_EVENTS`.
- `src/shared/ipc-types.ts` — add the three invoke channels + the event to `IpcChannelMap`.

**Deps:** B3, B4, B2.
**Acceptance:** preload rejects any oauth channel not in the Set; `oauth:status` never returns token material; handlers no-op (disabled status) when the env gate is off; a `settings:set({ai:{oauthConsentAccepted:true}})` attempt does NOT enable the flow (consent unchanged); projection unit test asserts no `device_auth_id`/token escapes.

---

### B7 — Settings UI: experimental gate, consent dialog, login/logout, device-code display
**MODIFIED:**
- `src/renderer/components/settings/SettingsModal.tsx` (AITab) — (a) surface `oauthExperimental:boolean` (via `oauth:status` or a non-secret `settings:get` field) and conditionally add `'openai-chatgpt'` to the `<option>` list only when on. (b) Branch the auth UI on `meta.authMethod`: a **third `'oauth-device'` variant** — *not signed in*: Consent banner + "Sign in with ChatGPT" button (disabled until consent accepted) **+ a line instructing the user to enable "ChatGPT Settings → Security → Allow device code login" first** (completeness-medium: otherwise a toggle-off user hits an opaque timeout); *signing in*: `user_code` + clickable `verification_uri` + status spinner from `oauth:progress`; *signed in*: "Signed in as <account_id>" + Logout. Also render the **no-keychain refusal** message from B4. `onProvider()` resets oauth UI state on provider switch.
- i18n: add `t('settings.ai.oauth.*')` keys (consent text incl. ToS/account-flag warning, device-login-toggle instruction, sign-in button, code display, status, logout, no-keychain) to **all 4 locale files** (en/ko/ja/zh).

**Deps:** B6.
**Acceptance (Manual Browser Gate — §6):** packaged app with `STELLAVAULT_OAUTH_EXPERIMENTAL=1`.

---

### B8 — Security hardening pass (cross-cutting, design §4.3 / §6)
**Touches:** `oauth-openai.ts`, `index.ts`, `preload/index.ts`, `redact-secrets.ts`, `chat-engine.ts`/`llm-synthesizer.ts` (transport).
**Verify each invariant is ENFORCED (not just intended):**
- **Redirect/SSRF (security-CRITICAL):** every OAuth + Responses request goes through the SP0 hardened outbound path — `redirect:'manual'`/`'error'`, per-hop `assertPublicUrl`, abort-and-reissue, and a **final-host assertion** (`auth.openai.com` for auth, `chatgpt.com` for runtime) BEFORE writing any token-bearing header. Never derive the auth/device endpoint from a user-editable `baseURL`. (Raw `net.request` defaults to `redirect:'follow'` — confirmed in `postJson` + chatStream — so this is a real exfil vector if not routed through the hardened path.)
- **OAuth log redaction (security-HIGH):** extend `redactForLog` (or add `redactOAuth`) to strip JSON field values for `refresh_token`/`authorization_code`/`code_verifier`/`code_challenge`/`device_auth_id`/`access_token`/`id_token` and the `eyJ…` JWT shape BEFORE any log/throw in `oauth-openai.ts`. (Confirmed: current `redactForLog` only catches `?key=/&api_key=/&access_token=` params, `x-api-key/x-goog-api-key/authorization` prefixes, and `sk-`/`AIza-` shapes — ChatGPT OAuth tokens/PKCE/JWT slip through.) Never log raw response bodies in the OAuth module — status + `endpointId` only. CI grep gate over `oauth-openai.ts`.
- **Consent un-spoofable:** consent is main-only, not renderer-writable (B6); handler re-checks it.
- **token non-exposure:** projection function (B6); renderer path proven never to receive tokens/`device_auth_id`.
- **single-flight refresh mutex:** test-confirmed.
- **no-keychain policy:** device flow BLOCKED when `!isPersistent()` (B4); in-memory blob zeroed on logout/`before-quit`.
- **id_token claim Zod-validated;** signature NOT verified ⇒ account_id is a routing hint only.
- **poller cleanup registry:** keyed by `wcId`; aborted on close/logout/expiry/`before-quit`/webContents `destroyed`/`did-start-navigation`; every `oauth:progress` send guarded by `!e.sender.isDestroyed()`.

**Deps:** B3, B5, B6.
**Acceptance:** all security regression tests (B9) pass; CI grep gate green.

---

### B9 — Tests
**NEW/MODIFIED (mirror existing vitest/smoke patterns):**
- `parseResponsesSse` unit tests: delta concat, completed→done, refusal→refused, failed/error→categorized throw, malformed→skip-no-throw.
- `callOpenAiChatGpt` buffered: walks `output[].content[]`; refusal/incomplete handled; both `stream:false` and buffered-collect modes if applicable.
- `oauth-openai.ts`: happy path (usercode→403×N→2xx→exchange), AbortController cancel, single-flight refresh (2→1), terminal refresh-error no-loop, Zod-reject malformed device/exchange/refresh + malformed id_token, usercode-phase-403 ≠ poll-phase-403.
- **Redirect regression (security-critical):** mock a 302 on a token-bearing request → assert no second request carries Bearer/refresh/code_verifier.
- **OAuth redaction regression:** stringified token blob + PKCE bundle + JWT → fully redacted.
- `secret-store.ts`: token blob round-trip; on `basic_text` device flow blocked + refresh_token never on disk; in-memory zeroed on logout/before-quit.
- **Security regressions (extend existing):** `redactSecrets` asserts no `apiKey` AND no token fields; preload allowlist contains no token-returning channel; `oauth:status`/`oauth:progress` projection asserts no token/`device_auth_id` (and: progress carries no `expiresAt`, status carries no `user_code`); `settings:set` consent-spoof attempt does not enable flow.
- `tests/smoke.mjs`: new-parser case + off-by-default gate case.
- **Packaging:** desktop builds with zod present (re-run packaging smoke after B3.0, given asar/ESM history).
**Acceptance:** `tsc` clean ×3; core vitest; desktop vitest; `node tests/smoke.mjs` 🟢 ALL PASS before commit.

---

## 5. Security checklist (design §4.3 / §6)
- [ ] **All OAuth + Responses traffic routed through the SP0 hardened outbound path** (`redirect:'manual'`/`'error'` + per-hop `assertPublicUrl` + abort-and-reissue + final-host assertion) BEFORE any token header — NOT raw `net.request`.
- [ ] Tokens & `device_auth_id` main-process only; payloads built via explicit projection (never spread flow state).
- [ ] `verification_uri` validated against hardcoded host allowlist (`auth.openai.com`) before `openExternal`; endpoints never derived from `baseURL`.
- [ ] Consent main-only (not in `settings:set` whitelist); re-checked in main before every device call.
- [ ] Single-flight refresh; atomic swap; terminal refresh codes → delete + reauth, no loop.
- [ ] No-keychain (`!isPersistent()`) → device flow BLOCKED with clear message; in-memory blob zeroed on logout/before-quit.
- [ ] OAuth-aware redaction (refresh_token/authorization_code/code_verifier/code_challenge/device_auth_id/access_token/id_token/JWT) before any log/throw; never log raw bodies; CI grep gate.
- [ ] id_token claim Zod-validated; signature NOT verified ⇒ account_id is a routing hint.
- [ ] Zod-validate every device/exchange/refresh/runtime-error response; missing field → no storage.
- [ ] Poller registry keyed by wcId; abort on close/logout/expiry/before-quit/destroyed/did-start-navigation; sends guarded by `!isDestroyed()`.
- [ ] Everything behind `STELLAVAULT_OAUTH_EXPERIMENTAL` + in-UI consent; default OFF; api-key path unchanged.
- [ ] `@stellavault/core` signatures unchanged; `zod` declared in desktop package.json.

## 6. Manual Browser Gate (required before committing B7)
1. With `STELLAVAULT_OAUTH_EXPERIMENTAL=1`, does `openai-chatgpt` appear, and is Sign-in disabled until consent accepted?
2. Does `user_code` render and `verification_uri` open `auth.openai.com/codex/device` (and only that host)?
3. After approving, does status flip to "Signed in as …" within the poll window?
4. Does Logout clear state, and a subsequent chat fall back to a clean "not configured" error?
5. With env unset, is the option absent and oauth IPC inert?
6. Does an expired/cancelled flow, AND destroying the settings window mid-flow, stop polling (no lingering timer/CPU)?
7. On a machine with no OS keychain, does Sign-in show the "no keychain" refusal rather than starting?

## 7. Experimental gate + consent UX (summary)
- **Gate:** env read once in main → surfaced as non-secret boolean. Off ⇒ option hidden, IPC inert.
- **Consent:** one-time, **main-recorded via intentful IPC** (not a renderer-writable setting), with explicit ToS/account-flag warning + device-login-toggle instruction.
- **Fallback:** revoked `client_id` degrades to api-key path with no code change.

## 8. Open decisions still needing the user
See `openDecisionsForUser`.

---

**Files, by task** (under `packages/desktop/src/` unless noted):
- NEW: `main/oauth-openai.ts` (B3)
- MODIFIED: `shared/ai-providers.ts` (B1,B2), `shared/ipc-types.ts` (B2,B6), `main/index.ts` (B1,B5,B6), `main/secret-store.ts` (B4), `main/chat-engine.ts` (B2,B5,B8), `main/llm-synthesizer.ts` (B1,B2,B5), `main/redact-secrets.ts` (B6,B8), `main/outbound-fetch.ts` (B5/B8 — reuse as OAuth+Responses transport; extend if a non-public host allowlist variant is needed), `preload/index.ts` (B6), `renderer/components/settings/SettingsModal.tsx` (B7), 4× locale files (B7), `packages/desktop/package.json` (B3.0 — add zod), test files (B9)
- DOC: `docs/02-design/llm-auth-secret-storage-design.md` (§4.1 endpoint correction + two-step exchange + confidence-grading, pending Q-F)