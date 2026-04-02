# Evan Knowledge Hub Planning Document

> **Summary**: 개인 지식을 벡터화하여 3D 시각화 + MCP로 AI 코딩 에이전트에 연결하는 로컬-퍼스트 플랫폼
>
> **Project**: evan-knowledge-hub (notion-obsidian-sync 모노레포)
> **Version**: 0.1.0
> **Author**: Evan (KHS)
> **Date**: 2026-03-30
> **Status**: Draft
> **PRD Reference**: `docs/00-pm/evan-knowledge-hub.prd.md`

---

## Executive Summary

| Perspective | Content |
|-------------|---------|
| **Problem** | AI 코딩 에이전트(Claude Code, Cursor)가 사용자의 축적된 지식(설계 문서, 교훈, 프로젝트 이력)에 접근할 수 없어 매번 컨텍스트를 반복 설명해야 하고, 지식이 Notion/Obsidian/웹에 파편화되어 검색·활용이 불가능하다 |
| **Solution** | Obsidian을 Single Source of Truth로 삼아 .md 파일을 벡터화(로컬 nomic-embed-text + SQLite-vec)하고, MCP 서버로 AI 에이전트에 개인 지식을 노출하며, 3D Knowledge Graph(Three.js/R3F)로 누구나 직관적으로 탐색할 수 있는 로컬-퍼스트 플랫폼 |
| **Function/UX Effect** | (1) CLI `ekh index/search/serve/graph` 4개 명령으로 즉시 사용 (2) 3D 그래프에서 노드 클릭으로 문서 탐색 (3) Claude Code에서 "내 과거 설계서 찾아줘" 한 마디로 관련 문서 자동 검색 |
| **Core Value** | "내 지식을 보고, 탐색하고, AI가 활용하는 플랫폼" — 시각화는 대중의 문(접근성), MCP 통합은 파워 유저의 핵심 가치(생산성) |

---

## Context Anchor

| Key | Value |
|-----|-------|
| **WHY** | AI 코딩 에이전트가 개인 지식에 접근 불가 + 지식 파편화로 검색·활용 불가능 |
| **WHO** | Claude Code + Obsidian 헤비 유저 (Beachhead), 확장: Cursor 유저, 리서처, 크리에이터 |
| **RISK** | 대규모 vault(1만+ 문서) 3D 렌더링 성능 저하 → LOD + 2D 폴백으로 완화 |
| **SUCCESS** | MCP 쿼리 성공률 >95%, 검색 p95 <200ms, 3D 60fps(1만 노드), 설치→첫 쿼리 5분 이내 |
| **SCOPE** | Phase 1: MVP (Indexer+MCP+Search+CLI) → Phase 2: 3D Visualization → Phase 3: Multi-source+Pro |

---

## 1. Overview

### 1.1 Purpose

개인이 축적한 마크다운 노트(Obsidian vault)를 AI가 활용할 수 있는 벡터 인덱스로 변환하고, MCP 프로토콜로 AI 코딩 에이전트에 노출하여 "내 경험을 아는 AI"를 실현한다. 3D 지식 그래프로 비개발자도 직관적으로 지식 구조를 탐색할 수 있다.

### 1.2 Background

- **현재 상태**: notion-obsidian-sync로 노션↔옵시디언 동기화 완성. 하지만 동기화된 문서를 AI가 활용할 방법이 없음.
- **시장 상황**: AI-Driven KM 시장 $11.24B(2026), CAGR 46.7%. MCP 생태계 급성장(1000+ 서버).
- **블루오션**: "시각화 높음 + AI 에이전트 통합 높음" 영역에 경쟁자 없음 (PRD §2.4)
- **기존 인프라 활용**: Langent 분석에서 RRF 하이브리드 검색, MCP 도구 패턴 아이디어 확보
- **모노레포 결정**: notion-obsidian-sync(수집) + knowledge-hub(벡터화·검색·시각화)를 하나의 레포에서 관리

### 1.3 Related Documents

