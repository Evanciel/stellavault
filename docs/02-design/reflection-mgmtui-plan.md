# Agent Reflection + Memory/Skill Management UI — 구현 스펙 (LOCKED)

> **Status**: LOCKED — 구현 착수 가능. P1–P3 적대리뷰 3종(SECURITY / INTEGRATION·YAGNI / UX·LOCAL-MODEL) 반영 완료.
> **Branch base**: `feat/multimedia-chat` (HEAD `a05ffc7`, P1+P2+P3 위에 적층).
> **Scope**: (A) 명시적 트리거형 read-only reflection 패스 → review chip → 기존 P2 force-confirm `core_memory_*` 경로 승인 쓰기. (B) 메모리/스킬 관리 UI 패널(AIPanel 탭).
> **Out-of-scope (Deferred 절 참조)**: reflection 자동 트리거(§10-d/e), 비고정 시맨틱 recall, 메모리 리스트 가상화/페이지네이션, gemma4 품질 스코어링 고도화, 관리 UI 컴포넌트 단위테스트(jsdom 미구성).
> **Design Ref 규약**: 코드 주석에 `// Design Ref: §{section}` + `// Plan SC: {criteria}`. 본 스펙은 `docs/02-design/agent-memory-skills-plan.md` §8/§10-d/SEC-2 위에 적층된다. 모든 경로는 `packages/desktop/` 기준.

---

## 핵심 정정 — 두 스펙 공통 FACTUAL 결함(빌드 차단) 선반영

세 리뷰가 일치 적발한 **실제 코드와 어긋나는 API 오용**을 구현 전 확정 정정한다. 아래는 본 스펙 전체에서 강제되는 불변식이다.

1. **`scanForInjection` 시그니처** (검증: `injection-scan.ts:77`):
   - 실제: `scanForInjection(text: string, opts?: { allowToolNames?: boolean }): { clean: string; blocked: string[] }`.
   - `'BASE'` 같은 두 번째 위치 문자열 인자는 **존재하지 않음**(드래프트의 날조). `.flagged` 필드도 **없음**. `.blocked`는 **string[]**(빈 배열 `[]`도 truthy → 드래프트의 `if(...blocked)` 게이트는 항상 참 → 전 후보 오거부).
   - **확정 헬퍼**(두 Feature 공용, 인라인으로 정의):
     ```ts
     // Design Ref: constraint 5 — detect = blocked span 존재 여부
     const isFlagged = (text: string) => scanForInjection(text).blocked.length > 0;
     ```
   - 탐지는 `isFlagged(text)`. 표시용 정화는 `scanForInjection(text).clean`(span을 `[BLOCKED]`로 치환한 사본, `memory-store.ts:215 sanitize` 패턴과 동일). 스킬 본문처럼 합법적으로 툴명을 담는 텍스트에만 `{ allowToolNames: true }`. **`'BASE'` 문자열 리터럴은 본 스펙 어디에도 쓰지 않는다.**

2. **`looksLikeSecret`는 `scanForInjection`과 별개 탐지기**(`memory-store.ts:104`). injection-scan은 role-spoof/override/tool-name, `looksLikeSecret`은 자격증명 패턴. 시크릿 차단이 필요한 게이트는 **둘 다** 호출해야 한다(둘 중 하나만으로는 미검출).

---

## Feature A — Reflection follow-up

### §A1 동작 개요 + 트리거(명시적만, §10-d 자동 비활성)

기존 distill 루프를 **read-only 형제 패스**로 재실행해 durable-memory **후보**(절대 직접 쓰지 않음)를 산출하고, 각 후보를 review chip으로 띄워 사용자가 승인한 것만 **기존 P2 force-confirm `core_memory_*` 경로**로 흘려보낸다.

**트리거 — 명시적만** (constraint 7, §10-d LOCKED):
- `ChatView.tsx` 컴포저 영역의 **신규 명시적 버튼** `🧠 Reflect` (onClick → `ipc('chat:reflect', …)`).
- 또는 커맨드 팔레트의 "remember X" 액션이 같은 `ipc('chat:reflect', …)`를 호출.
- **자동 경로 금지(강제)**: drafts가 anchor로 지목한 `ChatView.tsx:102`는 `const [autoDistill, setAutoDistill] = useState(false)` — 단순 **STATE 선언**이며 distill 자동 트리거는 `chat:done` mount-once 핸들러 내부 `autoDistillRef`로 동작한다. **reflect 호출을 `chat:done` 핸들러에 절대 넣지 않는다.** `🧠 Reflect`는 autoDistill을 본뜨지 않은 독립 버튼이다. `reflectStreamRef`는 **이벤트 라우팅 용도로만** `distillStreamRef`와 평행하게 둔다(자동 트리거 아님). 코드 주석 + `docs/02-design/agent-memory-skills-plan.md` §10-d에 *"reflection auto-trigger DEFERRED — explicit user action only (§10-e dogfooding 임계 보정 전까지)"* 명시.

### §A2 read-only 후보 생성 (distill 재사용, write-tool-free fail-closed, 반환 스키마)

`chat:distill` 계약은 **건드리지 않는다**. swapped 프롬프트 + zero write-dep의 **형제 핸들러**를 추가한다.

