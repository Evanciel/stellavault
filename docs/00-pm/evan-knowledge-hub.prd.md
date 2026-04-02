# Evan Knowledge Hub - Product Requirements Document

> **PM Agent Team 분석 결과** | 생성일: 2026-03-30
>
> 포함 분석: Discovery (OST) | Strategy (VP + Lean Canvas + SWOT) | Research (Personas + Competitors + TAM/SAM/SOM) | PRD Synthesis (ICP + Beachhead + GTM + User Stories)

---

## Executive Summary

| 관점 | 내용 |
|------|------|
| **Problem** | 개발자와 지식 근로자의 개인 지식이 Notion, Obsidian, 웹 등에 파편화되어 있으며, AI 코딩 에이전트가 사용자의 도메인 지식에 접근할 수 없어 매번 컨텍스트를 반복 설명해야 한다 |
| **Solution** | Obsidian을 Single Source of Truth로 삼아 다중 소스 지식을 수집, 벡터화하고, 3D 지식 그래프로 시각화하며, MCP를 통해 AI 코딩 에이전트(Claude Code, Cursor)가 개인 지식을 직접 활용할 수 있는 로컬-퍼스트 플랫폼 |
| **핵심 기능/UX** | (1) 3D 지식 그래프 -- 누구나 직관적으로 지식 구조를 탐색 (2) MCP 서버 -- AI 에이전트가 "내 프로젝트 이력에서 관련 문서 찾아줘" 같은 컨텍스트 질의 가능 (3) 하이브리드 검색 -- 의미 + 키워드 RRF 검색으로 정확한 지식 검색 |
| **핵심 가치** | "내 지식을 보고, 탐색하고, AI가 활용하는 플랫폼" -- 시각화는 대중의 문(접근성), MCP 통합은 파워 유저의 핵심 가치(생산성) |

---

## 1. Discovery Analysis (Opportunity Solution Tree)

### 1.1 Desired Outcome (목표 성과)

**"개인 지식의 AI 활용성을 극대화하여 개발자의 생산성과 의사결정 품질을 높인다"**

### 1.2 Step 1: Opportunity Brainstorm

사용자 인터뷰 및 시장 조사에서 도출된 기회 영역:

| # | Opportunity | 근거 |
|---|-------------|------|
| O1 | AI 코딩 에이전트에 개인 지식 컨텍스트 제공 | Claude Code, Cursor 등이 사용자 도메인 지식 없이 작업하여 반복 설명 비용 발생 |
| O2 | 파편화된 지식 통합 및 단일 진실 원천(SSOT) 구축 | Notion + Obsidian + 웹 + 메모 등 분산된 지식이 검색/활용 불가 |
| O3 | 지식 관계의 직관적 시각화 | 기존 도구는 텍스트 목록이나 2D 그래프로 제한, 비개발자 접근성 낮음 |
| O4 | 하이브리드 AI 검색으로 정확한 지식 검색 | 키워드만으로는 의미적 연관 문서를 놓침, 벡터 검색만으로는 정확도 부족 |
| O5 | 로컬-퍼스트 데이터 주권 보장 | 클라우드 기반 도구(Mem.ai, NotebookLM)는 데이터 유출 우려, 기업 도입 장벽 |
| O6 | AI 모델 비종속성 | 특정 모델에 락인되면 비용/성능 최적화 불가 |
| O7 | 팀 지식 공유 및 조직 학습 | 개인 지식을 팀으로 확장하면 가치 증폭 |

### 1.3 Step 2: Assumption Mapping

각 기회에 대한 핵심 가정과 위험도:

| 가정 | 영향도 (1-5) | 불확실성 (1-5) | 우선순위 점수 |
|------|:---:|:---:|:---:|
| A1: 개발자들이 MCP를 통해 AI에 개인 지식을 연결하려는 수요가 있다 | 5 | 3 | **15** |
| A2: 3D 시각화가 비개발자의 PKM 도구 채택 장벽을 낮춘다 | 4 | 4 | **16** |
| A3: 로컬-퍼스트 벡터 DB가 클라우드 솔루션 대비 충분한 성능을 제공한다 | 5 | 3 | **15** |
| A4: Obsidian 사용자가 notion-obsidian-sync를 통해 유입될 수 있다 | 3 | 3 | **9** |
| A5: 하이브리드 검색(RRF)이 단순 벡터 검색 대비 체감 품질 차이가 있다 | 4 | 2 | **8** |
| A6: 무료 오픈소스 모델로 상용 수준 임베딩 품질 달성 가능 | 4 | 3 | **12** |

### 1.4 Step 3: Prioritized Assumptions

**최우선 검증 대상** (점수 >= 12):

1. **A2 (16점)**: 3D 시각화 = 접근성 향상 가설 -- 가장 불확실하고 영향 큼
2. **A1 (15점)**: MCP + 개인 지식 = 개발자 수요 가설
3. **A3 (15점)**: 로컬 벡터 DB 성능 가설
4. **A6 (12점)**: 오픈소스 임베딩 품질 가설

### 1.5 Step 4: Experiment Design

| 가정 | 실험 | 성공 기준 | 비용/기간 |
|------|------|-----------|-----------|
| A2 | 3D 그래프 프로토타입(Three.js)으로 비개발자 10명 사용성 테스트 | 80%가 "관계를 이해할 수 있다"고 응답 | 2주 |
| A1 | Obsidian vault를 MCP 서버로 노출하는 MVP → Claude Code에서 테스트 | 5명의 개발자 중 4명이 "유용하다" 평가 | 1주 |
| A3 | SQLite-vec vs ChromaDB 벤치마크 (1만 문서, 로컬) | p95 검색 < 200ms, 메모리 < 500MB | 3일 |
| A6 | nomic-embed-text vs OpenAI ada-002 품질 비교 | NDCG@10 차이 < 5% | 2일 |

