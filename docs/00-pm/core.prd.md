# Evan Knowledge Hub - Core PRD (Phase 4+ Expansion)

> **PM Agent Team 분석 결과** | 생성일: 2026-03-30
>
> Phase 1-3 완료된 프로젝트의 다음 단계 확장을 위한 통합 PRD.
> 기존 PRD(`evan-knowledge-hub.prd.md`) + Feature Discovery(`evan-knowledge-hub-features.md`)를 기반으로,
> 현재 구현 상태를 반영한 전략적 로드맵 문서.

---

## Executive Summary

| 관점 | 내용 |
|------|------|
| **Problem** | Phase 1-3 핵심 기능(인덱싱, 벡터 검색, MCP 10 tools, 3D 그래프, Knowledge Pack)은 완성되었으나, "개인용 도구"에서 "공개 오픈소스 프로젝트"로 전환하려면 차별화 기능, 바이럴 메커니즘, 커뮤니티 성장 엔진이 필요하다 |
| **Solution** | 3가지 전략 축으로 확장: (1) 지식 인텔리전스 (감쇠, 갭 탐지, 진화 추적) -- AI의 "장기 기억" 포지션 강화 (2) 개발자 워크플로우 심화 (CLAUDE.md 고도화, 적응형 검색) -- Claude Code 사용자 락인 (3) 바이럴 엔진 (별자리 뷰 고도화, 그래프 공유, 프로필 카드 확장) -- 오픈소스 성장 |
| **핵심 기능/UX** | F09 지식 감쇠 모델(FSRS), F01 지식 갭 탐지기, F06 히트맵, F02 진화 타임라인, F11 적응형 검색, F15 코드-지식 링커, F12 크로스 볼트 연합 |
| **핵심 가치** | "검색을 넘어 인텔리전스로" -- 지식을 찾는 것을 넘어, 모르는 것을 알려주고, 잊어가는 것을 리마인드하고, 변화를 추적하는 살아있는 지식 플랫폼 |

---

## 1. Current State Assessment (Phase 1-3 완료 현황)

### 1.1 구현 완료된 기능

| Phase | 기능 | 상태 | 구현 위치 |
|-------|------|:----:|-----------|
| **Phase 1** | Obsidian 인덱서 (스캔, 청킹, 임베딩) | Done | `packages/core/src/indexer/` |
| **Phase 1** | 벡터 스토어 (SQLite-vec) | Done | `packages/core/src/store/sqlite-vec.ts` |
| **Phase 1** | 하이브리드 검색 (BM25 + Cosine + RRF) | Done | `packages/core/src/search/` |
| **Phase 1** | MCP 서버 (10 tools) | Done | `packages/core/src/mcp/` |
| **Phase 1** | CLI (index, search, serve, status, graph, card, pack) | Done | `packages/cli/` |
| **Phase 2** | 3D Knowledge Graph (R3F, force-directed, K-means 클러스터링) | Done | `packages/graph/` |
| **Phase 2** | 검색 연동 + 폴더/시맨틱 듀얼 모드 | Done | `packages/graph/` |
| **Phase 2.5** | MediaPipe 핸드 제스처 제어 | Done | `packages/graph/` |
| **Phase 2.5** | 별자리 뷰 (MST) | Done | `packages/graph/` |
| **Phase 2.5** | SVG 프로필 카드 | Done | `packages/core/`, `packages/cli/` |
| **Phase 3** | .ekh-pack 포맷 생성/내보내기/가져오기 | Done | `packages/core/src/pack/` |
| **Phase 3** | PII 마스킹 (7 패턴) | Done | `packages/core/src/pack/pii-masker.ts` |
| **Phase 3+** | CLAUDE.md 자동 생성기 (MCP tool) | Done | `packages/core/src/mcp/tools/generate-claude-md.ts` |
| **Phase 3+** | 컨텍스트 스냅샷 (create/load) | Done | `packages/core/src/mcp/tools/snapshot.ts` |
| **Phase 3+** | 결정 저널 (log/find) | Done | `packages/core/src/mcp/tools/decision-journal.ts` |
| **Phase 3+** | 지식 내보내기 (JSON-LD, CSV) | Done | `packages/core/src/mcp/tools/export.ts` |

**테스트**: 16 test files, 92 tests ALL PASS

### 1.2 현재 MCP Tools (10개)

| # | Tool | 설명 |
|---|------|------|
| 1 | `search` | RRF 하이브리드 검색 |
| 2 | `get-document` | 문서 전문 조회 |
| 3 | `list-topics` | 토픽 목록 |
| 4 | `get-related` | 관련 문서 탐색 |
| 5 | `generate-claude-md` | CLAUDE.md 자동 생성 |
| 6 | `create-snapshot` | 컨텍스트 스냅샷 생성 |
| 7 | `load-snapshot` | 컨텍스트 스냅샷 로드 |
| 8 | `log-decision` | 결정 기록 |
| 9 | `find-decisions` | 결정 검색 |
| 10 | `export` | 지식 내보내기 |

### 1.3 기존 Feature Discovery에서 이미 구현된 항목

| Feature ID | 이름 | 원래 Phase | 실제 상태 |
|------------|------|-----------|-----------|
| F13 | CLAUDE.md 자동 생성기 | Phase 1 | **Done** (`generate-claude-md.ts`) |
| F10 | 컨텍스트 스냅샷 | Phase 1 | **Done** (`snapshot.ts`) |
| F14 | 결정 저널 | Phase 1 | **Done** (`decision-journal.ts`) |
| F20 | 지식 내보내기 포맷 | Phase 1 | **Done** (`export.ts`) |
| F07 | 별자리 뷰 | Phase 2.5 | **Done** (MST 기반) |
| F17 | 지식 프로필 카드 | Phase 2.5 | **Done** (SVG 렌더링) |