- PRD: `docs/00-pm/evan-knowledge-hub.prd.md`
- Langent 분석: 이전 세션 (6.3/10, RRF 검색·MCP 패턴 참고)
- 경쟁 분석: PRD §3.2 (Khoj, Smart Connections, NotebookLM, Mem.ai, Think Machine)

---

## 2. Scope

### 2.1 In Scope

#### Phase 1: Foundation MVP (4-6주)
- [x] F1: Obsidian Indexer — .md 스캔, 청킹, 임베딩, SQLite-vec 저장
- [x] F2: MCP Server — search, get-document, list-topics, get-related 도구
- [x] F3: Hybrid Search — BM25(키워드) + Cosine(시맨틱) + RRF Fusion
- [x] F4: CLI — `ekh index`, `ekh search`, `ekh serve`, `ekh status`
- [x] F12: Auto-Index — chokidar 파일 감시 → 변경 시 자동 재색인

#### Phase 2: Visualization (4주)
- [ ] F5: 3D Knowledge Graph — Three.js/R3F, force-directed layout
- [ ] F6: Graph Interaction — 노드 클릭 → 미리보기, 줌/팬, 클러스터 필터
- [ ] F7: Search Integration — 그래프 내 검색 → 관련 노드 하이라이트
- [ ] F8: Web UI — 로컬 웹 서버 기반 대시보드 (React + Vite)

#### Phase 3: Multi-source & Pro (6주)
- [ ] F9: Notion Collector — notion-obsidian-sync 연동, 자동 수집 파이프라인
- [ ] F10: Web Clipper — 브라우저 확장 → Obsidian → 자동 벡터화
- [ ] F11: Pro Features — 클라우드 백업, 프리미엄 임베딩, 팀 지식 공유
- [ ] F13: Obsidian Plugin — Obsidian 커뮤니티 플러그인으로 배포

### 2.2 Out of Scope

- 자체 노트 작성/편집 기능 (Obsidian이 담당)
- 모바일 앱 (웹 UI로 대체)
- 실시간 협업/동시 편집
- 자체 AI 모델 학습/파인튜닝
- 클라우드 호스팅 서비스 (Phase 3 Pro에서 일부 도입)

---

## 3. Requirements

### 3.1 Functional Requirements

#### Phase 1 (P0 — MVP 필수)

| ID | Requirement | Priority | Status |
|----|-------------|----------|--------|
| FR-01 | .md 파일을 스캔하여 청킹(heading 기반 + 오버랩)하고 임베딩 생성 | P0 | Pending |
| FR-02 | 생성된 임베딩을 SQLite-vec에 저장하고 메타데이터(제목, 경로, 태그, 날짜) 인덱싱 | P0 | Pending |
| FR-03 | MCP 서버: `search` 도구 — 자연어 쿼리 → 상위 N개 관련 청크 반환 | P0 | Pending |
| FR-04 | MCP 서버: `get-document` 도구 — 문서 ID → 전문 + 프론트매터 반환 | P0 | Pending |
| FR-05 | MCP 서버: `list-topics` 도구 — 전체 토픽/태그 목록 반환 | P0 | Pending |
| FR-06 | MCP 서버: `get-related` 도구 — 문서 ID → 유사 문서 N개 반환 | P0 | Pending |
| FR-07 | RRF 하이브리드 검색: BM25 + Cosine Similarity → Reciprocal Rank Fusion | P0 | Pending |
| FR-08 | CLI: `ekh index <vault-path>` — 프로그레스 바 + 완료 요약 | P0 | Pending |
| FR-09 | CLI: `ekh search <query>` — 터미널에서 검색 결과 표시 | P0 | Pending |
| FR-10 | CLI: `ekh serve` — MCP 서버 시작 (stdio/SSE 모드) | P0 | Pending |
| FR-11 | 증분 인덱싱: 변경된 파일만 재색인 (파일 해시 비교) | P0 | Pending |
| FR-12 | 파일 워치: chokidar로 변경 감지 → 30초 내 자동 재색인 | P0 | Pending |

