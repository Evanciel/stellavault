# (점검 2026-06-25, 울트라코드 wf_238de2b7, 8에이전트 — Hermes config+UX 딥리서치 + Stellavault 코드 매핑 + 공정성 적대비평)

# Stellavault — Hermes 설정/UI·UX 이식 점검

## §1 요약

| 축 | 점수 | 한 줄 평결 |
|---|---|---|
| **설정 이식** | **~7/10** | provider/model/key 표면은 Hermes보다 낫고 의도된 생략 대부분은 옳다 — 단 write-approval 정책 노브 하나가 진짜로 비어 있다. |
| **UI/UX 이식** | **~7/10** | 투명성·메모리 가시화 surface는 터미널 원본을 능가하나, steering이 Stop-only이고 핵심 affordance 두 개(🤖 토글·write-confirm)가 약속을 못 지킨다. |

**통합 평결:** 강한 이식이다. 기본 유저에게 중요한 것은 잘 잡았고, 단일 유저 로컬 에이전트에 과한 Hermes 노브들(sampling·delegation·session-reset·guardrail threshold·profile)은 규율 있게 생략했다. 진짜 구멍은 단 하나의 클래스 — **쓰기 승인 정책의 부재 + 그 부재가 만드는 trust mismatch 2건**(🤖 토글이 클라우드에서 조용히 no-op, 쓰기 툴 설명이 실제 동작과 불일치)이다. 거짓말하는 버튼이 없는 버튼보다 나쁘다 — 이게 1순위.

---

## §2 SETTINGS 이식 — Hermes 노브별 점검

### 2.1 Model / Provider — **이식 우수 (이식 표면 중 최강)**

| Hermes 노브 | Stellavault | 상태 |
|---|---|---|
| `model.default` | Model 드롭다운 + live `ai:list-models` fetch + free-text `__custom__` | **PORTED** |
| `model.provider` | Provider select (none/anthropic/openai/google/openai-compatible) | **PORTED** |
| `model.base_url` | Base URL 필드 (openai-compatible 전용, Ollama 기본) | **PORTED** |
| `model.api_key` | Write-only `safeStorage` 필드 + `🟢 saved` 배지 | **PORTED — Hermes보다 우수** (절대 read-back 안 함) |
| `model.context_length` | auto-detect, 비노출 | OMITTED (적정) |
| provider routing / OpenRouter cache | — | OMITTED (옳음 — OpenRouter 미사용) |

Write-only safeStorage 비밀 저장은 Hermes의 `.env` 방식보다 진짜로 낫다.

### 2.2 Sampling / Reasoning — **의도적 생략 (옳음)**

| Hermes 노브 | Stellavault | 상태 |
|---|---|---|
| temperature / top_p / top_k | **강제 생략** — 코드 주석(L18/L151): fable-5/opus에서 전부 400 | **CORRECTLY OMITTED** (실증 근거, lazy 아님) |
| `model.max_tokens` | `CHAT_MAX_TOKENS=4096` 하드코딩 (L31) | HARD-CODED (적정) |
| `agent.reasoning_effort` | gemma는 `skipThinking` 하드 `'none'` (L179), 그 외 부재 | DELIBERATELY FIXED |

Hermes 자신도 top-level temperature를 노출하지 않으므로 이건 parity이지 regression이 아니다. `reasoning_effort`는 Hermes가 노출하는 유일한 sampling 노브지만, 현행 모델(gemma4/fable-5)이 전부 400을 내므로 **노출해도 보여줄 reasoning이 없다** — reasoning 모델(qwen/deepseek-r1)이 실제로 배선되기 전엔 비-목표.

### 2.3 Tool config — **대부분 생략; 진짜 갭은 여기 한 줄**

| Hermes 노브 | Stellavault | 상태 |
|---|---|---|
| `agent.max_turns` (90) | `AGENT_MAX_STEPS=12` (L1185) | HARD-CODED (advanced-only, 조건부) |
| `agent.disabled_toolsets` / tool toggles | 없음 (14-tool 고정; `invoke_skill`은 promotion gate만) | OMITTED (적정 — 단일 유저) |
| `agent.tool_use_enforcement` | 암묵 (로컬 tools-capable 모델에서만 발화) | OMITTED (적정) |
| `tool_output.max_bytes/max_lines` | 비노출 | OMITTED (적정) |
| `tool_loop_guardrails.*` | `AGENT_MAX_INVALID=3`/`DEAD_END_LIMIT=2` 하드코딩 (L1186/1194) | OMITTED (옳음 — anti-foot-gun 내부값) |

### 2.4 Memory — **부분 이식, write_approval만 진짜 갭**