---

## 2. Discovery Analysis (Phase 4+ Opportunities)

### 2.1 Desired Outcome

**"검색 도구에서 지식 인텔리전스 플랫폼으로 진화하여, 사용자가 '아는 것'뿐 아니라 '모르는 것', '잊어가는 것', '변화하는 것'을 인지하게 한다"**

### 2.2 Opportunity Mapping (미구현 기능 재평가)

기존 Feature Discovery 20개 중 6개가 구현 완료. 나머지 14개 + 새로 발굴한 기회를 재평가합니다.

#### Tier 1: "다음에 반드시 해야 할 것" (Impact x 차별화 >= 20)

| # | 기능 | Impact | 차별화 | 점수 | 근거 |
|---|------|:------:|:------:|:----:|------|
| F09 | **지식 감쇠 모델 (FSRS)** | 5 | 5 | **25** | Vestige가 에이전트 메모리에 FSRS를 쓰지만, 개인 지식 노트에 적용하는 도구는 없음. 3D 그래프에서 감쇠 시각화 = "살아있는 지식" |
| F15 | **코드-지식 링커** | 5 | 5 | **25** | 코드 파일/함수와 지식 노트의 양방향 연결. 완전히 새로운 개념. 3D 그래프에서 코드 노드도 표시 |
| F16 | **그래프 스크린샷/임베드** | 5 | 5 | **25** | 바이럴 핵심 엔진. "내 지식 우주" 공유. 이미 3D 그래프 완성 -- canvas export만 추가 |
| F07+ | **별자리 뷰 고도화** | 5 | 5 | **25** | MST 기반 기초 구현 완료. LOD + 줌 레벨별 별자리/개별 노트 전환 + 별자리 레이블 추가 |
| F02 | **지식 진화 타임라인** | 4 | 5 | **20** | 경쟁사 중 아무도 안 함. 4D 시각화 (시간 축) |
| F01 | **지식 갭 탐지기** | 4 | 5 | **20** | InfraNodus가 유사하지만 클라우드 전용. 로컬에서 그래프 갭 분석 |

#### Tier 2: "해야 하지만 Tier 1 후에" (점수 12-19)

| # | 기능 | Impact | 차별화 | 점수 | 근거 |
|---|------|:------:|:------:|:----:|------|
| F11 | **적응형 기억 우선순위** | 4 | 4 | **16** | 현재 컨텍스트 기반 검색 가중치 동적 조정 |
| F06 | **지식 히트맵** | 4 | 4 | **16** | 활동 빈도/최신성을 3D 그래프에 오버레이 |
| F05 | **시맨틱 클러스터링 + 자동 태깅** | 4 | 3 | **12** | K-means 이미 있음 -- HDBSCAN으로 업그레이드 + LLM 레이블링 |
| F12 | **크로스 볼트 연합** | 4 | 4 | **16** | 개인/업무 vault 분리하되 통합 검색 |
| F04 | **자동 지식 요약** | 3 | 3 | **9** | 주간/월간 로컬 HTML 리포트 |

#### Tier 3: "커뮤니티 주도 또는 Phase 5+" (점수 < 12 또는 High Effort)

| # | 기능 | Impact | 차별화 | Effort | 비고 |
|---|------|:------:|:------:|:------:|------|
| F03 | 모순 탐지기 | 4 | 5 | High | NLI 모델 필요, 커뮤니티 기여 기대 |
| F08 | 지식 흐름도 | 4 | 4 | High | Sankey/Flow 다이어그램. 방향성 추론 복잡 |
| F18 | 커뮤니티 지식 템플릿 | 3 | 2 | Low | 커뮤니티 형성 후 |
| F19 | 암호화 볼트 동기화 | 3 | 3 | High | CRDT + E2E 암호화. Pro 기능 |

#### 신규 발굴 기회 (2026-03 시장 변화 반영)

| # | 기능 | Impact | 차별화 | 점수 | 근거 |
|---|------|:------:|:------:|:----:|------|
| F21 | **MCP Streamable HTTP 전환** | 5 | 3 | **15** | MCP 2026 로드맵에서 stdio -> streamable HTTP가 production 표준으로 부상. 원격 접근 가능 |
| F22 | **Multi-Agent Knowledge Routing** | 5 | 5 | **25** | MCP 17,000+ 서버 생태계에서, 여러 AI 에이전트가 동시에 지식에 접근하는 패턴. Tasks primitive 활용 |
| F23 | **Agentic Knowledge Graph** | 4 | 5 | **20** | 2026 트렌드: AI가 그래프 구조를 동적으로 생성/재구성. 정적 인덱싱 -> 동적 지식 발견 |
| F24 | **Voice Knowledge Capture** | 4 | 4 | **16** | 자비스 에이전트 프로젝트와 시너지. 음성 -> 자동 노트 생성 -> 벡터화 |
| F25 | **Obsidian MCP Bridge** | 4 | 4 | **16** | cyanheads/obsidian-mcp-server가 이미 존재하지만 검색 품질 낮음. 우리의 RRF 엔진과 결합 |

### 2.3 Opportunity Solution Tree (Phase 4+)

