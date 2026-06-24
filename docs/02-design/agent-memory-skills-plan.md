# Stellavault Agent Memory + Skills — 설계서 (통합)

> Status: LOCKED-FOR-IMPLEMENTATION — §10 6결정(a~f) 추천안 전부 채택 잠금 확정 (2026-06-24). P1 구현 진행 중.
> Branch base: `feat/multimedia-chat` (SP1 chat + agent plan-act-reflect 코드 위)
> Scope: 로컬 에이전트(`runAgentLoop`)에 **durable MEMORY**(사용자 모델)와 **SKILL**(재사용 레시피)를 추가한다. MEMORY는 앱-데이터 오프-볼트 저장, SKILL은 볼트 마크다운. 첫 출시 증분(P1)은 **신규 WRITE 도구 0개** — 메모리 쓰기는 기존 확인 게이트가 붙은 `append_note`/`create_note`를 탄다.
> Out of scope: 클라우드(anthropic/openai/gemini) tool-calling 루프(단발 경로엔 pinned 메모리만 정적 주입 — §4.5), 멀티 에이전트/페르소나 협상, FTS5 dual-table recall, P3 이전의 background reflection 데몬.
> Design Ref 규약: 본 문서의 §번호를 구현 코드 주석에 `// Design Ref: §X.Y` 로 인용한다. 기존 `second-brain-agent-plan.md`의 §6.7(injection-scan)/§7.3(frozen snapshot)/§7.4(skills/memory deferred)를 본 문서가 **이행(implement)**한다.

---

## 1. 목표 + 기존 설계(§7.3/§7.4)와의 관계

### 1.1 목표

기존 에이전트(`second-brain-agent-plan.md`)는 **턴 단위 무상태(stateless-per-turn)**다. 매 턴 RAG로 볼트를 검색해 답할 뿐, 사용자에 대한 **지속 모델**(선호·환경·프로젝트 맥락)도, 반복 작업의 **재사용 레시피**도 없다. 본 설계는 두 가지를 추가한다.

- **MEMORY**: "gemma4:e4b 로컬 선호, GPU=3080Ti" 같은 durable 사용자 사실을 오프-볼트 JSON(`~/.stellavault/memory/blocks.json`)에 저장하고, 매 턴 시스템 프롬프트에 주입한다. Letta의 core-memory 블록 개념을 **단일 사용자용으로 평탄화(§9 YAGNI 반영)**한 것.
- **SKILL**: `<vault>/Skills/<name>.md`에 사용자가 직접 쓰는 절차 레시피. progressive disclosure(메타데이터 항상 노출, 본문은 호출 시)로 작은 로컬 모델의 컨텍스트를 보호한다. **선언적(declarative-only) — 절대 `eval`하지 않는다**.

### 1.2 기존 설계와의 관계

| 기존 설계 항목 | 본 설계에서의 처리 |
|---|---|
| §7.3 frozen system-prompt snapshot | **재사용**. 메모리/스킬 카탈로그는 `chat-engine.ts:621-637`의 `agentSystem` 배열에 단 한 번 합쳐져 `:643`에서 캡처 → 모든 `streamStep`이 같은 스냅샷을 본다. 턴 내 단일 주입 = single-settle 무손상. |
| §6.7 load-time injection-scan | **이행**. "추가될 때 스캔과 함께"라는 게약을 P1에서 실제 코드로 만든다(§3.5). 스캔은 **신규 모듈**이며 기존엔 없다(§9 SEC-1). |
| §7.4 skills library / background reflection | skills는 P3로, reflection은 read-only 제안 전용으로 **대폭 축소**(§9 SEC-2, YAGNI-5). |
| 단발(single-shot) RAG 경로 | 클라우드·tool-incapable 로컬은 여전히 단발. 단 pinned 메모리는 **도구 없이** `buildSystemPrompt`에 주입(§4.5) — "조용한 기능 절벽" 제거. |

핵심 설계 철학은 기존과 동일한 **최소 확장(minimal extend-in-place)**: `runAgentLoop`·확인 게이트·path-safety·`chat-session-store.ts`의 atomic-write/quarantine/`0o700` 1차 함수를 **전부 재사용**한다.

---

## 2. 아키텍처 개요 + 다이어그램

### 2.1 개요

- **저장 분리(threat-model-driven)**: MEMORY는 **오프-볼트**(`~/.stellavault/memory/`) — `search_vault`/`read_note` 인젝션 표면 밖. 볼트 노트는 동기화(Notion↔Obsidian)되어 "자기증폭 인젝션" 표면이므로, durable 사용자 모델을 거기 두면 오염된 동기화 노트가 RAG로 세탁되어 영구 사용자 모델에 박힌다 → 이를 차단. SKILL은 **볼트 마크다운** — 이식성·git 버전·사용자 편집성이 위협보다 가치가 큰 자산이라 의도적으로 볼트에 둔다(대신 §3.5 스캔 + §4.4 provenance 게이트로 방어).
- **검색은 기존 싱글톤 재사용**: 신규 인덱스/FTS5 없음. P1은 **pinned-only**(임베딩 0) — 모든 메모리 사실을 그냥 매 턴 주입(작음). P2+ 비-pinned는 기존 `searchEngine`/`decayEngine` 싱글톤으로 융합 검색(§3.2).
- **쓰기 표면 단계화**: P1은 신규 WRITE 도구 0개(기존 `append_note`/`create_note`가 확인 게이트를 상속). P2에서 전용 `core_memory_*` WRITE 도구가 **force-confirm**(§3.3 / §7 메커니즘).

### 2.2 다이어그램 (ASCII) — runAgentLoop 통과 흐름