**`chat-engine.ts` 편집:**
- `export const KARPATHY_REFLECT_PROMPT` 추가(L547 `KARPATHY_INGEST_PROMPT` 형제). 내용:
  > "You are reviewing a transcript to PROPOSE durable user-memory facts. You MUST NOT call any tool that writes. Emit ONLY a fenced ```json block: an array of `{ "text": string, "rationale": string, "suggestedOp": "append" | "replace", "targetId"?: string }`. `replace` requires a `targetId` from recall_memory. Max 5 items. Emit `[]` if nothing durable."
- **3-way 분기 정확 명세**(리뷰 medium 반영 — drafts는 distill 2분기만 가정). 현재 `chat-engine.ts:654-656`은 `opts.distill`만 분기한다. reflect를 ELSE로 떨어뜨리면 agent RULES 프롬프트("call set_plan FIRST", "create_note to grow the vault")가 덧붙어 REFLECT 프롬프트와 충돌(gemma4가 write 시도 + JSON 미방출). **정확 편집:**
  ```ts
  const skillCatalogue = (opts.distill || opts.reflect) ? '' : (opts.skillCatalogue ?? '');
  const agentSystem = opts.reflect
    ? [system, '', KARPATHY_REFLECT_PROMPT].join('\n')
    : opts.distill
      ? [system, '', KARPATHY_INGEST_PROMPT].join('\n')
      : /* 기존 big agent RULES 블록 */;
  ```
  reflect는 set_plan/create_note RULES를 **절대 받지 않는다**.
- **신규 agent 툴 추가 금지**(constraint 6, tool ceiling 16 불변) — reflection은 advertised set만 재사용.

**신규 파싱 헬퍼:**
```ts
export interface ReflectionCandidate { text: string; rationale: string; suggestedOp: 'append'|'replace'; targetId?: string }
export function parseReflectionCandidates(fullText: string): ReflectionCandidate[]
```
fenced JSON 추출 → `JSON.parse` try/catch(실패→`[]`) → 각 item shape 검증 → `suggestedOp` union 강제(미지값 drop) → **min-text-length(트림 후 ≥8자) + 기존 메모리 중복 제거**(리뷰 medium: gemma4 vacuous 5개 방지) → cap **3**(드래프트 5에서 하향) → `text` 빈 항목 drop → `replace`인데 `targetId` 없으면 drop. 순수함수 → 단위테스트. **fail-closed to `[]`**(crash 없음).

**리플렉션 핸들러 (`index.ts`에 `ipcMain.handle('chat:reflect', …)`, `chat:distill` L1300-1382 클론):**
1. transcript 빌더 동일(filter + `foldAttachmentsIntoText` + cap 12_000).
2. `buildExecuteAgentTool({...})`에 **`memoryRecall`(READ)만** 전달 — `memoryAppend`/`memoryReplace` **누락**(distill과 동일). **Fail-closed layer 1**: 모델이 write 방출 시 dispatcher가 `'memory write unavailable here'` 반환(`agent-tools.ts:428/435`).
3. **deny-all confirm broker 명시**(리뷰 low 모호성 제거 — drafts §2.3은 "no broker" vs "()=>false" 모순). 확정: reflection은 진짜 read-only(볼트 쓰기도 금지)여야 하므로 **`onToolConfirm = async () => false`를 명시적으로 wire** → 모든 write 툴(볼트 `create_note`/`append_note` AND `core_memory_*`)이 "User declined" 거부(`chat-engine.ts:1264-1270`). forceConfirm fail-close는 **defense-in-depth로 유지**하되 1차 통제는 deny-all broker다. ("no broker" 프레이밍은 vault write를 auto-apply시키므로 **삭제**.)
4. `chatStream({ …, reflect: true, onToolConfirm: async () => false })`.
5. `onDone`에서 `const cands = parseReflectionCandidates(fullText)`(현재 L1372-1373서 폐기됨).
6. **Emit 전 sanitize 게이트(1차 적용)**: 각 후보에 `isFlagged(c.text)` OR `looksLikeSecret(c.text)` → 둘 중 하나라도 걸리면 drop, dropped count를 디버그 필드에 태그.
7. `chat:reflect-done { streamId, candidates }` emit.

**불변식**: reflection 루프는 memory-write dep을 보유하지 않는다(fail-closed layers 1+2). §8, §10-d, SEC-2.

### §A3 review-chip 플로우 (승인→기존 force-confirm core_memory_* 경로, injection-scan+looksLikeSecret 2회)

**chip 소유권 확정**(리뷰 medium — A는 ChatView 내부, B는 패널 호스팅으로 충돌). **확정: chip은 ChatView에 산다**(A 원안 단순/일관). MemorySkillsPanel은 chip을 호스팅하지 않고, 승인 적용 후 **tab focus / 신호 변경 시 자신의 메모리 리스트를 재조회**(§B4)한다. 별도 `<ReflectionReviewChips />` 추출 컴포넌트는 만들지 않는다.

