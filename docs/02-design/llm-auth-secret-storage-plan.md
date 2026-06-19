# LLM Auth & Secret Storage (Track A) Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** API 키를 renderer에서 분리해 OS keychain(safeStorage)에 암호화 저장하고, `settings:get` 누출을 막아 비밀이 main 프로세스를 벗어나지 않게 한다.

**Architecture:** 신규 `main/secret-store.ts`가 safeStorage로 키를 `~/.stellavault/secrets.enc`에 atomic 저장. `getAiConfig()`가 settings 대신 secret-store에서 키를 채워 기존 `makeSynthesizer(LlmConfig)`에 그대로 전달(호출처 무변경). `settings:get`은 `ai.apiKey`를 redact, 키 입력은 write-only `ai:set-secret` IPC로만. safeStorage 미지원 환경은 **메모리-only**(평문 디스크 저장 절대 금지).

**Tech Stack:** Electron 35 `safeStorage`, 기존 `SettingsStore` atomic 패턴(tmp+rename), vitest(safeStorage 모킹), 기존 `llm-synthesizer.ts` 무변경.

**Scope:** Track A만. Track B(OpenAI ChatGPT device-code OAuth)는 스펙(`llm-auth-secret-storage-design.md` §4)만, 본 계획 제외.

---

## File Structure

| 파일 | 책임 | 변경 |
|---|---|---|
| `main/secret-store.ts` | safeStorage 키 저장/로드/삭제, 가용성 게이트, 메모리 폴백 | **신규** |
| `main/secret-store.test.ts` | secret-store 단위 테스트(safeStorage 모킹) | **신규** |
| `main/index.ts` | `getAiConfig`(키 출처), `settings:get`/`settings:set`(redact), `ai:set/has/clear-secret`·`ai:list-models` 핸들러 | 수정 |
| `preload/index.ts` | `ALLOWED_CHANNELS`에 `ai:set-secret`/`ai:has-secret`/`ai:clear-secret` 추가 | 수정 |
| `shared/ipc-types.ts` | 신규 채널 타입 + `AppSettings.ai`에서 apiKey 분리(메타만) | 수정 |
| `renderer/components/settings/SettingsModal.tsx` | 키 입력 → `ai:set-secret`, `hasKey` 표시(저장됨/지움) | 수정 |
| `tests/ipc-security.test.ts` | (기존 게이트) 신규 oauth/ai 채널 컨벤션 자동 검증 | 자동 |

**불변식:** `llm-synthesizer.ts`·`makeSynthesizer` 시그니처 무변경. core 무변경. `shared/ai-providers.ts`는 비밀 0 유지(이번 Track A는 메타 변경 없음 — `authMethod` 추가는 Track B 때).

---

## Task 1: secret-store (safeStorage 저장 + 가용성 게이트 + 메모리 폴백)

**Files:**
- Create: `packages/desktop/src/main/secret-store.ts`
- Test: `packages/desktop/src/main/secret-store.test.ts`