```
[Goal] 검색 도구 -> 지식 인텔리전스 플랫폼으로 진화
|
+-- [Opportunity] 지식의 시간적 차원 추가
|   +-- [Solution] F09: FSRS 감쇠 모델 (기억 강도 추적)
|   +-- [Solution] F02: 진화 타임라인 (시맨틱 드리프트)
|   +-- [Solution] F06: 히트맵 (활동 빈도 시각화)
|   +-- [Experiment] 100개 노트 vault에서 감쇠 시각화 데모
|
+-- [Opportunity] 지식의 빈틈을 알려줌
|   +-- [Solution] F01: 갭 탐지기 (브릿지 노드 부족 분석)
|   +-- [Solution] F03: 모순 탐지기 (NLI 기반)
|   +-- [Experiment] 클러스터 간 연결도 < threshold -> "갭" 경고
|
+-- [Opportunity] 코드와 지식의 통합
|   +-- [Solution] F15: 코드-지식 링커
|   +-- [Solution] F11: 적응형 검색 (현재 파일 컨텍스트)
|   +-- [Experiment] Claude Code 세션에서 파일 컨텍스트 기반 검색 A/B
|
+-- [Opportunity] 바이럴 성장 엔진
|   +-- [Solution] F16: 그래프 스크린샷/임베드
|   +-- [Solution] F07+: 별자리 뷰 고도화
|   +-- [Experiment] X/Twitter에 3D 그래프 GIF 공유 -> 유입 측정
|
+-- [Opportunity] 멀티 에이전트 시대 대응
    +-- [Solution] F21: MCP Streamable HTTP
    +-- [Solution] F22: Multi-Agent Knowledge Routing
    +-- [Solution] F23: Agentic Knowledge Graph
    +-- [Experiment] 2개 AI 에이전트 동시 지식 쿼리 벤치마크
```

---

## 3. Strategy Analysis (Phase 4+ 전략)

### 3.1 Value Proposition 재정의

#### Phase 1-3의 VP (달성됨)
> "내 지식을 보고, 탐색하고, AI가 활용하는 플랫폼"

#### Phase 4+의 VP (목표)
> "내 지식을 이해하고, 성장을 추적하고, 빈틈을 알려주는 지능형 지식 동반자"

#### JTBD 확장

**기존 JTBD** (해결됨):
> When I'm coding with AI, I want my personal knowledge accessible to AI agents, so that I don't repeat context every time.

**새로운 JTBD** (Phase 4):
> When I've accumulated hundreds of notes over years, I want to understand what I know deeply, what I'm forgetting, and what I should learn next, so that my knowledge becomes a strategic asset rather than a pile of files.

### 3.2 Lean Canvas 업데이트 (Phase 4)

| 섹션 | Phase 1-3 (달성) | Phase 4+ (목표) |
|------|-----------------|----------------|
| **Problem** | AI가 개인 지식에 접근 불가 | 지식이 쌓이기만 하고 활용/관리 안 됨 |
| **Customer** | AI 코딩 도구 사용 개발자 | + 지식 헤비 유저 (연구자, 크리에이터) |
| **UVP** | MCP로 AI가 내 지식 활용 | 지식의 "생명력"을 시각화하고 관리 |
| **Solution** | MCP 서버 + 3D 그래프 + 검색 | + 감쇠 모델 + 갭 탐지 + 진화 추적 |
| **Channels** | GitHub, Obsidian Community | + Product Hunt, YouTube 데모, X 바이럴 |
| **Revenue** | Core 무료 / Pro $10/mo | 변동 없음 (기능 풍부화로 Pro 전환율 향상) |
| **Cost** | 개발 인건비 | + 로컬 LLM 추론 비용 (사용자 부담) |
| **Key Metrics** | MCP 쿼리 수, GitHub Stars | + 감쇠 리마인드 반응률, 갭 탐지 활용률 |
| **Unfair Advantage** | MCP + 개인 지식 블루오션 | + 지식 인텔리전스 (아무도 안 함) |

### 3.3 SWOT 업데이트 (Phase 4 시점)

| | 긍정적 | 부정적 |
|---|--------|--------|
| **내부** | **Strengths** | **Weaknesses** |
| | - Phase 1-3 완성 (92 tests, 10 MCP tools) | - 아직 1인 개발 |
| | - 이미 3D 시각화 + 제스처 제어 구현 | - 공개 사용자 0명 (개인용) |
| | - MST 별자리 + 프로필 카드 차별화 보유 | - 커뮤니티/마케팅 경험 없음 |
| | - .ekh-pack으로 지식 이식성 확보 | - FSRS, 그래프 분석 구현 경험 부족 |
| **외부** | **Opportunities** | **Threats** |
| | - MCP 17,000+ 서버 (2026.01), 생태계 폭발 | - Obsidian 공식 AI 기능 확장 (Obsidian Labs AI) |
| | - Knowledge Graph Viz 시장 급성장 | - Khoj의 지속적 기능 추가 (에이전트 자동화) |
| | - "Agentic KG" 2026 트렌드 부상 | - NotebookLM 슬라이드/DB 변환 등 기능 확대 |
| | - 자비스 프로젝트와 시너지 가능 | - 대형 PKM (Notion AI, Tana) AI 통합 강화 |

### 3.4 Blue Ocean 포지션 재확인

```
          지식 인텔리전스 수준
             ^
      높음   |                            [Evan Knowledge Hub]
             |                               Phase 4 목표 위치
             |  [InfraNodus]                     ★
      중간   |     (클라우드)
             |
             |
      낮음   |  [Mem.ai] [NotebookLM] [Khoj] [Smart Conn.]  [Vestige]
             |
             +-------------------------------------------------------->
            낮음            AI 에이전트 통합 수준                   높음
```

**핵심**: Phase 1-3에서 확보한 "AI 에이전트 통합 높음" 축에 이어, Phase 4에서 "지식 인텔리전스" 축을 올려 완전한 블루오션을 형성합니다.

---

## 4. Research Analysis (2026-03 시장 업데이트)

### 4.1 Persona 재검증 및 확장

#### Primary Persona 유지: "Dev Minjun" (AI 코딩 개발자)