#### Phase 2 (P1 — 시각화)

| ID | Requirement | Priority | Status |
|----|-------------|----------|--------|
| FR-13 | 3D Knowledge Graph: 문서=노드, 유사도=엣지, force-directed layout | P1 | Pending |
| FR-14 | 노드 클릭 → 사이드패널에 마크다운 렌더링 미리보기 | P1 | Pending |
| FR-15 | 클러스터 자동 감지 (HDBSCAN/K-means) + 라벨링 | P1 | Pending |
| FR-16 | 그래프 내 검색 → 관련 노드 하이라이트, 경로 표시 | P1 | Pending |
| FR-17 | 줌/팬/회전 + LOD (먼 노드는 점으로, 가까운 노드는 상세) | P1 | Pending |
| FR-18 | Web UI 대시보드: 검색바 + 3D 그래프 + 문서 뷰어 | P1 | Pending |

#### Phase 3 (P2 — 확장)

| ID | Requirement | Priority | Status |
|----|-------------|----------|--------|
| FR-19 | Notion 수집: notion-obsidian-sync 파이프라인 연동 | P2 | Pending |
| FR-20 | Web Clipper: 브라우저 확장으로 웹 페이지 클리핑 → 옵시디언 | P2 | Pending |
| FR-21 | 팀 지식 공유: 복수 사용자 vault 통합 검색 | P2 | Pending |
| FR-22 | 프리미엄 임베딩: OpenAI/Anthropic API 옵션 | P2 | Pending |

### 3.2 Non-Functional Requirements

| Category | Criteria | Measurement |
|----------|----------|-------------|
| **Performance** | 1만 문서 인덱싱 < 10분, 검색 p95 < 200ms | 벤치마크 스크립트 |
| **Performance** | 3D 그래프 1만 노드에서 60fps | Chrome DevTools FPS |
| **Security** | 데이터 100% 로컬, 네트워크 요청은 임베딩 API만 (opt-in) | 네트워크 모니터링 |
| **Compatibility** | Windows 10+, macOS 12+, Linux Ubuntu 20.04+ | CI 크로스 플랫폼 테스트 |
| **Usability** | 설치 → 첫 MCP 쿼리까지 5분 이내 | 신규 사용자 타이머 |
| **Scalability** | 플러그인 아키텍처: Collector/Embedder/Visualizer 교체 가능 | 인터페이스 테스트 |
| **Accessibility** | 3D 그래프: 키보드 내비게이션, 2D 폴백 모드 | 접근성 테스트 |

---

## 4. Success Criteria

### 4.1 Definition of Done (Phase 1 MVP)

- [ ] SC-01: `ekh index ./vault` 실행 시 모든 .md 파일 벡터화 완료
- [ ] SC-02: Claude Code에서 MCP 연결 후 `search` 쿼리로 관련 문서 반환 성공
- [ ] SC-03: RRF 하이브리드 검색이 단순 벡터 검색 대비 NDCG@10 10%+ 개선
- [ ] SC-04: 1000개 문서 인덱싱 < 3분, 검색 p95 < 200ms
- [ ] SC-05: `npm install -g evan-knowledge-hub` → `ekh index` → `ekh serve` → Claude Code MCP 연결 5분 이내
- [ ] SC-06: 파일 수정 후 30초 내 검색 결과에 반영 (자동 재색인)

### 4.2 Definition of Done (Phase 2 시각화)

- [ ] SC-07: 3D 그래프에서 1만 노드 렌더링 시 60fps 유지
- [ ] SC-08: 노드 클릭 → 문서 미리보기 1초 이내 표시
- [ ] SC-09: 검색어 입력 → 관련 노드 하이라이트 0.5초 이내
- [ ] SC-10: 비개발자 사용성 테스트: 80%가 "관계를 이해할 수 있다" 응답

### 4.3 Definition of Done (Phase 3 확장)

