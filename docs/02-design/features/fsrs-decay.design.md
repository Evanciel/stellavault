# F09: FSRS Knowledge Decay — Design Document

> **Summary**: FSRS-6 기반 노트별 기억 강도 추적 + 감쇠 시각화 상세 설계
>
> **Project**: evan-knowledge-hub
> **Version**: 0.4.1
> **Author**: Evan (KHS)
> **Date**: 2026-03-31
> **Status**: Draft
> **Planning Doc**: [fsrs-decay.plan.md](../../01-plan/features/fsrs-decay.plan.md)
> **Architecture**: Option C — Pragmatic Balance

---

## Context Anchor

| Key | Value |
|-----|-------|
| **WHY** | 지식이 쌓이기만 하고 관리 안 됨. 잊어가는 노트를 자동 감지 |
| **WHO** | Obsidian 헤비 유저 (500+ 노트) |
| **RISK** | FSRS 파라미터가 SRS 카드용이라 지식 노트에 맞지 않을 수 있음 |
| **SUCCESS** | 30일 미접근 노트 R < 0.5, 접근 시 리셋, 10K 배치 < 5초 |
| **SCOPE** | FSRS 엔진 + DB + MCP + CLI + API + 3D 시각화 |

---

## 1. FSRS-6 Algorithm (Simplified)

### 1.1 Core Formula

```
Retrievability R(t) = (1 + t / (9 * S))^(-1)

where:
  t = elapsed days since last access
  S = stability (days until R drops to 0.9)
```

### 1.2 Stability Update (on access)

```
S' = S * (1 + a * D^(-b) * (S^(-c)) * (e^(d * (1 - R)) - 1))

where:
  D = difficulty (1~10, default 5)
  a, b, c, d = FSRS parameters (tunable)
  R = current retrievability at access time
```

### 1.3 Simplified Parameters for Knowledge Notes

학습 카드와 달리 지식 노트는 "정답/오답" 피드백이 없으므로:
- **접근 = 정답**: stability 증가
- **미접근 = 자연 감쇠**: R 감소
- 초기 stability: 노트 크기/연결 수 기반 (큰 문서 = 더 안정적)
- difficulty: 모든 노트 동일 (5.0, 향후 피드백으로 조정)

---

## 2. Data Model

### 2.1 DB Schema Extension

```sql
-- 접근 이벤트 로그
CREATE TABLE IF NOT EXISTS access_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id TEXT NOT NULL,
  access_type TEXT NOT NULL,  -- 'view' | 'search' | 'mcp_query'
  accessed_at TEXT NOT NULL,  -- ISO timestamp
  FOREIGN KEY (document_id) REFERENCES documents(id)
);

CREATE INDEX idx_access_log_doc ON access_log(document_id);
CREATE INDEX idx_access_log_time ON access_log(accessed_at);

-- 감쇠 상태 (노트별)
CREATE TABLE IF NOT EXISTS decay_state (
  document_id TEXT PRIMARY KEY,
  stability REAL NOT NULL DEFAULT 7.0,     -- days
  difficulty REAL NOT NULL DEFAULT 5.0,    -- 1~10
  last_access TEXT NOT NULL,               -- ISO timestamp
  retrievability REAL NOT NULL DEFAULT 1.0, -- 0~1
  updated_at TEXT NOT NULL,
  FOREIGN KEY (document_id) REFERENCES documents(id)
);
```

### 2.2 TypeScript Types

```typescript
// intelligence/types.ts
export interface DecayState {
  documentId: string;
  stability: number;      // days until R=0.9
  difficulty: number;      // 1~10
  lastAccess: string;      // ISO timestamp
  retrievability: number;  // 0~1
}

export interface AccessEvent {
  documentId: string;
  type: 'view' | 'search' | 'mcp_query';
  timestamp: string;
}

export interface DecayReport {
  totalDocuments: number;
  decayingCount: number;   // R < 0.5
  criticalCount: number;   // R < 0.3
  averageR: number;
  topDecaying: DecayState[];
  clusterHealth: Array<{
    clusterId: number;
    label: string;
    avgR: number;
    count: number;
  }>;
}
```

---

## 3. Module Design

### 3.1 intelligence/fsrs.ts (Pure Functions)

