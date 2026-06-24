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

---

## Transport-Adapter 자동전환 설계 (on-device ↔ Track B)

> **DESIGN-ONLY — BUILD-PAUSED.** 이 절은 설계 명세일 뿐이다. Track B(ChatGPT OAuth → Responses API)는 §4 HARD GATE(live-capture)가 통과하기 전까지 빌드 보류 상태이며, selector의 `openai-chatgpt` 절은 dormant(env 미설정 시 도달 불가)다. **출시된 reflection / memory(core_memory_*) / skill(invoke_skill) 코드는 단 한 줄도 바뀌지 않는다** — 이 설계는 `streamStep` thunk 한 지점(CE L736–737)을 native 무동작-변경 리팩터로 감싸는 것 외에 기존 루프·게이트·디스패처·IPC를 건드리지 않는다.

### 1. 동작 개요

에이전트 루프를 **복제하지 않고** on-device(native Ollama) ↔ Track B(Responses API)를 자동 전환한다. 전환되는 것은 **파싱(parse)과 프레이밍(framing)** 단 두 가지뿐이고, 모든 보안 불변식은 `runAgentLoop`(CE L1194–1381) 안에 **무조건(unconditional)** 남는다. 어댑터는 `StreamOnceResult`(CE L957–962)를 생산하는 것 외에 루프·게이트·디스패처를 절대 만지지 않으며, settle(succeed/fail)은 영구히 루프 소유다.

선택은 단일 `selectTransport()`가 담당한다. 첫 3절(agent 의존성 주입)이 통과하면 provider/capability에 따라 native 또는 cloud 어댑터를 반환하고, 어느 절도 안 맞으면 `null`을 반환해 기존 single-shot SSE 스트리머(CE L754~)로 fall-through 한다. **단일 selector + 단일 `StreamOnceResult` seam**이라는 구조가 "모델별 if-frontier 산포" 안티패턴을 원천 차단한다.

### 2. `AgentTransport` 인터페이스 (the streamStep boundary)

**계약 정합성(critical fix).** 루프는 `ctx.streamStep(messages)`를 **정확히 1-인자**로 호출한다(CE L1225; `AgentLoopCtx.streamStep` arity = `(messages) => Promise<StreamOnceResult>`, CE L1166). `signal`/`onDelta`는 thunk 안에 **클로저로 묶인다**(현행 L736–737이 이미 그렇게 한다). 따라서 `AgentTransport`는 **construction 시점에 `signal`/`onDelta`를 바인딩하는 팩토리**로 정의하고, 루프에 넘기는 값은 1-인자 thunk다:

```ts
export interface AgentTransport {
  // 1 step = 1 model turn. RESOLVES the assistant turn; NEVER calls outer succeed/fail.
  streamStep(messages: OllamaMsg[]): Promise<StreamOnceResult>;
}
// selectTransport가 signal+onDelta를 클로저로 받아 AgentTransport를 만든다 (팩토리).
// StreamOnceResult = { text; toolCalls; aborted; refusal }   // CE L957–962
// OllamaToolCall   = { function: { name: string; arguments: Record<string, unknown> } }  // CE L325–327
```

`{ text, toolCalls, done }`는 **두 계약의 혼동**이다. `done`은 **line-level** `OllamaFrameResult`(CE L411–415) 전용이고, step-level에서는 어댑터가 `done`을 **resolve로 붕괴(collapse)**시킨다 — native가 `res.done → ok(...)`(CE L1049)에서 하는 그대로. 루프가 보는 것은 영구히 `{ text, toolCalls, aborted, refusal }`뿐이다.

어댑터가 반드시 지킬 계약:
- `function.arguments`는 **항상 parsed object** (string 금지 — 디스패처가 객체를 받는다, CE L1301 unwrap).
- 텍스트는 `onDelta`(클로저 바인딩)로 **점진 스트리밍** 방출 (루프는 최종 text가 아니라 델타에 의존).
- 종결 마커를 resolve로 붕괴, outer `succeed/fail` **절대 호출 금지** (settle = 루프 소유, CE L971–974).
- **per-call `finished` single-settle 가드**를 각 어댑터가 독립 구현 (§5 참조).

