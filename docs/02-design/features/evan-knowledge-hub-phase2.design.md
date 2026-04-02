# Evan Knowledge Hub Phase 2 — 3D Knowledge Graph Design Document

> **Summary**: 1,512개 벡터화된 문서를 3D 공간에서 탐색·검색·발견하는 인터랙티브 지식 시각화
>
> **Project**: evan-knowledge-hub (notion-obsidian-sync monorepo)
> **Version**: 0.1.0
> **Author**: Evan (KHS)
> **Date**: 2026-03-30
> **Status**: Draft
> **Planning Doc**: [evan-knowledge-hub-phase2.plan.md](../../01-plan/features/evan-knowledge-hub-phase2.plan.md)
> **Phase 1 Design**: [evan-knowledge-hub.design.md](./evan-knowledge-hub.design.md)

---

## Context Anchor

| Key | Value |
|-----|-------|
| **WHY** | 텍스트 검색만으로는 지식 구조 파악·의외의 연결 발견 불가. 시각화가 제품 바이럴의 핵심 |
| **WHO** | 지식 노동자 (개발자 + 리서처 + 크리에이터). 비개발자도 3D 그래프로 진입 |
| **RISK** | 1만+ 노드 시 60fps 유지 어려움 → LOD + InstancedMesh + frustum culling |
| **SUCCESS** | 1만 노드 60fps, 클릭→미리보기 1초, 검색→하이라이트 0.5초, `ekh graph`→브라우저 3초 |
| **SCOPE** | 3D 그래프 + 인터랙션 + 검색 통합 + 대시보드 + CLI `ekh graph` |

---

## 1. Overview

### 1.1 Design Goals

1. **Phase 1 일관성**: core 패키지 재활용, 동일 DI 패턴, 동일 ESM 구조
2. **R3F 확장성**: React Three Fiber 기반으로 Phase 2.5 모션 제어·별자리 뷰 자연 확장
3. **점진적 로딩**: 초기 로드 3초, 이후 인터랙션은 즉각 반응
4. **LOD 내장**: 처음부터 1만 노드 대비 설계

### 1.2 Design Principles

- **core 의존만**: graph/는 @ekh/core만 import. 직접 SQLite 접근 금지
- **서버/클라이언트 분리**: API는 core에, UI는 graph에. 나중에 별도 배포 가능
- **프레임 예산 준수**: 16ms/frame (60fps). 렌더 루프 안에서 무거운 연산 금지

---

## 2. Architecture

### 2.0 Architecture Comparison

| Criteria | Option A: Embedded SPA | Option B: Full Separation | **Option C: Pragmatic Graph** |
|----------|:-:|:-:|:-:|
| **Approach** | core 안에 정적 번들 | graph+api 완전 분리 | graph/ 분리 + core/api/ |
| **New Files** | ~10 | ~30 | **~20** |
| **Complexity** | Low | High | **Medium** |
| **Maintainability** | Low | High | **High** |
| **R3F 확장성** | Low (vanilla) | High | **High** |
| **Phase 2.5 대비** | 모션 추가 어려움 | 자연스러운 확장 | **자연스러운 확장** |
| **Effort** | 1-2 sessions | 4-5 sessions | **3-4 sessions** |

**Selected**: **Option C: Pragmatic Graph** — Phase 1과 동일한 패턴(core 공유 + 패키지 분리). R3F로 Phase 2.5 모션/별자리 확장 용이.

### 2.1 Component Diagram