- [ ] SC-11: Notion 변경 → Obsidian 동기화 → 벡터 인덱스 업데이트 자동 파이프라인 작동
- [ ] SC-12: Pro 사용자 클라우드 백업/복원 정상 작동

### 4.4 Quality Criteria

- [ ] 테스트 커버리지 80% 이상 (핵심 모듈)
- [ ] ESLint 에러 0건
- [ ] TypeScript strict 모드 빌드 성공
- [ ] Cross-platform CI (Windows + macOS + Linux) 통과

---

## 5. Risks and Mitigation

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| R1: 대규모 vault 3D 렌더링 성능 저하 | High | Medium | LOD, 클러스터 단위 렌더링, WebGPU 대비, 2D 폴백 |
| R2: MCP 프로토콜 스펙 변경 | High | Low | MCP 추상화 레이어, 어댑터 패턴 |
| R3: Obsidian 공식 AI 기능 출시 | High | Medium | MCP 통합(Obsidian이 안 할 영역) 집중, 다중 소스 차별화 |
| R4: 로컬 임베딩 모델 한국어 품질 부족 | Medium | Medium | multilingual 모델 선정(nomic-embed-text v1.5), Pro에서 클라우드 옵션 |
| R5: Windows SQLite-vec 네이티브 바인딩 이슈 | Medium | Medium | better-sqlite3 + vec 확장, WASM 폴백 |
| R6: 1인 개발 속도 한계 | Medium | High | 모듈화로 커뮤니티 컨트리뷰션 유도, Phase 1 핵심에 집중 |
| R7: 청킹 전략 실패 (문맥 손실) | Medium | Medium | heading 기반 청킹 + 오버랩 + 메타데이터 보존, A/B 테스트 |

---

## 6. Impact Analysis

### 6.1 Changed Resources

| Resource | Type | Change Description |
|----------|------|--------------------|
| 프로젝트 구조 | Repository | 모노레포로 전환: `packages/sync` + `packages/hub` |
| package.json | Config | workspace 설정 추가, 공통 의존성 |
| .env | Config | 임베딩 모델 경로, MCP 설정 환경변수 추가 |
| notion-obsidian-sync 스크립트 | Script | `packages/sync/`로 이동, import 경로 변경 |

### 6.2 Current Consumers

| Resource | Operation | Code Path | Impact |
|----------|-----------|-----------|--------|
| sync-to-obsidian.mjs | READ/WRITE | Windows 스케줄러 → run-sync.mjs | 경로 변경 필요 |
| upload-pdca-to-notion.mjs | READ | run-sync.mjs에서 호출 | 경로 변경 필요 |
| .env | READ | sync 스크립트들 | 공유 .env 또는 패키지별 .env |
| .sync-state.json | READ/WRITE | sync-to-obsidian.mjs | packages/sync/으로 이동 |

### 6.3 Verification

- [ ] 모노레포 전환 후 기존 sync 스크립트 정상 작동 확인
- [ ] Windows 스케줄러 경로 업데이트
- [ ] .env 파일 구조 결정 및 마이그레이션

---

## 7. Architecture Considerations

### 7.1 Project Level Selection

| Level | Characteristics | Recommended For | Selected |
|-------|-----------------|-----------------|:--------:|
| **Starter** | Simple structure | Static sites, portfolios | ☐ |
| **Dynamic** | Feature-based modules, BaaS | Web apps with backend | ☒ |
| **Enterprise** | Strict layer separation, DI | High-traffic systems | ☐ |

**Dynamic 선정 근거**:
- MCP 서버 + 3D 웹 UI + CLI = 여러 진입점이 있는 풀스택 앱
- 벡터 DB가 BaaS 역할 (자체 로컬 DB)
- Enterprise 수준 복잡도는 불필요 (1인 개발, MVP 우선)

### 7.2 Key Architectural Decisions