루프 바인딩 지점은 그대로 `streamStep:` thunk(CE L736–737). 변경은 단 하나:

```ts
const transport = await selectTransport(cfg, opts, signal, onDelta); // ← signal/onDelta를 팩토리에 주입
if (!transport) { /* fall through to single-shot SSE at CE L754+ */ }
else { await runAgentLoop({ ...ctx, streamStep: (msgs) => transport.streamStep(msgs) }); return; }
```

### 3. NativeOllamaAdapter (현행 — 동작 무변경)

현재 thunk를 **그대로** 한 클래스로 감싸기만 한다. 동작 변경 0:

```ts
// agentSystem = 프롬프트 frozen snapshot(분기 후 고정), 마지막 false = think 플래그.
// 인자 순서·snapshot·think=false를 절대 재배열/누락하지 말 것.
const makeNativeAdapter = (signal, onDelta): AgentTransport => ({
  streamStep: (msgs) =>
    streamOnceNative(
      nativeUrl,
      buildOllamaChatBody(cfg, agentSystem, msgs, toolset.schemas, /* think */ false),
      signal,
      onDelta,
    ),
});
```

내부는 그대로: `streamOnceNative`(CE L975) → `.drain`(CE L1032–1074)이 `\n`-delimited NDJSON을 슬라이스, 라인당 `parseOllamaChatChunk`(CE L422–455). tool_calls는 **whole/pre-parsed**로 도착하고 args guard(CE L448–450)가 비-object를 `{}`로 봉쇄. `res.done`은 `ok(...)`(CE L1049)에서 resolve로 붕괴. inner `finished` single-settle 가드(CE L1002–1010)도 그대로 이 어댑터 안에 산다.

**§6.6 truncation 게이트는 native에서 영구 no-op** — native args는 이미 object라 `input_json_delta` 단편 누적이 없어 검증할 string-terminator가 존재하지 않는다(L448–449 주석). 무변경은 native happy-path smoke 회귀로 검증한다.

### 4. ResponsesApiAdapter (Track B — 빌드 보류, 설계만)

> **⚠ CAPTURE-REQUIRED (HARD GATE, trackb-oauth-plan §2/§4).** 아래 wire 세부(엔드포인트 경로, `wire_api`, body shape, header set, SSE event 목록)는 **live 200 응답으로 byte-confirm 되기 전까지 미확정**이다. 엔드포인트는 이미 한 번 demonstrably wrong이었던 전력이 있다. 이 절은 capture 통과 후 구현 청사진일 뿐, 사실 단정이 아니다.

Track B는 ChatGPT OAuth → Responses API(`chatgpt.com/backend-api/codex/responses`, `wire_api='responses'` — **CAPTURE-REQUIRED**)를 호출한다. 어댑터 책임 3가지:

**(a) 스트리밍 tool-call 조립(assembly).** native와 달리 args가 `input_json_delta` 단편으로 도착한다. 새 순수 파서 `parseResponsesSse`(trackb §3.3, frame당 `JSON.parse` + `obj.type` switch — **event 목록 CAPTURE-REQUIRED**)가:
- `response.output_text.delta` → `obj.delta`를 `onDelta`로 방출.
- tool-call 단편 → **`function.arguments` string을 per-name 누적**, frame 종결에서 §4(b) 게이트를 통과한 뒤에만 `JSON.parse`하여 object로 정규화, `OllamaToolCall` 모양으로 방출.
- `response.refusal.delta/done` → `refusal:true` (**단, toolCalls가 빈 terminal turn에서만** — §4(d)).
- `response.completed` → 종결(resolve로 붕괴). `response.failed` / out-of-band `error` → `ChatStreamError` throw(401/403→region/account, 429→`rate-limited`). malformed JSON → 라인 skip, throw 금지(`parseAnthropicSse` 미러).

**(b) §6.6 truncation-refuse 게이트 — 이 어댑터 파서가 SOLE HOME.** 

