# Stella Agent vs. (Hermes + Obsidian) — 경쟁 전략 & 갭 스펙

> 작성 2026-06-28. 목표 = **"hermes-agent + Obsidian 조합을 쓰느니 스텔라 에이전트를 쓰게"** 만든다.
> 보완 문서: [hermes-port-audit.md](hermes-port-audit.md)(설정/UX parity), [d1-mcp-distribution-scope.md](d1-mcp-distribution-scope.md), [competitive-positioning-memory-relax.md](competitive-positioning-memory-relax.md).

## §0 결정 (ADR-style)

- **결정**: 스텔라 에이전트 = **자체 볼트-네이티브 thin 에이전트**로 *지식 레인*에서 `hermes+obsidian` 조합을 이긴다.
- **근거**: hermes-agent(MIT, v0.17.0, 13k+ 커밋, 매우 활발)는 **범용 자율 에이전트 플랫폼**(셸·클라우드·멀티에이전트·cron·자기개선). 모델 천장(PR#14 frontier)만 올려선 그 폭을 못 따라가고, 따라가려 하면 (a) 업스트림 추격세 (b) 핵심 해자(보안격리·비파괴·로컬) 파괴.
- **대안 & 기각**:
  - *A. compose(헤르메스에 스텔라 MCP 꽂기)* — 검증용으론 좋으나 "스텔라를 쓰게 한다"는 목표엔 미달(헤르메스가 주인공).
  - *C. 헤르메스 포크 → 리브랜드* — MIT라 합법이나 유지보수 함정 + Nous 정면경쟁 + 해자 역행. **기각.**
  - *B. 자체 thin 에이전트* — **채택.** 범용성 흉내 NO, 볼트-네이티브 깊이 + 안전 + 통합으로 승부.
- **승리 조건(정직)**: 전 사용자 아님. **지식노동자·노트중심·프라이버시 중시** 세그먼트에서 이긴다. 범용 작업 자동화 파워유저는 hermes로 보낸다(쫓지 않음).

## §1 경쟁자 = 조합의 약점

`hermes+obsidian`은 강력하지만 **둘을 붙인 것**이라 틈이 있다:
1. **조립 마찰** — hermes 설치·키·모델·MCP 와이어링·obsidian 경로 연결.
2. **에이전트가 볼트-네이티브 아님** — obsidian은 저장소일 뿐. 감쇠(FSRS)·지식그래프·엔티티·비파괴를 *모름*. hermes는 파일을 읽을 뿐.
3. **기본이 비-안전/클라우드** — 개인 볼트에 광범위 셸/코드실행 에이전트를 돌리는 신뢰 부담.
4. **지식작업 비최적** — 범용 자동화 지향(터미널·배포·스크래핑).

→ 스텔라 승부축 = **통합 + 볼트-네이티브 지능 + 안전/로컬.**

## §2 갭 매트릭스 (현재 코드 기준)

현재 인앱 에이전트 툴 17개 (`packages/desktop/src/main/agent-tools.ts`):
`set_plan, invoke_skill, search_vault, read_note, list_topics, find_decisions, get_related, detect_gaps, learning_path, recall_memory, core_memory_append, core_memory_replace, log_decision, create_note, append_note, link_note`
루프: chat-engine `runAgentLoop` — 단일 plan-act, 확인게이트 쓰기, injection-scan, single-settle, drainSteer. 모델: 로컬(gemma) 또는 frontier(PR#14, **라이브 미검증**).

| 능력 | hermes | 현 스텔라 | 갭 → 조치 |
|---|---|---|---|
| 볼트 시맨틱검색·연결·감쇠·그래프 | ✗(obsidian 단순파일) | ✅ 1급 툴 | **우위 — 더 부각** |
| 안전 쓰기(confirm·undo·비파괴·injection-scan) | 약(command approval) | ✅ | **우위 — write-approval 노브 이미 구현됨**(`confirmWrites` 설정+토글, audit P0-1 닫힘). 🤖 정직화는 미머지 PR#14. |
| 로컬/오프라인/프라이버시 | ✗(클라우드 기본) | ✅ | **우위** |
| 에이전트 메모리(절차적·core memory) | ✅ Honcho/FTS5 | ✅ recall/core_memory | parity |
| frontier 추론 | ✅ | △ PR#14 미검증 | **라이브 E2E + 기본 경로화** |
| 루프 깊이(plan-act-**reflect**·다단계 지속) | ✅ | △ 단일 루프(plan만) | **reflect 단계 추가(모듈한 깊이)** |
| 프로액티브("뭐 잊는지 먼저 챙김") | △ knowledge nudge | ✗ | **감쇠/갭 기반 선제 제안 = 차별점** |
| 제로셋업 통합(앱 하나) | ✗(조립) | ✅(앱 내장) | **우위 — 온보딩 마감** |
| 셸·코드실행·웹브라우징 | ✅ | ✗ | **비-목표(레인 밖, 해자 파괴)** |
| 멀티에이전트·cron·서버리스·멀티플랫폼 | ✅ | ✗ | **비-목표** |

## §3 승리 스펙 (BUILD / KEEP / NON-GOALS)

**BUILD (이걸로 조합을 이긴다)**
1. **frontier 기본 경로화 + 라이브 E2E** (PR#14 마감): 로컬=프라이버시 기본, frontier=품질 부스트 토글. "멍청한 에이전트" 탈출.
2. **plan-act-reflect 깊이**: 단일 루프 → 계획·실행·**자기점검(reflect)** 모듈 1스텝. (멀티에이전트 아님 — 과투자 금지)
3. **프로액티브 지식**: 감쇠(R<0.4)·갭을 에이전트가 **먼저 제안**("이거 잊는 중, 다시 볼래?"). hermes+obsidian이 구조적으로 못 하는 것.
4. ~~write-approval 정책 노브~~ **이미 구현됨**(`confirmWrites` 설정+토글, audit P0-1 닫힘 — 2026-06-28 확인). 잔여=🤖 정직화(미머지 PR#14에 있음) + (선택·저가치) readonly deny-all 모드.
5. **제로셋업 온보딩**: 앱 깔면 인덱싱→에이전트 즉시. 조합 대비 마찰 0.

**KEEP (이미 강점 — 부각)**: 볼트 21툴 깊이, 비파괴·undo·steer·검사가능 메모리, 로컬/오프라인.

**NON-GOALS (절대 안 함 — hermes 영역·해자 파괴)**: 셸/터미널, 임의 코드실행, 웹브라우징, 멀티에이전트 위임, cron/서버리스 무인, 자가생성 실행스킬, 멀티플랫폼 메신저.

## §4 검증 & 단계

- **0단계(사용자, 캘리브레이션)**: `hermes+obsidian`(+스텔라 MCP) 실제 조립·사용 → "조합이 못 하는 정확한 지점" 체감 = §3 우선순위 재확인. (코드 0, 키 필요 → 사용자 환경)
- **1단계**: frontier 라이브 E2E 마감 + write-approval 노브 (audit 구멍).
- **2단계**: plan-act-reflect 깊이 + 프로액티브 감쇠/갭 제안.
- **3단계**: 제로셋업 온보딩 + "지식 레인 1등" 포지셔닝 카피.

## §5 한 줄

**헤르메스를 복제하지 말고, 헤르메스가 구조적으로 못 하는 "볼트와 한 몸인 안전한 지식 에이전트"를 만들어 지식 레인에서 이긴다. 범용 흉내 = 패배 공식.**