| Hermes 노브 | Stellavault | 상태 |
|---|---|---|
| `memory.write_approval` | per-tool 소스 상수 — `core_memory_replace`만 force-confirm, append→autonomous+undo-toast | **HARD-CODED — 토글이어야 함** |
| `memory.memory_enabled` | 암묵 (RAG/recall 상시) | OMITTED (적정) |
| `memory.nudge_interval`/`flush_min_turns` | reflection은 **explicit-only** (`🧠 Reflect` 버튼) | OMITTED (의도, §10-d) |
| recall `k` | 기본 8, 모델은 `k` 전달 가능·유저는 불가 (`AGENT_MAX_RECALL=4`, L1189) | OMITTED (기본값 적정, 비-목표) |
| `memory.*_char_limit` | 비노출 | OMITTED (적정) |

### 2.5 System prompt / identity — **하드코딩 (방어 가능, 단 caveat 1)**

| Hermes 노브 | Stellavault | 상태 |
|---|---|---|
| `SOUL.md` / context files | RULES 프롬프트 인라인 하드코딩 (chat-engine L718-734) | HARD-CODED |
| `--profile` 격리 | 없음 (단일 vault) | OMITTED (옳음 — 단일 유저) |

Profiles/personas 생략은 단일 유저 데스크탑에 옳다. 단 read-only/appendable **system-prompt view**는 파워 유저가 정당하게 원하는 유일한 identity 노브 (§4 P4).

### 2.6 Concurrency / Session / Safety — **대부분 옳게 생략, Safety가 headline 갭**

- **Concurrency/delegation**: `delegation.*`, worker pool, cron parallelism → 전부 N/A (서브에이전트 없음). `MAX_CONCURRENT=2`(L40)는 delegation 노브가 아니라 내부 UI 안전 캡 — **옳게 생략.**
- **Session/DB**: `session_reset.*`, `idle_minutes`, `max_concurrent_sessions` → session CRUD(SP1)은 있으나 reset-policy 노브 없음 — **옳게 생략.** (`IDLE_TIMEOUT_MS=60s`(L30)는 stream-stall 타임아웃, session-reset 아님 — 별개 개념.)
- **Safety/confirm** — **THE headline gap:**

| Hermes | Stellavault | 상태 |
|---|---|---|
| `memory.write_approval` 토글 / 4-tier consent ladder | per-tool 상수, UI 없음 | **MISSING TOGGLE** |
| YOLO vs hard-floor | 쓰기 **기본 auto-apply**; confirm chip은 `confirmWrites`가 set일 때만 (broker는 index.ts L1389-1411에 이미 배선, 단 ChatView L459는 ragOn+agentOn만 전송) | **MISSING** — "항상 쓰기 확인" 설정 자체가 없음 |
| `security.redact_secrets` | session redaction 존재(SP0), 토글 아님 | OMITTED (적정 — 보안 기본값, OFF되면 안 됨) |
| `HERMES_WRITE_SAFE_ROOT` | 쓰기는 구조상 vault-scoped | OMITTED (옳음) |

### §2 진짜 빠진 것 (요약)
단 하나의 클래스 — **write-approval 정책 노브**. provider/model/key는 우수, sampling·delegation·session-reset·guardrail·profile 생략은 전부 방어 가능. "no foot-guns" 규율 설계이지 미완성이 아니다.

---

## §3 UI/UX 이식 — Hermes 인터랙션 패턴별

### 3.1 패턴별 점수표

| Hermes load-bearing 패턴 | Stellavault | 등급 |
|---|---|---|
| **Tool-activity 투명성** (per-call feed, icon+arg+duration) | 접이식 disclosure strip, 최근 step 요약→최근 8 확장, 🔧/⚠️/✓/📝, **clickable "Filed" write 행** (B1) | **A — 개선** |
| **Before/after confirmation** (4-tier ladder + hard floor) | amber approve/deny chip (B3) — 단 `core_memory_replace`만 진짜 gated, vault 쓰기는 schema가 "approval" 말해도 auto-apply | **C — mismatch** |
| **Memory 가시화/편집** (staged queue, `💾` 영수증, raw 검사) | MemorySkillsPanel raw + delete + **⚠ injection 배지**; "remembered (undo)" 토스트; reflection 리뷰 칩 1개씩 (B4/B5/B17) | **A — 개선** |
| **Reasoning/plan 표시** (`/reasoning show`, thinking 카드 + plan) | `set_plan` **live 체크리스트** ☑/☐ (B2) — plan은 훌륭. 단 모델 **thinking은 전혀 표시 안 함** | **B− — 절반** |
| **Interrupt/steer** (interrupt/queue/steer-after-tool) | 하드 **Stop** abort, unmount/edit 시 abort (B7) | **C+ — Stop only** |
| **Error/refusal surfacing** (categorized + 액션) | 8 카테고리, Retry, **actionable "Start Ollama"**, model-missing→Settings (B8) | **A** |
| **Truncation/vitals** (context-fill bar, max_bytes, paste-collapse) | image cap/size 가드, distill 요약 — 단 **context-fill % bar 無, token/cost 無, paste-collapse 無** | **C — vitals 결손** |

