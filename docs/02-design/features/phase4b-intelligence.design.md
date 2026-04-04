# Phase 4b: Knowledge Intelligence — Design Document

> **Summary**: 히트맵 오버레이 + 갭 시각화 + 적응형 검색 상세 설계
>
> **Project**: stellavault
> **Version**: 0.3.0
> **Author**: Evan (KHS)
> **Date**: 2026-04-04
> **Status**: Draft
> **Planning Doc**: [phase4b-intelligence.plan.md](../../01-plan/features/phase4b-intelligence.plan.md)

---

## Context Anchor

| Key | Value |
|-----|-------|
| **WHY** | "검색 도구 → 지식 인텔리전스 플랫폼" 차별화. 경쟁사 없는 기능 |
| **WHO** | Obsidian 헤비 유저, Claude Code 개발자 |
| **RISK** | 히트맵 60fps; 적응형 NDCG 실효성 |
| **SUCCESS** | SC-01~06 PASS |
| **SCOPE** | F06 + F01 UI + F11. 3 sessions |

---

## 1. Data Model

### 1.1 graph-store 확장

```typescript
// 추가 상태
interface IntelligenceState {
  // F06 Heatmap
  showHeatmap: boolean;
  heatmapData: Record<string, number>; // nodeId → activityScore (0~1)

  // F01 Gap UI
  showGaps: boolean;
  gapData: {
    gaps: Array<{
      clusterIdA: number;
      clusterIdB: number;
      bridgeCount: number;
      severity: 'high' | 'medium' | 'low';
    }>;
    isolatedNodeIds: Set<string>;
  } | null;
}

// 추가 액션
interface IntelligenceActions {
  setHeatmapData: (data: Record<string, number>) => void;
  toggleHeatmap: () => void;
  setGapData: (data: IntelligenceState['gapData']) => void;
  toggleGaps: () => void;
}
```

### 1.2 Activity Score 계산

```typescript
// Design Ref: §1.2 — 히트맵 활동 점수
function computeActivityScore(
  lastAccess: Date | null,
  accessCount: number,
  lastModified: Date,
  decayR: number, // FSRS retrievability 0~1
): number {
  const now = Date.now();

  // 최근 접근 (0~0.4)
  const daysSinceAccess = lastAccess
    ? (now - lastAccess.getTime()) / 86400000
    : 365;
  const recencyScore = Math.max(0, 1 - daysSinceAccess / 90) * 0.4;

  // 접근 빈도 (0~0.3)
  const freqScore = Math.min(accessCount / 20, 1) * 0.3;

  // 감쇠 R값 반전 (0~0.3) — R이 높으면 기억 강함 = 활발
  const decayScore = decayR * 0.3;

  return Math.min(1, recencyScore + freqScore + decayScore);
}
```

### 1.3 Heatmap Color Gradient

```
activityScore → color:
  0.0 ~ 0.2  →  🔵 Cold   (#3b82f6 파랑)
  0.2 ~ 0.4  →  🟢 Normal (#10b981 초록)
  0.4 ~ 0.6  →  🟡 Warm   (#f59e0b 노랑)
  0.6 ~ 0.8  →  🟠 Hot    (#f97316 오렌지)
  0.8 ~ 1.0  →  🔴 Fire   (#ef4444 빨강)
```

노드 크기: `baseSize * (0.7 + activityScore * 0.8)` → cold=0.7x, fire=1.5x

---

## 2. F06: Heatmap Overlay

### 2.1 useHeatmap Hook

```typescript
// Design Ref: §2.1 — 히트맵 데이터 fetch + 색상 계산
export function useHeatmap(): {
  heatmapColors: Float32Array; // RGB per node
  heatmapSizes: Float32Array;  // size multiplier per node
  loading: boolean;
} {
  // 1. API GET /api/heatmap → { [nodeId]: activityScore }
  // 2. 각 노드에 대해 activityScore → RGB color 변환
  // 3. graph-store의 heatmapData에 저장
  // 4. Float32Array로 BufferAttribute 업데이트용 반환
}
```

### 2.2 API Endpoint

```
GET /api/heatmap
Response: {
  scores: Record<string, number>,  // nodeId → activityScore (0~1)
  stats: {
    total: number,
    hotCount: number,   // score > 0.6
    coldCount: number,  // score < 0.2
  }
}
```

서버에서 계산:
1. `decay_state` 테이블에서 각 문서의 R값 조회
2. `access_log` 테이블에서 접근 횟수/최근 접근 시간 조회
3. 문서 메타데이터에서 수정 시간 조회
4. `computeActivityScore()` 적용