### 1.6 Step 5: Opportunity Solution Tree (OST)

```
[Goal] 개인 지식의 AI 활용성 극대화
├── [Opportunity] O1: AI 코딩 에이전트에 개인 지식 컨텍스트 제공
│   ├── [Solution] S1a: MCP 서버 (tools: search, get-document, list-topics)
│   ├── [Solution] S1b: Claude Code CLAUDE.md 자동 생성 (지식 요약)
│   └── [Experiment] E1: MVP MCP 서버 → Claude Code 테스트
│
├── [Opportunity] O2: 파편화된 지식 통합 (SSOT)
│   ├── [Solution] S2a: Multi-source 수집기 (Notion, Web Clipper, Memos)
│   ├── [Solution] S2b: notion-obsidian-sync 확장 (기존 인프라 활용)
│   └── [Experiment] E2: 기존 sync 도구 + 웹 클리핑 추가 테스트
│
├── [Opportunity] O3: 지식 관계의 직관적 3D 시각화
│   ├── [Solution] S3a: Three.js/React Three Fiber 기반 3D 그래프
│   ├── [Solution] S3b: Force-directed layout + 클러스터링
│   └── [Experiment] E3: 프로토타입 사용성 테스트 (비개발자)
│
├── [Opportunity] O4: 하이브리드 AI 검색
│   ├── [Solution] S4a: RRF (Reciprocal Rank Fusion) 하이브리드 검색
│   ├── [Solution] S4b: 메타데이터 필터링 + 시맨틱 검색 결합
│   └── [Experiment] E4: RRF vs 단순 벡터 검색 A/B 비교
│
└── [Opportunity] O5: 로컬-퍼스트 데이터 주권
    ├── [Solution] S5a: SQLite-vec (단일 파일 벡터 DB)
    ├── [Solution] S5b: ChromaDB (로컬 모드)
    └── [Experiment] E5: 로컬 DB 성능 벤치마크
```

---

## 2. Strategy Analysis

### 2.1 Value Proposition (JTBD 6-Part Framework)

#### Jobs-to-be-Done Statement

> **When** 나는 AI 코딩 에이전트(Claude Code, Cursor)로 작업하고 있을 때,
> **I want to** 내가 축적한 프로젝트 이력, 설계 문서, 기술 노트를 AI가 자동으로 참조하게 하고 싶다,
> **So that** 매번 컨텍스트를 반복 설명하지 않고 바로 고품질 결과를 얻을 수 있다.

#### 6-Part Value Proposition

| Part | 내용 |
|------|------|
| **1. Customer** | AI 코딩 도구를 사용하는 개발자 + 지식 집약적 업무를 하는 전문직 |
| **2. Problem** | 개인 지식이 파편화되어 AI가 활용할 수 없고, 매번 컨텍스트 재입력 필요 |
| **3. Promise** | "내 지식을 보고, 탐색하고, AI가 활용하는" 로컬-퍼스트 플랫폼 |
| **4. Proof** | (MVP 후) MCP 연동 시 AI 응답 품질 X% 향상, 컨텍스트 설명 시간 Y% 감소 |
| **5. Product** | Obsidian SSOT + 벡터 DB + 3D 시각화 + MCP 서버 |
| **6. Price** | Core: 무료 오픈소스 / Pro: 클라우드 동기화 + 팀 기능 (월 $10-15) |

### 2.2 Lean Canvas

| 섹션 | 내용 |
|------|------|
| **1. Problem** | (1) AI 코딩 에이전트가 사용자 도메인 지식에 접근 불가 (2) 개인 지식이 여러 도구에 분산 (3) 지식 관계가 보이지 않아 활용도 낮음 |
| **2. Customer Segment** | Primary: AI 코딩 도구 사용 개발자 (Claude Code, Cursor, Copilot) / Secondary: 지식 관리에 관심 있는 리서처, 콘텐츠 크리에이터 |
| **3. Unique Value Proposition** | "내 지식을 AI 코딩 에이전트가 아는 것" -- MCP 통합으로 AI가 내 지식 기반으로 작업, 3D 그래프로 누구나 지식 탐색 |
| **4. Solution** | (1) MCP 서버: AI 에이전트가 개인 지식 검색/참조 (2) 3D Knowledge Graph: 직관적 시각화 (3) 하이브리드 검색: RRF 기반 시맨틱+키워드 |
| **5. Channels** | GitHub 오픈소스 / Obsidian 커뮤니티 / AI 개발자 커뮤니티 (Discord, X) / 유튜브 데모 |
| **6. Revenue Streams** | Freemium: Core 무료 (로컬) → Pro 유료 (클라우드 동기화, 팀 공유, 프리미엄 임베딩) |
| **7. Cost Structure** | 개발 인건비(초기 1인) / 호스팅(클라우드 옵션 시) / AI API 비용(임베딩) |
| **8. Key Metrics** | (1) MCP 일일 활성 쿼리 수 (2) 3D 그래프 세션 시간 (3) 문서 벡터화율 (4) 검색 정확도(NDCG) |
| **9. Unfair Advantage** | (1) notion-obsidian-sync 기존 사용자 기반 (2) MCP + 개인 지식 결합은 아직 블루오션 (3) 로컬-퍼스트 = 데이터 주권으로 기업 도입 용이 |

### 2.3 SWOT Analysis