**replace 후보의 before/after 표시(high 반영)**: chip이 P2 append-only confirm 카드(`ChatView.tsx:708-732`, 단일 argsPreview)를 재사용하면 replace 후보는 NEW 텍스트만 보이고 **무엇이 파괴되는지 미표시** → 위험. 확정 처리:
- **replace 후보는 이번 라운드에서 제외(append-only)**. `parseReflectionCandidates`가 `suggestedOp:'replace'`를 drop하거나 `'append'`로 강등(targetId 무시). reflection은 **새 사실 추가만** 한다. (full before/after diff UI는 Deferred.) → §A2의 cap·중복제거와 함께 append-only 단순 경로로 잠근다.

**Renderer (`ChatView.tsx`):**
- `chat:reflect-done` 구독(L322-326 `chat:tool-confirm` 평행): `reflectStreamRef.current.has(streamId)` 가드 후 `reflectQueue` state(배열)에 큐잉. `reflectStreamRef` 엔트리는 **`chat:reflect-done` 핸들러 내부에서 삭제**(distill L330 미러). abort/close 시엔 renderer ref를 청소하지 않아도 됨(`has()` 가드가 stale 엔트리를 inert화).
- amber 카드로 한 번에 한 chip 렌더. `whiteSpace`를 `'pre-wrap'`로 완화(append 프리뷰 미절단).
- **no-candidates / all-dropped 피드백(medium 반영)**: `candidates.length === 0`이면 기존 `distillSummary` 표면을 본뜬 인라인 토스트 *"No durable facts found to remember."* 표시(무반응으로 재클릭 유발 방지). all scan-dropped도 동일.
- Approve → `ipc('memory:apply-candidate', { streamId, candidate })`; 결과 ok면 queue shift. Deny → shift, 쓰기 없음.

**Main — 신규 직접 핸들러 `ipcMain.handle('memory:apply-candidate', …)`** (append-only, 정정된 시그니처):
```ts
(e, { streamId, candidate }) => {
  // 2차 scan(쓰기 시점) — 큐잉된 텍스트를 절대 신뢰하지 않음 (constraint 5)
  if (scanForInjection(candidate.text).blocked.length > 0) return { ok:false, reason:'injection' };
  if (looksLikeSecret(candidate.text))                     return { ok:false, reason:'secret' };
  try {
    const { id } = coreMemoryAppend(candidate.text);  // ONE arg — provenance 'user' 하드코딩(아래 결정 참조)
    return { ok:true, id };
  } catch (err) {
    return { ok:false, reason:'bounds-or-secret' };   // coreMemoryAppend는 throw(반환 falsy 아님)
  }
}
```

**Provenance 결정(high 반영 — drafts의 `provenance:'reflection'` 주장은 코드상 불가능):**
- 검증: `coreMemoryAppend(text)`는 ONE arg + `provenance:'user'` 하드코딩(`memory-store.ts:268-269`). `pinnedUserBlocks()`는 `provenance==='user'`만 trusted 프롬프트로 보냄(`:207-210`).
- **확정 결정 (a 채택)**: reflected 사실은 **`provenance:'user'`로 기록**한다. 근거: **사람의 review-chip 승인이 곧 trust 게이트**다 — 사용자가 명시 승인한 사실은 user-tier로 승격되어 agent가 recall 가능해야 함(`'reflection'`으로 두면 영원히 미주입 → 기능 무의미). `coreMemoryReplace`/추가 백엔드 시그니처 변경 **불필요**(append-only이므로). 기존 `coreMemoryAppend(text)`를 시그니처 변경 없이 그대로 호출.
- `memory-store.ts` 코드/설계 변경 없음. drafts §4의 `'reflection'` provenance 주장 및 Manual Gate "provenance:reflection" 항목은 **삭제**하고 "provenance:user + pinned로 blocks.json 기록"으로 정정(§A6 Manual Gate 반영).
- `docs/.../agent-memory-skills-plan.md` §3.2 rationale 업데이트: *"human review가 reflected 텍스트를 user-tier로 승격하는 trust 게이트"*.

**불변식**: chip은 후보가 리터럴 텍스트를 이미 명명하므로 write 자체가 LLM을 우회한 user-gated 직접 호출 → §8 "reflection 루프는 write 툴을 보유하지 않는다"가 구성상 성립. bounds + `looksLikeSecret`(appendBlock 내장)이 caller와 무관하게 쓰기를 안전화.

### §A4 신규 IPC (name/direction/payload/preload/main-validation)

| Channel | Direction | Payload | Preload allowlist | Main validation |
|---|---|---|---|---|
| `chat:reflect` | renderer→main (invoke) | `{ messages: ChatMessage[]; streamId: string; sessionId?: string }` | invoke allowlist(`chat:distill` L114 인근) | distill 클론, READ deps만, `onToolConfirm:()=>false` |
| `chat:reflect-done` | main→renderer (event) | `{ streamId: string; candidates: ReflectionCandidate[] }` | `on` allowlist(`chat:distill-done` L150 인근) | one-way, streamId-routed, candidates 사전 scan |
| `memory:apply-candidate` | renderer→main (invoke) | `{ streamId: string; candidate: ReflectionCandidate }` | invoke allowlist | 2차 scan(`scanForInjection().blocked.length>0` + `looksLikeSecret`), append-only `coreMemoryAppend`, try/catch → `{ok, reason?}` |