명시: **§6.6 게이트는 오늘 디스패처에 존재하지 않는다.** plan §6.6/SP-C가 "디스패처에 native no-op으로 planted" 라고 적었으나 `agent-tools.ts` 어디에도 `endsWith('}')`/`finish_reason`/REFUSE 체크는 없다(L497 default는 unknown-tool용일 뿐). native args guard(CE L448–450)는 비-object를 `{}`로 coerce할 뿐 string-terminator를 검증하지 않는다(native엔 string args가 없으므로 moot). 이 addendum은 게이트를 **cloud 어댑터 파서로 이전**하며, 이는 plan §6.6의 "디스패처 backstop" 가정을 **supersede**한다(plan 문서도 이 사실에 맞춰 갱신할 것).

cloud는 `finish_reason=length`(잘린 출력)를 `tool_calls`로 위장할 수 있다. 방어 규칙:
- 누적 args string이 `}` 또는 `]`로 **종결되지 않으면**, 또는 `JSON.parse`가 **실패하면 → REFUSE**.
- REFUSE = **해당 tool-call을 toolCalls에 넣지 않고 SKIP**. 동시에 synthetic `role:'tool'` 메시지(`"truncated tool call — not executed"`)를 푸시해 루프가 진행하게 한다.
- **절대 `{}`로 coerce 금지** — native의 `{}`-coercion 철학을 여기서 재사용하면 안 된다. 잘린 `core_memory_replace`가 `arguments:{}`로 디스패처에 도달하면 auto-apply 모드에서 빈 args로 write가 실행될 수 있다. 따라서 truncated/failed 조립은 **빈 args write가 아니라 skip**으로 매핑.

defense-in-depth: args는 양쪽 경로 모두 parsed object로 디스패처에 도달하므로 truncation 위험은 cloud 파서에 **완전히 격리**된다. 파서가 게이트를 통과한 object만 방출하는 것이 유일 방어선이며, 그래서 ship 시 이 게이트 활성화 누락 = truncation-위장 실행 취약점(§8 anti-pattern).

**(c) outbound 하드닝.** 모든 트래픽은 SP0 경로 경유: `redirect:'manual'/'error'` + 매홉 `assertPublicUrl` + abort-and-reissue + 토큰 헤더 부착 **전** 최종 호스트 단정(`chatgpt.com`, case-insensitive). raw `net.request` 기본 `redirect:'follow'`는 exfil 벡터.

**(d) refusal 상호배제(mutual exclusion).** 루프 L1235는 `res.refusal`을 `ctx.fail('the model declined','refused')`로 즉시 종결한다. native는 refusal을 항상 false로만 둔다(L985/1014/1049/1098). cloud 어댑터는 `refusal:true`를 **toolCalls가 빈 terminal turn에서만** 방출해 native의 상호배제를 미러링한다 — 그래야 write tool-call이 fail() 전에 messages[]에 half-built로 푸시되는 일이 없고, L1235 fail이 단일 결정적 결과가 된다.

### 5. 게이트 확장 (provider/capability → adapter 선택)

현행 4-clause 게이트(CE L692–696)를 **transport selector**로 일반화한다. selector는 **async**다(modelSupportsTools 네트워크 프로브를 await; 반환 타입 명시 = `Promise<AgentTransport|null>`). await는 호출부에 보존한다(§2의 `await selectTransport(...)`). 프로브는 첫 3절(injected-dep) 뒤에 위치해 non-agent 호출은 절대 프로브하지 않는다.

```ts
async function selectTransport(
  cfg, opts, signal: AbortSignal, onDelta: (d: string) => void,
): Promise<AgentTransport | null> {
  if (!(opts.agentOn && opts.executeTool && opts.toolset)) return null;          // 기존 3절 그대로
  if (isLocalProviderUrl(cfg.baseURL ?? '') && await modelSupportsTools(...))    // 현행 조건 = native
    return makeNativeAdapter(signal, onDelta);
  if (cfg.provider === 'openai-chatgpt' && STELLAVAULT_OAUTH_EXPERIMENTAL && consentGranted())
    return makeResponsesAdapter(signal, onDelta);                                // Track B (활성화 시·CAPTURE 후)
  return null; // → single-shot SSE 폴백 (CE L754~)
}
```

`null`이면 기존 single-shot 스트리머로 fall-through. Track B 절은 **off-by-default**: env 미설정 시 provider가 드롭다운에서 부재하고 selector가 절대 도달하지 않는다. selector가 **단일 함수**라는 점이 "흩어진 if-frontier"를 막는 구조적 핵심이다.