```
 chat:send{agentOn}                            (renderer는 도구/스킬 이름을 절대 못 보냄)
        │
        ▼
 chatStream  ──(local + tools)──►  agentSystem 조립  (chat-engine.ts:621-637)
        │                            │
        │   ┌────────────────────────┴─────────────────────────────────────┐
        │   │ [system]  + [RAG <untrusted>]  + [=== Core Memory ===]        │
        │   │           + [list_skills 카탈로그]  + [agent rules]            │
        │   │                                                                │
        │   │  ▶ buildCoreMemoryBlock(): pinned 블록 + (P2+) top-k 검색       │
        │   │  ▶ buildSkillCatalogue(): provenance=user 스킬의 name+desc만    │
        │   │  ▶ scanForInjection(조립된 문자열)  →  [BLOCKED:…] (스냅샷에만)  │
        │   │  ▶ capToBudget(MEMORY_TOKEN_BUDGET / SKILL_CATALOGUE_BUDGET)    │
        │   └──────────────────────────┬─────────────────────────────────────┘
        │                              ▼  frozen snapshot (:643, §7.3)
        ▼
 runAgentLoop  ──for step<MAX_STEPS──►  streamStep(messages)  (모델 1콜)
        │                                   │ tool_calls?
        │            ┌──────────────────────┼───────────────────────────────┐
        │            ▼                      ▼                               ▼
        │   set_plan (CONTROL)     invoke_skill (CONTROL)         recall_memory (READ)
        │   onPlan→chat:plan       loadSkill(name)→role:'tool'    deps.memoryRecall
        │   continue               onSkill→chat:skill-invoke      list_skills (READ)
        │                          continue (never settles)               │
        │                                                                 ▼
        │                                              core_memory_* (WRITE, P2)
        │                                              isWrite + forceConfirm
        │                                              → 무조건 confirm(§7)
        │                                              deps.memoryWrite (오프-볼트)
        │
        ▼  (tool_calls 없는 턴 = 최종답)  succeed() ── 정확히 1회 settle (single-settle)
        │
        ▼
 chat:chunk* ──► 정확히 한 번 chat:done|chat:error   (IPC 계약 무변경)
```

스킬 본문(Level-2)은 `invoke_skill`이 `role:'tool'` ack로 **단 한 줄 메시지**만 push하고 `continue`한다 → set_plan과 동일하게 settle/deadEnd를 건드리지 않는다.

---

## 3. MEMORY 서브시스템

### 3.1 저장 위치 / 포맷 / 스키마

**저장:** `~/.stellavault/memory/blocks.json` 단일 파일. 신규 모듈 `memory-store.ts`는 `chat-session-store.ts`의 1차 함수를 **그대로 클론**한다:

- `mkdirSync(MEM_DIR, { recursive: true, mode: 0o700 })` (`chat-session-store.ts:72`)
- atomic write: `tmp = target + '.' + randomUUID() + '.tmp'` → `writeFileSync` → `renameSync` (`:138` 패턴)
- 매 연산 `assertInsideDir(MEM_DIR, pathFor())` (`path-safety.ts:17`, `chat-session-store.ts:68`)
- 파싱 실패 시 `.broken`으로 quarantine(`:76` — 절대 삭제/throw 안 함)

**스키마(record):**
```jsonc
{ "blocks": [{
  "id": "uuid",
  "tag": "프로필 사실(자유 텍스트, 선택)",   // §9 YAGNI-1: Letta 4-scope label → 의미 없는 자유 태그로 평탄화
  "text": "Prefers gemma4:e4b local; GPU=3080Ti",
  "pinned": true,                              // pinned=항상 주입. 비-pinned=검색 대상(P2+)
  "created": 0, "updated": 0,                  // §9 YAGNI-2: lastAccess/importance/soft-invalidate 드롭
  "provenance": "user|reflection|skill:<name>" // §4.4 카탈로그 게이트 + 인젝션 신뢰등급 판정에만 사용
}],
  "version": 1 }
```

> §9 SEC-4/YAGNI-1·2 반영: 단일 사용자에 대해 `label`(human/persona/project)·`importance` 1-10·`valid`/`supersededBy` tombstone 체인은 over-design이라 **제거**. `pinned:true`가 "항상 주입" 의미를 전부 표현한다. `provenance`만 **신뢰등급 판정**(§3.5)과 **스킬 카탈로그 게이트**(§4.4)에 load-bearing이라 유지. 삭제는 confirm-gated 일반 삭제(§6 `memory:delete`).

**Bound(§9 SEC-4 DoS 반영) — fail-closed:**
- `MEM_MAX_BLOCKS`(예 256) 초과 쓰기는 거부 + 사용자 알림
- `MEM_MAX_PINNED`(예 32) 초과 pin 거부
- `blocks.json` 총 크기 `MEM_MAX_FILE_BYTES`(예 256KB) 초과 쓰기 거부
- 주입 시 `MEMORY_TOKEN_BUDGET`(예 400 tok) — 초과분은 recency 우선 잘림(§4.5/§9 LM-2)

**비밀 fail-closed(§9 SEC-5 반영):** `redact()`는 코드 주석(`chat-session-store.ts:84-92`)이 명시하듯 **privacy 보장이 아니다**(sk-/key-/AIza/xox 접두 + >1KB base64만). durable 메모리는 영구 보존 + 매 턴 시스템 프롬프트 재주입이라 위험이 다르다. 따라서 메모리 전용 **`looksLikeSecret(text)`** 검출기를 쓰기 시점에 추가하고 매치 시 **블록을 저장하지 않고 드롭 + 알림**(store-then-partially-redact 금지):
- 기존 4종 + `Bearer`/JWT(`eyJ…`) + AWS `AKIA…` + GitHub `ghp_`/`gho_` + PEM(`-----BEGIN`) + bare 32+ hex / 64+ base64 엔트로피 휴리스틱.

### 3.2 검색 · 주입

`chat:send` 시(= `chat-engine.ts:621-637` 조립 시점):

- **pinned 블록은 항상 포함**(작고 `MEMORY_TOKEN_BUDGET`로 cap). **P1은 pinned-only**(메모리 임베딩 0).
- **비-pinned(P2+)**: 원시 쿼리를 임베드(사전 LLM sketch 콜 없음 — latency 회피)하고 기존 싱글톤으로 선형 융합: `score = relevance(cosine via searchEngine) + recency(decayEngine retrievability)`, 각 항 min-max→[0,1]. top-k≈4.
  - **§9 LM-5 반영(공유 임베딩)**: 메모리 쿼리 임베딩은 **RAG 블록이 이미 계산한 쿼리 임베딩을 재사용**한다(`buildChatRagBlock` 내부, `:503` 근처). 같은 `chat:send`에서 임베더를 두 번 돌리지 않는다(3080Ti VRAM은 gemma4와 공유). 이를 hook point로 명시(§6).
  - **§9 YAGNI-3 반영**: pinned-only가 P1 dogfooding에서 충분하면 비-pinned 시맨틱 메모리는 **무기한 보류**. 사실 수가 윈도를 진짜 넘길 때만 "recency+pinned 마지막 N개"라는 둔한 cap을 먼저 시도, 임베딩+FSRS 융합은 그 다음.

