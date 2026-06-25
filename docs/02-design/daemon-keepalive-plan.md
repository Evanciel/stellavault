# Stellavault Desktop — Always-On Daemon 구현 스펙 (FINAL LOCKED)

> **Status**: LOCKED — 구현 착수 승인 대기. 적대리뷰 2라운드(SAFETY 5건 + LIFECYCLE/YAGNI 5건) 전건 인라인 반영 완료.
> **Branch**: `feat/daemon-keepalive` (off master HEAD `49fd11f`).
> **Scope**: 메인 창이 닫힌 채로 distill이 **1회 실재 실행**되는 headless 데몬. Phase 0(트레이 + 조건부 keep-alive + `runDistill` 추출 + 수동 Compile-now)만 LAYER thesis를 증명하는 **출시 단위**.
> **Out-of-scope (Phase 0)**: `DaemonScheduler` setInterval 틱, `daemon_distill_log` 영속 추적, `openAtLogin`, OS Notification, decay-tick job, pause/resume 트레이 연동 — 전부 Phase 1+로 디퍼(§8). OrchestrationEngine 개조는 영구 out-of-scope.
> **Design Ref**: `// Design Ref: §{n} — daemon-keepalive`. Plan SC: "window closed → distill writes a vault note, headless, once."

---

## §1. 동작 개요 + 왜 (LAYER thesis 실재화)

데스크탑 앱은 현재 **마지막 창이 닫히면 프로세스가 종료**된다(`window-all-closed` → `app.quit()`, `index.ts:3279`). 그 결과 모든 자율 지식 작업(대화 distill, FSRS 시드)은 **사용자가 창을 열어둔 동안에만** 가능하다. 세컨드브레인의 약속("내가 안 볼 때 볼트가 스스로 컴파일된다")은 코드에 존재하지 않는다.

**LAYER thesis**: distill이 메인 창이 닫힌 채로 **1회 실재 실행**되는 것 — 이것이 데몬의 유일한 존재 이유이자 유일한 수용 기준이다. "UI가 렌더링됨" / "타이머가 돈다"가 아니라, **창 0개 상태에서 `.md` 노트가 디스크에 실제로 쓰이고 `indexFiles`에 반영**되어야 한다.

**왜 distill인가**: distill은 (a) vault NOTES만 건드리는 **additive**(create=no-overwrite, append, link — delete/unlink 도구 없음) 작업이고, (b) `runDistill`이 distill deps를 그대로 상속해 **memoryWrite를 미배선**하므로 unattended 안전 작업의 정확한 모양이다. 메모리 쓰기·reflection·network는 데몬 task set에서 물리적으로 배제된다(§4).

**왜 OrchestrationEngine을 안 쓰나**: engine은 `capture_queue`를 드레인하는 **이벤트 구동 직렬 워커**로 타이머/폴이 없고, 모든 큐 행이 `runCapture()`로 하드와이어돼 distill(`chatStream` 경로)을 끼울 수 없다. engine은 **개조하지 않고**, 그것이 시연한 패턴(재진입 가드 직렬 드레인 + `getAllWindows()` no-op emit + `unref` 타이머)을 형제 모듈로 복제한다 — 단, **Phase 1 전까지 스케줄러 자체를 만들지 않는다**(§8 YAGNI 결론).

---

## §2. LIFECYCLE — 트레이 + 조건부 keep-alive

기존 종료/닫기 메커니즘 3종과 **공존**한다: `before-quit` chat-abort(`:3273`), `win.on('close')` dirty-veto, `window:confirm-close`(`:2047`) round-trip. 데몬은 이들을 **변경하지 않고 listener/분기만 추가**한다.

### 모듈 전역 (`index.ts` 상단, `chatStreamRegistry` 인근 `:179`)

```ts
let tray: Tray | null = null;          // GC 방지 — 반드시 모듈 전역
let isQuitting = false;                // "의도된 종료" 플래그 (relaunch·Quit·before-quit이 set)
const daemonEnabled = () => { try { return !!settingsStore?.get().daemon?.enabled; } catch { return false; } };
// Phase 1+: let daemonScheduler: DaemonScheduler | null = null;
```