### 6. SHARED / UNCONDITIONAL (어댑터가 절대 만지지 않음)

다음은 전부 parsed `(name, args)` object 위에서 동작하며 wire/framing 의존성이 0이다. 어떤 "더 똑똑한 모델"을 위해서도 자동 off되지 않는다. anchor는 실제 line 기준:

| 불변식 | 실 line anchor |
|---|---|
| **agent loop** (소비: `StreamOnceResult`만; `streamStep` arity=1) | `runAgentLoop` CE L1194–1381; ctx 계약 L1166; 호출 L1225 |
| **write-confirm gate** (isWrite→broker / forceConfirm→fail-closed) | CE L1321–1333; predicates AT L281–296 |
| **tool-name validate/repair** (allowlist, `AGENT_MAX_INVALID=3`) | CE L1296–1300; `AGENT_VALID_NAMES` AT L275–280 |
| **dispatcher FIXED switch + per-tool `assertInsideVault`** | AT L335–501 (default `{error}` L497); path-safety.ts |
| **injection-scan** (store 계층=upstream; chat-engine은 pre-scanned만 소비) | memory-store/skill-store/index.ts; CE 소비 L524–540, L710–717 |
| **single-settle** (outer 루프 succeed/fail 정확히 1회) | CE L652–662; terminal L1238/L1380 |
| **set_plan / invoke_skill 제어 가로채기** (allowlist 전, dispatch 안 함) | CE L1254–1265, L1271–1294 |
| **3-way reflect/distill/agent 프롬프트 분기** | CE L710–731 |
| **renderer-opacity / IPC 계약** | 기존 IPC 채널; renderer 입력 = provider id뿐 (아래) |

**renderer-opacity (cloud 경로에도 동일 적용).** cloud 어댑터는 새 outbound surface(Responses API)와 새 consent/token 경로(main 전용)를 추가하지만, **renderer는 양쪽 transport 어디서도 tool을 enumerate/invoke/선택할 수 없다.** renderer가 selectTransport에 주는 유일 입력은 기존 settings IPC를 통해 영속된 **provider id 문자열**(`cfg.provider`)뿐이다. `consentGranted()` 상태와 OAuth 토큰은 **main-side에서만** 읽히며 renderer에 노출되지 않는다(§4c). renderer는 tool 이름을 댈 수도, 토큰을 볼 수도, provider id 외의 어떤 adapter 선택도 할 수 없다.

**single-settle 경계(sharper).** inner teardown(`finished` 플래그, connect/idle 타이머, onAbort — CE L997–1116)은 transport-layer로서 각 어댑터 안으로 이동한다. 그러나 **"루프가 정확히 1회 settle한다"는 outer 불변식은 공유로 남는다.** 핵심: `runAgentLoop`는 단일 promise를 await(L1225)하고 먼저 settle된 것에 따라 행동하며, resolve 후 reject하는 streamStep을 **try/catch(L1226)로 잡지 못한다**(unhandled rejection). 따라서 **각 어댑터는 streamOnceNative L1002–1010과 동일한 per-call `finished` single-resolve 가드를 독립 구현**해야 한다 — 모든 에러 경로(HTTP non-2xx, parse throw, redirect re-issue 중 abort, idle/connect timeout)가 단 하나의 `ok()`/`bad()`로 라우팅. cloud 어댑터는 manual redirect re-issue + abort-and-reissue로 settle 경로가 native보다 많아 double-resolve 위험이 가장 크다.

선언: 어댑터는 위 표의 어느 불변식도 **읽지도 쓰지도 우회하지도** 않는다.

### 7. DEFERRED capability 노브 (지금 만들지 않음)

보안 불변식이 아니라 capability-conditional·optional이므로 어댑터/루프 어디에도 지금 박지 않는다. omission이 oversight로 오인되지 않도록 명시 라벨:

- **reflection auto-propose 적극성**: explicit-only 유지(plan §10-d). dogfooding 전 자동 트리거는 노이즈 위험 → 보류.
- **parallel/multi-worker tool 실행**: tool이 local·즉시인 한 한계효용 marginal. 현재 직렬 dispatch가 single-settle을 단순하게 유지 → tool이 remote/느려질 때까지 보류.
- **FTS5 session recall**: 어느 경로에도 미구축. local은 vault search, cloud는 large context로 충당 → net-new 인덱스 불필요.