| | 긍정적 | 부정적 |
|---|--------|--------|
| **내부** | **Strengths** | **Weaknesses** |
| | - notion-obsidian-sync 기존 인프라 (검증됨) | - 1인 개발 리소스 제한 |
| | - MCP 프로토콜 깊은 이해 (Claude Code 사용 경험) | - 3D 시각화 개발 경험 부족 |
| | - Langent 분석 결과 활용 가능 (RRF 하이브리드 검색) | - 마케팅/커뮤니티 빌딩 역량 미확인 |
| | - 로컬-퍼스트 아키텍처 (데이터 주권) | - 크로스 플랫폼 테스트 부담 |
| **외부** | **Opportunities** | **Threats** |
| | - MCP 생태계 급성장 (1000+ 서버, Google/MS 참여) | - Obsidian 공식 AI 기능 출시 가능성 |
| | - AI 코딩 도구 폭발적 성장 (Claude Code, Cursor) | - 대기업(Google NotebookLM) 기능 확장 |
| | - PKM 시장 연 46.7% 성장 ($11.24B, 2026) | - Khoj, Smart Connections 등 오픈소스 경쟁 심화 |
| | - 3D 시각화로 비개발자 시장 진입 가능 | - 임베딩 모델 변경 시 전체 재색인 비용 |

#### SO 전략 (강점 x 기회)
- MCP 프로토콜 이해 + MCP 생태계 성장 = **MCP 개인 지식 서버 선점** (First Mover)
- 기존 sync 인프라 + PKM 시장 성장 = **Obsidian 사용자 기반 빠른 확보**

#### WT 전략 (약점 x 위협)
- 1인 개발 + 대기업 경쟁 = **오픈소스 커뮤니티 레버리지** (컨트리뷰터 유치)
- 3D 경험 부족 + Obsidian 공식 AI = **3D를 차별화 핵심으로, AI 검색은 모듈형으로**

### 2.4 Blue Ocean Strategy (전략 캔버스)

| 가치 요소 | 경쟁자 평균 | Evan Knowledge Hub | 전략 |
|-----------|:-----------:|:------------------:|------|
| AI 검색 정확도 | 높음 | 높음 | **Match** (하이브리드 RRF) |
| 클라우드 동기화 | 높음 | 낮음 (로컬 우선) | **Eliminate** (초기에는 로컬만) |
| 노트 작성 기능 | 높음 | 없음 | **Eliminate** (Obsidian이 담당) |
| MCP AI 에이전트 통합 | 없음~낮음 | **매우 높음** | **Create** (블루오션) |
| 3D 지식 시각화 | 없음~낮음 | **높음** | **Raise** (차별화) |
| 데이터 주권 (로컬) | 낮음~중간 | **매우 높음** | **Raise** |
| 가격 | 중간 ($10-15/mo) | 무료 (Core) | **Reduce** |
| 다중 소스 수집 | 중간 | 중간 | **Match** |

**핵심 전략**: 노트 작성/클라우드를 포기하고, MCP 통합과 3D 시각화를 창조/강화하는 "가치 혁신"

---

## 3. Research Analysis

### 3.1 User Personas

#### Persona 1: "Dev Minjun" (개발자 민준, 28세)

| 항목 | 내용 |
|------|------|
| **역할** | 풀스택 개발자, 스타트업 (3년차) |
| **도구** | Claude Code, Cursor, Obsidian, Notion |
| **Pain Point** | Claude Code에 매번 프로젝트 배경/설계 문서를 붙여넣어야 함. CLAUDE.md를 수동으로 관리하는 게 번거로움 |
| **Goal** | AI가 내 프로젝트 히스토리와 기술 노트를 이미 알고 있는 상태에서 작업 시작 |
| **JTBD** | "AI 코딩할 때 내 과거 결정/패턴을 AI가 참조하게 하여 일관된 코드 품질 유지" |
| **기대 행동** | MCP 서버 연결 → Claude Code에서 "이전 프로젝트의 인증 설계 참고해" → 관련 문서 자동 검색/제공 |
| **지불 의향** | 월 $10-15 (현재 Claude Pro 이미 사용 중) |

#### Persona 2: "Researcher Yuna" (연구자 유나, 35세)

| 항목 | 내용 |
|------|------|
| **역할** | UX 리서처, 대기업 |
| **도구** | Notion, Google Docs, Miro, 일부 Obsidian |
| **Pain Point** | 수백 개의 리서치 노트가 있지만 관계가 보이지 않아, 같은 인사이트를 반복 발견. "이것과 관련된 이전 리서치가 뭐였지?" |
| **Goal** | 내 리서치 자산의 전체 그림을 보고, 패턴과 갭을 발견하고 싶음 |
| **JTBD** | "새 프로젝트 시작할 때 과거 리서치에서 관련 인사이트를 빠르게 찾아 활용" |
| **기대 행동** | 3D 그래프에서 "사용자 온보딩" 클러스터 탐색 → 관련 노트 5개 발견 → AI에 요약 요청 |
| **지불 의향** | 월 $5-10 (개인 구독), 팀 라이선스면 회사 비용 처리 가능 |

#### Persona 3: "Creator Jihoon" (크리에이터 지훈, 42세)

| 항목 | 내용 |
|------|------|
| **역할** | 테크 블로거, 유튜버, 프리랜서 컨설턴트 |
| **도구** | Obsidian (헤비 유저), Notion (클라이언트 협업), 웹 클리핑 |
| **Pain Point** | 5년간 축적된 3000+개 노트에서 원하는 걸 못 찾음. 태그/폴더 정리를 포기함. "내 과거 글에서 비슷한 주제를 다뤘는데..." |
| **Goal** | 정리하지 않아도 지식이 자동으로 연결되고, 콘텐츠 제작에 활용 |
| **JTBD** | "새 글/영상 주제에 대해 내 기존 지식을 빠르게 모아서 콘텐츠 품질 높이기" |
| **기대 행동** | "AI야, 'MCP'에 대해 내가 쓴 글/노트 모두 찾아줘" → 3D 그래프에서 관련 클러스터 탐색 → 콘텐츠 아웃라인 생성 |
| **지불 의향** | 월 $15+ (업무 도구로 비용 처리) |

### 3.2 Competitor Analysis (5 Competitors)

#### 경쟁사 비교 매트릭스