| Decision | Options | Selected | Rationale |
|----------|---------|----------|-----------|
| **Runtime** | Node.js / Bun / Deno | Node.js (ESM) | 기존 sync 인프라 호환, MCP SDK 지원 |
| **Vector DB** | SQLite-vec / ChromaDB / LanceDB | SQLite-vec | 단일 파일, 설치 간편, 네이티브 성능 |
| **Embedding** | nomic-embed-text / all-MiniLM / OpenAI | nomic-embed-text (로컬) | 무료, 로컬, multilingual, 768차원 |
| **MCP** | @modelcontextprotocol/sdk | @modelcontextprotocol/sdk | 공식 SDK, stdio+SSE 지원 |
| **3D** | Three.js+R3F / D3-3d / Babylon.js | Three.js + R3F | React 생태계, 커뮤니티 규모, force-graph 라이브러리 |
| **Search** | BM25+Cosine+RRF / FAISS / Elasticsearch | BM25+Cosine+RRF | 로컬 경량, Langent 검증 아이디어 |
| **File Watch** | chokidar / fs.watch / watchman | chokidar | 크로스 플랫폼, 안정적 |
| **UI** | React+Vite / Next.js / Electron | React + Vite | 경량, 빠른 시작, 로컬 서버 |
| **Package Manager** | npm workspaces / pnpm / turborepo | npm workspaces | 추가 도구 불필요, 기존 npm 사용 |
| **Testing** | Vitest / Jest | Vitest | ESM 네이티브, Vite와 통합 |

### 7.3 Monorepo Structure

```
evan-knowledge-hub/               (= 현재 notion-obsidian-sync 리네이밍)
├── package.json                  (workspace root)
├── .env                          (공유 환경변수)
├── CLAUDE.md
├── docs/
│   ├── 00-pm/
│   ├── 01-plan/
│   └── 02-design/
│
├── packages/
│   ├── sync/                     (기존 notion-obsidian-sync)
│   │   ├── package.json
│   │   ├── sync-to-obsidian.mjs
│   │   ├── upload-pdca-to-notion.mjs
│   │   ├── run-sync.mjs
│   │   └── setup-scheduler.mjs
│   │
│   ├── core/                     (Phase 1: 핵심 엔진)
│   │   ├── package.json
│   │   ├── src/
│   │   │   ├── indexer/          (문서 스캔, 청킹, 임베딩)
│   │   │   │   ├── scanner.ts    (vault .md 파일 스캔)
│   │   │   │   ├── chunker.ts    (heading 기반 청킹 + 오버랩)
│   │   │   │   ├── embedder.ts   (임베딩 생성 — 로컬/클라우드)
│   │   │   │   └── watcher.ts    (chokidar 파일 감시)
│   │   │   ├── search/           (하이브리드 검색)
│   │   │   │   ├── bm25.ts       (키워드 검색)
│   │   │   │   ├── semantic.ts   (벡터 유사도 검색)
│   │   │   │   └── rrf.ts        (Reciprocal Rank Fusion)
│   │   │   ├── store/            (벡터 DB)
│   │   │   │   ├── sqlite-vec.ts (SQLite-vec 어댑터)
│   │   │   │   └── types.ts      (스토어 인터페이스)
│   │   │   └── types/            (공유 타입)
│   │   │       ├── document.ts
│   │   │       ├── chunk.ts
│   │   │       └── search.ts
│   │   └── tests/
│   │
│   ├── mcp/                      (Phase 1: MCP 서버)
│   │   ├── package.json
│   │   ├── src/
│   │   │   ├── server.ts         (MCP 서버 엔트리)
│   │   │   ├── tools/
│   │   │   │   ├── search.ts     (search 도구)
│   │   │   │   ├── get-document.ts
│   │   │   │   ├── list-topics.ts
│   │   │   │   └── get-related.ts
│   │   │   └── index.ts
│   │   └── tests/
│   │
│   ├── cli/                      (Phase 1: CLI)
│   │   ├── package.json
│   │   ├── src/
│   │   │   ├── index.ts          (ekh 엔트리포인트)
│   │   │   ├── commands/
│   │   │   │   ├── index.ts      (ekh index)
│   │   │   │   ├── search.ts     (ekh search)
│   │   │   │   ├── serve.ts      (ekh serve)
│   │   │   │   ├── graph.ts      (ekh graph — Phase 2)
│   │   │   │   └── status.ts     (ekh status)
│   │   │   └── utils/
│   │   └── bin/
│   │       └── ekh.js            (실행 엔트리)
│   │
│   └── graph/                    (Phase 2: 3D 시각화)
│       ├── package.json
│       ├── src/
│       │   ├── App.tsx
│       │   ├── components/
│       │   │   ├── Graph3D.tsx    (Three.js/R3F 3D 그래프)
│       │   │   ├── NodeDetail.tsx (노드 클릭 → 문서 미리보기)
│       │   │   ├── SearchBar.tsx  (검색 → 노드 하이라이트)
│       │   │   ├── ClusterFilter.tsx
│       │   │   └── Dashboard.tsx  (전체 레이아웃)
│       │   ├── hooks/
│       │   │   ├── useGraph.ts    (그래프 데이터 로딩)
│       │   │   └── useSearch.ts   (검색 연동)
│       │   └── lib/
│       │       ├── layout.ts      (force-directed layout)
│       │       └── cluster.ts     (HDBSCAN 클러스터링)
│       ├── index.html
│       └── vite.config.ts
│
└── scripts/
    ├── migrate-to-monorepo.mjs   (기존 파일 이동 스크립트)
    └── benchmark.mjs             (성능 벤치마크)
```