### (a) requestSingleInstanceLock — `whenReady` 이전, 최상단

keep-alive는 두 번째 실행이 SQLite DB + MCP 루프백 포트를 두고 싸우게 만든다. **그러나 단일 인스턴스 락은 vault-switch `app.relaunch()`(`:2071`)와 정면충돌한다** — relaunch는 신 프로세스를 **구 프로세스가 락을 아직 쥔 채** 스폰하므로, naive 락은 child가 `false`를 받아 자살하고 둘 다 죽거나 잘못된 vault에 머문다. 락은 **`isPackaged && daemonEnabled()`에만 걸고**, `--smoke-core` CI 경로(`app.exit` early at `:3164`, 락 이전)는 건드리지 않는다.

```ts
const wantLock = app.isPackaged && daemonEnabled() && !process.argv.includes('--smoke-core');
if (wantLock) {
  if (!app.requestSingleInstanceLock()) { app.quit(); return; }
  app.on('second-instance', () => showMainWindow());
}
```

vault-switch와의 레이스 해소는 **(d)의 `isQuitting` 커밋 + 구 인스턴스 deterministic exit**에 의존한다(아래). `--smoke-core`는 락 이전에 `app.exit`하므로 게이팅으로 충분.

### (b) Tray — 데몬 토글 ON일 때만 빌드

`import { Tray, Menu, nativeImage, Notification } from 'electron'`. `whenReady`의 `createWindow()` 직후 호출.

```ts
function buildTray() {
  if (tray || !daemonEnabled()) return;
  tray = new Tray(nativeImage.createFromPath(trayIconPath()));  // extraResource
  rebuildTrayMenu();
  tray.setToolTip('Stellavault — knowledge daemon active');
}
function rebuildTrayMenu() {
  if (!tray) return;
  const engineReady = !!engine;                       // [LOW fix] null이면 Pause 비활성
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Stellavault', click: () => showMainWindow() },
    { label: 'Compile now (headless)', click: () => void runManualDistill() },
    { type: 'separator' },
    { label: 'Pause background capture', type: 'checkbox',
      enabled: engineReady, checked: !!engine?.isPaused?.(),
      click: (mi) => { engine?.setPaused(mi.checked); rebuildTrayMenu(); } },
    { type: 'separator' },
    { label: 'Quit Stellavault', click: () => { isQuitting = true; app.quit(); } },
  ]));
}
```

[LOW fix — dead Pause control] `engine`은 async `initCore`(`:464-497`) 끝에서야 생성되고 실패 시 null일 수 있다. 메뉴를 `engineReady`로 `enabled` 게이트하고, **`initCore` resolve 후 `rebuildTrayMenu()`를 1회 호출**해 체크박스 상태를 동기화한다(Electron은 buildFromTemplate 시점 상태를 캡처하므로 재빌드 필요).

트레이 아이콘은 `scripts/make-tray-icon.mjs`(순수-JS, `make-web-clipper-icon.mjs` 선례)로 생성 + electron-forge `extraResource`로 패키징. non-packaged 경로에서 빈 트레이가 뜨는 것은 (a)의 `isPackaged` 게이트가 차단한다.

### (c) 조건부 `window-all-closed` (`:3279` 교체)

```ts
app.on('window-all-closed', () => {
  if (isQuitting || !daemonEnabled()) { app.quit(); return; }
  if (process.platform === 'darwin') app.dock?.hide();
  // else: headless 생존 (트레이 유지)
});
```

### (d) close veto 체인 + vault-switch relaunch와 공존 — **CRITICAL fix**

dirty-veto round-trip은 **그대로 둔다**: 데몬 모드에서도 X를 누르면 미저장 확인을 받아야 한다. `window:confirm-close`(`:2047`) → `closeConfirmed.add(win); win.destroy()` 경로는 무변경. 차이는 destroy 후 `window-all-closed`가 quit 대신 headless로 떨어지는 것뿐.