```
┌─────────────────────────────────────────────────────────────┐
│  packages/core/ (Phase 1 기존 + API 추가)                    │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │ Indexer   │  │ Search   │  │  Store   │  │   MCP    │   │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘   │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ api/ [NEW]                                             │ │
│  │  server.ts  — Express, /api/graph, /api/search, etc.  │ │
│  │  routes.ts  — 라우트 정의 + graph-data 변환            │ │
│  │  graph-data.ts — 벡터 유사도 → nodes/edges 변환       │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
        ↑ import @ekh/core
┌─────────────────────────────────────────────────────────────┐
│  packages/graph/ [NEW] — React + Vite + R3F                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │ Graph3D  │  │ NodeDtl  │  │ SearchBar│  │ Layout   │   │
│  │ (R3F)    │  │ (preview)│  │ (filter) │  │ (3panel) │   │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘   │
│       ↑              ↑              ↑                       │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                 │
│  │ useGraph │  │useSearch │  │useSelect │  hooks/          │
│  └──────────┘  └──────────┘  └──────────┘                 │
│       ↑                                                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                 │
│  │ layout   │  │ cluster  │  │   lod    │  lib/            │
│  └──────────┘  └──────────┘  └──────────┘                 │
└─────────────────────────────────────────────────────────────┘
        ↑ import @ekh/core (CLI에서)
┌──────────────┐
│ packages/cli/│
│  graph-cmd   │  [NEW] ekh graph — API+Vite 서버 시작
└──────────────┘
```

### 2.2 Data Flow

```
[그래프 로딩]
  ekh graph
    → Express API (port 3333)
    → Vite dev (port 5173, proxy /api → 3333)
    → Browser open http://localhost:5173

  GET /api/graph
    → Store.getAllDocuments() — 1,512 문서 메타
    → graph-data.ts: 벡터 유사도 top-k → edges
    → { nodes: GraphNode[], edges: GraphEdge[] }

  R3F Canvas
    → force-directed layout (Web Worker)
    → InstancedMesh 렌더링
    → LOD: 카메라 거리 → 디테일 레벨

[검색]
  SearchBar input
    → GET /api/search?q=...
    → SearchEngine.search() (RRF)
    → 결과 documentIds → useGraph에서 하이라이트 상태

[미리보기]
  노드 클릭 → useSelection.select(nodeId)
    → GET /api/document/:id
    → NodeDetail 사이드패널 마크다운 렌더링

[클러스터]
  GET /api/clusters
    → graph-data.ts: K-means on mean embeddings
    → { clusters: Cluster[] }
    → 노드 컬러 매핑 + ClusterFilter UI
```

---

## 3. Data Model

### 3.1 Graph Data Types

```typescript
// packages/core/src/api/graph-data.ts
interface GraphNode {
  id: string;              // document.id
  label: string;           // document.title (max 40 chars)
  filePath: string;
  tags: string[];
  clusterId: number;       // K-means 클러스터 번호
  position?: [number, number, number]; // force-layout 결과
  size: number;            // 관련 문서 수 기반 크기 (1~5)
}

interface GraphEdge {
  source: string;          // node.id
  target: string;          // node.id
  weight: number;          // 시맨틱 유사도 (0~1)
}

interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  clusters: Cluster[];
  stats: {
    nodeCount: number;
    edgeCount: number;
    clusterCount: number;
  };
}

interface Cluster {
  id: number;
  label: string;           // 대표 키워드 (클러스터 내 빈출 단어)
  color: string;           // hex color
  nodeCount: number;
  centroid: number[];       // 평균 벡터
}
```

### 3.2 API Response Types

```typescript
// GET /api/graph
interface GraphResponse {
  data: GraphData;
  generatedAt: string;     // ISO 8601
  cacheKey: string;        // content hash (캐싱용)
}

// GET /api/search?q=...&limit=10
interface SearchResponse {
  results: Array<{
    documentId: string;
    title: string;
    score: number;
    highlights: string[];
  }>;
  query: string;
}

// GET /api/document/:id
interface DocumentResponse {
  id: string;
  title: string;
  content: string;         // 전체 마크다운
  tags: string[];
  lastModified: string;
  related: Array<{ id: string; title: string; score: number }>;
}

// GET /api/clusters
interface ClustersResponse {
  clusters: Cluster[];
}
```

---

## 4. API Specification