| 기능/경쟁사 | **Khoj** | **Smart Connections** | **NotebookLM** | **Mem.ai** | **Think Machine** |
|---|---|---|---|---|---|
| **유형** | 오픈소스 RAG | Obsidian 플러그인 | Google 서비스 | SaaS | SaaS |
| **가격** | 무료/Self-host | 무료 (기본) | 무료 | $10-15/mo | 유료 |
| **AI 검색** | 벡터 + 키워드 | 로컬 임베딩 | 구글 AI | AI 정리/검색 | AI 브레인스토밍 |
| **데이터 소스** | Notion, Obsidian, GitHub | Obsidian only | 업로드 문서 | 자체 노트 | 자체 입력 |
| **시각화** | 없음 | 없음 (사이드바만) | 없음 | 없음 | **3D 마인드맵** |
| **MCP 통합** | 없음 | 없음 | 없음 | 없음 | 없음 |
| **로컬-퍼스트** | O (self-host) | O | X (클라우드) | X (클라우드) | X (클라우드) |
| **강점** | 다중 소스, 오픈소스 | Obsidian 네이티브 | 무료, 구글 AI | 자동 정리 | 3D 시각화 |
| **약점** | 시각화 없음, UX 미흡 | Obsidian 한정 | 데이터 주권 없음 | 데이터 락인 | PKM 통합 없음 |

#### 경쟁 포지셔닝

```
         시각화 수준
            ^
     높음   |  [Think Machine]              [Evan Knowledge Hub]
            |                                    ★ 목표 위치
            |
     중간   |
            |
     낮음   |  [Mem.ai]  [NotebookLM]  [Khoj]  [Smart Connections]
            |
            +---------------------------------------------------->
           낮음                AI 에이전트 통합 수준              높음
```

**핵심 인사이트**: 시각화 높음 + AI 에이전트 통합 높음 영역은 비어 있다 (블루오션).

#### 개별 경쟁사 상세 분석

**1. Khoj (가장 가까운 경쟁자)**
- 강점: Notion/Obsidian/GitHub 등 다중 소스 지원, 오픈소스, self-hosted
- 약점: 3D 시각화 없음, MCP 미지원, 설치/설정 복잡
- Evan KH 차별점: MCP 네이티브 통합, 3D 시각화, 더 쉬운 설치 (Obsidian SSOT)

**2. Smart Connections (Obsidian 생태계 내 경쟁)**
- 강점: Obsidian 네이티브, 로컬 임베딩, 무료
- 약점: Obsidian 안에서만 작동, 외부 AI 도구와 연결 불가
- Evan KH 차별점: MCP로 외부 AI 도구 연결, 3D 시각화, 다중 소스

**3. NotebookLM (Google의 위협)**
- 강점: 무료, 강력한 구글 AI, 슬라이드/DB 변환 (2026 업데이트)
- 약점: 클라우드 전용 (데이터 주권 없음), 기존 PKM 연동 없음, MCP 미지원
- Evan KH 차별점: 로컬-퍼스트, Obsidian 생태계 통합, MCP 네이티브

**4. Mem.ai (상용 PKM)**
- 강점: 자동 정리/태깅, 깔끔한 UX, 빠른 검색
- 약점: 클라우드 전용, 데이터 락인, 외부 도구 연동 제한
- Evan KH 차별점: 오픈소스, 로컬-퍼스트, MCP 통합, 3D 시각화

**5. Think Machine (3D 시각화 경쟁)**
- 강점: 우수한 3D 마인드맵, AI 브레인스토밍, Wayfinder AI
- 약점: PKM 도구와 직접 통합 없음, MCP 미지원, 자체 입력만
- Evan KH 차별점: Obsidian/Notion 직접 연동, MCP 코딩 에이전트 통합, 로컬-퍼스트

### 3.3 Market Sizing (TAM/SAM/SOM)

#### 듀얼 메서드 추정

**Method 1: Top-Down**

| 레벨 | 시장 규모 | 산출 근거 |
|------|-----------|-----------|
| **TAM** | $11.24B (2026) | AI-Driven Knowledge Management System 전체 시장 (CAGR 46.7%) |
| **SAM** | $560M | PKM + AI 통합 세그먼트 (TAM의 ~5%: 개인/소규모 팀, 개발자 중심) |
| **SOM** | $2.8M (Year 3) | SAM의 0.5%: Obsidian 커뮤니티 + AI 코딩 도구 사용자 중 얼리 어답터 |

**Method 2: Bottom-Up**

| 레벨 | 산출 | 근거 |
|------|------|------|
| **TAM** | 전 세계 개발자 2,870만 + 지식 근로자 ~10억 명 | 잠재적 PKM+AI 수요 |
| **SAM** | Obsidian 사용자 ~200만 + AI 코딩 도구 사용자 ~500만 = ~700만 명 | 직접 접근 가능 사용자 |
| **SOM** | 5,000명 (Year 1) → 20,000명 (Year 3) x $120/yr avg = **$2.4M ARR** | Obsidian 커뮤니티 내 얼리 어답터 (0.25-1%) |

#### 시장 성장 전망

```
2026: $11.24B ──→ 2030: $51.36B (CAGR 46.7%)

Evan KH 타겟 궤적:
Year 1: 5,000 users (무료 중심, MCP MVP)     → ~$120K ARR
Year 2: 15,000 users (Pro 전환 10%)          → ~$900K ARR
Year 3: 50,000 users (3D 시각화 + 팀 기능)  → ~$2.4M ARR
```

### 3.4 Customer Journey Map (Primary Persona: Dev Minjun)