### 2.3 GraphNodes.tsx 변경

```typescript
// showHeatmap일 때:
// 1. 기존 클러스터 색상 대신 heatmap gradient 색상 적용
// 2. 노드 크기에 activity score 반영
// 3. decayOverlay와 상호 배타 (heatmap > decay 우선)

// useFrame 내부:
if (showHeatmap && heatmapColors) {
  const colorAttr = pts.geometry.getAttribute('color');
  for (let i = 0; i < nodes.length; i++) {
    colorAttr.setXYZ(i,
      heatmapColors[i * 3],
      heatmapColors[i * 3 + 1],
      heatmapColors[i * 3 + 2]
    );
  }
  colorAttr.needsUpdate = true;
}
```

### 2.4 StatusBar 토글

기존 패턴: `[🎨Theme] [📷Export]` → `[🔥Heatmap] [🕳️Gaps] [🎨Theme] [📷Export]`

토글 시 API fetch → 데이터 로드 → 오버레이 적용.

---

## 3. F01+: Gap Visualization

### 3.1 useGapOverlay Hook

```typescript
// Design Ref: §3.1 — 갭 데이터 fetch + 시각 처리
export function useGapOverlay(): {
  isolatedNodeIds: Set<string>;
  gapEdges: Array<{ from: [x,y,z]; to: [x,y,z]; severity: string }>;
  loading: boolean;
} {
  // 1. API GET /api/gaps → GapReport
  // 2. 고립 노드 ID 집합 추출
  // 3. 갭 클러스터 쌍의 중심점 좌표 계산 → 점선 렌더링용
}
```

### 3.2 API Endpoint

```
GET /api/gaps
Response: GapReport (기존 detectKnowledgeGaps 결과 그대로)
```

### 3.3 GraphNodes.tsx — 고립 노드 강조

```typescript
// showGaps && gapData 일 때:
// 고립 노드에 빨간 pulse 애니메이션 (기존 search pulse 패턴 재사용)
if (showGaps && gapData?.isolatedNodeIds.has(nodes[i].id)) {
  // 빨간색으로 변경 + pulse
  colorAttr.setXYZ(i, 1.0, 0.2, 0.2);
  sizeAttr.setX(i, baseSize * gapPulse); // sin wave 1.0~1.6
}
```

### 3.4 GraphEdges.tsx — 갭 점선

```typescript
// 갭이 있는 클러스터 쌍 사이에 점선(dashed line) 그리기
// 기존 GraphEdges는 실선 — 갭 점선은 별도 <Line> 컴포넌트로 추가
// severity에 따라 색상: high=빨강, medium=노랑, low=파랑
// LineDashedMaterial 사용 (dashSize: 5, gapSize: 5)
```

### 3.5 MCP detect-gaps Tool

```typescript
// mcp/tools/detect-gaps.ts
// Plan SC: MCP detect-gaps가 클러스터 간 갭 + 고립 노드 반환

export const detectGapsTool: Tool = {
  name: 'detect-gaps',
  description: 'Detect knowledge gaps between topic clusters',
  inputSchema: {
    type: 'object',
    properties: {
      minSeverity: {
        type: 'string',
        enum: ['high', 'medium', 'low'],
        default: 'medium',
      },
    },
  },
  handler: async ({ minSeverity = 'medium' }) => {
    const report = await detectKnowledgeGaps(store);
    const filtered = report.gaps.filter(g => {
      const sev = { high: 0, medium: 1, low: 2 };
      return sev[g.severity] <= sev[minSeverity];
    });
    return {
      totalGaps: filtered.length,
      gaps: filtered,
      isolatedNodes: report.isolatedNodes.slice(0, 10),
      suggestion: filtered.length > 0
        ? `${filtered[0].suggestedTopic} 주제로 노트를 작성하면 지식 갭을 줄일 수 있습니다.`
        : '현재 심각한 지식 갭이 없습니다.',
    };
  },
};
```

---

## 4. F11: Adaptive Search

### 4.1 search/adaptive.ts