**[CRITICAL/HIGH fix — vault-switch 무한 생존 버그]** 원안은 "relaunch가 `isQuitting=true`를 set한다"고 가정했으나 **실제 코드는 아무것도 set하지 않는다**. 실 경로: `vault:switch`(`:2722`) `win.close()` → renderer `window:confirm-close(true)`(`:2047`) → `app.relaunch()`(`:2071`) → `win.destroy()`(`:2078`). `app.relaunch()`는 **프로세스 종료 시점에 relaunch를 큐잉**할 뿐이고, 프로세스를 실제로 죽이는 건 unconditional `window-all-closed`다. 새 조건부에서 **데몬 ON이면 `isQuitting=false && daemonEnabled=true`** → quit 안 함 → 구 프로세스가 트레이에서 **구 vault로 생존**하고, 큐잉된 relaunch는 영영 안 터진다. vault-switch가 **데몬 켜질 때만 조용히 깨진다**.

수정 (`window:confirm-close`의 vault-switch 커밋 분기, `app.relaunch()` **직전** `:2071`):

```ts
ipcMain.handle('window:confirm-close', (e, proceed: boolean) => {
  // ... 기존 가드 ...
  if (proceed && pendingVaultSwitch) {
    isQuitting = true;            // [FIX] 조건부 window-all-closed가 app.quit() 하도록
    app.relaunch();              // 종료 시 relaunch 큐잉
  }
  // ... win.destroy() → window-all-closed(isQuitting=true) → app.quit() → 락 해제 → child 부팅
});
```

이로써 (a)의 락도 안전해진다: 구 인스턴스가 `app.quit()`로 **deterministic하게 종료 → 락 해제** 후 child가 부팅하므로 child의 `requestSingleInstanceLock()`이 성공한다. `:124`의 기존 주석("commit it in window:confirm-close, i.e. ONLY on a path that actually relaunches")이 이 위치를 정확히 가리킨다 — **vault-switch 커밋 분기에서만** set하고, 일반 dirty-close에서는 set하지 않는다(일반 X는 headless 생존이 정상).

**[MEDIUM fix — hidden autostart 락 대기]** `--hidden` 자동시작 부팅이 구 인스턴스 종료와 겹치면 child가 락 획득에 실패할 수 있다. child는 락 실패 시 즉시 자살하지 말고, 단일 재시도(짧은 backoff 후 1회) 또는 `app.quit()` 후 OS 재시작에 맡긴다. Phase 0에는 `openAtLogin`이 없으므로(§8) 이 경로는 Phase 1에서만 활성.

### (e) before-quit / chat-abort 공존

`before-quit`(`:3273`)의 `chatStreamRegistry` 일괄 abort는 **무변경**. 데몬의 distill은 자신의 AbortController를 **같은 `chatStreamRegistry`에 등록**(§3)하므로 기존 sweep이 자동으로 커버한다. Phase 1에서 타이머 추가 시 `before-quit`에 `daemonScheduler?.stop()` 한 줄만 더한다(memTimer 선례).

**[MEDIUM fix — quit 중 tick 시작 방지]** `before-quit` 핸들러에서 `isQuitting = true`를 **맨 앞에서 set**하고, `idleEnough()`(Phase 1)는 `isQuitting`이면 즉시 `false`를 반환한다 → Quit 순간 새 distill이 시작되지 않는다.

### (f) showMainWindow — 트레이 / `activate` / `second-instance` 공용 헬퍼

현 `win`은 `whenReady` 로컬(`:3210`)이라 전역 참조가 없다.

```ts
function showMainWindow() {
  const [w] = BrowserWindow.getAllWindows();
  if (w) { if (w.isMinimized()) w.restore(); w.show(); w.focus(); }
  else createWindow();   // dirty-veto+destroy 경로라 재오픈은 fresh createWindow (bounds 복원)
  if (process.platform === 'darwin') app.dock?.show();
}
```

기존 hide-아닌-destroy 경로를 유지(현 dirty-veto+destroy 무손상 우선). `second-instance`에서 headless라면 `getAllWindows()`가 비어 `createWindow()`로 떨어진다 — 이때 **vault-picker(`:3188`)를 재트리거하지 않도록** createWindow가 이미 설정된 vault를 재사용하는지 확인(vault 설정 시 picker skip 분기 존재).