```
[인식] ──→ [평가] ──→ [도입] ──→ [활용] ──→ [확장] ──→ [옹호]

인식 단계:
  터치포인트: GitHub trending, 개발자 커뮤니티, X/Twitter
  행동: "내 노트를 AI가 읽을 수 있으면 좋겠다" → 검색
  감정: 호기심, 약간의 회의감
  Pain: MCP 서버 직접 만들기는 너무 번거로움

평가 단계:
  터치포인트: GitHub README, 데모 영상, 3D 그래프 스크린샷
  행동: 경쟁 도구 비교, MCP 통합 여부 확인
  감정: "이거 Khoj보다 낫나?" → 3D 시각화에 호기심
  Pain: 설치가 복잡하면 포기

도입 단계:
  터치포인트: npm install, CLI 설정, Obsidian vault 연결
  행동: 첫 벡터화 실행, MCP 서버 시작
  감정: "오 진짜 작동한다!" (Aha Moment)
  Critical: 5분 내 첫 MCP 쿼리 성공 필수

활용 단계:
  터치포인트: Claude Code에서 MCP 쿼리, 3D 그래프 탐색
  행동: 일상 코딩 워크플로우에 통합
  감정: "이제 AI가 내 맥락을 안다" (핵심 가치 체감)
  Metric: 일일 MCP 쿼리 수 > 5

확장 단계:
  터치포인트: Pro 전환, 팀원 초대
  행동: 더 많은 소스 연결, 팀 지식 베이스 구축
  감정: "팀 전체가 쓰면 더 강력하겠다"
  Metric: 팀 내 2인 이상 사용

옹호 단계:
  터치포인트: 블로그 포스트, 컨퍼런스 발표, GitHub star
  행동: 커뮤니티에 경험 공유, 컨트리뷰션
  감정: "이건 다른 사람도 알아야 해"
  Metric: NPS > 50
```

---

## 4. ICP (Ideal Customer Profile) & Beachhead Segment

### 4.1 ICP 정의

| 속성 | 내용 |
|------|------|
| **인구통계** | 25-40세, 소프트웨어 개발자/엔지니어 |
| **행동 특성** | AI 코딩 도구(Claude Code, Cursor) 일상 사용, Obsidian 또는 Notion으로 노트 관리 |
| **기술 수준** | CLI 친숙, MCP 개념 이해 가능, 로컬 도구 설치/관리 가능 |
| **Pain 강도** | 높음 -- AI에게 매번 컨텍스트 반복 설명에 좌절 |
| **지불 의향** | 월 $10-15 (이미 AI 도구에 지출 중) |
| **접근 채널** | GitHub, 개발자 Discord/Slack, X/Twitter, 기술 블로그 |

### 4.2 Beachhead Segment (Geoffrey Moore 4-Criteria Scoring)

| 후보 세그먼트 | 접근성 (1-5) | Pain 강도 (1-5) | 확산력 (1-5) | 수익 가능성 (1-5) | **총점** |
|---|:---:|:---:|:---:|:---:|:---:|
| **A. Claude Code 헤비 유저 (Obsidian)** | 5 | 5 | 4 | 4 | **18** |
| B. Cursor 사용자 (일반) | 4 | 4 | 4 | 4 | 16 |
| C. UX 리서처 (Notion 헤비) | 3 | 3 | 3 | 3 | 12 |
| D. 테크 블로거/크리에이터 | 4 | 3 | 5 | 3 | 15 |
| E. 기업 개발팀 | 2 | 4 | 3 | 5 | 14 |

**선정된 Beachhead: "A. Claude Code 헤비 유저 (Obsidian 사용자)"**

**선정 근거**:
- **접근성 (5)**: notion-obsidian-sync 기존 사용자 + Claude Code 커뮤니티에 직접 접근 가능
- **Pain 강도 (5)**: CLAUDE.md 수동 관리의 한계를 매일 체감, MCP로 해결 가능한 명확한 Pain
- **확산력 (4)**: 개발자 커뮤니티 특성상 도구 추천/공유 활발 (GitHub star, 블로그)
- **수익 가능성 (4)**: 이미 Claude Pro ($20/mo) 지불 중, 추가 $10-15 지불 장벽 낮음

### 4.3 Beachhead 확장 경로 (Bowling Alley)

```
[Beachhead] Claude Code + Obsidian 유저
    ↓
[Pin 2] Cursor + VS Code 유저 (MCP 지원 확대)
    ↓
[Pin 3] 테크 블로거/크리에이터 (3D 시각화 매력)
    ↓
[Pin 4] UX 리서처/PM (3D 그래프 + AI 검색)
    ↓
[Pin 5] 기업 개발팀 (팀 지식 베이스, 엔터프라이즈)
    ↓
[Tornado] AI 에이전트 표준 지식 인터페이스
```

---

## 5. GTM (Go-To-Market) Strategy

### 5.1 Launch Strategy

**Phase 0: Pre-launch (4주)**
- GitHub 레포 공개 (README + 아키텍처 다이어그램)
- "Building in Public" X/Twitter 스레드 시작
- Obsidian 커뮤니티 포럼에 RFC 게시

**Phase 1: MVP Launch (Week 1-2)**
- MCP 서버 + CLI 인덱서 → "5분 안에 Claude Code에서 내 노트 검색"
- Product Hunt launch
- Hacker News "Show HN" 게시

**Phase 2: Visualization Launch (Week 4-6)**
- 3D Knowledge Graph 웹 UI 공개
- 데모 영상 (유튜브, X)
- 개발자 컨퍼런스 라이트닝 토크

**Phase 3: Pro Launch (Month 3)**
- 클라우드 동기화 + 프리미엄 임베딩
- 팀 공유 기능 베타

### 5.2 채널 전략

| 채널 | 목표 | KPI |
|------|------|-----|
| **GitHub** | 인식 + 신뢰 | Stars, Forks, Contributors |
| **Obsidian Community** | Beachhead 도입 | 플러그인 다운로드 |
| **X/Twitter** | 인식 + 바이럴 | 임프레션, 리트윗 |
| **YouTube** | 시연 + 교육 | 조회수, 구독 전환 |
| **Dev Discord/Slack** | 커뮤니티 + 피드백 | 활성 멤버, 질문/답변 |
| **블로그/DEV.to** | SEO + 깊은 설명 | 유기적 트래픽 |