- **Phase 4에서의 새 Pain**: "MCP 검색은 잘 되는데, 6개월 전에 정리한 디자인 패턴 노트를 완전히 잊고 있었다. 같은 실수를 반복했다."
- **Phase 4 기대**: 지식 감쇠 알림 ("이 노트를 3개월간 안 열었습니다. 리마인드할까요?"), 코드-지식 자동 연결

#### 확장 Persona: "Power User Soyeon" (지식 헤비 유저, 30세)

| 항목 | 내용 |
|------|------|
| **역할** | 기술 PM / 전략 컨설턴트 |
| **도구** | Obsidian (3,000+ 노트), Claude, Notion (팀 협업) |
| **Pain Point** | "내가 뭘 알고 뭘 모르는지 모른다". 같은 인사이트를 반복 발견. 지식 자산의 전체 그림이 없다 |
| **Goal** | 지식의 성장을 추적하고, 빈틈을 체계적으로 메꾸고 싶음 |
| **JTBD** | "연간 지식 성장 리포트를 보고, 다음 분기에 뭘 공부할지 데이터 기반으로 결정" |
| **기대 행동** | 3D 그래프에서 히트맵/감쇠 오버레이 확인 -> 갭 탐지 결과 검토 -> 학습 계획 수립 |
| **지불 의향** | 월 $15+ (업무 도구로 비용 처리) |

### 4.2 Competitor Update (2026-03 기준)

#### 경쟁 환경 변화

| 경쟁사 | 2026-03 변화 | 위협 수준 | 우리의 대응 |
|--------|-------------|:---------:|-----------|
| **Khoj AI** | 에이전트 자동화(Automation) 추가, 다중 소스 확장 | 중간 | 지식 인텔리전스(감쇠/갭)로 차별화. Khoj는 "검색+채팅"에 집중 |
| **Smart Connections** | 여전히 Obsidian 내부로 한정. RAG 품질 개선 | 낮음 | MCP 외부 연동이 핵심 차별점 |
| **NotebookLM** | 비디오 개요, 슬라이드 변환 기능 추가. 여전히 클라우드 | 중간 | 로컬-퍼스트 + MCP 통합. NotebookLM은 코딩 에이전트 미지원 |
| **Obsidian MCP** | cyanheads/obsidian-mcp-server 등장 (vault CRUD + 검색) | **높음** | RRF 하이브리드 검색 품질 + 3D 시각화 + 지식 인텔리전스로 차별화 |
| **Vestige** | FSRS-6 기억 감쇠 + 3D 뉴럴 대시보드 | 중간 | Vestige는 에이전트 세션 메모리. 우리는 개인 지식 전체. 상호 보완적 |
| **InfraNodus** | Obsidian 플러그인 출시. 텍스트 네트워크 분석 | 중간 | 클라우드 전용 vs 우리 로컬. MCP 통합 없음 |
| **Tana** | 노드 기반 구조화 PKM, AI 통합 강화 | 낮음 | 클라우드, 프로프리어터리. 완전히 다른 접근 |

#### 신규 경쟁 위협: Obsidian MCP 서버들

MCP "Knowledge & Memory" 카테고리에 283개 서버가 등록된 상황에서, 가장 직접적인 위협은 Obsidian vault을 MCP로 노출하는 범용 서버들입니다.

**우리의 해자(moat)**:
1. **검색 품질**: 범용 MCP 서버는 단순 키워드/파일명 검색. 우리는 BM25+Cosine+RRF 하이브리드
2. **3D 시각화**: 어떤 Obsidian MCP 서버도 시각화 미제공
3. **지식 인텔리전스**: 감쇠 모델, 갭 탐지, 진화 추적은 독자 기능
4. **Knowledge Pack**: .ekh-pack 포맷은 지식 이식성의 유일한 솔루션

### 4.3 Market Sizing 업데이트

| 레벨 | 원래 추정 (2026-03) | 업데이트 근거 |
|------|---------------------|-------------|
| **TAM** | $11.24B | AI-Driven KM System 시장, CAGR 46.7% 유지 |
| **SAM** | $560M | PKM + AI 통합 세그먼트. MCP 서버 17,000+개로 생태계 확대 반영 |
| **SOM** | $2.4M ARR (Year 3) | Obsidian 커뮤니티 + Claude Code 사용자. 283개 KM MCP 서버 중 차별화 필요 |

### 4.4 Customer Journey Map 업데이트 (Phase 4 기능 포함)

```
[인식] --> [평가] --> [도입] --> [활용] --> [인텔리전스] --> [옹호]
                                              ^
                                              | Phase 4 신규 단계

인텔리전스 단계 (Phase 4 추가):
  터치포인트: 감쇠 알림, 갭 리포트, 진화 대시보드
  행동: 주간 지식 상태 리뷰, 학습 계획 수립
  감정: "이 도구가 나보다 내 지식을 잘 안다" (놀라움 + 의존)
  Pain: 감쇠 알림이 너무 많으면 피로감
  Metric: 감쇠 리마인드 후 노트 재방문율 > 30%
  Critical: 리마인드 빈도 조절 가능해야 함
```

---

## 5. ICP & Beachhead 재확인

### 5.1 Beachhead 유지: Claude Code + Obsidian 사용자

기존 분석의 Beachhead (18/20점)는 여전히 유효합니다.

**Phase 4 추가 근거**:
- Claude Code 사용자는 MCP 10 tools를 이미 활용 중 -- 지식 인텔리전스 기능 추가 시 자연스러운 확장
- "CLAUDE.md 자동 생성기"가 이미 구현되어 있어, 이를 킬러 유스케이스로 공개 가능
- 자비스 프로젝트를 통한 음성+지식 통합은 별도 프로젝트로 분리 예정

### 5.2 Bowling Alley 업데이트

