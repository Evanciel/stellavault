# Evan Knowledge Hub Phase 2 — 3D Knowledge Graph Planning Document

> **Summary**: 1,512개 벡터화된 문서를 3D 공간에서 탐색·검색·발견하는 인터랙티브 지식 시각화 플랫폼
>
> **Project**: evan-knowledge-hub (notion-obsidian-sync monorepo)
> **Version**: 0.1.0
> **Author**: Evan (KHS)
> **Date**: 2026-03-30
> **Status**: Draft
> **PRD Reference**: `docs/00-pm/evan-knowledge-hub.prd.md`
> **Phase 1 Report**: `docs/04-report/features/evan-knowledge-hub.report.md`

---

## Executive Summary

| Perspective | Content |
|-------------|---------|
| **Problem** | 1,512개 벡터화된 문서가 있지만, CLI 텍스트 검색만으로는 지식 전체 구조를 파악할 수 없고 의외의 연결(serendipity)을 발견할 수 없다 |
| **Solution** | Three.js + R3F 기반 3D Knowledge Graph를 로컬 웹 서버로 제공. 문서=노드, 시맨틱 유사도=엣지, force-directed layout으로 자연스러운 클러스터 형성 |
| **Function/UX Effect** | `ekh graph` 한 명령으로 브라우저에서 3D 지식 우주 탐색. 노드 클릭→미리보기, 검색→하이라이트, 줌→LOD |
| **Core Value** | "내 지식을 눈으로 보는 경험" — 시각화는 대중의 문, MCP 통합은 파워 유저의 핵심 가치. Phase 2는 대중의 문을 여는 단계 |

---

## Context Anchor

| Key | Value |
|-----|-------|
| **WHY** | 텍스트 검색만으로는 지식 구조 파악·의외의 연결 발견 불가. 시각화가 제품 바이럴의 핵심 |
| **WHO** | 지식 노동자 (개발자 + 리서처 + 크리에이터). 비개발자도 3D 그래프로 진입 가능 |
| **RISK** | 1만+ 노드 시 60fps 유지 어려움 → LOD + 클러스터 단위 렌더링 + WebGPU 대비 |
| **SUCCESS** | 1만 노드 60fps, 노드 클릭→미리보기 1초, 검색→하이라이트 0.5초, `ekh graph`→브라우저 3초 |
| **SCOPE** | 3D 그래프 + 인터랙션 + 검색 통합 + 대시보드 UI + CLI `ekh graph` 명령 |

---

## 1. Overview

### 1.1 Purpose

Phase 1에서 완성한 벡터 DB(1,512문서, 26,783청크)와 MCP 검색 엔진 위에 3D 시각화 레이어를 추가한다. 사용자가 자신의 지식 전체 구조를 한눈에 파악하고, 클러스터(주제 영역)를 발견하며, 시맨틱 유사도 기반으로 문서 간 관계를 직관적으로 탐색할 수 있게 한다.

### 1.2 Phase 1 Foundation

Phase 2가 의존하는 Phase 1 완성물:

| Component | Status | Phase 2 활용 |
|-----------|:------:|-------------|
| SQLite-vec DB (384d) | ✅ | 노드 데이터 + 벡터 유사도 → 엣지 계산 |
| Search Engine (BM25+RRF) | ✅ | 그래프 내 검색 → 노드 하이라이트 |
| MCP Server (10 tools) | ✅ | REST API 엔드포인트 추가 |
| Core facade (`createKnowledgeHub`) | ✅ | Graph 패키지에서 import |

---

## 2. Scope

### 2.1 In Scope

| ID | Feature | Priority | Description |
|----|---------|:--------:|-------------|
| F5 | 3D Knowledge Graph | P0 | Three.js/R3F, force-directed, 노드=문서, 엣지=유사도 |
| F6 | Graph Interaction | P0 | 노드 클릭→미리보기, 줌/팬/회전, 호버 툴팁 |
| F7 | Search Integration | P0 | 그래프 내 검색바 → 관련 노드 하이라이트 + 카메라 포커스 |
| F8 | Web UI Dashboard | P0 | React+Vite 로컬 서버, 검색바+그래프+미리보기 3패널 |
| F-CLI | `ekh graph` 명령 | P0 | 로컬 서버 시작 + 브라우저 자동 열기 |
| F-API | Graph REST API | P0 | GET /api/graph, /api/search, /api/document/:id |
| F-LOD | Level of Detail | P1 | 먼 노드=점, 가까운 노드=라벨+상세, 1만 노드 60fps |
| F-CLUSTER | 클러스터 시각화 | P1 | 벡터 유사도 기반 그룹핑, 컬러 매핑, 필터 |

### 2.2 Out of Scope (Phase 2.5/3)