**주입 신뢰등급(§9 LM/SEC 반영):** `=== Core Memory ===`는 **시스템 역할(신뢰)**로 splice하되 **`provenance==='user'`인 블록만**. `provenance:'reflection'`이나 (P1 임시) 볼트-유래 텍스트는 `buildSystemPrompt`의 `<untrusted>` data로 주입(`:516-519`) — 시스템 역할 금지. **모든 경우 §3.5 스캔이 splice 전에 돈다.**

### 3.3 자기수정 플로우 (review-before-apply)

- **P1:** 모델은 기존 `append_note`/`create_note`를 designated 메모리 노트에 호출 → `:1160`의 확인 게이트 + `assertInsideVault` + `afterWrite` 무료 상속. **신규 WRITE 표면 0개**. 단 §9 SEC-6/INT-6 반영으로 **P1 메모리 쓰기 위치는 오프-볼트 `blocks.json`(thin 내부 헬퍼)** — 볼트 내 `MEMORY.md`는 거부(§10-a 잠금).
- **P2:** 전용 `core_memory_replace({id,old,new})` / `core_memory_append({text})` WRITE 도구. `deps.memoryWrite`(오프-볼트)로 라우팅. **이 도구는 `confirmWrites` 설정과 무관하게 force-confirm**(§7 메커니즘) — core 블록은 시스템 프롬프트를 먹이므로 자동 적용된 오염은 durable + 파일트리 비가시.
  - **§9 SEC-7 data-integrity 반영(`core_memory_replace`):** `old`가 0개 또는 2개+ 매치면 **거부**(모델은 반드시 블록 `id`를 지정). `provenance==='user'` 블록은 in-place 덮어쓰기 금지 → append+supersede(새 블록 생성, 옛 블록은 사용자 확인 후 삭제)만 허용. confirm UI는 diff가 아니라 **블록 before/after 전문**과 `provenance`를 보여 사실-뒤집기(fact-flip)를 가시화. 모든 replace는 supersession으로 로그.

### 3.4 주입 지점

`chat-engine.ts:621-637`(`agentSystem` 배열 조립). `=== Core Memory ===` 블록(pinned + (P2+)검색, cap됨)을 `.join('\n')`(`:637`) 직전 배열 원소로 splice. 캡처는 `:643`에서 한 번 → 모든 `streamStep` 재사용(§7.3 frozen snapshot). 비-pinned/볼트-유래 히트는 `<untrusted>` data로(시스템 역할 아님).

### 3.5 injection-scan (§6.7 이행 — 신규 모듈)

**§9 SEC-1/INT-5 반영: 이 스캔은 기존에 없다.** `buildSystemPrompt`의 `<untrusted>` 래퍼(`:514-520`)는 모델에게 "안의 지시 따르지 마라"고 말하는 **평문 지시**일 뿐 강제 스캐너가 아니다. 따라서 build-from-scratch P1 산출물로 명시한다.

**`scanForInjection(text) -> { clean: string, blocked: string[] }`** (순수 함수):
- 룰셋: assistant 대상 명령형 패턴, role-spoofing 마커(`system:`, `</untrusted>`, `assistant:`, `ignore previous/above`), 도구명 언급, fenced-instruction 블록.
- 적용 대상 **3곳 모두**:
  (a) 모든 메모리 블록 `text` — splice 전
  (b) 모든 스킬 `description` — 카탈로그 주입 전(build time)
  (c) 모든 스킬 body — `role:'tool'` push 전(`:1135` 브랜치)
- 출력: 매치를 `[BLOCKED:…]`로 치환 — **스냅샷에만**. live `blocks.json`/`Skills/*.md`는 무손상·사용자 삭제 가능.
- **회귀 테스트가 P1 게이트**(확장할 기존 스캔이 없으므로 신규 테스트 자체가 게이트). 첫 시스템-프롬프트 메모리/스킬 주입과 **반드시 같은 커밋**에 ship. 클라우드 경로(§4.5)도 메모리가 시스템 프롬프트에 닿으므로 거기서도 스캔이 돈다.

---

## 4. SKILL 서브시스템

### 4.1 저작 포맷

`<vault>/Skills/<name>.md`, Claude-Skills `SKILL.md` 규약 — YAML frontmatter(`name`, `description`=무엇+언제+트리거, 3인칭, ≤1024자) + 마크다운 본문. 사용자 저작, git 이식, 일반 노트처럼 편집.
```markdown
---
name: weekly-review
description: Summarize notes touched this week into a digest. Use when the user asks for a weekly review or recap.
tools: [search_vault, read_note, recall_memory, create_note]
---
## Steps
1. recall_memory("project") to anchor scope
2. search_vault recent topics; read_note top hits
3. create_note under Digests/, link sources via [[ ]]
## Pitfalls
- dedupe near-identical chunks before synthesis
```

### 4.2 progressive disclosure

- **Level-1**(`name`+`description`, ~100 tok/skill): `list_skills` 카탈로그가 `chat-engine.ts:621-637`에 **항상** 주입. 단 **`provenance==='user'`(사용자-승격) 스킬만 적격**(§4.4) + **하드 cap**(`SKILL_CATALOGUE_BUDGET`≈300 tok, 최대 N개 — recency/use 상위, deterministic 잘림)(§9 SEC-3/INT-4/LM-2).
- **Level-2**(본문): `invoke_skill` 시에만 로드. **§9 LM-3 반영**: 본문을 **줄이 아니라 토큰으로 cap**(`SKILL_BODY_BUDGET`≈800 tok, `capToBudget`). 초과 시 head + 절단 안내. 권장: `## Steps` 섹션만 주입(Pitfalls/examples는 저자 문서). skill-load 시 본문이 런타임 budget 초과면 lint 경고.

### 4.3 control-tool 호출