### 3.2 GUI가 터미널을 개선한 점 (진짜 wins — 터미널이 불가능한 것)

1. **Clickable "Filed" write 행** (📝 + accent + ↗ → 노트 열기, ChatView L755 `openNote`). 터미널은 "wrote note"만 출력 — GUI는 second-brain 성장을 navigable하게. Hermes analog 없음.
2. **Injection 배지 달린 검사 가능 메모리 패널** (MemorySkillsPanel `scanForInjection` ⚠). Hermes는 MEMORY.md를 frozen snapshot으로 — Stellavault는 durable block을 visible·deletable·threat-flagged 리스트로. 더 나은 메모리 위생.
3. **"Remembered (undo)" 토스트** (B4, `memory:delete`). autonomous append를 write-time에 reversible하게 — 이 undo affordance가 relax-to-autonomous 설계를 licensed한 사려 깊은 trust 패턴.
4. **set_plan = ticking 체크리스트** (B2), current-step accent + clamped index. Hermes plain-text plan보다 우수.
5. **Reflection-as-review-chips** — rationale + queue count 와 함께 1개씩, explicit-trigger-only (B5).
6. **Per-bubble streaming cursor + elapsed timer** + concurrency-safe stream routing (B6) — "에이전트가 살아있다" 타이머를 race-safe하게 이식.

### 3.3 약하거나 누락된 점

P0/P1 갭은 §4 우선순위에서 통합 다룸. 추가 smaller 갭:
- **Streaming tool-args 미표시**: Hermes는 arg 프리뷰를 live 스트림, Stellavault strip은 call 착지 후 표시. minor, "명령 타이핑 보는" 질감 부재.
- **두 개의 분리된 "agent" surface**: Settings→Agent(외부 MCP, 21 tools, `mcpAutoStart`) vs chat 🤖(in-process, 14 tools) — 같은 단어, 다른 tool 수. UX 함정.
- **Loop-budget 가시성 無**: `AGENT_MAX_STEPS=12`가 invisible. plan 체크리스트가 부분 보완하나 "step 9/12" 큐 없음.

### 3.4 Stellavault가 Hermes 경고를 피한 점
Hermes issue #29511: approval-warning 텍스트가 model-visible transcript에 누출. Stellavault는 approval/confirm UI를 renderer에 엄격 격리(chip 컴포넌트), **user 텍스트는 plaintext(`whiteSpace:pre-wrap`)**·assistant 텍스트만 `SanitizedMarkdown` 통과 — 보안상 옳은 split. 누출 벡터 없음.

---

## §4 우선순위 갭 + 권고 (critique 통과분만)

### P0 — Trust mismatch (먼저 고칠 것; 능동적으로 오도함)

**P0-1. "항상 쓰기 확인" 토글 + 설명/동작 불일치 수정.** 가장 놀라운 갭. agentHint(i18n.ts L281)·tool 설명(agent-tools L211/230/247)은 `create_note`/`append_note`/`link_note`가 "approval 필요"라 하지만, 루프는 `req.confirmWrites`가 set이 아니면 **auto-apply**(index.ts L1390-1391). `confirmWrites`는 아무도 안 보냄(ChatView L459는 ragOn+agentOn만)·설정 UI도 없음. `core_memory_*`만 진짜 gated → hint가 common case에서 거짓. **broker는 index.ts L1389-1411에 이미 배선되어 있음** — Review-every-write 토글이 `req.confirmWrites`를 set하도록 한 줄 배선하거나 hint를 고칠 것. **Hermes 4-tier ladder는 over-engineering — single boolean이면 충분.** Trust/safety 갭이라 단순 튜닝보다 우선.

**P0-2. 🤖 Agent 토글이 클라우드 provider에서 조용히 no-op.** agent 분기는 `isLocalProviderUrl + modelSupportsTools`에서만 발화(chat-engine L695-699). fable-5/openai/gemini에서 🤖 켜면 single-shot로 fall through, **UI 피드백 0**. affordance가 거짓말하는 버그. **수정:** non-local provider 또는 tools 미지원 모델일 때 pill을 grey/disable + annotate("Agent mode needs a local tools model"). YAGNI 아님.