- [ ] **Step 1: 실패 테스트 작성** (`secret-store.test.ts`)

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
// safeStorage 모킹: encryptString/decryptString 라운드트립 + 가용성 토글
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
    const { SecretStore } = await import('./secret-store.js');
    const s = new SecretStore(`${process.env.TEMP || '/tmp'}/sv-secrets-test-${Math.random().toString(36).slice(2)}.enc`);
    s.setSecret('anthropic', 'sk-ant-xyz');
    expect(s.hasSecret('anthropic')).toBe(true);
    expect(s.getSecret('anthropic')).toBe('sk-ant-xyz'); // decrypts
    expect(enc).toHaveBeenCalled(); // never plaintext
  });

  it('when encryption unavailable: memory-only, NEVER writes plaintext to disk', async () => {
    available = false;
    const { SecretStore } = await import('./secret-store.js');
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
```

- [ ] **Step 2: 실패 확인** — Run: `npm run test --workspace=@stellavault/desktop -- secret-store` · Expected: FAIL (module not found)

- [ ] **Step 3: 최소 구현** (`secret-store.ts`)

```ts
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
```

- [ ] **Step 4: 통과 확인** — Run: `npm run test --workspace=@stellavault/desktop -- secret-store` · Expected: PASS (2 tests)

- [ ] **Step 5: 커밋** — `git add packages/desktop/src/main/secret-store.ts packages/desktop/src/main/secret-store.test.ts && git commit -F <msg>` ("feat(desktop): secret-store — safeStorage key storage with memory-only fallback")

---

## Task 2: getAiConfig가 secret-store에서 키 주입 (makeSynthesizer 무변경)

**Files:** Modify `main/index.ts` (getAiConfig ~L98, app.whenReady에서 SecretStore 생성)

- [ ] **Step 1:** `app.whenReady()` 이후(safeStorage는 ready 후에만 접근 가능) 모듈 스코프 `let secretStore: SecretStore | null = null` 생성, ready 핸들러에서 `secretStore = new SecretStore()`.
- [ ] **Step 1b (마이그레이션 — 확정, 키 손실 방지):** ready 직후 1회 — 기존 `desktop-settings.json`에 평문 `ai.apiKey`가 있으면 `secretStore.setSecret(ai.provider, ai.apiKey)`로 이전 후 `settingsStore.set({ ai: { apiKey: undefined } })`(또는 redact 저장)로 settings에서 제거. 기존 사용자가 업그레이드 시 키를 잃지 않도록 **반드시** 수행. 마이그레이션 단위 테스트 1개(평문 키 있는 settings → secret-store 이전 + settings에서 삭제 단언).
- [ ] **Step 2:** `getAiConfig()` 수정 — settings에서 provider/model/baseURL만 읽고, **apiKey는 secret-store에서**:

```ts
function getAiConfig(): LlmConfig | undefined {
  try {
    if (!settingsStore) settingsStore = new SettingsStore();
    const ai = settingsStore.get().ai as Omit<LlmConfig, 'apiKey'> | undefined;
    if (!ai) return undefined;
    const apiKey = ai.provider ? (secretStore?.getSecret(ai.provider) ?? '') : '';
    return { ...ai, apiKey } as LlmConfig;
  } catch { return undefined; }
}
```

- [ ] **Step 3:** 호출처(index.ts:860, 1372) 무변경 확인 — `makeSynthesizer(getAiConfig())` 그대로. tsc로 검증.
- [ ] **Step 4:** Run `npx tsc --noEmit -p packages/desktop/tsconfig.json` · Expected: 0 errors.
- [ ] **Step 5:** 커밋 ("refactor(desktop): getAiConfig reads key from secret-store").

---

## Task 3: settings:get redact + settings:set 키 차단 (보안 회귀 테스트)

**Files:** Modify `main/index.ts` (settings:get L1174, settings:set L1178); `shared/ipc-types.ts` (AppSettings.ai → apiKey 제거); Test `main/index` 회귀(또는 `tests/`).

- [ ] **Step 1: 실패 테스트** — `settings:get` 반환에 `ai.apiKey`가 없어야 함(불변식). 순수 redact 헬퍼를 분리해 테스트:

```ts
// redactSecrets(settings) → ai에서 apiKey 제거, hasKey:boolean 부여
import { redactSecrets } from './index-helpers.js'; // 헬퍼 추출
it('settings:get output never contains apiKey/token', () => {
  const out = redactSecrets({ ai: { provider: 'anthropic', apiKey: 'sk-ant-SECRET', model: 'x' } } as any, (p) => true);
  expect(JSON.stringify(out)).not.toContain('sk-ant-SECRET');
  expect(JSON.stringify(out)).not.toMatch(/"apiKey"|access_token|refresh_token/);
  expect(out.ai.hasKey).toBe(true);
});
```

- [ ] **Step 2:** 실패 확인.
- [ ] **Step 3:** `redactSecrets` 헬퍼 구현 + `settings:get`에서 적용:

```ts
ipcMain.handle('settings:get', () => {
  if (!settingsStore) settingsStore = new SettingsStore();
  return redactSecrets(settingsStore.get(), (p) => !!secretStore?.hasSecret(p));
});
```
`settings:set`은 들어온 patch의 `ai.apiKey`를 **삭제**(키는 set-secret 전용)한 뒤 기존 validate→set.
  - redact 페이로드에 `keychainAvailable: secretStore?.isPersistent() ?? false` 포함(Task 6 Step 3의 비영구 경고가 이 플래그를 소비).

- [ ] **Step 4:** 통과 확인 + `AppSettings.ai` 타입에서 `apiKey` 제거(`{ provider, model, baseURL, hasKey? }`), tsc 0.
- [ ] **Step 5:** 커밋 ("fix(desktop): redact apiKey from settings:get — close renderer leak").

---

## Task 4: write-only 키 IPC (ai:set/has/clear-secret) + preload + 타입

**Files:** Modify `main/index.ts`(핸들러), `preload/index.ts`(ALLOWED_CHANNELS), `shared/ipc-types.ts`(IpcChannelMap).

- [ ] **Step 1: 실패 테스트** — preload `ALLOWED_CHANNELS`에 `ai:set-secret`/`ai:has-secret`/`ai:clear-secret` 포함, **토큰을 반환하는 채널은 없음**:

```ts
it('exposes write-only secret channels, no secret-returning channel', () => {
  expect(ALLOWED_CHANNELS.has('ai:set-secret')).toBe(true);
  expect([...ALLOWED_CHANNELS].some(c => /get-secret|read-secret/.test(c))).toBe(false);
});
```

- [ ] **Step 2:** 실패 확인.
- [ ] **Step 3:** 핸들러 구현 — `ai:set-secret`(`{provider, key}` → `secretStore.setSecret`), `ai:has-secret`(`provider`→boolean), `ai:clear-secret`. **get-secret 핸들러는 만들지 않음.** preload `ALLOWED_CHANNELS`에 3개 추가(namespace:action 컨벤션). `IpcChannelMap`에 타입.
- [ ] **Step 4:** 통과 + `tests/ipc-security.test.ts` 재실행(신규 채널 컨벤션 통과) + tsc 0.
- [ ] **Step 5:** 커밋 ("feat(desktop): write-only ai:set/has/clear-secret IPC").

---

## Task 5: ai:list-models 키 출처를 secret-store로

**Files:** Modify `main/index.ts` (ai:list-models 핸들러 ~L1187).

- [ ] **Step 1:** 현재 `ai:list-models`는 `{provider, apiKey, baseURL}`(apiKey가 renderer 인자)을 받음 → **provider만** 받고 키는 `secretStore.getSecret(provider)`에서 로드하도록 변경(키가 renderer를 왕복하지 않음). **함께 업데이트**: `IpcChannelMap['ai:list-models']` args에서 `apiKey` 제거 + `SettingsModal`의 `ai:list-models` 호출처에서 apiKey 전달 제거(타입 계약과 호출부가 같이 이동 — tsc가 강제하지만 명시).
- [ ] **Step 2:** 키 미저장 시 친절한 에러(`StellavaultError` 패턴: "먼저 키를 저장하세요").
- [ ] **Step 3:** tsc 0 + 수동: 키 저장 후 모델 목록 Load 동작.
- [ ] **Step 4:** 커밋 ("refactor(desktop): ai:list-models uses stored key, not renderer arg").

---

## Task 6: SettingsModal AITab — write-only 키 입력 + hasKey 표시

**Files:** Modify `renderer/components/settings/SettingsModal.tsx` (AITab 키 입력); i18n 키 en/ko 추가.

- [ ] **Step 1:** 키 입력 필드 → 저장 시 `ipc('ai:set-secret', {provider, key})` 호출(더 이상 `settings:set`에 apiKey 넣지 않음). 저장 후 입력값 클리어.
- [ ] **Step 2:** `settings:get`의 `ai.hasKey`로 "✓ 키 저장됨 / [지우기]"(clear-secret) vs "키 입력" 상태 표시. provider 전환 시 `ai:has-secret`로 갱신.
- [ ] **Step 3:** safeStorage 비영구(`isPersistent=false`) 안내 — main이 `settings:get`(또는 별도 `ai:secret-persistent`)로 noKeychain 플래그 노출 시 "OS 키체인 미지원 — 키가 이 세션에만 유지됩니다" 경고. (플래그는 Task 3 redact 페이로드에 `keychainAvailable:boolean` 추가)
- [ ] **Step 4:** i18n 상태 문자열 en/ko 추가(최근 453키 관습). tsc 0 + desktop vitest.
- [ ] **Step 5:** 커밋 ("feat(desktop): AITab write-only key input + saved-state").

---

## Task 7: 통합 검증 게이트

- [ ] **Step 1:** `npx tsc --noEmit -p packages/desktop/tsconfig.json` → 0
- [ ] **Step 2:** `npm run test --workspace=@stellavault/desktop` → 전부 PASS(신규 secret-store + redact + preload 회귀 포함)
- [ ] **Step 3:** `node tests/smoke.mjs` → 🟢 ALL PASS
- [ ] **Step 4:** **보안 회귀 단언 확인**: `settings:get` 출력에 `apiKey`/`access_token`/`refresh_token` 부재 테스트 PASS, get-secret 채널 부재 테스트 PASS.
- [ ] **Step 5: Manual Browser/Device Gate** (safeStorage·재시작 = 자동 불가, commit 전 사용자 확인):
  - [ ] 키 입력→저장→"✓ 저장됨" 표시
  - [ ] 앱 재시작 후 키 유지(재입력 불필요), Ask/Wiki 정상 동작
  - [ ] 키 [지우기] 후 추출 폴백 모드 복귀
  - [ ] (가능 시) `~/.stellavault/secrets.enc`가 평문 아님(암호화 바이트) 확인
  - [ ] `desktop-settings.json`에 apiKey 문자열 부재 확인
- [ ] **Step 6:** 검증=`npm run package` 후 exe(dev는 type:module로 안 뜸), 패키징 전 `taskkill stellavault`. 전체 통과 후 최종 커밋.

---

## Notes
- **advisory #1 해소**: `makeSynthesizer` 시그니처 유지 → 호출처(860/1372) 무변경. `getAuthHeader` 추상화는 Track B에서.
- **advisory #2 결정**: safeStorage 미지원 = 메모리-only(평문 디스크 저장 절대 금지).
- 기존 평문 `ai.apiKey` 마이그레이션은 **Task 2 Step 1b로 확정**(reviewer #2 반영 — 업그레이드 시 키 손실 방지).