**`shared/ipc-types.ts`**: 3개 channel-map 엔트리(distill L596/L676 인근) + `ReflectionCandidate` export. 모두 additive·one-way/req-resp·streamId-routed → single-settle `chat:send→chunk*→done|error` 계약 불변(constraint 4). `memory:apply-candidate`는 `memory:delete`와 같은 global-store write → wcId 가드 없음(id-validation이 containment 통제, L1281-1282 선례).

**원자적 추가 강제(low 반영 — exact-count tripwire)**: `chat:reflect-done`은 **(1) preload `ALLOWED_EVENTS`, (2) ipc-types event 섹션, (3) 테스트 `CHAT_EVENTS` 배열** 세 곳을 **같은 커밋에서** 갱신해야 한다. `ipc-security-chat.test.ts:216`의 `expect(keys.length).toBe(CHAT_EVENTS.length)` 정확-카운트 단언이 tripwire.

### §A5 파일+심볼 변경표 (add/edit)

| File | Add/Edit | Symbol |
|---|---|---|
| `chat-engine.ts` | add | `KARPATHY_REFLECT_PROMPT`, `reflect` opt(3-way 분기 L654-656), `ReflectionCandidate`, `parseReflectionCandidates`(append-only·cap3·min8·dedupe) |
| `index.ts` | add | `ipcMain.handle('chat:reflect')`(`onToolConfirm:()=>false`), `ipcMain.handle('memory:apply-candidate')`(append-only·2차scan·try/catch); import `parseReflectionCandidates`, `scanForInjection`, `looksLikeSecret`, `coreMemoryAppend`, `isMemoryId` |
| `shared/ipc-types.ts` | add | 3 channel 엔트리 + `ReflectionCandidate` export |
| `preload/index.ts` | edit | allowlist `chat:reflect`, `chat:reflect-done`, `memory:apply-candidate` |
| `renderer/.../ChatView.tsx` | add/edit | `🧠 Reflect` 버튼(독립·자동경로 아님), `reflectStreamRef`, `reflectQueue` state, `chat:reflect-done` 구독(ref 삭제 포함), chip 카드 재사용(`whiteSpace:pre-wrap`), no-candidates 토스트, `applyCandidate`/`dismissCandidate` |
| `docs/02-design/agent-memory-skills-plan.md` | edit | §8/§10-d: reflection SHIPPED(read-only·append-only) 표기, auto-trigger DEFERRED, §3.2 trust-gate rationale |

### §A6 테스트 (unit + 확장할 suite)

- **`tests/chat-engine.test.ts`**: `parseReflectionCandidates` — 유효 JSON→cap 3, 빈 `text` drop, `replace`→drop/강등(append-only), `suggestedOp` 강제, min8 미만 drop, dedupe, malformed→`[]`. reflect `chatStream` config가 READ-only deps(no `memoryAppend`/`memoryReplace`) **그리고** `onToolConfirm`이 false 반환임을 단언. reflect agentSystem이 `KARPATHY_REFLECT_PROMPT` 포함 + `'create_note'` rule 문자열 **미포함** 단언(3-way 분기 검증).
- **`tests/agent-tools.test.ts`**: reflection wiring이 `AGENT_WRITE_NAMES` 제외(`memoryAppend` 부재 시 dispatcher가 `'memory write unavailable here'` 반환, `:428`) 잠금.
- **`tests/ipc-security-chat.test.ts`**: `CHAT_EVENTS`(L58)에 `chat:reflect-done` 추가; `chat:reflect`/`memory:apply-candidate` allowlist+main-handled+NOT-in-events 단언; `memory:apply-candidate` 2차 scan 경로(injection/secret/bounds 거부) 잠금(`memory:delete` `isMemoryId` 템플릿 L239-246 미러). L216 exact-count tripwire 주석.
- **`tests/injection-scan.test.ts`**: 회귀 — injection 페이로드 후보가 emit 게이트(§A2.6)와 apply 게이트(§A3) **양쪽**에서 `scanForInjection(text).blocked.length>0`로 drop(새 스캐너 없음).
- **`tests/memory-store.test.ts`**: `coreMemoryAppend`가 bounds/`looksLikeSecret` 위반 시 **throw**(반환 falsy 아님)임을 단언 → apply 핸들러 try/catch가 `{ok:false}`로 매핑함을 락.

**Gates**: `npx tsc --noEmit -p tsconfig.json`(cwd `packages/desktop`), `npx vitest run`(cwd `packages/desktop`), `node tests/smoke.mjs`(repo root, `npm run bundle` 후).

**§A7 Manual Browser Gate (commit-blocking — review chip은 신규 renderer UI):**
패키징 exe + CDP(`--remote-debugging-port=9222`; dev 미실행 `type:module`)로 검증.
- [ ] fact-rich 대화에서 `🧠 Reflect` 클릭 → **이 로컬 모델(gemma4:e4b)로 실제 ≥1 chip 출현**(빈 결과는 파스 실패와 구분 불가 — known-limitation, §A2 fail-closed `[]`).
- [ ] **Approve** → 사실이 `~/.stellavault/memory/blocks.json`에 **`provenance:'user'` + `pinned:true`**로 기록(DB 확인, chip dismiss만 아님).
- [ ] **Deny** → chip dismiss, 쓰기 없음.
- [ ] durable 사실 없는 대화에서 Reflect → **"No durable facts found" 인라인 표시**(무반응 아님).
- [ ] injection/secret 적재 transcript Reflect → 후보가 emit 게이트서 drop(chip 미도달) AND apply서 재차단; 미승인 쓰기 0.
- [ ] reflection 중 창 닫기 → orphan chip 없음, 재오픈 시 partial write 없음(`chatStreamRegistry` + before-quit abort + finally-delete `index.ts:1380`).

