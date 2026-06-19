# LLM 인증 & 비밀 저장 설계 (Track A 구현 + Track B OAuth 스펙)

> 작성일: 2026-06-19 · 브랜치: feat/second-brain-autocapture · 상태: 설계 승인 대기
> 산출: ultracode 워크플로(`oauth-spec-harden`, 9 에이전트) 심층 조사 + 4관점 검증 종합

## 1. 개요

LLM provider 인증과 비밀(API 키·OAuth 토큰) 저장을 개선한다. 이는 후속 "에이전트 모드"의 인증 토대이기도 하다(에이전트 루프 자체는 별도 스펙).

원안("GPT/Gemini를 device-code OAuth로 붙여 기존 LLM 경로에 Bearer만 주입")은 조사 결과 **두 공급자 모두에서 사실과 달라**, 2-트랙으로 재정의했다.

- **Track A — 구현 대상** (ToS-clean, 즉시): 모든 클라우드 provider는 BYO API 키 유지 + **비밀 저장 safeStorage 통일 + renderer 누출 차단 + write-only 키 입력**. 확실한 보안 순익.
- **Track B — 스펙만** (experimental, off-by-default, 다음 사이클): **OpenAI ChatGPT device-code OAuth만**. 설계·리스크를 문서로 남기고 구현은 보류.
- **제외 확정**: Gemini OAuth(기술적으로 불가), Claude OAuth(2026-04 ToS 금지).

범위 결정(사용자): "Track A 먼저 구현, Track B는 스펙만."

## 2. 배경 / 현재 상태

- `shared/ai-providers.ts`: provider enum = `none|anthropic|openai|openai-compatible|google`, `needsKey`/`needsBaseURL` 메타. API 키 방식.
- `llm-synthesizer.ts`(core 아님, desktop): BYO 키 호출 경로 **이미 완성** — Claude(x-api-key), OpenAI(Bearer→api.openai.com/v1), Gemini(?key=→generativelanguage), Ollama(keyless baseURL).
- **보안 구멍(발견)**: `settings:get` 핸들러(`main/index.ts`, ~L1174)가 `ai.apiKey` 포함 전체 객체를 renderer로 반환. safeStorage를 도입해도 contextBridge를 넘으면 XSS/합성 콘텐츠/웹클리퍼/devtools로 탈취 가능.
- core(`@stellavault/core`)는 LLM SDK·키를 보유하지 않는 불변식 — 이 스펙은 core 시그니처를 변경하지 않는다.

## 3. Track A — 구현 대상 (보안 강화 + BYO 키 통일)

### 3.1 컴포넌트
1. **`shared/ai-providers.ts`** (확장): `ProviderMeta`에 `authMethod: 'apikey' | 'baseurl' | 'oauth-device'` 추가(비밀 0, electron import 없음 불변식 유지). renderer는 `authMethod`로 "키 입력 vs 로그인 버튼" 선언적 분기만.
2. **`main/secret-store.ts`** (신규): API 키(+Track B 토큰)를 `safeStorage.encryptString`으로 `~/.stellavault/secrets.enc`에 atomic write(tmp+rename, `settings-store.ts:113` 패턴). `desktop-settings.json`에는 **비민감 메타만**(provider/model/baseURL/authMethod/`hasSecret:boolean`/expiresAt). 키·토큰은 절대 `AppSettings`에 넣지 않음.
3. **core LLM 어댑터(`llm-synthesizer.ts`)**: `makeSynthesizer`를 동기 `LlmConfig` 대신 `getAuthHeader(provider): Promise<Record<string,string>>` 프로바이더를 받도록 일반화. API키 provider는 `Promise.resolve(동기 헤더)`로 흡수 → Claude/Ollama/Gemini 경로 무변경.
4. **IPC**: write-only `ai:set-secret`(키 저장), `ai:has-secret`/`ai:clear-secret`. `settings:get` 응답에서 `ai.apiKey` redact(`hasKey`/`expiresAt`만). LLM 호출·모델 목록은 전부 main에서 키 주입(현재 SettingsModal이 apiKey를 인자로 넘기던 부분 제거).
5. **설정 UI(SettingsModal AITab)**: provider 선택 후 `authMethod`에 따라 폼 분기 — `apikey`면 write-only 키 입력(저장됨 표시), `baseurl`이면 baseURL.

### 3.2 데이터 플로우 (키 입력/저장/사용)
1. 사용자가 설정에서 provider 선택 + 키 입력 → `ipc('ai:set-secret', {provider, key})` (write-only)
2. main: `safeStorage.encryptString` → `secrets.enc` atomic write. `desktop-settings.json`엔 `hasSecret:true`만.
3. `settings:get`: `ai.apiKey` 제거 후 반환(renderer는 `hasKey` boolean만 받음).
4. LLM 호출: main이 `secret-store`에서 키 로드 → `getAuthHeader`로 헤더 구성 → `llm-synthesizer`가 호출. **키는 renderer를 거치지 않음.**

