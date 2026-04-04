# Phase 4b: Knowledge Intelligence — Plan Document

> **Summary**: 지식 히트맵(F06) + 적응형 검색(F11) + 갭 탐지 UI 통합(F01+)
>
> **Project**: stellavault
> **Version**: 0.3.0
> **Author**: Evan (KHS)
> **Date**: 2026-04-04
> **Status**: Draft
> **PRD Reference**: `docs/00-pm/core.prd.md` §7.3.2

---

## Context Anchor

| Key | Value |
|-----|-------|
| **WHY** | Phase 4a로 오픈소스 공개 준비 완료. 이제 "검색 도구"에서 "지식 인텔리전스 플랫폼"으로 차별화 확보 필요 |
| **WHO** | Obsidian 헤비 유저(1000+ 노트), Claude Code 개발자 |
| **RISK** | 히트맵 60fps 성능 유지; 적응형 검색의 NDCG 실제 개선 효과 불확실 |
| **SUCCESS** | SC-01~SC-06 (아래 정의) 전부 PASS |
| **SCOPE** | F06 + F11 + F01 UI 통합. F02 진화 타임라인은 Phase 4c로 |

---

## 1. Current State Assessment

### 1.1 이미 구현된 것 (활용 가능)

| 모듈 | 파일 | 상태 |
|------|------|------|
| FSRS 감쇠 엔진 | `intelligence/fsrs.ts`, `decay-engine.ts` | ✅ 완료 |
| 갭 탐지 코어 | `intelligence/gap-detector.ts` | ✅ 완료 (클러스터 간 갭, 고립 노드) |
| 학습 경로 | `intelligence/learning-path.ts` | ✅ 완료 (decay+gaps+search 통합) |
| CLI gaps 명령 | `cli/commands/gaps-cmd.ts` | ✅ 완료 |
| 감쇠 3D 오버레이 | `graph/GraphNodes.tsx` 내 decayOverlay | ✅ 완료 (R < 0.7 흐림) |
| 타임라인 필터 | `graph/graph-store.ts` showTimeline | ✅ 완료 |
| MCP get-decay-status | `mcp/tools/decay.ts` | ✅ 등록 완료 |
| MCP get-learning-path | `mcp/tools/learning-path.ts` | ✅ 등록 완료 |

### 1.2 구현 필요한 것

| 기능 | 설명 | 난이도 |
|------|------|:------:|
| **F06 히트맵 오버레이** | 노드 색상을 활동 빈도/최신성 기반 gradient 매핑 | Medium |
| **F01 갭 시각화** | 갭 탐지 결과를 3D에서 시각적 표시 (브릿지 부족 영역 강조) | Low-Medium |
| **F11 적응형 검색** | 현재 작업 컨텍스트 기반 검색 결과 reranking | Medium |
| **MCP detect-gaps** | 갭 탐지 MCP tool 등록 | Low |
| **MCP adaptive-search** | 컨텍스트 인지 검색 MCP tool | Low |

---

## 2. Feature Breakdown

### 2.1 F06: Knowledge Heatmap

**목적**: 3D 그래프에서 활발한 영역 vs 방치된 영역을 직관적으로 구분

**구현 내용**:
- GraphNodes에 히트맵 모드 추가: 노드 색상을 "활동 점수"에 매핑
- 활동 점수 = f(최근 접근 시간, 접근 빈도, 수정 시간, 감쇠 R값)
- 색상 gradient: 🔴 Hot (최근 활발) → 🟡 Warm → 🟢 Normal → 🔵 Cold (방치)
- 노드 크기도 활동 점수에 비례 (hot = 1.5x, cold = 0.7x)
- graph-store에 `showHeatmap: boolean`, `heatmapData: Record<string, number>` 추가
- StatusBar에 Heatmap 토글 버튼

**데이터 소스**:
- `decay-engine.ts`의 access_log 테이블 (접근 빈도, 최근 접근)
- 문서 수정 시간 (scanner에서 이미 수집)
- FSRS R값 (감쇠 상태)

**Success Criteria**:
- SC-01: 히트맵 오버레이 시 60fps 유지 (10K 노드)
- SC-02: Hot/Cold 구분이 직관적 (5색 gradient)

### 2.2 F01+: Gap Detection UI

**목적**: CLI로만 볼 수 있던 갭 정보를 3D에서 시각화

**구현 내용**:
- 갭 탐지 결과를 그래프에 오버레이: 연결 부족 클러스터 쌍을 점선 표시
- 고립 노드(≤1 연결) 강조 표시 (빨간 테두리 또는 pulse)
- 갭 영역 클릭 시 "이 주제를 연결하는 노트 작성 제안" 표시
- graph-store에 `showGaps: boolean`, `gapData: GapResult[]` 추가
- MCP `detect-gaps` tool 등록

**Success Criteria**:
- SC-03: 갭 시각화가 실제 빈 영역을 정확히 표시 (수동 검증)
- SC-04: MCP detect-gaps가 클러스터 간 갭 + 고립 노드 반환