### 7.4 데이터 흐름

```
[수집 단계]
  Notion API ──→ packages/sync ──→ Obsidian vault (.md files)
  Web Clipper ──→                 ↗

[벡터화 단계]
  Obsidian vault ──→ scanner ──→ chunker ──→ embedder ──→ SQLite-vec
                                  │                         │
                              heading 기반              nomic-embed-text
                              + 300 token              (768차원, 로컬)
                              + 50 overlap

[검색 단계]
  사용자 쿼리 ──→ embedder(쿼리 임베딩)
                    ├──→ BM25 (키워드) ──→ rank list 1
                    └──→ Cosine (시맨틱) ──→ rank list 2
                                              ↓
                                         RRF Fusion ──→ 최종 결과

[활용 단계]
  Claude Code ──→ MCP Server ──→ search/get-document ──→ SQLite-vec
  3D Web UI ──→ REST API ──→ graph data + search ──→ SQLite-vec
```

---

## 8. Convention Prerequisites

### 8.1 Existing Project Conventions

- [x] `.env` — Notion API 키, 옵시디언 경로
- [ ] `CLAUDE.md` — 프로젝트 코딩 규칙 (생성 필요)
- [x] ESLint — 추가 예정
- [ ] TypeScript — 신규 패키지는 TypeScript strict
- [ ] Prettier — 추가 예정

### 8.2 Conventions to Define

| Category | Rule | Priority |
|----------|------|:--------:|
| **Language** | 신규 코드: TypeScript strict, 기존 sync: JS 유지 (점진 마이그레이션) | High |
| **Naming** | 파일: kebab-case, 변수/함수: camelCase, 타입: PascalCase | High |
| **Import** | Node built-in → 외부 패키지 → 내부 모듈 (알파벳순) | Medium |
| **Error** | Result<T, E> 패턴 (throw 최소화), catch에서 반드시 로깅 | Medium |
| **Embedding** | embedder 인터페이스 분리 — 모델 교체 가능 설계 | High |
| **Store** | store 인터페이스 분리 — SQLite-vec 외 다른 DB로 교체 가능 | High |

### 8.3 Environment Variables