**보존 불변식**: review-before-apply(미승인 `blocks.json` 무변경); reflection 루프 write-dep 0(fail-closed 1+2 = deny-all broker + forceConfirm); 이중 injection-scan + `looksLikeSecret`(emit+apply); telemetry OFF/local; renderer는 opaque candidate data만(툴/경로명 미보유); single-settle 불변; tool ceiling 16 불변; auto-trigger DEFERRED.

---

## Feature B — Management UI panel

### §B1 패널 구조 + AIPanel 탭 등록

**ADD `renderer/components/panels/MemorySkillsPanel.tsx`** — `export function MemorySkillsPanel(): JSX.Element`. 내부 두 서브섹션 `MemoryBlockList` + `SkillList`을 한 스크롤 컬럼에. `ReviewQueue`(AIPanel.tsx:407-544) 구조/state/스타일 미러:
- `const t = useT();`
- `const [blocks, setBlocks] = useState<MemoryBlockMeta[] | null>(null);` / `const [skills, setSkills] = useState<SkillMeta[] | null>(null);` / `const [error, setError] = useState<string | null>(null);`
- `const refresh = useCallback(async () => {...}, [])` → `Promise.all([ipc('memory:list'), ipc('skill:list')])`; `useEffect(() => { void refresh(); }, [refresh])`.
- 스타일 토큰 ReviewQueue 동일(rows `padding:'8px 10px', marginBottom:6, borderRadius:4, background:'var(--hover)', border:'1px solid var(--border)'`; title `fontSize:12, fontWeight:500, color:'var(--ink)'`; section header `fontWeight:600`; hint `fontSize:10, color:'var(--ink-faint)'`).
- imports: `ipc`(typed `IpcChannelMap`, no `invokeIpcRaw`), `type { MemoryBlockMeta, SkillMeta }`(ipc-types.ts:398-413, 기정의), `useT`.

**EDIT `AIPanel.tsx`** 탭 등록:
1. L14 `type Tab` → `| 'manage'` append.
2. L11 import `MemorySkillsPanel`.
3. L84 tab array → `'manage'` append.
4. L101 label 체인 → `: tab === 'manage' ? t('panel.ai.tabManage')`.
5. L113 switch → `{activeTab === 'manage' && <MemorySkillsPanel />}`.
6. (optional) `registerAiPanelCommands`(L43) 팔레트 `panel.ai-manage` → `setRightPanel('ai')` + `requestTab('manage')`(union 확장으로 충분).

**탭 라벨 충돌 해소(medium 반영)**: 기존 decay 탭이 이미 `t('panel.ai.tabMemory')`="Memory"(FSRS note-decay·ReviewQueue, agent memory 아님). 7번째 flex:1 탭 추가 시 좁은 우패널서 라벨 절단 + "Memory" 2개 혼동. **확정**: 신규 탭 라벨 = **"Agent"**(`panel.ai.tabManage` → "Agent" 계열, agent durable facts+skills), decay 탭은 그대로 둠. §B6 Manual Gate에 패키징 좁은 패널 라벨 렌더 확인 항목 포함. (icon-only 대안은 Deferred.)

### §B2 메모리 list/get/delete (main id검증+wcId-owner+UUID-only)

**`MemoryBlockList`** (MemorySkillsPanel.tsx 내부):
- `blocks`를 `block.id` 키 rows로. 각 row: `block.text`(절단 `whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'`), provenance 배지(`user`/`reflection`/`skill:*`), `pinned` 표시, `block.updated` 상대시각(`block.updated`만 존재 — `created` 없음, `daysSince(updated)` 공유 헬퍼).
- **Delete 버튼**(ReviewQueue open-button L507-518 미러):
  ```ts
  const handleDelete = useCallback(async (id: string) => {
    const { ok } = await ipc('memory:delete', id);   // opaque UUID only
    if (ok) await refresh();                          // 낙관 mutate 금지, 재조회
  }, [refresh]);
  ```
- renderer는 `block.id` verbatim 전달; main이 `isMemoryId(id)` + must-exist(`deleteBlock` memory-store.ts:364) 재검증. 툴명/경로/wcId 없음.