---

## §3. SCHEDULER — `runDistill` 추출 + (Phase 1) `DaemonScheduler`

### 판정 (재확인)

OrchestrationEngine 미개조. Phase 0는 **스케줄러·타이머 없이** 트레이 "Compile now" 수동 클릭으로 LAYER thesis를 증명한다(§8 YAGNI). `DaemonScheduler`(setInterval/idleEnough/tick)는 Phase 1에서만 도입.

### `runDistill` 추출 — **HIGH fix: thin wrapper 아님, DI 수술**

원안은 "emit 주입만 하면 됨"으로 과소평가했다. 실제 `chat:distill`(`:1305-1387`)은:
- `e.sender.id`를 `wcId`로 `chatStreamRegistry`에 등록(chat:abort 소유권 + before-quit가 사용),
- `req.messages`의 untrusted 이미지를 보안 한도로 **bounding**(compromised renderer가 메모리를 못 몰도록),
- deps(`getAiConfig`, `currentVaultPath`, `store`, `embedder`, `decayEngine`, `searchEngine`, `chatStreamRegistry`, `buildAgentToolset`, `buildExecuteAgentTool`, `recallMemory`, `describeImages`)가 **전부 `index.ts` 모듈-private** — `daemon/distill-job.ts`에서 import 불가.

따라서 진짜 DI: `index.ts`에서 globals를 **export하거나 `runDistill`에 주입**한다.

```ts
// daemon/distill-job.ts
export async function runDistill(opts: {
  messages: ChatMessage[]; streamId: string; signal: AbortSignal;
  emit: (event: DistillEvent) => void;       // safeSend(renderer) | log writer(headless)
  cfg: AiConfig; deps: DistillDeps;           // index.ts globals 주입
}): Promise<DistillResult>;
```

요구 사항(§7 변경표에 반영):
1. **이미지/트랜스크립트 bounding을 `runDistill` 내부로** 이전(`:1328-29` 보안 한도 유지) — 데몬도 동일하게 untrusted 입력 취급.
2. AbortController를 **`chatStreamRegistry`에 합성 `wcId = -1`로 등록** → before-quit(`:3273`) sweep이 커버. [MEDIUM fix]
3. chat:abort per-window 소유권(`:1119`, `ent.wcId === wcId` 카운트)이 **데몬 스트림(`-1`)과 렌더러 스트림을 교차 abort하지 않음**을 검증(렌더러 `wcId`는 항상 ≥0).
4. IPC `chat:distill` 핸들러는 thin wrapper로 `emit = safeSend`, `wcId = e.sender.id` 전달 — **기존 동작 무손상**.

### emit 라우팅 — headless 메커니즘

창이 없으면 UI 이벤트(`tool-call` 등)는 갈 곳이 없다. `emit`을 **JSONL 로그 라이터**로 라우팅: `~/.stellavault/daemon.log`, 라인 = `{ts, event, name, filePath}`. 노트 쓰기는 `afterWrite`(`:1345`, `assertInsideVault` + `indexFiles`)로 정상 적용 → distill은 windowless에서도 **기능적으로 완전**, UI 이벤트만 로그로 흐른다. 열린 창이 있으면 `getAllWindows()` 브로드캐스트 fallback.

### Phase 0 진입점 — `runManualDistill()`

```ts
async function runManualDistill() {
  const sessions = listSessions();                       // {id,title,updated} desc (검증됨)
  const target = sessions.find(s => /* ≥2턴 & 미distill */);
  if (!target) return;
  const { messages } = loadSession(target.id);           // 메시지 복원 (검증됨)
  const ctrl = new AbortController();
  await runDistill({ messages, streamId: `daemon-${target.id}`, signal: ctrl.signal,
                     emit: daemonLogEmit, cfg: getAiConfig(), deps: distillDeps });
}
```

### Phase 1 — `DaemonScheduler` (디퍼, §8)