- 웹캠 모션 제어 (MediaPipe Hands) → Phase 2.5
- 별자리 뷰 (F07) → Phase 2.5
- 지식 히트맵 (F06), 감쇠 모델 (F09) → Phase 2 확장
- Knowledge Pack 이식 → Phase 3
- 클라우드 배포 → Phase 3

---

## 3. Requirements

### 3.1 Functional Requirements

| ID | Requirement | Priority |
|----|-------------|:--------:|
| FR-01 | 모든 문서를 3D 공간의 노드로 렌더링 (위치=force-directed) | P0 |
| FR-02 | 시맨틱 유사도 > threshold인 문서 쌍을 엣지로 연결 | P0 |
| FR-03 | 노드 클릭 → 사이드패널에 마크다운 렌더링 미리보기 | P0 |
| FR-04 | 검색바에 쿼리 입력 → 관련 노드 하이라이트 + 비관련 노드 반투명 | P0 |
| FR-05 | 줌/팬/회전 OrbitControls + 마우스 휠 | P0 |
| FR-06 | 노드 호버 → 툴팁 (제목, 태그, 최종 수정일) | P0 |
| FR-07 | 로컬 웹 서버 (Express/Vite dev) + 자동 브라우저 열기 | P0 |
| FR-08 | LOD: 거리에 따라 노드 디테일 조절 (먼 곳=점, 가까운 곳=라벨) | P1 |
| FR-09 | 클러스터 자동 감지 + 컬러 매핑 + 필터 UI | P1 |
| FR-10 | 대시보드: 문서 수, 클러스터 수, 렌더링 FPS 상태바 | P1 |

### 3.2 Non-Functional Requirements

| Category | Criteria | Target |
|----------|----------|--------|
| Performance | 1,500노드 렌더링 | 60fps |
| Performance | 10,000노드 렌더링 (LOD 적용) | 60fps |
| Performance | 노드 클릭 → 미리보기 표시 | < 1초 |
| Performance | 검색 → 하이라이트 반영 | < 0.5초 |
| Performance | `ekh graph` → 브라우저 표시 | < 3초 |
| UX | 비개발자 사용성 | 80%가 "관계를 이해할 수 있다" |
| Compatibility | 브라우저 | Chrome 120+, Firefox 120+, Safari 17+ |

---

## 4. Success Criteria

| ID | Criteria | Measurement |
|----|----------|-------------|
| SC-01 | 1,512 문서 3D 그래프 60fps 렌더링 | Chrome DevTools FPS |
| SC-02 | 노드 클릭 → 마크다운 미리보기 1초 이내 | 수동 측정 |
| SC-03 | 검색어 → 관련 노드 하이라이트 0.5초 이내 | 수동 측정 |
| SC-04 | `ekh graph` 실행 → 브라우저 3초 이내 | 수동 측정 |
| SC-05 | LOD 적용 시 10,000노드에서 60fps | 벤치마크 |
| SC-06 | 클러스터 3개 이상 자동 감지 | UI 확인 |

---

## 5. Architecture

### 5.1 New Package: `packages/graph/`

```
packages/graph/
├── package.json           (React + Vite + R3F)
├── tsconfig.json
├── vite.config.ts
├── index.html
├── src/
│   ├── main.tsx           엔트리포인트
│   ├── App.tsx            루트 컴포넌트
│   ├── api/
│   │   └── client.ts      REST API 클라이언트
│   ├── components/
│   │   ├── Graph3D.tsx    Three.js/R3F 3D 그래프 (Canvas)
│   │   ├── GraphNode.tsx  개별 노드 렌더링 (LOD)
│   │   ├── GraphEdge.tsx  엣지 렌더링
│   │   ├── NodeDetail.tsx 사이드패널 문서 미리보기
│   │   ├── SearchBar.tsx  검색 → 하이라이트
│   │   ├── ClusterFilter.tsx  클러스터 필터 UI
│   │   ├── StatusBar.tsx  FPS, 문서 수, 클러스터 수
│   │   └── Layout.tsx     3패널 대시보드 레이아웃
│   ├── hooks/
│   │   ├── useGraph.ts    그래프 데이터 로딩 + 캐싱
│   │   ├── useSearch.ts   검색 상태 관리
│   │   └── useSelection.ts  노드 선택 상태
│   └── lib/
│       ├── layout.ts      force-directed 레이아웃 계산
│       ├── cluster.ts     K-means 클러스터링
│       ├── lod.ts         Level of Detail 계산
│       └── graph-data.ts  그래프 데이터 변환 (DB → nodes/edges)
└── tests/
    └── graph-data.test.ts  데이터 변환 테스트
```

### 5.2 API Server (core 확장)