### 5.3 가격 전략

| 티어 | 가격 | 포함 기능 |
|------|------|-----------|
| **Core (무료)** | $0 | 로컬 벡터화, MCP 서버, 3D 시각화 (노트 1000개까지), CLI |
| **Pro** | $10/mo | 무제한 노트, 프리미엄 임베딩 모델, 클라우드 백업, 우선 지원 |
| **Team** | $15/mo/user | Pro + 팀 지식 공유, 접근 제어, 관리자 대시보드 |

### 5.4 핵심 메트릭

| 메트릭 | 목표 (Year 1) | 측정 방법 |
|--------|----------------|-----------|
| GitHub Stars | 2,000+ | GitHub API |
| 월간 활성 사용자 (MAU) | 5,000 | 텔레메트리 (opt-in) |
| MCP 일일 쿼리 | 25,000+ (5 queries/user/day) | MCP 서버 로그 |
| Pro 전환율 | 5-10% | Stripe |
| NPS | 50+ | 분기별 설문 |
| 3D 그래프 평균 세션 시간 | > 3분 | 클라이언트 로그 |

---

## 6. Competitive Battlecards

### vs. Khoj

| 질문 | 응답 |
|------|------|
| "Khoj도 오픈소스이고 Obsidian 지원하는데?" | Khoj는 채팅 중심, 우리는 MCP 통합으로 AI 코딩 에이전트가 직접 지식을 활용. 3D 시각화로 지식 구조를 직관적으로 탐색 가능 |
| "Khoj는 self-hosted인데 뭐가 다른가?" | 설치가 더 간단하고 (npm install), Obsidian을 SSOT로 삼아 데이터 중복 없음. MCP 표준 프로토콜로 모든 AI 도구와 연동 |

### vs. NotebookLM

| 질문 | 응답 |
|------|------|
| "Google NotebookLM은 무료인데?" | NotebookLM은 문서를 업로드해야 하고 구글 서버에 저장됨. 우리는 로컬 파일 그대로 사용, 데이터가 내 컴퓨터를 떠나지 않음 |
| "NotebookLM AI가 더 강력하지 않나?" | 검색 품질은 유사하지만, NotebookLM은 코딩 AI와 연동 불가. MCP로 Claude Code에서 직접 지식 활용이 핵심 차별점 |

### vs. Smart Connections

| 질문 | 응답 |
|------|------|
| "이미 Smart Connections 쓰고 있는데?" | Smart Connections는 Obsidian 안에서만 작동. 우리 MCP 서버로 Claude Code, Cursor 등 외부 AI에서도 지식 검색 가능 |
| "Smart Connections도 로컬 임베딩인데?" | 맞지만 검색이 Obsidian UI에 한정됨. 우리는 하이브리드 RRF 검색 + 3D 시각화 + MCP API로 확장성이 다름 |

---

## 7. PRD: Product Requirements

### 7.1 Product Vision

**"내 지식을 보고, 탐색하고, AI가 활용하는 로컬-퍼스트 지식 플랫폼"**

시각화는 누구나 들어오는 대중의 문이고, MCP 통합은 개발자가 머무는 핵심 가치다.

### 7.2 Goals & Success Criteria

| # | 목표 | 성공 기준 | 측정 방법 |
|---|------|-----------|-----------|
| G1 | MCP 통한 AI 에이전트 지식 접근 | Claude Code에서 MCP 쿼리 성공률 > 95% | MCP 서버 로그 |
| G2 | 하이브리드 검색 품질 | NDCG@10 > 0.7 (RRF 하이브리드) | 테스트 쿼리 세트 |
| G3 | 3D 시각화 사용성 | 비개발자 80%가 "관계를 이해할 수 있다" 응답 | 사용성 테스트 |
| G4 | 설치 편의성 | 첫 MCP 쿼리까지 5분 이내 | 신규 사용자 타이머 |
| G5 | 성능 | 1만 문서 기준 검색 p95 < 200ms | 벤치마크 |

### 7.3 Scope & Phasing

#### Phase 1: Foundation (MVP) -- 4-6주

| 기능 | 설명 | 우선순위 |
|------|------|:--------:|
| **F1: Obsidian Indexer** | .md 파일 스캔, 청킹, 임베딩 생성, 로컬 벡터 DB 저장 | P0 |
| **F2: MCP Server** | tools: search, get-document, list-topics, get-related | P0 |
| **F3: Hybrid Search** | RRF (Reciprocal Rank Fusion) = 시맨틱 + 키워드 | P0 |
| **F4: CLI** | `ekh index`, `ekh search`, `ekh serve` 명령어 | P0 |

#### Phase 2: Visualization -- 4주

| 기능 | 설명 | 우선순위 |
|------|------|:--------:|
| **F5: 3D Knowledge Graph** | Three.js/R3F 기반, force-directed layout | P1 |
| **F6: Graph Interaction** | 클릭 → 문서 미리보기, 줌/팬, 클러스터 필터 | P1 |
| **F7: Search Integration** | 그래프 내 검색 → 관련 노드 하이라이트 | P1 |
| **F8: Web UI** | Electron 또는 로컬 웹 서버 기반 대시보드 | P1 |

#### Phase 3: Multi-source & Pro -- 6주

| 기능 | 설명 | 우선순위 |
|------|------|:--------:|
| **F9: Notion Collector** | notion-obsidian-sync 연동, 자동 수집 | P2 |
| **F10: Web Clipper** | 브라우저 확장 → Obsidian → 자동 벡터화 | P2 |
| **F11: Pro Features** | 클라우드 백업, 프리미엄 임베딩, 팀 공유 | P2 |
| **F12: Auto-Index** | 파일 변경 감지(watchman/chokidar) → 자동 재색인 | P2 |