`packages/desktop/src/main/daemon/scheduler.ts`: `setInterval` + `unref()` + 재진입 가드(`running`) + `idleEnough()`(마지막 입력 N분 + `getFocusedWindow()===null` + `!isQuitting`) + `daemon_distill_log` claim-then-run. **decay-tick job은 드롭**(§4·§8). `DAEMON_TICK_MS = 30*60_000`(OOM 주의, `[mem]` `:3212`).

---

## §4. SAFETY BOUNDARY — 데몬이 절대 안 하는 것 + 코드가 어떻게 막는지

핵심 불변식: 데몬 SAFE task set = **auto-distill(vault NOTES, create-only headless / additive / reversible / no memoryWrite dep)**. 그 외 아무것도 없음.

| 절대 금지 (unattended) | 코드가 이미 강제 | 데몬 추가 방어 |
|---|---|---|
| `core_memory_replace` | force-confirm set 유일 멤버(`agent-tools.ts:296`) + `onToolConfirm` 없음 → fail-closed. dep 미배선 시 dispatcher `'memory write unavailable here'`(`:443`). **2중**. | `runDistill`에서 `deps.memoryReplace === undefined` **hard-assert throw**. |
| `core_memory_append` | **[HIGH fix — 1중뿐임을 정직히 명시]** append는 memory-relax로 autonomous화돼 **force-confirm 아님**(`:296`엔 replace만). headless 유일 방어는 distill이 memoryAppend dep를 미배선해 dispatcher `:436`가 거부하는 **단일 negative invariant**. undo-toast(`chat-engine:1369`)는 렌더러 없는 headless에서 **inert**. | **[FIX]** `runDistill`에서 `deps.memoryAppend === undefined` **hard-assert throw** + 루프가 fail-closed로 거부하는 **positive headless deny set**(`core_memory_append` 포함)을 둔다 → 미래 DRY 리팩터가 dep를 몰래 재배선해도 **시끄럽게 실패**. |
| poisoned distill의 무제한 노트 오염 | create_note는 no-overwrite(`:229/451`), delete/unlink 도구 부재 → 비파괴. **그러나** append_note(`:246/475`)·link_note(`:261/489`)는 경로로 **기존 노트를 무제한 additive 오염** 가능. foreground는 사용자가 tool strip 보고 undo; **headless는 30분 틱에 아무도 안 봄**. | **[HIGH fix]** ① headless distill은 **create_note만 허용**, append_note·link_note는 데몬 컨텍스트에서 **deny**(기존 노트 unattended 변경이 위험 핵심). ② 폴드된 트랜스크립트에 **`scanForInjection` 선검사**(reflection 후보 `:1448`와 동일 detector), trip 시 skip. ③ **per-tick write cap** 하드 스톱. ④ `daemon_distill_log`는 **claim-then-run**(실행 전 기록) → erroring/looping 세션이 무한 재distill 안 됨. |
| reflection auto-trigger (§10-d OFF) | `chat:reflect`는 명시 호출만. | 데몬 task set에서 reflect **완전 배제** — enqueue/tick 안 함. |
| network-write / telemetry | agent toolset에 network-write 도구 0. agent 루프는 `isLocalProviderUrl`(`chat-engine:697`) 루프백에만 실행 → remote provider는 write-incapable single-shot으로 degrade. telemetry OFF. | **[LOW fix — outbound 정정]** "outbound=로컬 Ollama뿐"은 **부정확**. 패키징+auto-update ON이면 `setupAutoUpdate`(`:3127`)가 **GitHub 피드를 시간당 폴**한다(isPackaged+env 2중 게이트, notify-only, 무음 설치 없음). headless 장기 생존 시 restart 알림이 닫힌 렌더러를 타겟할 수 있음. **권고: headless(창 0개)면 auto-update 폴 일시정지.** |
| 누수 / quit 후 생존 | — | `runDistill` AbortController를 `chatStreamRegistry` 등록 → before-quit(`:3273`) abort. Phase 1 타이머는 before-quit `daemonScheduler?.stop()` + `isQuitting` tick 가드. |
| orphan autostart (Phase 1) | — | **[LOW fix]** 데몬 또는 `openAtLogin` 토글 **OFF** 시 `setLoginItemSettings({openAtLogin:false})` 명시 호출 → 데몬 꺼졌는데 hidden 부팅하는 orphan 제거. `isPackaged` 게이트 유지. vault 미설정 hidden 부팅은 창 표시 fallback. |