`invoke_skill(name)`은 `set_plan` 템플릿을 클론한다. **볼트 쓰기 없음** — `Skills/<name>.md`를 읽고(`assertInsideVault` resolve + §3.5 스캔) 본문을 `role:'tool'` ack로 한 번 push 후 `continue`. **선언적 cut(declarative-never-eval)**: 스킬은 모델이 재해석하는 비활성 텍스트일 뿐, 레시피가 지시하는 쓰기는 반드시 실제 confirm-gated WRITE 도구로 재발화돼야 한다. **절대 `eval` 안 함** → Voyager류 RCE/공급망-실행 클래스 제거.

**§9 SEC-6(slow-DoS) / INT-1 반영 — 턴당 컨트롤 churn cap:**
- 턴당 `invoke_skill` 최대 2회, `recall_memory` 최대 N회.
- 같은 스킬 이름 같은 턴 재호출 거부(프롬프트가 아니라 루프에서 강제).
- 컨트롤 도구 호출도 step budget(`AGENT_MAX_STEPS=12`)을 소모 → non-settling이지만 "생산적으로 보이는" 루프도 빠르게 종료(오염된 비-empty recall이 dead-end 카운터를 못 올리는 경우 대비).

### 4.4 스킬 ↔ 메모리 상호작용 + provenance 게이트(잠금)

레시피 스텝이 `recall_memory(...)`(READ, 무료)로 개인화하고, 메모리 갱신 스텝은 `core_memory_append`(P2, force-confirm) 또는 `append_note`(P1)를 호출한다. `invoke_skill`은 텍스트만 주입하므로 게이트 우회 불가.

**§9 SEC-3 잠금(권고 아님 — 하드 요구):** 동기화/클론된 `Skills/*.md`(비-사용자-저작)는 **사용자 명시 승격(provenance=user) 전엔 카탈로그 주입 금지**. Notion↔Obsidian 동기화나 `git pull`이 공격자 스킬을 떨굴 수 있고, `description`(≤1024자)은 공격자 통제 텍스트가 매 턴 시스템 프롬프트에 닿기 때문(인젝션 + context-DoS). 카탈로그는 §4.2 cap으로 토큰/개수 모두 상한.

### 4.5 클라우드 / tool-incapable 로컬 degradation 계약(§9 LM-3/LM-6 반영)

에이전트 브랜치는 `isLocalProviderUrl && modelSupportsTools`일 때만 돈다(`:608-612`). 클라우드(fable-5/openai/gemini)와 tool-incapable 로컬(gemma2:9b)은 단발 경로(`buildSystemPrompt`)로 빠진다. "조용한 절벽"을 막기 위해 **잠금된 계약**:

- **(a) pinned 메모리는 모든 provider에 주입**: `buildSystemPrompt`가 RAG 블록뿐 아니라 pinned 메모리 블록(READ-only, 도구 불필요)도 받게 확장. 클라우드/tool-incapable 사용자도 durable 사용자 모델을 얻는다. **스킬 INVOCATION(에이전트 루프)은 로컬 tool-capable 전용**임을 문서화.
- **(b) §3.5 스캔은 클라우드 경로에서도 돈다**: untrusted 메모리가 클라우드 시스템 프롬프트에 닿으므로.
- pinned-메모리 floor가 "tool-driven 메모리/스킬"의 보편 degradation 타깃.

---

## 5. 새 에이전트 도구

| Tool | Category | Schema loc | Registry placement |
|---|---|---|---|
| `recall_memory(query, k?)` | **READ** | `AGENT_TOOL_SCHEMAS` (`agent-tools.ts:44`) | `AGENT_VALID_NAMES` (`:206`) + dispatcher `case` (`:257`). `{memories:[{tag,text,provenance}]}` 반환, title/snippet only. |
| `list_skills()` | **READ** | same | `AGENT_VALID_NAMES` + dispatcher(no-arg, `list_topics` 류). `{skills:[{name,description}]}` 반환. |
| `invoke_skill(name)` | **CONTROL** | `AGENT_TOOL_SCHEMAS` **만** | `AGENT_VALID_NAMES`/`AGENT_WRITE_NAMES`/dispatcher **불포함** — `set_plan` 본보기. |
| `core_memory_replace({id,old,new})` / `core_memory_append({text})` | **WRITE** (P2) | `AGENT_TOOL_SCHEMAS` | `AGENT_VALID_NAMES`(`:206`) + `AGENT_WRITE_NAMES`(`:211`) 둘 다; dispatcher(`:257`)에서 `deps.memoryWrite`. **force-confirm**. |

**도구 수 ceiling(§9 LM-1/INT-4 잠금):** 현 toolset은 `set_plan` + 7 read + 4 write = 12. 코드 자체(`agent-tools.ts:18`)가 "keeping the toolset small avoids overwhelming gemma4:e4b"라고 명시. 따라서:
- **advertised-tool ceiling ≤ 14를 게이트로 둔다.**
- **P1은 `recall_memory`만 추가(13개)** — `list_skills`는 메모리 selection 정확도 측정 후에만. 메모리 쓰기는 기존 `append_note`로 pinned-only ship.
- skill은 슬롯 절약: 기본은 `invoke_skill`만 광고(description="call to see available skills")해 N개가 아니라 1슬롯으로. `list_skills` 카탈로그는 §4.2 cap 하에.
- **gemma4:e4b 도구선택 eval 게이트**: 고정 10 프롬프트에서 추가 전/후 올바른 도구 ≥8/10 assert. 회귀 시 게이트 실패. (P2/P3 잠금 전 16-tool에서 재측정.)

**`invoke_skill` 인터셉션(set_plan 템플릿), `chat-engine.ts:1135`** — `set_plan` 브랜치 **바로 앞**, `:1148` `validNames` 체크 **앞**(아니면 `AGENT_MAX_INVALID` 발동):
```ts
if (name === 'invoke_skill') {
  const a = (tc.function.arguments ?? {}) as Record<string, unknown>;
  if (skillInvokeCount >= 2) {                                    // §4.3 턴당 cap
    messages.push({ role: 'tool', tool_name: name, content: 'skill limit reached this turn' });
    continue;
  }
  skillInvokeCount++;
  const body = ctx.toolset.loadSkill?.(String(a.name ?? ''));     // assertInsideVault + §3.5 scan + budget cap
  ctx.onSkill?.(String(a.name ?? ''));                            // surface → chat:skill-invoke
  messages.push({ role: 'tool', tool_name: name, content: body ?? '(skill not found)' });
  continue;                                                       // never settles, never deadEnds
}
```