```
packages/core/src/
├── api/                   [NEW] REST API for graph
│   ├── server.ts          Express 서버 (Vite dev 프록시 또는 standalone)
│   └── routes.ts          GET /api/graph, /api/search, /api/document/:id, /api/clusters
```

### 5.3 CLI 확장

```
packages/cli/src/commands/
├── graph-cmd.ts           [NEW] ekh graph — API 서버 + Vite dev 서버 시작
```

### 5.4 Data Flow

```
[그래프 로딩]
  ekh graph → Express API server (port 3333) + Vite dev server (port 5173)
                                    │
  Browser → GET /api/graph ──→ Store.getAllDocuments()
                               + 벡터 유사도 계산 (상위 k개 이웃)
                               → { nodes: Node[], edges: Edge[] }
                                    │
  R3F Canvas ← force-directed ← 노드/엣지 데이터

[검색]
  SearchBar → POST /api/search?q=... → SearchEngine.search()
           → 결과 chunkIds → 관련 노드 하이라이트

[미리보기]
  노드 클릭 → GET /api/document/:id → Store.getDocument()
           → NodeDetail 사이드패널 마크다운 렌더링
```

---

## 6. Dependencies (Phase 2 추가)

| Package | Version | Purpose |
|---------|---------|---------|
| `three` | ^0.170 | 3D 렌더링 엔진 |
| `@react-three/fiber` | ^9 | React Three.js 바인딩 |
| `@react-three/drei` | ^10 | OrbitControls, Html, Text 등 유틸 |
| `react` | ^19 | UI 프레임워크 |
| `react-dom` | ^19 | DOM 렌더링 |
| `vite` | ^6 | 빌드 + HMR dev 서버 |
| `express` | ^5 | REST API 서버 |
| `react-markdown` | ^10 | 마크다운 렌더링 (미리보기) |
| `open` | ^10 | 브라우저 자동 열기 |

---

## 7. Implementation Roadmap

| Module | Scope Key | Description | Effort |
|--------|-----------|-------------|:------:|
| API 서버 + Graph 데이터 | `module-1` | Express routes + 벡터 유사도 → nodes/edges 변환 | Medium |
| Graph 패키지 셋업 + 기본 렌더링 | `module-2` | Vite + R3F + 노드/엣지 표시 | Medium |
| Force-directed layout | `module-3` | 물리 시뮬레이션 or 정적 레이아웃 | Medium |
| 인터랙션 (클릭, 호버, 줌) | `module-4` | 노드 선택 → 미리보기, 툴팁, OrbitControls | Small |
| 검색 통합 + 하이라이트 | `module-5` | SearchBar → API → 노드 하이라이트/포커스 | Small |
| LOD + 성능 최적화 | `module-6` | 거리 기반 디테일, instanced mesh, 1만 노드 60fps | Medium |
| 클러스터링 + 컬러 매핑 | `module-7` | K-means on embeddings → 그룹 컬러 + 필터 UI | Medium |
| CLI `ekh graph` + 대시보드 | `module-8` | graph-cmd.ts + Layout + StatusBar + 마무리 | Small |

### Recommended Session Plan

| Session | Scope | 내용 |
|---------|-------|------|
| **Session 1** | `module-1,module-2` | API 서버 + Graph 패키지 + 기본 3D 렌더링 |
| **Session 2** | `module-3,module-4` | Force layout + 인터랙션 (클릭/호버/줌) |
| **Session 3** | `module-5,module-6` | 검색 통합 + LOD 성능 최적화 |
| **Session 4** | `module-7,module-8` | 클러스터링 + CLI + 대시보드 마무리 |

---

## 8. Risks and Mitigation

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| 1,500+ 노드 렌더링 성능 | High | Medium | InstancedMesh, LOD, frustum culling |
| Force-directed 계산 시간 | Medium | Medium | Web Worker + 정적 초기 배치 후 점진적 시뮬레이션 |
| WebGL 호환성 이슈 | Low | Low | Three.js가 처리, 2D 캔버스 폴백 준비 |
| 엣지 수 폭발 (N²) | High | High | threshold + k-NN (각 노드당 상위 5개만) |
| React 상태 + R3F 렌더 루프 충돌 | Medium | Medium | useFrame 내부에서 상태 분리, zustand 사용 |

---

## 9. Test Plan

| Type | Target | Tool |
|------|--------|------|
| Unit | graph-data 변환 (nodes/edges) | Vitest |
| Unit | K-means 클러스터링 | Vitest |
| Unit | LOD 계산 로직 | Vitest |
| Integration | API routes → 정상 응답 | Vitest + supertest |
| Visual | 3D 렌더링 60fps | Chrome DevTools (수동) |
| E2E | `ekh graph` → 브라우저 → 노드 클릭 → 미리보기 | 수동 |

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 0.1 | 2026-03-30 | Initial Phase 2 Plan | Evan (KHS) |