**가시 affordance + opt-in**: 트레이 아이콘 = "daemon active" 신호. 설정 토글 **기본 OFF**. (Phase 1) distill 발생 시 OS Notification(opt-out).

---

## §5. SETTINGS + IPC

### `AppSettings` 추가 (`shared/ipc-types.ts` + `settings-store.ts` `getDefaults`)

```ts
daemon: { enabled: false, openAtLogin: false, notify: true, tickMinutes: 30 }
```

중첩 객체 — `deepMerge`가 부분 패치/누락 키를 default로 채움 → `version` bump 불필요. (Phase 0는 `enabled`만 실질 사용; 나머지 필드는 Phase 1 전까지 inert.)

### IPC 채널 (`registerIpcHandlers`)

- `daemon:get-status` → `{ enabled, running, lastRun, lastResult, nextTickIn }`.
- `daemon:set-enabled` (bool) → `settingsStore.set` + 즉시 `buildTray()` / `tray?.destroy(); tray=null` + (Phase 1) `daemonScheduler?.start()/stop()`. **[LOW fix]** `enabled→false` 시 `setLoginItemSettings({openAtLogin:false})`로 orphan autostart 제거.
- `daemon:set-open-at-login` (bool, Phase 1) → `app.isPackaged &&` `setLoginItemSettings({ openAtLogin, args:['--hidden'], path: process.execPath })`.
- `daemon:run-now` → `runManualDistill()` (창 열린 채로도 수동 트리거 — Phase 0 수용 테스트용).

preload allowlist 양방향 등록(`ipc-security-chat` 선례 → `toContain` 단위 테스트). 렌더러 Settings → General: 토글 + "Compile now" 버튼 + 마지막 실행 시각.

---

## §6. ACCEPTANCE TEST — 창 닫고 distill 1회

CDP(`--remote-debugging-port=9222`) + 로그 검증(desktop-packaged-verify 선례):

1. 데몬 토글 ON, Ollama(`openai-compatible` 루프백) 기동, **2턴 이상** 대화 1건 생성·저장.
2. `~/.stellavault/daemon.log` 초기 라인 수 기록.
3. 메인 창 **닫기**(X → dirty-veto 통과 → destroy → `window-all-closed`가 quit 안 함 → headless). CDP `Runtime.evaluate`로 `BrowserWindow.getAllWindows().length === 0` 확인.
4. 트레이 **"Compile now"** 클릭.
5. **검증(thesis)**: `daemon.log`에 새 `{event:'tool-result', name:'create_note', filePath}` 라인 + 해당 vault `.md`가 디스크에 실재 + `indexFiles` 반영.
6. **음성 검증(safety)**: 같은 로그에 `core_memory_*` 쓰기 라인 **부재** 확인 + append_note/link_note **부재**(create-only deny 검증) + `scanForInjection` skip 동작.
7. **레이스 검증(lifecycle)**: 데몬 ON 상태에서 **vault-switch** → 정확히 **1개 인스턴스가 새 vault로 부팅**(orphan 0). 데몬 distill `streamId`가 `chatStreamRegistry`에 등장(before-quit 커버 단언).

---

## §7. 파일 + 심볼 변경표

### 신규

| 파일 | 심볼 |
|---|---|
| `packages/desktop/src/main/daemon/distill-job.ts` | `runDistill({messages,streamId,signal,emit,cfg,deps})` — chat:distill 본체 추출, 이미지/트랜스크립트 bounding 내부화, `chatStreamRegistry` 등록(wcId=-1), memoryAppend/Replace **hard-assert**, headless deny set, scanForInjection 선검사, create-only + per-call write cap |
| `packages/desktop/src/main/daemon/daemon-log.ts` | `daemonLogEmit(event)` → `~/.stellavault/daemon.log` JSONL writer |
| `scripts/make-tray-icon.mjs` | 순수-JS 트레이 아이콘 생성 |
| *(Phase 1)* `daemon/scheduler.ts` | `DaemonScheduler{start,stop,tick,runOnce,runPendingDistill}`, `idleEnough()`, `DAEMON_TICK_MS` |
| *(Phase 1)* `daemon/distill-log-dao.ts` | `daemon_distill_log` 테이블 + `claimDistill/markDone`(queue-dao 패턴, `store.getDb()` 공유) |