```
[Beachhead] Claude Code + Obsidian 사용자
    |
    v (Phase 4: 지식 인텔리전스)
[Pin 2] Cursor + Windsurf + VS Code MCP 사용자
    |
    v (Phase 4: 바이럴 엔진)
[Pin 3] 테크 블로거/크리에이터 (3D 그래프 공유)
    |
    v (Phase 5: 크로스 볼트)
[Pin 4] UX 리서처/PM (구조화된 지식 관리)
    |
    v (Phase 5: 팀 기능)
[Pin 5] 기업 개발팀 (팀 지식 베이스)
    |
    v
[Tornado] AI 에이전트의 표준 지식 인터페이스
```

---

## 6. GTM Strategy (Phase 4 Launch)

### 6.1 Launch Strategy

**Phase 4a: 오픈소스 공개 (4주)**

| 주차 | 활동 | 목표 |
|------|------|------|
| W1 | GitHub 레포 정리 (README, 아키텍처 다이어그램, CONTRIBUTING.md) | 코드 공개 준비 |
| W1 | "Building in Public" X 스레드 시작 | 인식 생성 |
| W2 | Product Hunt 런치 | 초기 트래픽 |
| W2 | Hacker News "Show HN" | 개발자 커뮤니티 유입 |
| W3 | Obsidian 커뮤니티 포럼 게시 | Beachhead 접근 |
| W4 | YouTube 데모 영상 (3D 그래프 + MCP 연동) | 시각적 어필 |

**Phase 4b: 지식 인텔리전스 기능 추가 (6주)**

| 주차 | 기능 | 임팩트 |
|------|------|--------|
| W5-6 | F09: FSRS 감쇠 모델 + 3D 시각화 연동 | "살아있는 지식" 메시지 |
| W7-8 | F06: 히트맵 오버레이 + F16: 그래프 스크린샷 | 바이럴 엔진 점화 |
| W9 | F01: 갭 탐지기 + F11: 적응형 검색 | 인텔리전스 차별화 |
| W10 | F02: 진화 타임라인 (시간 축 슬라이더) | "4D 지식" 데모 |

### 6.2 핵심 마케팅 메시지

| 타겟 | 메시지 | 채널 |
|------|--------|------|
| 개발자 (Beachhead) | "Claude Code가 당신의 모든 프로젝트를 기억합니다" | GitHub, X, Dev Discord |
| 시각화 관심층 | "Show your knowledge universe" | X, YouTube, Product Hunt |
| 지식 관리 관심층 | "당신의 지식은 살아 숨쉽니다" | Obsidian Forum, Reddit |

### 6.3 가격 전략 (변동 없음)

| 티어 | 가격 | 포함 기능 |
|------|------|-----------|
| **Core (무료)** | $0 | 로컬 벡터화, MCP 10 tools, 3D 시각화, CLI, Knowledge Pack |
| **Pro** | $10/mo | 무제한 노트, 프리미엄 임베딩, 클라우드 백업, 감쇠 모델 고급 설정 |
| **Team** | $15/mo/user | Pro + 팀 지식 공유, 크로스 볼트 연합, 접근 제어 |

### 6.4 핵심 메트릭 (Phase 4)

| 메트릭 | 목표 (6개월) | 측정 방법 |
|--------|-------------|-----------|
| GitHub Stars | 500+ | GitHub API |
| npm 설치 수 | 1,000+ | npm downloads |
| MCP 일일 쿼리 | 5,000+ | 텔레메트리 (opt-in) |
| 감쇠 리마인드 반응률 | > 30% | 클라이언트 로그 |
| 그래프 스크린샷 공유 수 | 100+/월 | 소셜 미디어 트래킹 |
| 커뮤니티 컨트리뷰터 | 5+ | GitHub Contributors |

---

## 7. Product Requirements (Phase 4)

### 7.1 Product Vision (확장)

**Phase 1-3**: "내 지식을 보고, 탐색하고, AI가 활용하는 로컬-퍼스트 지식 플랫폼"

**Phase 4+**: "내 지식을 이해하고, 성장을 추적하고, 빈틈을 알려주는 **지능형 지식 동반자**"

### 7.2 Goals & Success Criteria (Phase 4)

| # | 목표 | 성공 기준 | 측정 방법 |
|---|------|-----------|-----------|
| G6 | 지식 감쇠 인지 | FSRS 기반 감쇠 계산 정확도 > 85% (수동 평가) | 사용자 피드백 |
| G7 | 지식 갭 발견 | 갭 탐지 후 새 노트 생성 비율 > 20% | 인덱서 로그 |
| G8 | 바이럴 성장 | 그래프 스크린샷 공유 -> GitHub 방문 전환 > 5% | UTM 트래킹 |
| G9 | 적응형 검색 품질 | 컨텍스트 인지 검색이 기본 검색 대비 NDCG 15%+ 향상 | 테스트 쿼리 세트 |
| G10 | 오픈소스 공개 | 공개 후 30일 내 외부 PR 1건 이상 | GitHub |

### 7.3 Phase 4 Scope & Implementation Order

#### 7.3.1 Phase 4a: 공개 준비 + 바이럴 (4주)

| # | 기능 | 설명 | 우선순위 | Effort |
|---|------|------|:--------:|:------:|
| F16 | **그래프 스크린샷/임베드** | Three.js canvas -> PNG/WebM + iframe 코드 | P0 | Low |
| F07+ | **별자리 뷰 고도화** | LOD + 줌 레벨별 전환 + 레이블. 기존 MST 확장 | P0 | Medium |
| -- | **README + 문서 정비** | 아키텍처 다이어그램, 설치 가이드, 스크린샷 | P0 | Low |
| -- | **npm publish 준비** | @ekh/core, @ekh/cli public publishing | P0 | Low |

#### 7.3.2 Phase 4b: 지식 인텔리전스 (6주)