### P1 — 그 다음

**P1-3. Steer-after-tool 부재 (Stop-only).** Hermes의 headline steering — 현재 step을 tear-down 없이 다음 tool 뒤에 note 주입(`/steer`) + queue 모드 — analog 없음. Stellavault는 abort-and-restart만(B7). 훔칠 가치 가장 높은 steering UX.

**P1-4. Vitals/context-fill 큐 부재.** Hermes의 color-threshold context-fill bar(green→red)가 가장 명확한 overflow 신호 — token usage/cost/duration·paste-collapse 전부 비노출. 하드코딩 `RAG_TOKEN_BUDGET`/`CHAT_MAX_TOKENS` 있는데도 "context 벽에 얼마나 가까운가" 신호 0. 경량 context-fill 인디케이터 + paste-collapse 권고.

### P2 — 소소한 것

**P2-5. System-prompt 가시성.** RULES가 인라인 하드코딩(L718-734). read-only "view agent instructions" 패널이 minimum viable, appendable user-rules 박스가 ideal. baked rules가 sensible해서 우선순위 낮음.

**P2-6. `MAX_STEPS` 노출 — 조건부 advanced-only.** `AGENT_MAX_STEPS=12`는 gemma4에 적정, bigger-model 근거는 hypothetical(미배선). **reasoning/bigger 모델이 실제 배선될 때까지 비-목표**, 배선 시 advanced 섹션에 단일 numeric.

### 비-목표 (추가하지 말 것 — critique 탈락)
- temperature/top_p/top_k — **옳게 제거**(fable-5/opus 400 실증, L18/L151)
- recall-`k` / RAG-depth 슬라이더 — 기본값(recall=4/RAG=8) 적정, 아무도 안 튜닝 (단일 유저 cruft)
- `tool_loop_guardrails` threshold·`AGENT_MAX_INVALID`·`DEAD_END_LIMIT` — anti-foot-gun 내부값
- `delegation.*`·worker pool·cron — 서브에이전트 없음, N/A
- `session_reset.*`·profiles/`SOUL.md` 격리 — 단일 유저·단일 vault에 과함
- provider routing / OpenRouter cache — 잘못된 provider 모델
- `memory.*_char_limit`·`nudge_interval`·`flush_min_turns` — reflection은 explicit-by-design

---

## §5 정직한 종합

**터미널 vs GUI 공정성.** 두 점검 모두 apples-to-apples다. Hermes의 많은 노브는 터미널 power-user 도구의 산물이고, Stellavault는 단일 유저 로컬 데스크탑 도구다 — 그래서 sampling·delegation·session-reset·guardrail threshold·profile 생략은 **결함이 아니라 의도된 차이**다. 코드 주석(L18/L151)이 temperature 생략이 lazy가 아니라 실증(fable-5/opus 400)임을 증명한다. 이건 규율 있는 "no foot-guns" 설계다.

**무엇이 진짜 부족한가.** 단 하나의 클래스: **쓰기 승인 정책**. 그리고 그것이 만드는 두 trust mismatch — (a) 쓰기 툴 설명·agentHint가 "approval 필요"라 말하지만 실제로는 auto-apply, (b) 🤖 토글이 클라우드에서 조용히 inert. broker(index.ts L1389-1411)가 이미 배선돼 있어 **P0-1은 한 줄 배선 + 토글**이면 닫힌다 — Hermes의 4-tier ladder까지 갈 필요 없이 single boolean으로 충분. 이게 Hermes의 가장 강한 기여(consent ladder + 명시적 approval 정책)인데 정확히 이게 이식되지 않았다.

**무엇은 의도된 차이인가.** GUI는 여러 면에서 터미널을 **능가**했다 — clickable filed-writes, injection-badged 검사 가능 메모리, undo-toast, ticking plan, race-safe streaming timer. 이것들은 터미널이 구조적으로 못 하는 것이고 Stellavault가 매체를 제대로 활용했다. 약점은 위젯 부재가 아니라 **steering(Stop-only)과 정직한 capability signaling**이다.

**종합 점수 ~7/10** (설정·UI 동률). 기본 유저에게 중요한 건 강하고, 파워 유저가 가장 먼저 손 뻗을 노브(write-approval 정책) 하나가 비어 있으며, 에이전트 기능을 훼손하는 discoverability 버그(advisory 🤖 토글)가 있다. **거짓말하는 버튼이 없는 버튼보다 나쁘다 — P0-1·P0-2 두 mismatch를 다른 무엇보다 먼저 고칠 것.**