---

## 6. 정확한 hook points (파일 + 심볼 + 이유)

- **`chat-engine.ts:621-637`** (`agentSystem` 조립) — `=== Core Memory ===` + 스킬 카탈로그 splice + §3.5 스캔 + `capToBudget`. *이유:* `:643`에서 단일 frozen 스냅샷 캡처, 모든 `streamStep` 재사용 → 한 번 주입으로 루프 전체 커버(§7.3). **`capToBudget`(`:503`에 이미 존재)를 메모리/카탈로그에도 적용** — `(RAG + memory + catalogue + agent-rules) ≤ CHAT_MAX_TOKENS(4096)의 고정 분율(예 2800)`, history+응답 여유 확보(§9 LM-2).
- **`chat-engine.ts:1031-1042`** (`isEmptyToolResult` 키 목록, `:1038`) — `'memories'`, `'skills'` 추가. *이유:* 신규 READ 배열 키가 미등록이면 plan-act-reflect dead-end 추적이 깨짐.
  - **§9 INT-7 반영**: `recall_memory`가 `{memories:[]}`(히트 없음) 반환 시 `deadEndCount++`(`:1188`)로 `DEAD_END_LIMIT=2`를 향해 강제-결론될 수 있음 — P1에선 빈 메모리가 흔함. **빈 메모리는 실패 검색이 아니므로 `recall_memory`를 dead-end 카운트에서 exempt**(쓰기처럼). 유닛 테스트로 `{memories:[]}`가 `deadEndCount`를 안 올림을 assert.
- **`chat-engine.ts:1135`** — `invoke_skill` 브랜치(`:1148` validNames 앞). *이유:* control-tool 순서 불변식(아니면 `AGENT_MAX_INVALID`); single-settle 보존(`continue`, succeed/fail 없음), role alternation(정확히 하나의 `role:'tool'` ack).
- **`chat-engine.ts:1160`** (write confirm 게이트) — `core_memory_*`가 탐. P2는 **force-confirm 우회 메커니즘**(아래) 추가. *이유:* 실제 opt-in shipped floor. 현 게이트는 `isWrite(name) && ctx.onToolConfirm`이라, `onToolConfirm`이 안 wired면(= `req.confirmWrites` 미설정, `index.ts:1169`) 쓰기가 **auto-apply**(`:1155-1157` 주석). 따라서 "force-confirm regardless of confirmWrites"는 신규 코드 필요.
- **`chat-engine.ts:1050-1073`** (`AgentToolset` / `AgentLoopCtx`) — **§9 INT-1 반영 신규 멤버 명시**:
  - `AgentToolset`에 `loadSkill?: (name: string) => string | undefined` 추가, `buildAgentToolset`(`agent-tools.ts:401`)이 반환.
  - `AgentToolset`에 `forceConfirm?: (name: string) => boolean` 추가(core_memory_* → true).
  - `AgentLoopCtx` + `ChatStreamOptions`(`:542-565`)에 `onSkill?: (name: string) => void` 추가, `runAgentLoop({...})` 콜(`:638-653`)에서 `onPlan`(`:648`)처럼 thread.
- **`chat-engine.ts:1160` force-confirm 메커니즘(§9 SEC-2/INT-3 잠금):** 게이트를 다음으로 교체 — `const needsConfirm = ctx.toolset.isWrite(name) && (ctx.onToolConfirm || ctx.toolset.forceConfirm?.(name));`. `forceConfirm`이 true인데 `onToolConfirm`이 없으면 **fail-closed**(쓰기 거부 + `'core memory write requires confirmation'` ack). 즉 `core_memory_*`는 confirm broker 없이는 절대 실행 안 됨.
- **`agent-tools.ts:44/:206/:211/:257`** — schemas, `AGENT_VALID_NAMES`, `AGENT_WRITE_NAMES`, dispatcher; `AgentToolDeps`(`:27-41`)에 `memoryRecall`/`memoryWrite`/`listSkills`/`loadSkill` 추가.
- **`index.ts:1148` AND `:1293`** (이중 `buildExecuteAgentTool` 사이트) — **모든 신규 deps를 양쪽에 wire**. *이유:* 둘째 사이트(chat:distill, `:1293`)는 같은 `runAgentLoop`를 돌리므로 `:1148`만 wire하면 distill 경로에서 `recall_memory`가 'unknown tool' throw. **§9 INT-2/SEC-2 잠금: distill/reflection 루프는 READ 메모리 deps만(`memoryRecall`/`loadSkill`/`listSkills`). `memoryWrite`는 `:1293`에 wire하지 않는다** — distill은 confirm 게이트 없이 auto-apply(`:1308` 주석)라 reflection이 무인 core 메모리 쓰기를 하면 review-before-apply(§7-1) 위반. reflection 제안은 review chip으로 라우팅(§8 P3).
- **`index.ts:1169` confirm broker** — `core_memory_*` force-confirm을 위해 **`req.confirmWrites` 가드와 무관하게** broker가 wired되도록(또는 `forceConfirm` predicate가 독립 검사). 둘 다 사이트에 적용.
- **`index.ts:1161-1162`** (`onPlan→chat:plan`) — `onSkill→chat:skill-invoke` 미러. *이유:* additive, one-way, `streamId`-routed surfacing 템플릿.
- **`ipc-types.ts` + `preload/index.ts` allowlists** — `chat:skill-invoke`(ALLOWED_EVENTS) + `memory:list/get/delete`, `skill:list/get`(ALLOWED_CHANNELS). *이유:* 렌더러는 데이터만, 도구/경로명 절대 못 보냄.
  - **§9 INT-8 반영**: `memory:delete`는 렌더러가 고른 블록 id를 운반 = 렌더러가 mutation 타깃을 지정 → **main에서 id를 store에 대조 검증(임의 삭제 불가) + `wcId`-owner 체크**(`chat:tool-approve`의 `index.ts:1229-1236` 패턴). 렌더러는 `memory:list`로 받은 opaque UUID로만 삭제, label/text로는 불가. "렌더러가 도구를 못 부른다" 위반 아님(데이터 CRUD로 프레이밍)지만 검증 floor를 명시.