### 편집

| 파일 | 변경 |
|---|---|
| `index.ts` | `:179` 전역(`tray`,`isQuitting`,`daemonEnabled`). whenReady 최상단 `requestSingleInstanceLock`(isPackaged+daemonEnabled 게이트). `:3279` window-all-closed 조건부. `:3210` 인근 `buildTray`/`rebuildTrayMenu`/`showMainWindow`/`runManualDistill`. `:2071` **window:confirm-close vault-switch 분기에 `isQuitting=true`**[CRITICAL]. `:3273` before-quit 맨 앞 `isQuitting=true`. `:1305-1387` distill 핸들러 → `runDistill` thin wrapper 리팩터. initCore resolve 후 `rebuildTrayMenu()` 1회. `setupAutoUpdate`(`:3127`) headless 폴 일시정지[LOW]. |
| `settings-store.ts` / `shared/ipc-types.ts` | `daemon` 필드 + `getDefaults` |
| preload | daemon IPC allowlist(양방향) |
| 렌더러 Settings UI | 토글 + Compile-now + lastRun |
| `forge.config` | 트레이 아이콘 `extraResource` |
| smoke test | `daemon-distill-headless`(emit no-op 라우팅 + memoryWrite dep 부재 단위 + scanForInjection skip + create-only deny) + `daemon-stream-registered`(streamId ∈ registry) + `ipc-security-chat` daemon 채널 `toContain` |

### 재사용 (무개조)

`chatStreamRegistry`(abort), `before-quit`(`:3273`), `decayEngine.initializeNewDocuments`, `listSessions`/`loadSession`(검증됨), `buildExecuteAgentTool`+`afterWrite`(`:1345`), `assertInsideVault`, `getAllWindows()` no-op emit, `scanForInjection`(`:1448`), `isLocalProviderUrl`(`chat-engine:697`).

---

## §8. PHASED ROLLOUT

- **Phase 0 (LAYER thesis 증명 — 유일한 출시 단위)**: window-all-closed 조건부 + 트레이(open/Compile-now/Quit) + `requestSingleInstanceLock`(게이트) + **vault-switch isQuitting fix** + `runDistill` 추출(hard-assert·create-only·scanForInjection·write-cap) + `daemonLogEmit`. **스케줄러·타이머 없음**. 토글 기본 OFF. → §6 수용 테스트를 **수동 Compile-now**로 통과. **[YAGNI fix: 이것만으로 "창 닫고 distill 1회" 입증 — DaemonScheduler/daemon_distill_log/openAtLogin/Notification/decay-tick 전부 디퍼.]**
- **Phase 1 (스케줄, 수요 입증 후에만)**: `DaemonScheduler` + `idleEnough()` + `daemon_distill_log` claim-then-run + `openAtLogin`(orphan 정리 포함) + Notification + auto-update headless 일시정지. **decay-tick은 영구 드롭**(아래).
- **Phase 2 (마감)**: Settings 상태 표시, pause/resume 트레이↔engine 연동(rebuild), 대형 vault 메모리 가드(`rss` 임계 skip), macOS dock 가드.

**[YAGNI fix — decay-tick 드롭]** decay-tick은 `decayEngine.initializeNewDocuments`(이미 부팅 `:449`)를 재호출할 뿐이고 FSRS retrievability는 read 시 lazy 계산 → 스케줄 틱은 **OOM 위험만 있는 busywork**. 구체적 read-staleness 문제가 입증되기 전까지 **만들지 않는다**.