| # | 기능 | 설명 | 우선순위 | Effort |
|---|------|------|:--------:|:------:|
| F09 | **지식 감쇠 모델 (FSRS)** | FSRS-6 기반 기억 강도 계산. 노트 접근/MCP 쿼리 시 리셋. 3D 그래프에서 감쇠 노드 "흐림" 표현 | P0 | Medium |
| F06 | **지식 히트맵** | 3D 그래프 노드 색상/크기를 수정일/접근 빈도에 매핑. Shader 기반 | P1 | Low |
| F01 | **지식 갭 탐지기** | 클러스터 간 브릿지 노드 부족 탐지. 토픽 커버리지 분석. MCP tool 추가 | P1 | Medium |
| F11 | **적응형 기억 우선순위** | MCP 쿼리 시 현재 파일 경로/언어/최근 히스토리 가중치 반영 | P1 | Medium |

#### 7.3.3 Phase 4c: 지식 심화 (4주)

| # | 기능 | 설명 | 우선순위 | Effort |
|---|------|------|:--------:|:------:|
| F02 | **지식 진화 타임라인** | 노트 생성/수정 시점 기반 시맨틱 드리프트 추적. 3D에 시간 축 슬라이더 | P1 | Medium |
| F15 | **코드-지식 링커** | git 커밋/파일에서 키워드 추출 -> 관련 노트 자동 매칭. MCP tool: `link-code` | P1 | Medium-High |
| F05 | **시맨틱 클러스터링 업그레이드** | K-means -> HDBSCAN. LLM 기반 클러스터 레이블 자동 생성 | P2 | Medium |

### 7.4 Technical Architecture (Phase 4 확장)

```
+---------------------------------------------------------------+
|                  Evan Knowledge Hub (Phase 4)                  |
|                                                                |
|  +-- Intelligence Layer (NEW) --+   +-- Visualization (확장) -+|
|  | FSRS Decay Engine            |   | 3D Graph + Heatmap      ||
|  | Gap Detector                 |   | Constellation LOD       ||
|  | Evolution Tracker            |   | Screenshot/Embed Export  ||
|  | Adaptive Priority            |   | Timeline Slider         ||
|  +------------------------------+   +-------------------------+|
|                                                                |
|  +-- MCP Server (10 -> 14 tools) --+                           |
|  | [기존 10 tools]                  |                           |
|  | + detect-gaps                    |                           |
|  | + get-decay-status               |                           |
|  | + link-code                      |                           |
|  | + get-evolution                  |                           |
|  +----------------------------------+                           |
|                                                                |
|  +-- Core Engine (기존) --+   +-- CLI (기존 + 확장) ----------+|
|  | Indexer + Embedder      |   | ekh index/search/serve/status ||
|  | SQLite-vec Store        |   | ekh graph/card/pack           ||
|  | BM25 + Cosine + RRF     |   | + ekh decay                  ||
|  | Chunker + Scanner       |   | + ekh gaps                   ||
|  +-------------------------+   +-------------------------------+|
+---------------------------------------------------------------+
```

**새로운 MCP Tools (Phase 4)**:

| # | Tool | 설명 | 관련 기능 |
|---|------|------|-----------|
| 11 | `detect-gaps` | 지식 갭 탐지 결과 반환 | F01 |
| 12 | `get-decay-status` | 노트별/클러스터별 감쇠 상태 조회 | F09 |
| 13 | `link-code` | 코드 파일/함수와 관련 노트 연결 | F15 |
| 14 | `get-evolution` | 특정 주제의 시간적 변화 추적 | F02 |

**새로운 CLI 명령**:

| 명령 | 설명 |
|------|------|
| `ekh decay` | 감쇠 상태 리포트 출력 |
| `ekh gaps` | 지식 갭 탐지 결과 출력 |

### 7.5 Non-Functional Requirements (Phase 4 추가)

| 항목 | 요구사항 |
|------|----------|
| **FSRS 성능** | 10,000개 노트 감쇠 계산 < 5초 (배치 처리) |
| **갭 탐지** | 그래프 분석 < 10초 (10,000 노트 기준) |
| **스크린샷 생성** | PNG 2048x2048 < 2초 |
| **적응형 검색** | 컨텍스트 로딩 오버헤드 < 50ms |
| **호환성** | Node.js 20+, Windows/macOS/Linux |

### 7.6 User Stories (Phase 4)

#### Epic 5: Knowledge Intelligence

| ID | Story | 수용 기준 | INVEST |
|----|-------|-----------|--------|
| US-5.1 | 개발자로서, 내가 잊어가는 중요한 노트를 알림받고 싶다, 반복 학습을 위해 | FSRS 감쇠 강도 < 0.3인 노트 목록 + 리마인드 제안 | I,N,V,E,S,T |
| US-5.2 | 사용자로서, 3D 그래프에서 활발한 영역과 방치된 영역을 구분하고 싶다, 지식 관리를 위해 | 히트맵 오버레이: 최근 활발 = 밝은 빨강, 방치 = 파랑 | I,N,V,E,S,T |
| US-5.3 | 사용자로서, 내 지식에 빈틈이 어디인지 알고 싶다, 학습 계획을 위해 | 클러스터 간 연결 부족 영역 + 추천 학습 주제 | I,N,V,E,S,T |
| US-5.4 | 개발자로서, 검색 결과가 현재 작업 파일에 맞게 조정되길 원한다 | React 프로젝트 작업 시 React 관련 노트 우선 반환 | I,N,V,E,S,T |

#### Epic 6: Knowledge Visualization Extension