- **공유 임베딩 hook(§9 LM-5)**: `buildChatRagBlock`(`:503` 근처)이 계산한 쿼리 임베딩을 메모리 검색에 전달 — 같은 `chat:send`에서 임베더 이중 실행 금지. P2+ 비-pinned 검색의 hook point로 명시.

---

## 7. 보안 불변식 테이블 + 위협모델 5문 답변

| 잠금 제약 | 메커니즘 |
|---|---|
| **1. review-before-apply** | 메모리 쓰기는 `append_note`/`create_note`(P1) 또는 `core_memory_*`(P2) → `isWrite`→confirm(`:1160`); **core 블록은 `confirmWrites`와 무관하게 force-confirm**(`forceConfirm` predicate; broker 없으면 fail-closed). `invoke_skill`은 write-free + declarative-never-eval. **distill 루프엔 memoryWrite 미wire**(`:1293`). Floor: path-safety + allowlist + tool-strip + no-network-write. |
| **2. telemetry OFF** | 모든 store는 `~/.stellavault/` + 볼트; network-write 도구 0개; embedder 로컬. |
| **3. 렌더러가 도구를 못 지정** | `invoke_skill`/`recall_memory`/`core_memory_*`는 메인 모델 스트림에서만 발화, 루프-인터셉트/디스패치; IPC는 UUID/intent만(`memory:delete`는 main에서 id 검증 + wcId-owner). |
| **4. single-settle** | `invoke_skill`은 `set_plan` 클론: 하나의 `role:'tool'` ack, `continue`, succeed/fail 없음, 조기 `chat:done` 없음, cap-2 슬롯 누출 없음. |
| **5. IPC 계약** | additive `streamId`-routed 이벤트만; 코어 triad `chat:send→chunk*→done\|error` 무손상. |
| **6. 로컬 모델 현실** | tool ceiling ≤14 + eval 게이트(§5); progressive disclosure(메타데이터-at-rest) + token budget(`MEMORY_TOKEN_BUDGET`/`SKILL_CATALOGUE_BUDGET`/`SKILL_BODY_BUDGET`, `capToBudget`); 클라우드/tool-incapable는 pinned 메모리만 정적 주입(§4.5). |
| **7. injection-scan WITH 메모리** | §3.5 `scanForInjection`이 첫 시스템-프롬프트 주입과 **같은 P1 커밋**; 스냅샷-only 치환, live `blocks.json` 무손상; atomic write + `.broken` quarantine; 회귀 테스트가 게이트. 클라우드 경로도 스캔. |
| **8. 보안 baseline** | `assertInsideVault`/`assertInsideDir` 매 FS touch; `0o700`; `looksLikeSecret` fail-closed(redact는 보장 아님 — §3.1); title/path-only(RAG snippet 본문 미저장); provenance가 신뢰등급/카탈로그 게이트; store bound + fail-closed. |

**위협모델 5문 (CLAUDE.md Threat Model Gate):**

1. **악의적 입력:** 오염된 동기화 노트가 메모리에 못 들어감(MEMORY 오프-볼트, `provenance:'user'`만 시스템-역할). 스킬 description/body는 §3.5 스캔 + provenance 카탈로그 게이트(§4.4). 모든 주입 텍스트 `[BLOCKED:…]` 치환.
2. **서비스 거부:** store bound(blocks/pinned/file-bytes fail-closed); 토큰 budget으로 컨텍스트 blowout 차단; 턴당 `invoke_skill`/`recall_memory` cap + 같은 스킬 재호출 거부 + control churn이 step budget 소모(§4.3); `AGENT_MAX_STEPS=12` floor.
3. **프라이버시 유출:** telemetry OFF; `looksLikeSecret` fail-closed drop; title/path-only; 모든 store 로컬. durable 메모리라 redact 대신 거부.
4. **신뢰 악용:** declarative-never-eval(RCE 제거); force-confirm 우회 불가(fail-closed); distill 무인 루프에 memoryWrite 미부여; provenance 게이트로 동기화 스킬 카탈로그 진입 차단.
5. **데이터 무결성:** `core_memory_replace` 0/2+ 매치 거부 + id 필수; user-provenance 블록은 append+supersede(in-place 덮어쓰기 금지); confirm UI에 before/after 전문 + provenance; atomic write + quarantine; 모든 replace 로그.

---

## 8. 단계적 롤아웃 (SP0→SPn, 각 게이트)

- **P1 — Memory recall (READ-only): ✅ 구현 완료(2026-06-24, 미커밋)**
  - `memory-store.ts`(session-store 1차 함수 클론, 오프-볼트 `blocks.json`, bound + `looksLikeSecret` fail-closed)
  - `recall_memory` READ 도구(**이것만 추가 → 13 advertised tools, ceiling≤14 준수**)
  - pinned-블록 주입 + §3.5 `scanForInjection` **같은 커밋**
  - `memories` 키 등록 + dead-end exempt(§6 INT-7)
  - 메모리 쓰기는 오프-볼트 thin 헬퍼(§10-a; 볼트-내 `MEMORY.md` 거부)
  - **구현 노트(설계 대비 단순화·동치):** 메모리 텍스트는 index.ts가 사전 스캔+렌더해 `coreMemory`로 chatStream에 주입 → `buildSystemPrompt` **단일 주입점**이 에이전트 루프(`agentSystem[0]`→frozen snapshot §7.3)와 클라우드/단발 경로를 **동시 커버**. chat-engine을 electron-free로 유지(기존 `{net}`-only 테스트 무손상). `scanForInjection`은 신규 순수 모듈 `injection-scan.ts`(electron 무관, chat-engine·memory-store 양쪽 import).
  - **적대리뷰(wf_ee591fdc, 22에이전트/1.44M토큰, 4렌즈→독립검증) 확정 5건 전부 수정:** ①§4.3 턴당 recall 캡(`AGENT_MAX_RECALL=4`, recall이 dead-end-exempt라 churn 방어) ②read/inject 경로 secret 재검사(`pinnedUserBlocks`서 `looksLikeSecret` 필터 — 손편집 blocks.json 방어) ③base64 휴리스틱 엔트로피 게이트(혼합대소문자+숫자 요건 — 긴 Unix 경로 오탐 제거) ④+⑤결합 시스템프롬프트 예산 `SYSTEM_PROMPT_TOKEN_BUDGET=2800`(§6/LM-2) + worst-case 테스트(중간 절단 금지로 가드라인 보존). 13건 반박(아키텍처 정합성=frozen snapshot·electron-free·양쪽 wire·ceiling·scope creep 없음 확인).
  - **게이트 결과:** tsc 0 ✅ / desktop vitest **407 PASS**(신규 26: injection-scan 10·memory-store 13·agent-tools recall 1·chat-engine coreMemory+exempt+recall-cap+budget) ✅ / injection-scan 회귀 게이트 ✅ / SSRF·CSP 무손상 ✅. **신규 WRITE 도구·dispatcher write-case 0** ✅.
  - **패키징:** `npm run package` 성공(exit0, asar 번들, Vite main CJS). 신규 모듈 정상 번들.
  - **남은 검증(P1 비차단·매뉴얼):** gemma4:e4b eval(도구선택 ≥8/10, Ollama 상주 필요·seed blocks.json)만. Manual Browser Gate 불요(브라우저 API/신규 UI IPC 없음 — P1은 main-process 전용).