### 4.1 REST API (core/api/)

| Method | Path | Description | Response |
|--------|------|-------------|----------|
| GET | `/api/graph` | 전체 그래프 데이터 (nodes + edges + clusters) | `GraphResponse` |
| GET | `/api/search?q=&limit=` | 검색 (기존 SearchEngine 활용) | `SearchResponse` |
| GET | `/api/document/:id` | 문서 상세 + 관련 문서 | `DocumentResponse` |
| GET | `/api/clusters` | 클러스터 목록 | `ClustersResponse` |
| GET | `/api/stats` | DB 통계 (문서 수, 청크 수 등) | `StoreStats` |

### 4.2 Graph Data 생성 알고리즘

```typescript
// graph-data.ts — 핵심 변환 로직
async function buildGraphData(store: VectorStore, options: {
  edgeThreshold: number;   // default: 0.3 (유사도 최소값)
  maxEdgesPerNode: number; // default: 5 (k-NN)
  clusterCount: number;    // default: 0 (auto-detect)
}): Promise<GraphData> {
  // 1. 모든 문서 로드
  const docs = await store.getAllDocuments();

  // 2. 각 문서의 평균 임베딩 계산 (청크 벡터 평균)
  //    → 문서 레벨 벡터

  // 3. k-NN: 각 문서에 대해 유사도 상위 k개 이웃 선택
  //    → edges (threshold 이상만)

  // 4. K-means 클러스터링 (문서 벡터 기반)
  //    → 각 노드에 clusterId 할당

  // 5. 클러스터 라벨 생성 (빈출 단어 추출)

  // 6. 노드 크기: 연결된 엣지 수 기반 정규화

  return { nodes, edges, clusters, stats };
}
```

### 4.3 엣지 수 제어 (N² 방지)

```
문서 1,512개 → 나이브 전체 비교 = 1,143,216 쌍
k-NN (k=5) → 최대 7,560 엣지 (threshold 필터 후 더 적음)
메모리: ~500KB (충분히 브라우저에서 처리 가능)
```

---

## 5. UI/UX Design

### 5.1 대시보드 레이아웃

```
┌──────────────────────────────────────────────────────────┐
│  🔍 [검색...]                    [클러스터 ▼] [FPS: 60] │
├──────────────────────────────────┬───────────────────────┤
│                                  │  📄 문서 미리보기     │
│                                  │                       │
│     ● ● ●   ●                   │  # OAuth 설계 교훈    │
│    ● ●● ●  ● ●                  │                       │
│     ● ●   ●  ●                  │  redirect_uri를       │
│            ●                     │  화이트리스트로       │
│   [3D Knowledge Graph]           │  검증하지 않아...     │
│                                  │                       │
│    ● ●●                          │  Tags: #보안 #OAuth   │
│   ● ● ●●                        │  Modified: 2026-03-15 │
│    ● ●                           │                       │
│                                  │  [📂 Open in Obsidian]│
├──────────────────────────────────┴───────────────────────┤
│  📊 1,512 docs | 5 clusters | 3D rendering 60fps        │
└──────────────────────────────────────────────────────────┘
```

### 5.2 인터랙션 명세

| 인터랙션 | 동작 | 구현 |
|----------|------|------|
| 노드 호버 | 툴팁 표시 (제목, 태그, 날짜) | R3F `<Html>` + onPointerOver |
| 노드 클릭 | 사이드패널 미리보기 + 카메라 포커스 | useSelection + camera lerp |
| 마우스 드래그 | 회전 (orbit) | OrbitControls |
| 마우스 휠 | 줌 in/out | OrbitControls |
| 우클릭 드래그 | 팬 | OrbitControls |
| 검색 입력 | 관련 노드 하이라이트, 나머지 반투명 | useSearch → opacity 변경 |
| 클러스터 필터 | 선택 클러스터만 표시, 나머지 숨김 | ClusterFilter → visible 토글 |
| ESC | 선택 해제, 검색 초기화 | useSelection.clear() |