```typescript
// FSRS 상수 (기본 파라미터)
const FSRS_PARAMS = {
  initialStability: 7.0,  // 7일 (새 노트)
  difficulty: 5.0,
  a: 0.4,   // stability growth factor
  b: 0.6,   // difficulty decay
  c: 0.2,   // stability decay
  d: 1.0,   // retrievability weight
} as const;

// R(t) 계산
function computeRetrievability(stabilityDays: number, elapsedDays: number): number;

// S' 계산 (접근 시 stability 업데이트)
function updateStability(
  currentS: number, difficulty: number, currentR: number
): number;

// 초기 stability 추정 (노트 특성 기반)
function estimateInitialStability(
  contentLength: number, connectionCount: number
): number;
```

### 3.2 intelligence/decay-engine.ts

```typescript
export class DecayEngine {
  constructor(private db: Database);

  // 전체 노트 감쇠 배치 계산
  async computeAll(): Promise<DecayReport>;

  // 단일 노트 접근 이벤트 처리
  async recordAccess(event: AccessEvent): Promise<void>;

  // 감쇠 임계값 이하 노트 조회
  async getDecaying(threshold?: number): Promise<DecayState[]>;

  // 노트 초기화 (인덱싱 후 decay_state 없는 노트)
  async initializeNewDocuments(): Promise<number>;
}
```

### 3.3 이벤트 수집 지점

| 위치 | 이벤트 타입 | 트리거 |
|------|-----------|--------|
| `GET /api/document/:id` | `view` | 그래프에서 노드 클릭 → 문서 조회 |
| `GET /api/search?q=` | `search` | 검색 결과에 포함된 모든 문서 |
| MCP `search` tool | `mcp_query` | AI 에이전트가 검색 |
| MCP `get-document` | `mcp_query` | AI 에이전트가 문서 조회 |

---

## 4. API Design

### 4.1 GET /api/decay

```json
// Response
{
  "totalDocuments": 1205,
  "decayingCount": 342,    // R < 0.5
  "criticalCount": 89,     // R < 0.3
  "averageR": 0.62,
  "topDecaying": [
    {
      "documentId": "abc123",
      "title": "OAuth2 구현 가이드",
      "retrievability": 0.12,
      "stability": 3.2,
      "lastAccess": "2026-01-15T...",
      "daysSinceAccess": 75
    }
  ],
  "clusterHealth": [
    { "label": "AI Systems (274)", "avgR": 0.71, "count": 274 },
    { "label": "TOOLS (149)", "avgR": 0.45, "count": 149 }
  ]
}
```

### 4.2 MCP Tool: get-decay-status

```json
{
  "name": "get-decay-status",
  "description": "잊어가는 지식 노트를 조회합니다. 리마인드가 필요한 노트 목록을 반환.",
  "inputSchema": {
    "properties": {
      "threshold": { "type": "number", "description": "감쇠 임계값 (0~1, default: 0.5)" },
      "limit": { "type": "number", "description": "반환할 최대 노트 수 (default: 20)" }
    }
  }
}
```

---

## 5. 3D Graph Visualization

### 5.1 Decay Overlay Mode

`graph-store`에 `showDecayOverlay: boolean` 상태 추가.

활성화 시 GraphNodes의 노드 색상/크기를 R값에 매핑:

| R 값 | Dark Mode | Light Mode | Size |
|------|-----------|------------|:----:|
| > 0.7 | 원래 색상 | 원래 회색 | 1x |
| 0.5~0.7 | 색상 50% 감소 | 회색 연하게 | 0.8x |
| 0.3~0.5 | 색상 80% 감소 + 깜빡임 | 매우 연한 회색 | 0.5x |
| < 0.3 | 거의 투명 (0.1 opacity) | 거의 투명 | 0.3x |

### 5.2 Decay Toggle Button

헤더에 "Decay" 버튼 추가 (Clusters 옆):
- OFF: 일반 그래프
- ON: 감쇠 오버레이 (위 테이블 적용)

---

## 6. Implementation Guide

### 6.1 Session Plan

| Session | Module | Files | Lines |
|---------|--------|-------|:-----:|
| **session-1** | FSRS 엔진 + DB | fsrs.ts, types.ts, decay-engine.ts, sqlite-vec.ts | ~350 |
| **session-2** | 이벤트 수집 + MCP + CLI + API | server.ts, mcp, decay-cmd.ts, decay.ts | ~200 |
| **session-3** | 3D 시각화 + 테스트 | useDecay.ts, GraphNodes.tsx, Layout.tsx, tests | ~180 |

Session 1이 핵심 (독립적). Session 2-3은 1 이후 병렬 가능.

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 0.1 | 2026-03-31 | Initial design | Evan (KHS) |