### 7.4 Technical Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Evan Knowledge Hub                           │
│                                                                 │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐      │
│  │  Collectors   │    │   Indexer     │    │  Vector DB    │      │
│  │              │    │              │    │              │      │
│  │ Notion Sync  │───→│ Chunker      │───→│ SQLite-vec   │      │
│  │ Web Clipper  │    │ Embedder     │    │ (local file) │      │
│  │ File Watcher │    │ Metadata     │    │              │      │
│  └──────────────┘    └──────────────┘    └──────┬───────┘      │
│                                                  │              │
│  ┌──────────────┐    ┌──────────────┐           │              │
│  │  3D Graph UI  │    │  MCP Server   │───────────┘              │
│  │              │    │              │                           │
│  │ Three.js/R3F │    │ search       │                           │
│  │ Force Layout │    │ get-document │                           │
│  │ Clustering   │    │ list-topics  │                           │
│  │ Web UI       │    │ get-related  │                           │
│  └──────────────┘    └──────────────┘                           │
│                                                                 │
│  ┌──────────────┐    ┌──────────────┐                           │
│  │  Search Engine│    │  CLI          │                           │
│  │              │    │              │                           │
│  │ Semantic     │    │ ekh index    │                           │
│  │ Keyword (BM25)│    │ ekh search   │                           │
│  │ RRF Fusion   │    │ ekh serve    │                           │
│  └──────────────┘    │ ekh graph    │                           │
│                      └──────────────┘                           │
└─────────────────────────────────────────────────────────────────┘
```

**기술 스택 (권장)**:
- Runtime: Node.js (ESM) -- 기존 notion-sync 인프라 호환
- Vector DB: SQLite-vec (단일 파일, 설치 간편) 또는 ChromaDB
- Embeddings: nomic-embed-text (로컬, 무료) / OpenAI ada-002 (Pro)
- MCP: @modelcontextprotocol/sdk
- 3D: Three.js + React Three Fiber
- Search: BM25 (키워드) + Cosine Similarity (시맨틱) + RRF Fusion
- File Watch: chokidar
- UI: React + Vite (로컬 웹 서버)

### 7.5 Non-Functional Requirements

| 항목 | 요구사항 |
|------|----------|
| **성능** | 1만 문서 기준: 인덱싱 < 10분, 검색 p95 < 200ms, 3D 렌더링 60fps |
| **보안** | 모든 데이터 로컬 저장, 네트워크 요청은 임베딩 API만 (opt-in), Pro 동기화는 E2E 암호화 |
| **호환성** | Windows 10+, macOS 12+, Linux (Ubuntu 20.04+) |
| **확장성** | 플러그인 아키텍처: Collector/Embedder/Visualizer 각각 교체 가능 |
| **접근성** | 3D 그래프: 키보드 내비게이션, 2D 폴백 모드 |

### 7.6 User Stories

#### Epic 1: Knowledge Indexing

| ID | Story | 수용 기준 | INVEST |
|----|-------|-----------|--------|
| US-1.1 | 개발자로서, 내 Obsidian vault를 벡터화하고 싶다, AI 검색을 위해 | `ekh index ./vault` 실행 시 모든 .md 파일이 청킹 + 임베딩 + 저장됨 | I,N,V,E,S,T |
| US-1.2 | 사용자로서, 파일 변경 시 자동 재색인되길 원한다, 수동 실행 없이 | file watcher가 변경 감지 후 30초 내 해당 파일만 재색인 | I,N,V,E,S,T |
| US-1.3 | 사용자로서, 인덱싱 진행률을 보고 싶다, 완료 시점을 알기 위해 | CLI에 프로그레스 바 + 완료 시 요약 (N files, M chunks, T seconds) | I,N,V,E,S,T |

#### Epic 2: MCP Integration

| ID | Story | 수용 기준 | INVEST |
|----|-------|-----------|--------|
| US-2.1 | 개발자로서, Claude Code에서 내 노트를 검색하고 싶다, 관련 문서를 참조하기 위해 | MCP tool `search` 호출 시 상위 5개 관련 문서 반환, 메타데이터 포함 | I,N,V,E,S,T |
| US-2.2 | 개발자로서, 특정 문서 전문을 가져오고 싶다, 상세 내용을 AI에 제공하기 위해 | MCP tool `get-document` 호출 시 파일 내용 + 프론트매터 반환 | I,N,V,E,S,T |
| US-2.3 | 개발자로서, 관련 문서를 탐색하고 싶다, 연관 지식을 함께 활용하기 위해 | MCP tool `get-related` 호출 시 의미적으로 유사한 문서 5개 반환 | I,N,V,E,S,T |

#### Epic 3: 3D Visualization

| ID | Story | 수용 기준 | INVEST |
|----|-------|-----------|--------|
| US-3.1 | 사용자로서, 내 지식을 3D 그래프로 보고 싶다, 전체 구조를 파악하기 위해 | `ekh graph` 실행 시 브라우저에 3D 그래프 렌더링, 노드 = 문서, 엣지 = 관계 | I,N,V,E,S,T |
| US-3.2 | 사용자로서, 노드를 클릭하면 문서 미리보기를 보고 싶다, 내용 확인을 위해 | 노드 클릭 시 사이드패널에 마크다운 렌더링된 내용 표시 | I,N,V,E,S,T |
| US-3.3 | 사용자로서, 특정 주제 클러스터만 필터링하고 싶다, 관심 영역에 집중하기 위해 | 클러스터 라벨 클릭 시 해당 클러스터만 표시, 나머지 fade out | I,N,V,E,S,T |

#### Epic 4: Search

| ID | Story | 수용 기준 | INVEST |
|----|-------|-----------|--------|
| US-4.1 | 사용자로서, 자연어로 지식을 검색하고 싶다, 정확한 키워드를 몰라도 찾기 위해 | 시맨틱 검색 결과 상위 10개, 관련도 점수 포함 | I,N,V,E,S,T |
| US-4.2 | 사용자로서, 키워드와 의미 검색을 결합하고 싶다, 더 정확한 결과를 위해 | RRF 하이브리드 검색 결과가 단일 방식 대비 NDCG 10%+ 개선 | I,N,V,E,S,T |

### 7.7 Test Scenarios

| ID | 시나리오 | 관련 Story | 검증 방법 |
|----|----------|------------|-----------|
| TS-1 | 1000개 .md 파일 vault 인덱싱 → 완료 시간 < 3분, 검색 가능 | US-1.1 | 자동화 벤치마크 |
| TS-2 | Claude Code에서 `@knowledge search "인증 설계"` → 관련 문서 반환 | US-2.1 | MCP 통합 테스트 |
| TS-3 | 파일 수정 후 30초 내 검색 결과에 반영 | US-1.2 | 파일 워치 E2E |
| TS-4 | 3D 그래프에서 1만 노드 렌더링 시 60fps 유지 | US-3.1 | 성능 프로파일링 |
| TS-5 | "authentication" 검색 시 "인증", "로그인", "OAuth" 노트도 결과에 포함 | US-4.1 | 시맨틱 검색 정확도 |
| TS-6 | 오프라인 환경에서 검색 및 MCP 쿼리 정상 작동 | 전체 | 네트워크 차단 테스트 |

---

## 8. Pre-mortem Analysis

### 8.1 Top 3 Risks

| # | 위험 | 영향 | 확률 | 완화 전략 |
|---|------|------|------|-----------|
| R1 | **3D 시각화 성능**: 대규모 vault(1만+ 문서)에서 3D 렌더링이 느려져 UX 저하 | 높음 | 중간 | LOD(Level of Detail) 구현, 클러스터 단위 렌더링, WebGPU 대비, 2D 폴백 모드 |
| R2 | **MCP 생태계 변화**: MCP 프로토콜 스펙 변경 또는 경쟁 프로토콜 등장 | 높음 | 낮음 | MCP 추상화 레이어, 어댑터 패턴으로 프로토콜 교체 가능하게 설계 |
| R3 | **Obsidian 공식 AI 출시**: Obsidian이 유사 기능(AI 검색, 시각화)을 공식 탑재 | 높음 | 중간 | MCP 통합(Obsidian이 안 할 영역)에 집중, 다중 소스 지원으로 차별화, Obsidian 플러그인으로도 배포 |

### 8.2 Additional Risks

| # | 위험 | 영향 | 확률 | 완화 전략 |
|---|------|------|------|-----------|
| R4 | 로컬 임베딩 모델 품질이 기대 미달 | 중간 | 낮음 | 모델 교체 가능 설계, Pro에서 클라우드 임베딩 옵션 |
| R5 | Windows 환경에서 SQLite-vec 네이티브 바인딩 문제 | 중간 | 중간 | better-sqlite3 + vec 확장, WASM 폴백 |
| R6 | 1인 개발로 기능 개발 속도 부족 | 중간 | 높음 | 모듈화 설계로 커뮤니티 컨트리뷰션 유도, 핵심(MCP)에 집중 |

---

## 9. Stakeholder Map

| 이해관계자 | 역할 | 관심사 | 참여 수준 |
|-----------|------|--------|-----------|
| 개발자 (Evan) | 프로젝트 오너, 핵심 개발자 | 기술 구현, 아키텍처 결정 | **Driver** |
| Claude Code 사용자 | 핵심 타겟 유저 | MCP 통합 품질, 검색 정확도 | **Key Stakeholder** |
| Obsidian 커뮤니티 | 얼리 어답터 풀 | 호환성, 로컬-퍼스트, 설치 편의성 | **Supporter** |
| MCP 생태계 | 프로토콜 제공자 | 스펙 준수, 모범 사례 | **Influencer** |
| Anthropic | Claude/MCP 운영사 | MCP 생태계 확장, 에이전트 활용 사례 | **Enabler** |
| 오픈소스 컨트리뷰터 | 공동 개발자 | 코드 품질, 모듈화, 문서화 | **Supporter** |

---

## 10. Growth Loops

### Loop 1: Developer Word-of-Mouth

```
개발자 A가 Claude Code + MCP로 생산성 향상 체험
    → X/Twitter에 "이거 게임 체인저" 포스트
    → 개발자 B가 설치
    → 개발자 B도 공유
    → (반복)