### 5.3 LOD (Level of Detail)

| 카메라 거리 | 노드 표현 | 엣지 표현 |
|------------|-----------|-----------|
| 가까움 (< 50) | 라벨 텍스트 + 아이콘 + 풀 컬러 | 실선, 두께 비례 |
| 중간 (50~200) | 색상 구분 점 (크기 비례) | 얇은 선 |
| 먼 거리 (> 200) | 단색 점 (InstancedMesh) | 숨김 |

---

## 6. Core Algorithm Design

### 6.1 Force-Directed Layout

```typescript
// packages/graph/src/lib/layout.ts
interface LayoutOptions {
  iterations: number;      // default: 300
  repulsion: number;       // default: 100
  attraction: number;      // default: 0.01
  damping: number;         // default: 0.9
  dimensions: 3;           // 3D
}

// Web Worker에서 실행 (메인 스레드 블로킹 방지)
// 알고리즘: Barnes-Hut (O(n log n)) or 단순 Fruchterman-Reingold

function computeLayout(nodes: GraphNode[], edges: GraphEdge[], options: LayoutOptions): Position3D[] {
  // 1. 랜덤 초기 배치 (구 표면에 분포)
  // 2. 반복:
  //    - 반발력: 모든 노드 쌍 (Barnes-Hut 근사)
  //    - 인력: 연결된 노드 쌍 (엣지 weight 비례)
  //    - 감쇠 적용
  // 3. 최종 좌표 정규화 ([-1000, 1000] 범위)
  return positions;
}
```

### 6.2 K-Means 클러스터링

```typescript
// packages/graph/src/lib/cluster.ts
function kMeansClustering(
  vectors: number[][],       // 문서 평균 벡터 (384d)
  k?: number,                // 미지정 시 Elbow method로 자동 결정 (3~15)
): ClusterAssignment[] {
  // 1. k 자동 결정 (Elbow: WCSS 감소율 둔화점)
  // 2. K-means++ 초기화
  // 3. 최대 50 iterations
  // 4. 클러스터 라벨: 각 클러스터 문서 제목에서 TF-IDF 상위 3 키워드
  return assignments;
}
```

### 6.3 InstancedMesh 최적화 (1만 노드)

```typescript
// 노드 렌더링: InstancedMesh 사용
// - 1개 geometry + 1개 material로 1만 노드 렌더
// - 각 인스턴스: position(matrix), color(attribute), scale(matrix)
// - LOD: 카메라 거리에 따라 scale 조절 (먼 곳은 0.1, 가까운 곳은 1.0)
// - Frustum culling: Three.js 내장

// 엣지 렌더링: BufferGeometry + LineSegments
// - 모든 엣지를 단일 BufferGeometry에 패킹
// - LOD: 먼 엣지는 visible=false
```

---

## 7. Security Considerations

- [x] API는 localhost만 바인딩 (`127.0.0.1:3333`), 외부 접근 차단
- [x] CORS: `origin: 'http://localhost:5173'`만 허용
- [ ] 마크다운 렌더링 시 XSS: react-markdown은 기본 safe (HTML 태그 escape)
- [ ] 문서 내용이 브라우저에 로드됨 → 네트워크 탭에서 볼 수 있음 (로컬이므로 OK)

---

## 8. Test Plan

| Type | File | Tests | Phase |
|------|------|-------|:-----:|
| Unit | `graph-data.test.ts` | 노드/엣지 변환, threshold 필터, k-NN | P0 |
| Unit | `cluster.test.ts` | K-means 수렴, 라벨 생성 | P0 |
| Unit | `layout.test.ts` | force 계산, 정규화, 겹침 방지 | P1 |
| Integration | `api-routes.test.ts` | /api/graph, /api/search 응답 구조 | P0 |
| Visual | 수동 | 1,512노드 60fps, 인터랙션 반응성 | P0 |
| E2E | 수동 | `ekh graph` → 브라우저 → 클릭 → 미리보기 | P0 |