**Redaction 결정 — main read 핸들러 미변경(medium 반영, 핵심 충돌 해소):**
- 검증: `listBlocks()`(memory-store.ts:347-349)는 **의도적으로 RAW 텍스트 반환** — 주석: *"renderer DISPLAYS this (not a prompt) … lets the user see + delete even a hand-planted / secret-shaped block."* 관리 UI의 목적은 **remediation**(오염 블록 식별 후 삭제)이다.
- 드래프트 §3의 `memory:list`/`get` redact 래퍼는 (i) 모든 블록을 동일 placeholder로 가려 **사용자가 어느 블록이 문제인지 식별 불가**(설계 의도 위배), (ii) `looksLikeSecret`-shaped 블록은 `scanForInjection`이 잡지 못해(다른 탐지기) 어차피 미redact, (iii) **Feature A가 raw `memory:get`을 필요로 함**(append-only로 전환했어도 프로그램 caller 계약 보존)와 충돌.
- **확정 결정 (a 채택)**: `memory:list`/`memory:get` **main 핸들러 미변경**(raw 유지, `index.ts:1283-1284` 그대로). 대신 **renderer 표시 시점**에 flagged 블록을 식별 가능한 **visible ⚠ 배지 + raw 텍스트**로 렌더(가리지 않음 — 사용자가 식별·삭제 가능). 표시 정화가 필요하면 `scanForInjection(text).clean`(span 치환 사본)을 보조로. memory-store.ts:347-349 주석 변경 불필요(동작 보존).
- **wcId-owner note**: 메모리는 단일 global store. 코드 주석(index.ts:1281-1282)대로 containment 통제는 **id-validation**(wcId-ownership 아님) → 패널은 wcId 가드 추가 안 함(기존 P2 관리 표면과 일관). `chat:tool-approve` wcId 가드는 confirm broker 전용 유지.

### §B3 스킬 list + promote 토글 (content-hash 상태)

**`SkillList`:**
- `skills: SkillMeta[]`를 `skill.name` 키 rows로: `skill.description` + **promote 토글**(ExpressDraft format 토글 AIPanel.tsx:654-666 미러 — `skill.promoted` 반영 체크박스/세그먼트).
  ```ts
  const handlePromote = useCallback(async (name: string, next: boolean) => {
    try {
      const { promoted } = await ipc('skill:set-promoted', name, next);  // opaque name only
      setSkills((prev) => prev?.map((s) => s.name === name ? { ...s, promoted } : s) ?? prev);
    } catch {
      await refresh();  // (low 반영) throw/unchanged → 인라인 note + 재동기화
    }
  }, [refresh]);
  ```
- `promoted`는 **content-hash promoted registry**(skill-store.ts off-vault) 반영. 토글 상태는 `skill:list`가 authoritative, `set-promoted`가 persisted 값 반환(content-hash mismatch/rejected name → 토글 snap-back). list view는 `name`/`description`만 표시(`listAllSkills`가 vault-skill metadata로 제약). 툴팁에 스킬 본문 노출 시 `scanForInjection(text, { allowToolNames:true })` 통과 필요(스킬 본문은 합법 툴명 보유).

### §B4 review-chip 호스팅

**확정(medium 충돌 해소): MemorySkillsPanel은 reflection chip을 호스팅하지 않는다.** chip은 ChatView에 산다(§A3). 패널은 **chip surface를 mount하지 않으며**, Feature A 승인 적용 후 새 블록이 리스트에 나타나도록 **tab focus / 신호 변경 시 `refresh()` 재조회**만 한다. `<ReflectionReviewChips />` import 타깃은 존재하지 않으므로 제거. (드래프트 B §5의 cross-component 마운트 + apply 콜백 wiring은 **삭제**.)

### §B5 파일+심볼 변경표

| Action | File | Symbol |
|---|---|---|
| ADD | `renderer/components/panels/MemorySkillsPanel.tsx` | `MemorySkillsPanel`, `MemoryBlockList`, `SkillList`, `daysSince` 헬퍼, provenance 배지, ⚠ flagged 배지 |
| EDIT | `renderer/components/panels/AIPanel.tsx` | `Tab`(L14), import(L11), tab array(L84), label "Agent"(L101), switch(L113), optional `registerAiPanelCommands`(L43) |
| EDIT | i18n catalogue (en/ko/ja/zh) | `panel.ai.tabManage`("Agent"), `manageMemoryTitle`, `manageSkillsTitle`, `loadingMemory`, `noMemoryBlocks`, `noSkills`, `deleteMemory`, `promote`, `demote`, `memoryProvenance`, `skillPromotedHint`, `flaggedBadge` |
| NO CHANGE | `main/index.ts` | `memory:list`/`get`/`delete`, `skill:list`/`set-promoted` 핸들러 — **redact 래퍼 추가 안 함**(§B2 결정). raw 유지 |
| NO CHANGE | `preload/index.ts` | 5 channel 이미 allowlist(L107-112) — 테스트로 단언만 |
| NO CHANGE | `shared/ipc-types.ts` | `MemoryBlockMeta`/`SkillMeta` 기정의(L397-413) |

### §B6 테스트 + Manual Browser Gate 체크리스트

**`tests/ipc-security-chat.test.ts` 확장:**
- `MEMORY_CHANNELS`(L224)/`SKILL_CHANNELS`(L250) 여전히 allowlist+main-handled+NOT-in-`CHAT_EVENTS` 단언(신규 channel 0 → 패널이 IPC 미추가 회귀락).
- (드래프트의 `memory:list`/`get` `scanForInjection` source-assertion은 **제거** — §B2서 redact 래퍼 미추가로 결정).