### 3.3 보안 (critical 우선)
- **[critical] 비밀 renderer 누출 차단**: secret-store 분리, `settings:get` redact, write-only set-secret, LLM 호출은 main 주입. 회귀 테스트로 `settings:get` 출력에 `apiKey`/토큰 키 **부재 단언**.
- **[high] safeStorage 가용성 게이트**: `app.whenReady()` 이후 접근. `isEncryptionAvailable()===false` 또는 `getSelectedStorageBackend()==='basic_text'`(Linux 평문 fallback)면 **평문 저장 절대 금지** — 경고 + (대안) 메모리-only 또는 키 입력만 허용. `encryptString` throw 가능 → try/catch, 실패 시 평문 저장 금지(graceful degrade).
- **[medium] 로깅 누출 차단**: 키/토큰 로그 금지. CI grep gate(아래 테스트).

### 3.4 에러 처리
- 비밀 없음 → "키를 입력하세요" + 설정 직행 토스트.
- 복호화 실패(키 회전 등) → 재입력 유도(루프 금지).
- `decryptStringAsync`의 `{result, shouldReEncrypt}` — `shouldReEncrypt=true`면 즉시 재암호화 저장.
- LLM 호출 401/403 → 키 무효 안내. extractive 폴백 유지(askVault).

### 3.5 테스트
- **[보안 회귀 — 최고 레버리지]** ① `settings:get` 출력에 `apiKey`/토큰 키 부재 ② preload `ALLOWED_CHANNELS`에 비밀 반환 채널 0개 ③ CI grep gate: `main/` 비밀 리터럴 로그 금지.
- **[기능]** secret-store 암·복호화 라운드트립(safeStorage 모킹), redact 동작, write-only IPC.
- tsc clean / core vitest / desktop vitest / `tests/smoke.mjs` ALL PASS 후 커밋.

## 4. Track B — OpenAI ChatGPT device-code OAuth (스펙만, 미구현)

> experimental, off-by-default(`STELLAVAULT_OAUTH_EXPERIMENTAL=1` 게이트 + in-UI ToS 동의 필수). 다음 사이클에서 구현 판단.

### 4.1 device-code 흐름 (조사 확정값)
- **client_id** = `app_EMoamEEZ73f0CkXaXp7hrann` (OpenAI 공식 Codex CLI의 **public** client, secret 없음, `codex-rs/core/src/auth.rs` 하드코딩값). 공식 문서엔 미명시 → **회전/차단 리스크**.
- **auth_base** = `https://auth.openai.com`.
- **device user-code(비표준, RFC 8628 아님)**: `POST {auth_base}/deviceauth/usercode` body `{client_id}` → `{device_auth_id, user_code, interval(기본5s), verification url}`. user_code TTL 15분.
- **검증 페이지**: 사용자가 `https://auth.openai.com/codex/device`에서 user_code 입력.
- **폴링**: `POST {auth_base}/deviceauth/token` body `{device_auth_id, user_code}`. **pending = HTTP 403/404**(RFC의 `authorization_pending`/`slow_down` JSON 아님). 2xx면 `{access_token, refresh_token, expires_in}`. max_wait 900s(15분).
- **scope**: 공식 리터럴 `openid profile email`(없어도 refresh 발급). 3rd-party는 `offline_access` 추가하기도.
- **id_token(JWT)**: `claims['https://api.openai.com/auth'].chatgpt_account_id` 추출.
- **refresh**: `POST https://auth.openai.com/oauth/token` `grant_type=refresh_token`. 만료 30~60s 전 선제.
- **활성화 게이트**: 사용자 ChatGPT Settings > Security > "Allow device code login" 필요(미활성 시 실패).

### 4.2 런타임 호출 — Responses API 별도 경로 (critical)
- ChatGPT-OAuth 토큰은 **`api.openai.com/v1/chat/completions`에서 동작하지 않음**(401/403).
- 반드시 별도 `openai-chatgpt` provider 분기: base = `https://chatgpt.com/backend-api/codex`, `wire_api='responses'`(Responses API 바디), 헤더 `Authorization: Bearer` + `ChatGPT-Account-ID` + `originator: codex_cli_rs`(화이트리스트). originator 미일치 시 403.
- 현재 Ask/Wiki 프롬프트(Chat Completions messages)를 **Responses 바디로 변환하는 어댑터가 net-new**(스트리밍 파싱 포함) — 작업량 별도 추정.