---

## 9. Clean Architecture

### 9.1 Layer Structure

```
packages/core/src/
├── api/ [NEW]      [Presentation]  REST 엔드포인트, graph-data 변환
├── types/          [Domain]        (기존) + GraphNode, GraphEdge 타입
├── indexer/        [Application]   (기존)
├── search/         [Application]   (기존)
├── store/          [Infrastructure] (기존)
├── mcp/            [Presentation]  (기존)
└── index.ts        [Facade]        + createApiServer export

packages/graph/src/
├── components/     [Presentation]  React UI 컴포넌트
├── hooks/          [Application]   상태 관리 (API 호출, 선택, 검색)
├── lib/            [Domain]        레이아웃, 클러스터링, LOD 알고리즘
└── api/            [Infrastructure] REST API 클라이언트
```

### 9.2 Dependency Rules

```
graph/components → graph/hooks → graph/lib (순수 알고리즘)
                                graph/api → core REST API (HTTP)
core/api → core/search, core/store (기존 인터페이스 활용)

graph/는 core 코드를 직접 import하지 않음 (HTTP API 통신만)
CLI graph-cmd만 @ekh/core를 import (서버 시작용)
```

---

## 10. Coding Convention

### 10.1 This Feature's Conventions

| Item | Convention |
|------|-----------|
| **Framework** | React 19 + Vite 6 + @react-three/fiber 9 |
| **State** | zustand (R3F 렌더 루프와 충돌 방지, useState 최소화) |
| **Styling** | CSS Modules (graph 패키지 내, Tailwind 불필요) |
| **3D** | R3F 선언형 + useFrame 내 imperative |
| **API 호출** | fetch + SWR 패턴 (useSWR 또는 직접 구현) |
| **Worker** | Web Worker for layout computation |
| **Test** | `*.test.ts`, Vitest, 알고리즘 중심 |

---

## 11. Implementation Guide

### 11.1 File Structure

```
packages/
├── core/src/
│   ├── api/ [NEW]
│   │   ├── server.ts          Express 서버 + Vite proxy 설정
│   │   ├── routes.ts          REST 라우트 (graph, search, document, clusters)
│   │   └── graph-data.ts      문서→노드/엣지 변환 + 클러스터링
│   ├── types/
│   │   └── graph.ts [NEW]     GraphNode, GraphEdge, Cluster 타입
│   └── index.ts               + createApiServer export 추가
│
├── graph/ [NEW]
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts         proxy: /api → localhost:3333
│   ├── index.html
│   ├── src/
│   │   ├── main.tsx           React DOM render
│   │   ├── App.tsx            루트 (Layout + providers)
│   │   ├── api/
│   │   │   └── client.ts      fetch wrapper (GET /api/*)
│   │   ├── components/
│   │   │   ├── Layout.tsx     3패널: SearchBar + Graph3D + NodeDetail
│   │   │   ├── Graph3D.tsx    R3F Canvas + OrbitControls + InstancedMesh
│   │   │   ├── GraphNodes.tsx InstancedMesh 노드 렌더링 + LOD
│   │   │   ├── GraphEdges.tsx LineSegments 엣지 렌더링
│   │   │   ├── NodeDetail.tsx 사이드패널 마크다운 미리보기
│   │   │   ├── SearchBar.tsx  검색 입력 + 결과 하이라이트
│   │   │   ├── ClusterFilter.tsx 클러스터 토글 필터
│   │   │   ├── StatusBar.tsx  문서 수, 클러스터 수, FPS
│   │   │   └── Tooltip.tsx    노드 호버 툴팁
│   │   ├── hooks/
│   │   │   ├── useGraph.ts    그래프 데이터 fetch + 캐싱
│   │   │   ├── useSearch.ts   검색 쿼리 + 결과 상태
│   │   │   └── useSelection.ts 노드 선택 + 카메라 포커스
│   │   ├── lib/
│   │   │   ├── layout.ts      force-directed (Web Worker)
│   │   │   ├── layout.worker.ts  Web Worker 본체
│   │   │   ├── cluster.ts     K-means + 라벨 생성
│   │   │   └── lod.ts         LOD 계산 (거리→스케일)
│   │   └── stores/
│   │       └── graph-store.ts zustand 스토어
│   └── tests/
│       ├── graph-data.test.ts
│       └── cluster.test.ts
│
├── cli/src/commands/
│   └── graph-cmd.ts [NEW]     ekh graph 명령어
│
└── cli/src/index.ts           + graph command 등록
```