### 2.3 F11: Adaptive Memory Priority

**목적**: 현재 작업 컨텍스트에 맞게 검색 결과 자동 조정

**구현 내용**:
- `search/adaptive.ts` 신규: 컨텍스트 수집 + reranking 레이어
- 컨텍스트 소스: (a) 최근 검색 히스토리 (b) 최근 접근 문서 태그 (c) MCP 호출 시 파일 경로
- Reranking 공식: `finalScore = baseScore * (1 + contextBoost)`
  - contextBoost = tagOverlap * 0.3 + recencyBoost * 0.2 + decayBoost * 0.1
- MCP search tool에 optional `context` 파라미터 추가
- 기존 검색은 영향 없음 (context 미전달 시 기본 동작)

**Success Criteria**:
- SC-05: 컨텍스트 인지 검색이 기본 검색 대비 NDCG 15%+ 향상 (테스트 쿼리)
- SC-06: 기존 116 tests 전부 통과 (regression 0)

---

## 3. Architecture

### 3.1 Module Dependency

```
F06 (Heatmap)
  └── decay-engine.ts (데이터)
  └── graph-store.ts (상태)
  └── GraphNodes.tsx (렌더링)
  └── StatusBar.tsx (토글)

F01+ (Gap UI)
  └── gap-detector.ts (기존 코어)
  └── graph-store.ts (상태)
  └── GraphNodes.tsx (고립 노드 강조)
  └── GraphEdges.tsx (갭 점선)
  └── mcp/server.ts (detect-gaps 등록)

F11 (Adaptive Search)
  └── search/adaptive.ts (NEW)
  └── search/index.ts (통합)
  └── mcp/server.ts (context 파라미터)
```

### 3.2 File Plan

| # | 파일 | Action | 설명 |
|---|------|--------|------|
| 1 | `core/src/api/server.ts` | MOD | heatmap/gap 데이터 API 엔드포인트 추가 |
| 2 | `core/src/search/adaptive.ts` | NEW | 컨텍스트 수집 + reranking |
| 3 | `core/src/search/index.ts` | MOD | adaptive 레이어 통합 |
| 4 | `core/src/mcp/server.ts` | MOD | detect-gaps tool 등록, search context 파라미터 |
| 5 | `core/src/mcp/tools/detect-gaps.ts` | NEW | MCP detect-gaps tool |
| 6 | `graph/src/stores/graph-store.ts` | MOD | heatmap + gap 상태 추가 |
| 7 | `graph/src/components/GraphNodes.tsx` | MOD | 히트맵 색상 + 갭 고립 강조 |
| 8 | `graph/src/components/GraphEdges.tsx` | MOD | 갭 점선 표시 |
| 9 | `graph/src/components/StatusBar.tsx` | MOD | Heatmap/Gap 토글 |
| 10 | `graph/src/hooks/useHeatmap.ts` | NEW | 히트맵 데이터 fetch + 색상 계산 |
| 11 | `graph/src/hooks/useGapOverlay.ts` | NEW | 갭 데이터 fetch + 시각 처리 |
| 12 | `core/tests/adaptive-search.test.ts` | NEW | 적응형 검색 테스트 |
| 13 | `core/tests/detect-gaps-mcp.test.ts` | NEW | MCP tool 테스트 |

### 3.3 Non-Functional Requirements

| 항목 | 목표 |
|------|------|
| 히트맵 렌더링 | 60fps, 10K 노드 |
| 갭 탐지 | < 10초 (10K 노트) |
| 적응형 검색 오버헤드 | < 50ms |
| 패키지 크기 증가 | < 20KB |

---

## 4. Session Plan

| Session | 범위 | 파일 | 예상 Lines |
|---------|------|------|:----------:|
| **S1** | Heatmap 코어 | graph-store 확장, useHeatmap hook, GraphNodes 히트맵, StatusBar 토글, API 엔드포인트 | ~300 |
| **S2** | Gap UI | useGapOverlay hook, GraphNodes 고립 강조, GraphEdges 갭 점선, StatusBar Gap 토글, MCP detect-gaps | ~250 |
| **S3** | Adaptive Search | search/adaptive.ts, search/index.ts 통합, MCP search context, 테스트 2파일 | ~250 |

S1 ↔ S2 독립 (병렬 가능). S3는 독립.

---

## 5. Risk Assessment

| Risk | 확률 | 영향 | 대응 |
|------|:----:|:----:|------|
| 히트맵 10K 노드 성능 저하 | 중 | 중 | BufferAttribute 일괄 업데이트 (매 프레임 아닌 데이터 변경 시만) |
| 적응형 검색 NDCG 효과 미미 | 중 | 낮 | contextBoost 가중치 튜닝 가능. 효과 없으면 opt-in |
| 갭 탐지 오탐 | 중 | 중 | "제안" 수준 표시, 사용자 무시 가능 |

---

## 6. Version History

| Version | Date | Changes |
|---------|------|---------|
| 0.1 | 2026-04-04 | Initial plan — F06+F01++F11, 3 sessions |