```

### Loop 2: Content-Led Growth

```
사용자가 3D 그래프 스크린샷 공유 (시각적으로 인상적)
    → "이게 뭐야?" 호기심 유발
    → GitHub 방문 → 설치
    → 자신의 그래프도 공유
    → (반복)
```

### Loop 3: Integration Ecosystem

```
MCP 서버 표준 구현 공개
    → 다른 AI 도구(Cursor, Windsurf)에서 연동
    → 더 많은 AI 도구 사용자 유입
    → 커뮤니티가 새 Collector 플러그인 기여
    → (반복)
```

---

## Attribution

이 PRD는 PM Agent Team의 4개 하위 분석을 통합하여 생성되었습니다.

**분석 프레임워크 출처:**
- Discovery: Teresa Torres의 Opportunity Solution Tree
- Strategy: Ash Maurya의 Lean Canvas + Alex Osterwalder의 Value Proposition Canvas + JTBD
- Research: Persona Design + Porter's Five Forces + TAM/SAM/SOM (Top-Down + Bottom-Up)
- GTM: Geoffrey Moore의 Crossing the Chasm (Beachhead + Bowling Alley)
- PRD: Pawel Huryn의 PM Skills framework (MIT License)

**시장 데이터 출처 (2026-03-30 기준):**
- AI-Driven KM Market: The Business Research Company ($11.24B, 2026)
- MCP Ecosystem: Anthropic/AAIF (1000+ servers, Linux Foundation)
- Competitor pricing: 각 서비스 공식 사이트

---

*Generated by PM Agent Team | evan-knowledge-hub | 2026-03-30*