| Variable | Purpose | Scope | Phase |
|----------|---------|-------|:-----:|
| `NOTION_API_KEY` | 노션 API 인증 (기존) | sync | 1 |
| `NOTION_ROOT_PAGE_ID` | 루트 페이지 (기존) | sync | 1 |
| `OBSIDIAN_PATH` | 옵시디언 vault 경로 | sync + core | 1 |
| `EKH_DB_PATH` | SQLite-vec DB 파일 경로 | core | 1 |
| `EKH_EMBEDDING_MODEL` | 임베딩 모델 선택 (local/openai) | core | 1 |
| `EKH_MCP_PORT` | MCP SSE 서버 포트 (기본: 3333) | mcp | 1 |
| `OPENAI_API_KEY` | OpenAI 임베딩 (Pro, opt-in) | core | 3 |

---

## 9. Implementation Roadmap

### Phase 1: Foundation MVP (4-6주)

| Week | Tasks | Deliverable |
|------|-------|-------------|
| **W1** | 모노레포 전환 + core 패키지 셋업 + scanner + chunker | `ekh index` (스캔+청킹만) |
| **W2** | embedder (nomic-embed-text) + SQLite-vec store | 벡터화 완료, 로컬 DB 저장 |
| **W3** | BM25 + semantic search + RRF fusion | `ekh search` 작동 |
| **W4** | MCP 서버 (4 tools) + `ekh serve` | Claude Code 연동 성공 |
| **W5** | chokidar auto-index + 증분 인덱싱 + CLI 마무리 | `ekh status`, file watch |
| **W6** | 테스트 + 벤치마크 + README + npm publish 준비 | MVP 릴리스 |

### Phase 2: Visualization (4주)

| Week | Tasks | Deliverable |
|------|-------|-------------|
| **W7** | graph 패키지 셋업 + Three.js/R3F 기본 렌더링 | 노드/엣지 표시 |
| **W8** | force-directed layout + 클러스터링 + LOD | 성능 최적화된 3D 그래프 |
| **W9** | 노드 클릭 → 문서 미리보기 + 검색 하이라이트 | 인터랙션 완성 |
| **W10** | Dashboard UI + `ekh graph` 명령어 | Web UI 릴리스 |

### Phase 3: Multi-source & Pro (6주)

| Week | Tasks | Deliverable |
|------|-------|-------------|
| **W11-12** | Notion collector 파이프라인 + 자동 인덱스 연동 | 노션→벡터 자동화 |
| **W13-14** | Web Clipper 확장 + Obsidian 플러그인 | 다중 소스 수집 |
| **W15-16** | Pro 기능 (클라우드 백업, 팀 공유) + 결제 | Pro 릴리스 |

---

## 10. Dependencies

### 10.1 Phase 1 핵심 패키지

| Package | Version | Purpose |
|---------|---------|---------|
| `better-sqlite3` | ^11.x | SQLite 네이티브 바인딩 |
| `sqlite-vec` | ^0.1.x | SQLite 벡터 검색 확장 |
| `@modelcontextprotocol/sdk` | ^1.x | MCP 서버 SDK |
| `@xenova/transformers` | ^3.x | 로컬 임베딩 (nomic-embed-text) |
| `chokidar` | ^4.x | 파일 변경 감시 |
| `commander` | ^12.x | CLI 프레임워크 |
| `ora` | ^8.x | CLI 스피너/프로그레스 |

### 10.2 Phase 2 추가

| Package | Version | Purpose |
|---------|---------|---------|
| `three` | ^0.170.x | 3D 렌더링 |
| `@react-three/fiber` | ^9.x | React Three.js 바인딩 |
| `@react-three/drei` | ^10.x | Three.js 유틸리티 |
| `3d-force-graph` | ^1.x | Force-directed graph 레이아웃 |
| `react` | ^19.x | UI 프레임워크 |
| `vite` | ^6.x | 빌드 도구 |

---

## 11. Next Steps

1. [ ] `/pdca design evan-knowledge-hub` — 아키텍처 상세 설계
2. [ ] 모노레포 전환 스크립트 작성
3. [ ] Phase 1 구현 시작

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 0.1 | 2026-03-30 | Initial draft (PRD 기반) | Evan (KHS) |