### 8. Track B 활성화 체크리스트 (unpause 시)

1. `makeResponsesAdapter` + `parseResponsesSse` 구현 (§4(a) type-switch, refusal/completed/failed).
2. **§6.6 truncation-refuse를 stub→active로 승격** (args string `}`/`]` 종결 + `JSON.parse` 성공 검증, REFUSE=skip-not-`{}`-coerce) — string-args 도입 순간 필수.
3. selector에 `openai-chatgpt` 절 추가 + env/consent 게이트 배선.
4. **live-capture 확정**(blocking HARD GATE, trackb §4): `redirect_uri`(deviceauth/callback 하드코딩 금지), Responses body shape(`instructions`+`input[]`+`store:false`), full header set(`originator: codex_cli_rs`·`ChatGPT-Account-Id` PascalCase·UA `<ver>`·`OpenAI-Beta`), `stream:false` buffered POST 허용 여부(미허용 시 SSE buffered-collect 래퍼). **live 200 byte-confirm 전 selector 절 enable 금지.**
5. 403/404=keep-polling이므로 fresh usercode 후 ~30s 무변화 = probable-misconfig 에러 처리(silent infinite-pending 방지).
6. 각 어댑터 per-call `finished` single-settle 가드 검증 (§5/§6).
7. smoke: native happy-path 회귀 + Responses 조립/refuse 케이스 + ① mid-object로 끝나는 arg string → tool skip·write 미발화·루프 진행 + ② redirect re-issue 중 abort → `{aborted:true}` 정확히 1회 resolve·이후 reject 없음.

### 9. ANTI-PATTERNS (금지)

- ❌ **"if frontier" 분기 산포**: 모델별 if를 루프/게이트 안에 흩뿌리기. confirm-gate/injection-scan 우회 위험 → 반드시 **단일 selector + 단일 `StreamOnceResult` seam**으로 수렴.
- ❌ **보안 불변식 auto-off**: "이 모델은 신뢰할 만하니 confirm/scan/allowlist 생략" — 절대 금지. 불변식은 transport와 무관.
- ❌ **어댑터가 string args를 디스패처로 흘림**: `function.arguments`는 루프 도달 전 **반드시 parsed object**. §6.6 게이트는 파서 안에서 통과.
- ❌ **truncated tool-call을 `{}`로 coerce**: 빈 args write가 silent 실행될 수 있음 → **skip + synthetic tool 메시지**, 절대 coerce 금지.
- ❌ **어댑터가 outer succeed/fail 호출**: settle은 루프 소유. 어댑터는 resolve만 (+ inner `finished` 가드로 1회).
- ❌ **3-arg streamStep을 ctx에 직결**: 루프는 `streamStep(messages)` 1-인자로 호출(L1225). signal/onDelta는 selectTransport 팩토리에 클로저 주입.
- ❌ **§6.6를 cloud 경로에서 stub로 방치**: native에선 no-op이 정답이지만 string-args 경로에선 load-bearing — ship 시 활성화 누락 = truncation 위장 실행 취약점.
- ❌ **Track B를 live-capture 없이 활성화**: 엔드포인트/redirect_uri/body가 이미 한 번 틀렸던 전력 → capture 200 전 selector 절 enable 금지.
- ❌ **두 계약(`OllamaFrameResult` vs `StreamOnceResult`) 혼동**: `done`은 line-level 전용, step-level은 resolve로 붕괴.

### 10. Low-severity notes (간략)

- **refusal 카테고리**: tool-call + refusal-delta 동시 turn은 fail-closed로 안전하나 user-facing 카테고리가 'refused'로 표기됨(드롭된 tool 의도 미반영). §4(d) 상호배제로 half-built turn 푸시를 방지하므로 수용 가능.
- **native 샘플 인자 순서**: `agentSystem`은 frozen snapshot, 끝 `false`는 think 플래그(§3 주석). 재배열/누락 금지 — 무동작-변경은 native happy-path smoke로 보증.
- **selector 동기/비동기**: §5에서 `Promise<AgentTransport|null>` 명시로 해소(과거 동기 반환 표기 오류 정정).