- **P2 — Memory self-edit:**
  - `core_memory_replace`/`core_memory_append` WRITE 도구(force-confirm, fail-closed) + `deps.memoryWrite` **양쪽 사이트**(단 distill `:1293`엔 미wire)
  - `memory:list/get/delete` UI IPC(main id-검증 + wcId-owner)
  - `list_skills`는 메모리 selection 정확도 측정 통과 후 추가(16 tools에서 eval 재측정)
  - **§9 YAGNI-7 반영**: Mem0-style extract→reconcile(ADD/UPDATE/DELETE/NOOP) + MD5/유사도 dedup 파이프라인은 **드롭**. 대신 쓰기 제안 시 현재 메모리 사실을 같은 프롬프트에 넣어 단일 모델 콜이 append-vs-replace를 inline 결정 → 하나의 confirm diff. 사람이 보는 confirm이 dedup 게이트.
  - **게이트:** confirm-diff E2E to disk + force-confirm fail-closed 테스트 + replace 0/2+ 매치 거부 테스트.
- **P3 — Skills + (read-only) reflection:**
  - `list_skills`/`invoke_skill` + `Skills/` + `onSkill→chat:skill-invoke` + provenance 카탈로그 게이트
  - **§9 SEC-2/YAGNI-5 반영**: background reflection 데몬은 **무인 쓰기 금지**. reflection은 distill 루프를 **read-only pass**로만 돌려 candidate diff를 생성, P2 confirm UI에 review chip으로 큐잉. **reflection 루프는 write 도구를 절대 보유하지 않는다**(memoryWrite 미wire 불변식). 자동 트리거 임계값은 vault-calibrated 값을 dogfooding 후 결정(§10-e); 그 전엔 명시적 "remember X"만.
  - **게이트:** Manual Browser Gate(commit-blocking) — point-render, Stop-mid-recall abort, window-close orphan, sanitize, disk-write E2E, force-confirm 가시화.

---

## 9. 적대리뷰 반영 요약

**SECURITY**
- **SEC-1 (critical, §3.5):** injection-scan은 코드에 없음 → "재사용"이 아니라 **build-from-scratch P1 산출물**로 명시. `scanForInjection` 룰셋·3개 적용지점·회귀-테스트-게이트 구체화. 메모리/스킬 시스템-프롬프트 주입은 스캔 없이는 같은 커밋에서 ship 금지.
- **SEC-2 (critical, §6/§8):** "force-confirm regardless of confirmWrites"는 현 게이트(`:1160` `&& ctx.onToolConfirm`)로 불가능 → `forceConfirm` predicate + **broker 없으면 fail-closed**로 구체화. **distill 루프(`:1293`)는 memoryWrite 미wire** — reflection은 read-only 제안 전용(write 도구 미보유 불변식).
- **SEC-3 (high, §4.4):** 항상-주입 카탈로그가 동기화 공격 표면 → provenance=user 승격 스킬만 적격(권고→**하드 잠금**) + 카탈로그 토큰/개수 하드 cap + description 스캔.
- **SEC-4 (high, §3.1):** store 무한 성장 → `MEM_MAX_BLOCKS`/`MAX_PINNED`/`MAX_FILE_BYTES`/`MEMORY_TOKEN_BUDGET` 모두 fail-closed. soft-invalidate tombstone 제거(YAGNI-2와 합치).
- **SEC-5 (high, §3.1):** `redact()`는 privacy 보장 아님(코드 주석 확인) → 메모리 전용 `looksLikeSecret` 검출기로 **저장 거부(fail-closed)**, Bearer/JWT/AKIA/ghp_/PEM/엔트로피 추가.
- **SEC-6 (medium, §3.3·§4.5·§6 INT-6):** P1 in-vault `MEMORY.md` 권고 **거부** → 오프-볼트 thin 헬퍼(§10-a 잠금).
- **SEC-6b (medium, §4.3):** 비-empty 오염 recall이 dead-end를 안 올려 무한 루프 → 턴당 control cap + step budget 소모.
- **SEC-7 (medium, §3.3):** `core_memory_replace` 모호성/fact-flip → 0/2+ 매치 거부 + id 필수 + user-provenance append+supersede + before/after 전문 confirm.

**YAGNI**
- **YAGNI-1 (high, §3.1):** Letta 4-scope label 제거 → 자유 `tag` + `pinned`만.
- **YAGNI-2 (medium, §3.1):** soft-invalidate/provenance tombstone 체인 제거; `provenance`는 카탈로그 게이트/신뢰등급에만 유지(자유 문자열로 축소).
- **YAGNI-3 (high, §3.2):** FSRS 융합 메모리 검색 → P1 pinned-only(모든 사실 주입); 비-pinned 시맨틱은 윈도 압박 입증 시까지 보류, 먼저 둔한 recency cap.
- **YAGNI-4 (high, §4.2):** 임베딩-검색 스킬 카탈로그 → 사용자 저작 소수 스킬엔 progressive disclosure로 충분, `invoke_skill` 슬롯 1개 전략.
- **YAGNI-5 (high, §8 P3):** reflection 데몬 → read-only 제안 전용, 명시적 "remember X" 우선, 자동 트리거는 dogfooding 후.
- **YAGNI-6 (low):** `importance` 1-10 필드 제거(pinned로 충분).
- **YAGNI-7 (medium, §8 P2):** Mem0 extract→reconcile + MD5 dedup 제거 → 단일 모델 콜 inline append-vs-replace + 사람 confirm이 dedup.