**Manual Browser Gate (커밋 차단, Node 0% 검출)** — 사용자 수동 체크 후 커밋:
- [ ] 창 닫고 트레이 잔존 → "Compile now" → vault에 `.md` 노트 생성됨
- [ ] 재오픈(트레이 Open) 정상, vault-picker 재트리거 없음
- [ ] Quit이 **진짜 종료**(트레이 사라짐, 프로세스 죽음)
- [ ] **데몬 ON 상태 vault-switch → 새 vault로 1개 인스턴스 부팅**(orphan/구-vault 생존 없음)
- [ ] dirty 문서 열고 X → 미저장 확인 다이얼로그 여전히 뜸

---

## §9. 적대리뷰 반영 (전건 인라인)

| # | 심각도 | 지적 | 반영 위치 |
|---|---|---|---|
| L1 | **critical** | 조건부 window-all-closed가 vault-switch relaunch를 깸 (isQuitting 미set) | §2(d) `window:confirm-close` vault-switch 분기 `isQuitting=true` + §6-7 + §8 게이트 |
| S1 | high | core-memory append 방어는 1중(force-confirm 아님), undo-toast headless inert | §4 append 행 정정 + `runDistill` hard-assert + positive deny set |
| S2 | high | poisoned distill이 기존 노트 무제한 오염(append/link), 재distill 루프 | §4 행 + §3: create-only deny, scanForInjection 선검사, write-cap, claim-then-run |
| L2 | high | runDistill 추출은 thin wrapper 아님(e.sender wcId, 이미지 bounding, non-export globals) | §3 DI 수술 명세 + §7 변경표 |
| L3 | high | singleInstanceLock이 relaunch와 레이스(child false→자살) | §2(a) `isPackaged&&daemonEnabled` 게이트 + (d) deterministic exit로 락 해제 |
| S3 | medium | abort-on-quit은 registry 등록 + tick 중단 선행에만 성립 | §3 wcId=-1 registry 등록 + §2(e) before-quit `isQuitting` 선set + tick 가드 |
| S4 | medium | singleInstanceLock + headless가 vault-switch 깸(L1과 동일 근원) | §2(d)와 통합 해소 |
| L4 | medium | scheduler/log/openAtLogin/Notification/decay-tick은 thesis에 YAGNI | §8 Phase 0 only + decay-tick 영구 드롭 |
| S5 | low | always-on이 auto-update 시간당 폴 + persistent login item 노출 | §4 outbound 정정(GitHub 피드 명시 + headless 폴 정지) + §5 orphan login item 정리 |
| L5 | low | Pause 트레이 체크박스가 engine null일 때 dead | §2(b) `enabled:engineReady` + initCore 후 rebuild |

---

## §10. OPEN DECISIONS (추천안 포함)

1. **headless distill 대상 선택 휴리스틱** — `listSessions()` 최근 N개 중 "≥2턴 & 미distill". Phase 0엔 `daemon_distill_log`가 없어 영속 추적 불가 → **추천: Phase 0는 가장 최근 미-distill 1건만 in-memory로 1회 처리**(중복 방지는 사용자가 한 번 클릭하는 수동 트리거라 허용 가능), 영속 추적은 Phase 1 `daemon_distill_log` claim-then-run에서.
2. **per-tick write cap 수치** — **추천: 노트 쓰기 ≤ 3건/distill**(create-only). distill 1건이 정상적으로 1~2 노트를 만드므로 3은 여유. 초과 시 하드 스톱 + 로그.
3. **scanForInjection trip 시 동작** — **추천: skip + 로그**(distill 자체를 버림). 부분 distill보다 전건 보류가 안전(reflection 후보 `:1448`와 동일 정책).
4. **auto-update headless 정책** — **추천: 창 0개면 updater 폴 일시정지, 창 복귀 시 재개**. 완전 비활성은 보안 패치 지연 위험 → 일시정지가 균형.
5. **트레이 default 가시성** — 토글 OFF면 트레이 자체가 없음(현 설계). **추천 유지**: 데몬 = opt-in이므로 트레이 존재 자체가 동의·가시 신호.
6. **`openAtLogin` Phase** — **추천: Phase 1로 디퍼**(L4). Phase 0는 사용자가 앱을 띄워둔 채 창만 닫는 시나리오로 thesis 충분.