| ID | Story | 수용 기준 | INVEST |
|----|-------|-----------|--------|
| US-6.1 | 사용자로서, 3D 그래프를 이미지로 저장하고 싶다, 공유를 위해 | "Export" 버튼 -> PNG/WebM 파일 다운로드 | I,N,V,E,S,T |
| US-6.2 | 사용자로서, 특정 주제의 시간적 변화를 보고 싶다, 성장 추적을 위해 | 타임라인 슬라이더 -> 시점별 그래프 상태 애니메이션 | I,N,V,E,S,T |
| US-6.3 | 사용자로서, 별자리 뷰에서 줌 레벨에 따라 추상화 수준이 바뀌길 원한다 | 줌아웃 = 별자리 레이블, 줌인 = 개별 노트 | I,N,V,E,S,T |

#### Epic 7: Code-Knowledge Integration

| ID | Story | 수용 기준 | INVEST |
|----|-------|-----------|--------|
| US-7.1 | 개발자로서, 현재 코드 파일과 관련된 지식 노트를 자동으로 찾고 싶다 | MCP tool `link-code` 호출 시 관련 노트 5개 반환 | I,N,V,E,S,T |
| US-7.2 | 개발자로서, Claude Code에서 "이 함수의 설계 배경 찾아줘" 하면 관련 노트를 받고 싶다 | 함수명/파일 경로 기반 시맨틱 검색 연동 | I,N,V,E,S,T |

### 7.7 Test Scenarios (Phase 4)

| ID | 시나리오 | 관련 Story | 검증 방법 |
|----|----------|------------|-----------|
| TS-7 | 30일간 미접근 노트의 FSRS 감쇠 강도가 정확히 계산됨 | US-5.1 | 단위 테스트 + 시뮬레이션 |
| TS-8 | 히트맵 오버레이 시 60fps 유지 (10K 노드) | US-5.2 | 성능 프로파일링 |
| TS-9 | 갭 탐지가 실제 빈 영역을 정확히 식별 (수동 검증) | US-5.3 | 테스트 vault 사용 |
| TS-10 | React 프로젝트에서 "auth" 검색 시 React 관련 노트가 상위 | US-5.4 | 통합 테스트 |
| TS-11 | PNG 스크린샷이 3D 그래프 현재 뷰를 정확히 캡처 | US-6.1 | 비주얼 테스트 |
| TS-12 | 별자리 줌 레벨 3단계 전환이 부드럽게 작동 | US-6.3 | UX 테스트 |
| TS-13 | `link-code` MCP tool이 파일 경로에서 키워드 추출하여 관련 노트 반환 | US-7.1 | MCP 통합 테스트 |

---

## 8. Pre-mortem Analysis (Phase 4)

### 8.1 Top 3 Risks

| # | 위험 | 영향 | 확률 | 완화 전략 |
|---|------|------|------|-----------|
| R7 | **FSRS 정확도 부족**: 개인 지식 노트에 FSRS를 적용하는 선례가 없어, 감쇠 예측이 부정확할 수 있음 | 높음 | 중간 | FSRS 파라미터를 사용자 행동(접근, MCP 쿼리, 수정)에 맞게 커스텀 튜닝. 사용자가 피드백("아직 기억함"/"잊었음") 제공 가능하게 |
| R8 | **갭 탐지 오탐**: "갭"이라고 판단한 것이 실제로는 관심 없는 영역일 수 있음 | 중간 | 높음 | 갭 탐지 결과를 "제안" 수준으로 제시. 사용자가 무시/확인 가능. 학습 기반으로 갭 임계값 조정 |
| R9 | **오픈소스 공개 후 관심 부족**: Product Hunt/HN에서 관심을 못 끌면 커뮤니티 형성 실패 | 높음 | 중간 | 3D 그래프 스크린샷/GIF를 핵심 시각 자산으로 활용. "와" 효과로 초기 관심 확보. 데모 영상 품질에 투자 |

### 8.2 Additional Risks

| # | 위험 | 영향 | 확률 | 완화 전략 |
|---|------|------|------|-----------|
| R10 | 283개 KM MCP 서버와 검색 결과에서 차별화 실패 | 중간 | 중간 | "Knowledge Intelligence"라는 카테고리 자체를 생성. 단순 검색 MCP와 다른 포지셔닝 |
| R11 | 바이럴 시도가 "기능은 많지만 핵심이 흐릿"으로 인식 | 중간 | 중간 | 런치 시 "3D + MCP"에만 집중. 인텔리전스는 후속 업데이트로 |
| R12 | CLI 이름 "ekh" 변경 시 기존 문서/설정 호환성 깨짐 | 낮음 | 높음 | 새 이름 결정 시 alias 지원. `ekh` -> `newname`으로 symlink |

---

## 9. Stakeholder Map (Phase 4)

| 이해관계자 | 역할 | 관심사 | 참여 수준 |
|-----------|------|--------|-----------|
| 개발자 (Evan) | 프로젝트 오너, 핵심 개발자 | 기술 구현, 오픈소스 공개 전략 | **Driver** |
| Claude Code 사용자 | 핵심 타겟 유저 (Beachhead) | MCP 통합 품질, 새 tool 유용성 | **Key Stakeholder** |
| Obsidian 커뮤니티 | 얼리 어답터 풀 | 호환성, 로컬-퍼스트, 설치 편의성 | **Supporter** |
| MCP 생태계 (17K+ 서버) | 프로토콜/생태계 | 표준 준수, 차별화 사례 | **Influencer** |
| Anthropic | Claude/MCP 운영사 | MCP 생태계 확장, 모범 사례 | **Enabler** |
| 오픈소스 컨트리뷰터 (미래) | 공동 개발자 | 코드 품질, 모듈화, 문서화, 기여 난이도 | **Supporter** |
| 자비스 프로젝트 (미래) | 연계 프로젝트 | 음성 입력 -> 지식 벡터화 파이프라인 | **Consumer** |