**INTEGRATION**
- **INT-1 (high, §5·§6):** `loadSkill`/`onSkill`/`forceConfirm`은 net-new 멤버 → `AgentToolset`/`AgentLoopCtx`/`ChatStreamOptions`에 명시 추가 + `runAgentLoop` 콜에서 thread(체크리스트화).
- **INT-2 (high, §6):** 둘째 사이트 `:1293` — 모든 신규 deps 양쪽 wire, 단 distill은 READ deps만(memoryWrite 미wire).
- **INT-3 (high, §6):** force-confirm은 `:1160`로 표현 불가 → `forceConfirm` predicate + fail-closed.
- **INT-4 (medium, §5):** tool 12→16 + 카탈로그 → ceiling ≤14 게이트 + eval(≥8/10) + 단계화(P1=`recall_memory`만).
- **INT-5 (medium, §3.5):** §6.7 스캔은 net-new 모듈 — 입출력 계약 + 같은 커밋 + 회귀 게이트.
- **INT-6 (medium, §3.2):** in-vault 메모리는 system-role 신뢰 위반 → provenance=user만 system-role, 그 외 `<untrusted>`.
- **INT-7 (low, §6):** `recall_memory {memories:[]}`가 dead-end 오발 → exempt + 유닛 테스트.
- **INT-8 (low, §6):** `memory:delete` 검증 floor 명시(main id-검증 + wcId-owner + UUID-only).

**LOCAL-MODEL**
- **LM-1 (high, §5):** tool ceiling ≤14 + eval 게이트 + 단계화.
- **LM-2 (high, §6):** unbudgeted 주입 → `capToBudget` 재사용 + `MEMORY_TOKEN_BUDGET`/`SKILL_CATALOGUE_BUDGET` + 합산 budget(≤2800/4096) + worst-case 테스트.
- **LM-3 (high/medium, §4.2·§4.5):** 클라우드/tool-incapable 무메모리 절벽 → pinned 메모리 도구-free 주입 + 스킬은 로컬 전용 명시; 스킬 body 토큰 cap(`SKILL_BODY_BUDGET`) + `## Steps`만.
- **LM-5 (medium, §3.2·§6):** 메모리 임베딩 이중 실행 → RAG 쿼리 임베딩 공유.
- **LM-6 (medium, §4.5):** tool-incapable 로컬도 pinned floor로 통합.
- **LM-7 (low, §3.4):** 턴내 frozen snapshot으로 방금 쓴 메모리는 다음 턴까지 비검색 → agent rule 한 줄 추가("memory you write this turn is saved but not searchable until your next reply — do not re-recall it").

---

## 10. OPEN DECISIONS — LOCKED (2026-06-24, 사용자 추천안 전부 채택)

> 6건(a~f) 모두 아래 추천안으로 **잠금 확정**. 이후 변경은 설계 변경(re-lock) 절차를 거친다.

- **(a) P1 메모리 쓰기 위치** — 볼트-내 `MEMORY.md`(zero new tool, 단 동기화 인젝션 표면) vs 오프-볼트 `blocks.json` thin 헬퍼(표면 밖, 최소 write path 필요).
  **→ LOCKED: 오프-볼트 `blocks.json` thin 내부 헬퍼.** §9 SEC-6/INT-6에 따라 in-vault 권고 거부 — durable 모델이 동기화 볼트에 임시로도 거주 금지. 헬퍼는 모델-호출 도구가 아니므로 "신규 WRITE 도구 0개" 유지.
- **(b) force-confirm 범위** — `core_memory_*`만 vs 모든 메모리 쓰기.
  **→ LOCKED: core 블록만**(시스템 프롬프트를 먹이는 블록). label/scope 제거(§9 YAGNI-1)로 "core"=메모리 store 전체이므로 사실상 **모든 오프-볼트 메모리 쓰기 force-confirm**. P1 볼트 노트 쓰기는 기존 게이트 정책 그대로.
- **(c) 스킬 본문 주입 범위** — 전체 body vs `## Steps`만.
  **→ LOCKED: `## Steps`만 주입**(`SKILL_BODY_BUDGET` cap 하에). Pitfalls/examples는 저자 문서.
- **(d) reflection 자동 트리거 임계값** — Stanford 150은 sim-derived.
  **→ LOCKED: P3 이전엔 비활성. dogfooding 후 vault-calibrated 값 결정.** 그 전엔 명시적 "remember X"만.
- **(e) 비-pinned 시맨틱 메모리 검색 활성화 시점** — P2 vs 윈도 압박 입증 후.
  **→ LOCKED: 입증 후.** P1 pinned-only가 충분하면 임베딩+융합 무기한 보류, 먼저 둔한 recency+pinned cap(§9 YAGNI-3).
- **(f) eval 게이트 통과 기준선** — 고정 프롬프트 수/통과율.
  **→ LOCKED: 10 프롬프트, ≥8/10, P1(13 tool)·P2(16 tool) 각각 측정, 회귀 시 게이트 실패.**

---

## Deferred / Known-limitations

- **LM-7(턴내 staleness):** 방금 쓴 메모리는 frozen snapshot(§7.3) 때문에 같은 턴엔 비검색 — agent rule 한 줄로 완화하되, 작은 모델이 드물게 재-recall 시도 가능(허용된 trade-off, 다음 턴엔 반영됨).
- **provenance 자유 문자열:** §9 YAGNI-2로 tombstone 체인은 제거했으나 `provenance`는 카탈로그 게이트/신뢰등급에 load-bearing이라 유지 — 단일 사용자엔 `user` vs `synced` boolean으로 더 줄일 여지(미래 단순화 후보).
- **tombstone GC 불요:** soft-invalidate 제거(§9 YAGNI-2)로 blocks.json은 confirm-gated 삭제로 직접 compaction — 별도 GC/archive 정책 불필요. 사용자가 손으로/UI로 편집.
- **클라우드 스킬 INVOCATION:** §4.5로 pinned 메모리는 모든 provider에 주입하나, 스킬 호출(에이전트 루프)은 로컬 tool-capable 전용 — 클라우드는 의도적 미지원(UI에 명시).