### 4.3 보안 / ToS
- experimental off-by-default + in-UI 동의("Codex 클라이언트로 위장하며 OpenAI ToS 위반/계정 플래그 위험, 본인 책임"). API 키가 권장 기본.
- device_code/device_auth_id/토큰은 **renderer 미노출**(main 전용). `oauth:progress`는 user_code+verification_uri+expiresIn+상태만.
- `verification_uri` host 하드코딩 화이트리스트(`auth.openai.com`) 검증 후에만 open-external. device endpoint는 user-editable baseURL에서 절대 파생 금지.
- single-flight refresh 뮤텍스(동시 만료 시 1회만), 회전 시 atomic 교체, `invalid_grant` → 토큰 삭제+reauth(루프 금지). logout은 revocation best-effort + 로컬 삭제.
- 폴러: `setInterval` 아님 — `await sleep→fetch→분기` + `AbortController`. 모달 close/logout/expires/before-quit에서 확실 중단(OOM/idle 누수 규율).
- device/token 응답 **Zod 검증**(필수 필드 누락 시 저장 금지).

## 5. 제외 결정

- **Gemini(Google) OAuth 불가 확정**: ① Google device flow scope 화이트리스트(openid/email/profile/drive.*/youtube)에 `generative-language`/`cloud-platform` 미포함 ② `generativelanguage.googleapis.com`에 사용자 구독 과금 OAuth 경로 부재 ③ gemini-cli의 `cloudcode-pa` 사설 경로는 ToS 위반+ban 보고. → Gemini는 **BYO API 키만**. "로그인 한 번" UX가 필요하면 Vertex AI(GCP 프로젝트+동의화면 검증)를 별도 PRD로.
- **Claude(Anthropic) OAuth 제외**: 2026-02-20 ToS가 구독 OAuth의 제3자 도구 사용 금지(04-04 enforcement). `authMethod='apikey'` 코드 고정.

## 6. 리스크 등록부

| # | 리스크 | severity | 완화 |
|---|---|---|---|
| 1 | ChatGPT-OAuth 토큰이 `v1/chat/completions`에서 401/403 (설계 최대 거짓 전제) | critical | `openai-chatgpt` 전용 분기(Responses API)로만. experimental. Track A는 키로 이미 작동 |
| 2 | Gemini device-code OAuth 부재 — google.ts 설계 불가 | critical | google.ts 삭제. Gemini=BYO키. Vertex는 별도 PRD |
| 3 | Codex client_id 위장 = ToS 회색 + 단일 차단점(회전 시 전원 사망 + 계정 ban 전가) | critical | experimental off + in-UI 동의. authMethod 데이터화로 깨지면 1줄 apikey 폴백. canary ping |
| 4 | 키/토큰 `settings:get`로 renderer 누출(`settings:get` 핸들러, main/index.ts ~L1174) | critical | secret-store 분리·redact·write-only IPC·main 주입. 회귀 테스트. **OAuth 무관 지금 적용** |
| 5 | safeStorage 미지원(Linux basic_text)서 refresh 토큰 평문 저장 | high | `isEncryptionAvailable`/backend 게이트, false면 평문 금지 |
| 6 | 동시 LLM 호출이 같은 refresh로 병렬 refresh → 강제 로그아웃/write 경합 | high | single-flight 뮤텍스 + atomic + 선제 갱신 |
| 7 | device-code 피싱 + verification_uri 변조 | medium | host 화이트리스트, 안티피싱 경고, single in-flight |
| 8 | 폴러/타이머 미정리 OOM/idle 누수 | medium | AbortController, before-quit/logout/close/expires 중단 |
| 9 | 응답 무검증 파싱 → undefined 토큰/폴링폭주 | medium | Zod 검증, status 상태머신 |
| 10 | logout이 로컬만 삭제 → 좀비 refresh 토큰 | medium | revocation best-effort |
| 11 | 멀티계정 식별자 부재 | low | v1은 provider당 1계정+재로그인 |

## 7. 오픈 퀘스천 (Track B 구현 결정 전 해소)

1. **제품/법률**: ChatGPT 구독 OAuth를 끝내 지원할지 — OpenAI 약관의 제3자 클라이언트 구독 토큰 사용 허용 여부 문서 인용 + self-registered client 동의화면 검증 가능 여부. 둘 다 불가면 **구현하지 않는다.** (상용/멀티유저 배포는 회색지대+ban 사례 → counsel 필요)
2. device 응답 JSON 정확한 스키마 + originator enforcement 강도는 공식 미명시 → 구현 전 라이브 응답 캡처 검증.
3. Chat Completions → Responses 바디 변환 어댑터 작업량 추정(스트리밍 포함).
4. Vertex AI 경유 Gemini "로그인" UX를 별도 PRD로 분리할지.
5. Electron 35의 safeStorage sync/async 권장 확인.

## 8. 출처 (워크플로 조사)
- OpenAI Codex auth 소스: `openai/codex` `codex-rs/core/src/auth.rs`, `codex-rs/login/src/device_code_auth.rs`
- Anthropic 3rd-party OAuth 금지: theregister.com / winbuzzer.com (2026-02)
- Google Gemini OAuth/device flow: ai.google.dev/gemini-api/docs/oauth
- 레퍼런스 구현: OpenClaw, Hermes(Nous), opencode-openai-codex-auth (GitHub)
- 전체 조사·검증 원본: 워크플로 `wf_e76ac285-5a5` 산출(tasks/wif3gfme0.output)