---

## 10. Growth Loops (Phase 4)

### Loop 1: 3D Graph Viral (핵심 성장 엔진)

```
사용자가 3D 지식 그래프 스크린샷/GIF 공유 (F16)
    -> "이게 뭐야?" 호기심 유발 (시각적 임팩트)
    -> GitHub 방문 -> README의 인터랙티브 데모
    -> 설치 -> 자신의 그래프 생성
    -> 자신의 그래프도 공유
    -> (반복)
```

### Loop 2: MCP Ecosystem Network Effect

```
MCP 서버 표준 구현 공개 (14 tools)
    -> Claude Code/Cursor/Windsurf에서 연동
    -> 다른 AI 도구 사용자 유입
    -> 커뮤니티가 새 Collector 플러그인 기여
    -> 더 많은 데이터 소스 지원
    -> (반복)
```

### Loop 3: Knowledge Intelligence Stickiness

```
감쇠 알림으로 오래된 노트 재방문 (F09)
    -> "아 이런 것도 있었지" 경험
    -> 지식 관리 습관 형성
    -> 더 많은 노트 작성/연결
    -> 그래프 풍부화 -> 인텔리전스 가치 증가
    -> (반복)
```

---

## 11. Implementation Roadmap Summary

```
Phase 4a: Open Source Launch + Viral Engine (4주)
|-- [P0] F16: Graph Screenshot/Embed
|-- [P0] F07+: Constellation View Enhancement
|-- [P0] README + Docs + npm publish
|
Phase 4b: Knowledge Intelligence (6주)
|-- [P0] F09: FSRS Knowledge Decay Model
|-- [P1] F06: Knowledge Heatmap
|-- [P1] F01: Knowledge Gap Detector
|-- [P1] F11: Adaptive Memory Priority
|
Phase 4c: Knowledge Depth (4주)
|-- [P1] F02: Knowledge Evolution Timeline
|-- [P1] F15: Code-Knowledge Linker
|-- [P2] F05: Semantic Clustering Upgrade
|
Phase 5: Multi-source & Community (이후)
|-- F12: Cross-Vault Federation
|-- F22: Multi-Agent Knowledge Routing
|-- F21: MCP Streamable HTTP
|-- F18: Community Knowledge Templates
|
Phase 5+: Advanced Intelligence (커뮤니티 주도)
|-- F03: Contradiction Detector
|-- F08: Knowledge River Flow
|-- F23: Agentic Knowledge Graph
|-- F19: Encrypted Vault Sync
```

---

## 12. Competitive Battlecards (Phase 4 기준)

### vs. Obsidian MCP 서버들 (cyanheads/obsidian-mcp-server 등)

| 질문 | 응답 |
|------|------|
| "이미 Obsidian MCP 서버가 있는데?" | 범용 MCP 서버는 파일 CRUD + 기본 검색. 우리는 BM25+Cosine+RRF 하이브리드 검색, 3D 시각화, 지식 감쇠/갭 탐지 등 인텔리전스 기능을 제공 |
| "그쪽이 Obsidian Local REST API 연동이라 편한데?" | 우리는 직접 .md 파일을 인덱싱하여 Obsidian 실행 없이도 작동. MCP 14 tools로 더 풍부한 지식 활용 |

### vs. Vestige (FSRS 메모리)

| 질문 | 응답 |
|------|------|
| "Vestige도 FSRS + 3D인데?" | Vestige는 AI 에이전트의 세션 메모리(대화 기록). 우리는 개인 지식 전체(노트, 문서, 코드). 상호 보완적 -- 둘 다 쓸 수 있음 |
| "Vestige 뉴럴 대시보드가 더 예쁜데?" | 우리 3D는 실제 지식 관계를 반영한 그래프. 히트맵/별자리/진화 타임라인으로 더 깊은 인사이트 제공 |

### vs. Khoj (2026 업데이트)

| 질문 | 응답 |
|------|------|
| "Khoj도 에이전트 자동화 추가됐는데?" | Khoj는 검색+채팅+자동화. 우리는 검색+인텔리전스(감쇠/갭/진화)+시각화. 지식을 "이해"하는 도구 vs "찾는" 도구 |
| "Khoj가 더 많은 소스를 지원하는데?" | 소스 수보다 검색 품질과 인텔리전스가 중요. RRF 하이브리드 + FSRS 감쇠 가중치는 독자 기능 |

---

## Attribution

이 PRD는 기존 PM Agent Team 분석 결과를 기반으로 Phase 4+ 확장을 위해 업데이트되었습니다.

**기존 분석 문서**:
- `docs/00-pm/evan-knowledge-hub.prd.md` -- 원본 PRD (2026-03-30)
- `docs/00-pm/evan-knowledge-hub-features.md` -- Feature Discovery 20개 (2026-03-30)

**분석 프레임워크**:
- Discovery: Teresa Torres의 Opportunity Solution Tree
- Strategy: Ash Maurya의 Lean Canvas + JTBD
- Research: Persona Design + Competitive Analysis + TAM/SAM/SOM
- GTM: Geoffrey Moore의 Crossing the Chasm (Beachhead + Bowling Alley)
- PRD: Pawel Huryn의 PM Skills framework (MIT License)

**시장 데이터 출처 (2026-03-30 기준)**:
- MCP Ecosystem: 17,000+ servers (2026-01), Knowledge & Memory 카테고리 283개
- Knowledge Graph Visualization Tool Market: 급성장 추세
- AI-Driven KM Market: $11.24B (2026), CAGR 46.7%
- Obsidian MCP: cyanheads/obsidian-mcp-server 등 신규 경쟁

---

*Generated by PM Lead Agent | evan-knowledge-hub Phase 4+ | 2026-03-30*