**`tests/memory-store.test.ts` 확장:**
- `deleteBlock(badUuid)`→`false`(id-validation), `deleteBlock(unknownButValidUuid)`→`false`(must-exist), `deleteBlock(real)`→`true` + atomic write로 정확히 1개 제거.

**`tests/skill-store.test.ts` 확장:**
- `setSkillPromoted(vault, unknownName, true)` reject(`false`/unchanged); `setSkillPromoted(vault, realName, true)` off-vault registry persist + 재-`listAllSkills` 생존(content-hash round-trip).

renderer 컴포넌트 테스트 없음(vitest `tests/**/*.test.ts`, jsdom/RTL 미구성) — IPC-security source-assertion + 아래 Manual Gate로 게이트.

**Gate commands** (pre-commit 전부 통과): `npx tsc --noEmit -p tsconfig.json`, `npx vitest run`(cwd `packages/desktop`), `node tests/smoke.mjs`(root, `npm run bundle` 후), `npm run package`(cwd `packages/desktop`).

**Manual Browser Gate (commit-blocking — renderer UI + IPC-driven mutation):**
패키징 exe + CDP(`--remote-debugging-port=9222`; dev 미실행 `type:module`). 커밋 전 사용자 체크 획득.
- [ ] **Agent** 탭 열기 → 현재 메모리 블록 + 스킬 리스트가 store 내용과 일치, 콘솔 에러 0(406/Hydration/PGRST류 없음), 좁은 패널서 7번째 탭 라벨 미절단.
- [ ] 메모리 블록 **Delete** → 리스트서 사라짐 AND 재오픈 시 `~/.stellavault/memory/blocks.json`서 제거(DB 확인).
- [ ] store가 밑에서 변경된 채(이미 삭제됨) 삭제 → crash 없음, 재조회 clean; junk/invalid id가 다른 블록 미삭제(`isMemoryId` containment).
- [ ] **스킬 promote 토글** → off-vault registry persist, 패널 재오픈/앱 재시작 생존. **rejected-name snap-back repro**: 스킬 promote → `Skills/*.md` 본문 편집해 content-hash 변경 → 재오픈 후 토글 → snap-back 확인(또는 skill-store 자동 테스트로 대체).
- [ ] **injection-shaped** 블록이 **visible ⚠ 배지 + raw 텍스트**로 식별 가능하게 표시(⚠ = `scanForInjection().blocked.length>0`, injection 전용). secret-shaped 블록은 `coreMemoryAppend` 쓰기 시점에 거부되므로 정상 경로엔 존재하지 않음 — 손으로 `blocks.json`에 심은 경우에만 raw 텍스트로 표시되어 삭제 가능(⚠ 없이). (looksLikeSecret는 main-only 모듈이라 렌더러 미임포트 — 적대리뷰 low 반영.)
- [ ] Agent 탭에서 mid-load 전환 → stuck spinner 없음(`ipc` reject 시 `blocks`/`skills`를 `[]`로, never `null`), 복귀 시 clean 재로드.

**Files (absolute)**: ADD `packages/desktop/src/renderer/components/panels/MemorySkillsPanel.tsx`; EDIT `…/renderer/components/panels/AIPanel.tsx`, i18n catalogue; tests `…/packages/desktop/tests/{ipc-security-chat,memory-store,skill-store}.test.ts`. (`main/index.ts` 미변경.)

---

## §C 적대리뷰 반영 요약 (finding → 처리)

| # | Sev | Feature | Finding | 처리 |
|---|---|---|---|---|
| 1 | critical | both | `scanForInjection(text,'BASE').flagged`/`.blocked` 오용(날조 2nd arg, `.flagged` 부재, `[]` truthy) | **인라인 정정**: `'BASE'` 전면 삭제, `isFlagged(t)=scanForInjection(t).blocked.length>0`, 표시는 `.clean`. §핵심정정+§A2/§A3/§B2 |
| 2 | critical | A | `coreMemoryAppend(text,'reflection')`/`coreMemoryReplace(id,text,'reflection')` 잘못된 시그니처 → 비컴파일/throw | **인라인 정정**: append-only로 전환, `coreMemoryReplace` 미사용, `coreMemoryAppend(candidate.text)` 1-arg + try/catch. §A3 |
| 3 | high | A | provenance fork — `'reflection'` 기록 불가/기록해도 영원히 미주입 | **결정 (a)**: `provenance:'user'` 기록, human review가 trust 게이트. Manual Gate 정정. §A3 |
| 4 | high | A | replace chip이 before/after 미표시(fact-flip 은닉) | **append-only로 제외**(replace drop/강등), full diff는 Deferred. §A3 |
| 5 | high | both | scanForInjection redact 래퍼가 NEVER fire / 모든 caller 가림 | **B redact 래퍼 삭제**(raw 유지 + visible ⚠ 배지, remediation 의도 보존). §B2/§B4 |
| 6 | medium | A | reflect 3-way 분기 미명세 → agent RULES 상속 위험 | **정확 편집 명세**(L654-656 3분기, create_note rule 미포함 단언). §A2 |
| 7 | medium | A | gemma4 noise 품질 플로어/no-candidates 상태 미정 | min8+dedupe+cap3, no-candidates 토스트 추가. §A2/§A3 |
| 8 | medium | B | 7번째 flex:1 탭 + "Memory" 라벨 충돌 | 신규 탭 "Agent" 명명, 좁은 패널 라벨 Gate. §B1 |
| 9 | medium | both | chip 위치 충돌(ChatView vs Panel) | **ChatView 확정**, 패널은 refresh만. §A3/§B4 |
| 10 | medium | both | `memory:get` redact가 A가 필요로 하는 raw와 충돌 | raw 유지로 해소(§5와 동일 결정). §B2 |
| 11 | low | A | §2.3 broker 모순(no-broker vs ()=>false) | **`onToolConfirm:async()=>false` 명시**, "no broker" 삭제. §A2 |
| 12 | low | A | exact-count CHAT_EVENTS tripwire | 3곳 동시 갱신 강제 명시. §A4 |
| 13 | low | A | distill 토글 anchor 오인(L102=state) → 자동경로 위험 | 독립 버튼 명시, `chat:done` 핸들러 reflect 금지. §A1 |
| 14 | low | A | reflectStreamRef cleanup 미명세 | reflect-done서 삭제, abort는 has() 가드로 inert. §A3 |
| 15 | low | both | Manual Gate 도달불가 항목(provenance:reflection / snap-back repro) | provenance:user로 정정, snap-back content-hash repro 제공. §A7/§B6 |
| 16 | low | B | promote 토글 error 경로 부재 | try/catch + refresh + 인라인 note. §B3 |
| 17 | low | B | 메모리 리스트 가상화/헬퍼 hand-wave | `daysSince(updated)`/provenance 배지 정의, 가상화는 Deferred. §B2 |