```typescript
// Design Ref: §4.1 — 컨텍스트 수집 + reranking

export interface SearchContext {
  recentSearches?: string[];     // 최근 검색어 (max 5)
  recentDocTags?: string[];      // 최근 접근 문서 태그
  currentFilePath?: string;      // MCP 호출 시 파일 경로
}

export function createAdaptiveSearch(deps: {
  baseSearch: SearchEngine;
  store: VectorStore;
  decayEngine?: DecayEngine;
}): SearchEngine {
  const { baseSearch, store, decayEngine } = deps;

  // 컨텍스트 히스토리 (in-memory, 세션 기반)
  const searchHistory: string[] = [];
  const recentTags: string[] = [];

  return {
    async search(options: SearchOptions & { context?: SearchContext }) {
      const { context, ...baseOptions } = options;

      // 1. 기본 검색 수행
      const results = await baseSearch.search(baseOptions);

      // 2. 컨텍스트 없으면 그대로 반환
      if (!context && searchHistory.length === 0) return results;

      // 3. 컨텍스트 기반 reranking
      const ctx = {
        recentSearches: context?.recentSearches ?? searchHistory.slice(-5),
        recentDocTags: context?.recentDocTags ?? recentTags.slice(-10),
        currentFilePath: context?.currentFilePath,
      };

      const reranked = results.map(r => {
        let boost = 0;

        // 태그 오버랩 (0 ~ 0.3)
        if (ctx.recentDocTags.length > 0) {
          const docTags = new Set(r.document.tags);
          const overlap = ctx.recentDocTags.filter(t => docTags.has(t)).length;
          boost += Math.min(overlap / ctx.recentDocTags.length, 1) * 0.3;
        }

        // 감쇠 부스트 (0 ~ 0.1) — 잊어가는 노트 약간 올림
        if (decayEngine) {
          const R = decayEngine.getRetrievability?.(r.document.id);
          if (R !== undefined && R < 0.5) {
            boost += (0.5 - R) * 0.2; // max 0.1
          }
        }

        return { ...r, score: r.score * (1 + boost) };
      });

      // 4. 재정렬
      reranked.sort((a, b) => b.score - a.score);

      // 5. 검색 히스토리 업데이트
      searchHistory.push(options.query);
      if (searchHistory.length > 20) searchHistory.shift();

      return reranked;
    },
  };
}
```

### 4.2 MCP search 확장

```typescript
// 기존 search tool의 inputSchema에 추가:
context: {
  type: 'object',
  properties: {
    recentSearches: { type: 'array', items: { type: 'string' } },
    currentFilePath: { type: 'string' },
  },
}

// handler에서: adaptiveSearch.search({ ...options, context })
```

기존 호출(context 없음)은 동일하게 동작 → 하위 호환 유지.

---

## 5. Implementation Guide

### 5.1 구현 순서

| # | 모듈 | 파일 | 의존성 |
|---|------|------|--------|
| 1 | graph-store 확장 | `stores/graph-store.ts` | 없음 |
| 2 | API heatmap/gaps | `api/server.ts` | decay-engine, gap-detector |
| 3 | useHeatmap hook | `hooks/useHeatmap.ts` | graph-store, API |
| 4 | useGapOverlay hook | `hooks/useGapOverlay.ts` | graph-store, API |
| 5 | GraphNodes 히트맵+갭 | `components/GraphNodes.tsx` | useHeatmap, useGapOverlay |
| 6 | GraphEdges 갭 점선 | `components/GraphEdges.tsx` | useGapOverlay |
| 7 | StatusBar 토글 | `components/StatusBar.tsx` | graph-store |
| 8 | adaptive.ts | `search/adaptive.ts` | search/index, decay-engine |
| 9 | search/index.ts 통합 | `search/index.ts` | adaptive |
| 10 | MCP detect-gaps | `mcp/tools/detect-gaps.ts` | gap-detector |
| 11 | MCP search context | `mcp/server.ts` | adaptive |
| 12 | 테스트 | `tests/` | 모든 모듈 |

### 5.2 Session Guide

| Session | Module Key | 범위 | Lines |
|---------|-----------|------|:-----:|
| **S1** | Heatmap | #1, #2(heatmap), #3, #5(heatmap), #7(heatmap) | ~300 |
| **S2** | Gap UI | #2(gaps), #4, #5(gaps), #6, #7(gaps), #10 | ~250 |
| **S3** | Adaptive | #8, #9, #11, #12 | ~250 |

S1 ↔ S2 독립. S3 독립.

---

## 6. Error Handling

| 시나리오 | 처리 |
|---------|------|
| Heatmap API 실패 | toast "히트맵 로드 실패", 토글 자동 off |
| Gaps API 실패 | toast "갭 분석 실패", 토글 자동 off |
| decayEngine 미초기화 | heatmap에서 R값=0.5 기본값 사용 |
| 10K+ 노드 히트맵 성능 | BufferAttribute 일괄 업데이트 (needsUpdate 1회만) |
| context 없는 adaptive search | 기본 검색 결과 그대로 반환 |

---

## 7. Version History

| Version | Date | Changes |
|---------|------|---------|
| 0.1 | 2026-04-04 | Initial design — Heatmap + Gap UI + Adaptive Search |