### 11.2 Implementation Order

```
1. [ ] core/api + types (graph-data 변환 + REST routes + Express 서버)
2. [ ] graph/ 패키지 셋업 (Vite + React + R3F + 빈 Canvas)
3. [ ] 기본 3D 렌더링 (InstancedMesh 노드 + LineSegments 엣지)
4. [ ] force-directed layout (Web Worker)
5. [ ] 인터랙션 (OrbitControls + 노드 클릭 → 미리보기 + 호버 툴팁)
6. [ ] 검색 통합 (SearchBar → API → 하이라이트)
7. [ ] 클러스터링 (K-means + 컬러 매핑 + 필터 UI)
8. [ ] LOD + 성능 최적화 (1만 노드 60fps)
9. [ ] CLI graph-cmd + StatusBar + 대시보드 마무리
10. [ ] 테스트 + E2E 검증
```

### 11.3 Session Guide

#### Module Map

| Module | Scope Key | Description | Effort |
|--------|-----------|-------------|:------:|
| API 서버 + Graph 데이터 | `module-1` | Express + graph-data.ts + types/graph.ts | Medium |
| Graph 패키지 + 기본 렌더링 | `module-2` | Vite + R3F Canvas + InstancedMesh | Medium |
| Force layout + 인터랙션 | `module-3` | Web Worker layout + OrbitControls + 클릭/호버 | Medium |
| 검색 + 하이라이트 | `module-4` | SearchBar + API → 노드 opacity | Small |
| 클러스터 + LOD + 최적화 | `module-5` | K-means + LOD + frustum culling | Medium |
| CLI + 대시보드 + 테스트 | `module-6` | graph-cmd + StatusBar + 테스트 파일 | Small |

#### Recommended Session Plan

| Session | Scope | 내용 | 산출물 |
|---------|-------|------|--------|
| **Session 1** | `module-1,module-2` | API 서버 + Graph 패키지 + 기본 3D | 브라우저에서 점 표시 |
| **Session 2** | `module-3` | Force layout + 인터랙션 | 회전/줌/클릭 동작 |
| **Session 3** | `module-4,module-5` | 검색 + 클러스터 + LOD | 검색 하이라이트 + 컬러 클러스터 |
| **Session 4** | `module-6` | CLI + 대시보드 + 테스트 + 마무리 | `ekh graph` 완성 |

---

## 12. Dependencies

### 12.1 graph/ 패키지

```json
{
  "dependencies": {
    "three": "^0.170.0",
    "@react-three/fiber": "^9.0.0",
    "@react-three/drei": "^10.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "react-markdown": "^10.0.0",
    "zustand": "^5.0.0"
  },
  "devDependencies": {
    "@types/three": "^0.170.0",
    "@types/react": "^19.0.0",
    "@vitejs/plugin-react": "^4.0.0",
    "vite": "^6.0.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

### 12.2 core/ 추가 의존성

```json
{
  "dependencies": {
    "express": "^5.0.0",
    "cors": "^2.8.5",
    "open": "^10.0.0"
  }
}
```

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 0.1 | 2026-03-30 | Initial Phase 2 Design — Option C (Pragmatic Graph) | Evan (KHS) |