---

## §D 구현 순서 (어느 것 먼저, 게이트 순서)

1. **B-store 테스트 선행**(순수, UI 무관): `memory-store.test.ts`/`skill-store.test.ts` 확장 → `npx vitest run`. 기존 백엔드 계약 락 확보.
2. **A-engine 코어**: `chat-engine.ts`(`KARPATHY_REFLECT_PROMPT` + 3-way 분기 + `parseReflectionCandidates`) → `chat-engine.test.ts`/`agent-tools.test.ts` → `tsc` + `vitest`. (순수 함수·분기부터, IPC 전에 락.)
3. **A-IPC + main**: `ipc-types.ts` 3채널 + `preload` allowlist + `index.ts`(`chat:reflect` `onToolConfirm:()=>false`, `memory:apply-candidate` append-only+2차scan) → `ipc-security-chat.test.ts` 확장(L216 tripwire 동시 갱신) + `injection-scan.test.ts` 회귀 → `tsc` + `vitest`.
4. **A-renderer**: `ChatView.tsx`(`🧠 Reflect` 독립 버튼·`reflectStreamRef`·`reflectQueue`·reflect-done 구독·no-candidates 토스트) → `tsc`.
5. **B-panel**: `MemorySkillsPanel.tsx` + `AIPanel.tsx` 탭("Agent") + i18n 4로케일 → `ipc-security-chat.test.ts`(no-new-channel 회귀) → `tsc` + `vitest`.
6. **공통 게이트**: `node tests/smoke.mjs`(root, `npm run bundle` 후) → `npm run package`(cwd `packages/desktop`) → exe asar에 reflect+패널 shipped 확인.
7. **Manual Browser Gate (commit-blocking)**: §A7(chip 점진렌더·Approve provenance:user·Deny·no-candidates·injection drop·창닫기) + §B6(Agent 탭 렌더·Delete DB확인·junk id·promote snap-back·⚠ raw 표시·stuck spinner). 사용자 체크 획득.
8. **커밋**(브라우저 게이트 통과 후): `tsc 0 ×N`, `vitest` 전건, `smoke.mjs` PASS, `package` OK 확인 후 단일 커밋.

---

## Deferred / Known-limitations

- **reflection 자동 트리거(§10-d/e)**: 명시적 액션만. dogfooding 임계 보정 전까지 DEFERRED.
- **replace/supersede 후보**: 이번 라운드 append-only. full before/after diff chip UI(`memory:get(targetId)` fetch + 시각화 + provenance 배지) 후속.
- **gemma4:e4b JSON-emit 신뢰성**: read-only 패스서 fenced-JSON 방출이 flaky(constraint 6). `[]` fail-closed(crash 없음)이나 빈 결과 = 파스 실패와 구분 불가 → Manual Gate가 "실제 ≥1 chip" 확인. fenced JSON 미발견 시 전체 답변을 단일 후보로 fallback하는 안은 후속 검토.
- **메모리 리스트 가상화/페이지네이션**: `listBlocks()` unbounded, `MemoryBlockList`는 windowing 없음(ReviewQueue는 20 cap). 수백 개 사실 시 단일 비가상 스크롤 — 허용 가능 deferred.
- **비고정 시맨틱 recall**: `recallMemory`는 P1 pinned-only. query-driven 선택은 §10-e.
- **icon-only 탭**: 7탭 라벨 절단 시 대안. 현재는 "Agent" 텍스트 라벨 + Manual Gate 확인.
- **telemetry**: OFF/local 유지(불변).
