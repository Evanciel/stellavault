# Evan Knowledge Hub Design Document

> **Summary**: 개인 지식을 벡터화하여 3D 시각화 + MCP로 AI 코딩 에이전트에 연결하는 로컬-퍼스트 플랫폼
>
> **Project**: evan-knowledge-hub (notion-obsidian-sync 모노레포)
> **Version**: 0.1.0
> **Author**: Evan (KHS)
> **Date**: 2026-03-30
> **Status**: Draft
> **Planning Doc**: [evan-knowledge-hub.plan.md](../01-plan/features/evan-knowledge-hub.plan.md)
> **PRD**: [evan-knowledge-hub.prd.md](../00-pm/evan-knowledge-hub.prd.md)

---

## Context Anchor

| Key | Value |
|-----|-------|
| **WHY** | AI 코딩 에이전트가 개인 지식에 접근 불가 + 지식 파편화로 검색·활용 불가능 |
| **WHO** | Claude Code + Obsidian 헤비 유저 (Beachhead), 확장: Cursor 유저, 리서처, 크리에이터 |
| **RISK** | 대규모 vault(1만+ 문서) 3D 렌더링 성능 저하 → LOD + 2D 폴백으로 완화 |
| **SUCCESS** | MCP 쿼리 성공률 >95%, 검색 p95 <200ms, 3D 60fps(1만 노드), 설치→첫 쿼리 5분 이내 |
| **SCOPE** | Phase 1: MVP → Phase 1.5: 클러스터링 → Phase 2: 3D + 히트맵 + 감쇠 → Phase 2.5: 모션 + 별자리 → Phase 3: 지식팩 이식 + Pro |

---

## 1. Overview

### 1.1 Design Goals

1. **수정 자유도 극대화**: core 패키지 안에서 검색·인덱싱·MCP를 자유롭게 수정 가능
2. **교체 가능한 핵심 컴포넌트**: 임베딩 모델, 벡터 DB를 인터페이스로 추상화하여 언제든 교체
3. **점진적 확장**: Phase 1 완료 후 graph/ 패키지만 추가하면 Phase 2 진입
4. **5분 내 첫 경험**: 설치 → 인덱싱 → MCP 쿼리까지 최소 단계
5. **로컬 우선, 네트워크 선택적**: 기본 동작에 인터넷 불필요

### 1.2 Design Principles

- **Single Source of Truth**: Obsidian .md 파일이 마스터. 벡터 DB는 파생 인덱스
- **인터페이스 우선**: Embedder, Store는 인터페이스 정의 후 구현. 교체 시 구현체만 변경
- **Fail-safe**: 인덱싱 중 crash → 재시작 시 이어서 처리 (체크포인트)
- **No Magic**: 설정 파일 1개(`.ekh.json`), 환경변수 최소화

---

## 2. Architecture

### 2.0 Architecture Comparison

| Criteria | Option A: Flat | Option B: Full | **Option C: Pragmatic** |
|----------|:-:|:-:|:-:|
| **Approach** | 단일 패키지 | 4패키지 완전 분리 | core+mcp 통합, cli 분리 |
| **New Files** | ~20 | ~35 | **~25** |
| **Complexity** | Low | High | **Medium** |
| **Maintainability** | Medium | High | **High** |
| **Effort** | Low | High | **Medium** |
| **Modification Freedom** | High (no boundaries) | Low (cross-package rebuild) | **High (free within core)** |
| **npm Deploy** | Impossible (bloated) | Individual packages | **CLI separate** |

**Selected**: **Option C: Pragmatic Split** — core 안에서 자유롭게 수정하면서 CLI만 분리해 배포 독립성 확보. Phase 2에서 graph만 추가.

### 2.1 Component Diagram

```
┌─────────────────────────────────────────────────────────────┐
│  packages/core/                                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │ Indexer   │  │ Search   │  │  Store   │  │   MCP    │   │
│  │          │  │          │  │          │  │  Server  │   │
│  │ scanner  │→│ bm25     │←│sqlite-vec│←│ search   │   │
│  │ chunker  │  │ semantic │  │          │  │ get-doc  │   │
│  │ embedder │→│ rrf      │  │          │  │ topics   │   │
│  │ watcher  │  │          │  │          │  │ related  │   │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘   │
│       ↑              ↑              ↑              ↑        │
│       └──────── types/ (공유 인터페이스) ──────────┘        │
└─────────────────────────────────────────────────────────────┘
        ↑                                        ↑
┌──────────────┐                     ┌──────────────────┐
│ packages/cli/│                     │ packages/graph/  │
│   ekh index  │                     │ (Phase 2)        │
│   ekh search │                     │ 3D Knowledge     │
│   ekh serve  │                     │ Graph UI         │
│   ekh status │                     │ React + Vite     │
└──────────────┘                     └──────────────────┘
        ↑
┌──────────────┐
│ packages/sync│
│ (기존 동기화) │
└──────────────┘
```

### 2.2 Data Flow

```
[인덱싱 플로우]
  .md files ──→ Scanner ──→ Chunker ──→ Embedder ──→ Store
                  │           │            │            │
              glob *.md   heading 기반   all-MiniLM   SQLite-vec
              frontmatter  300 tokens    384차원       INSERT
              parsing      50 overlap    batch 처리

[검색 플로우]
  Query string ──→ Embedder(쿼리) ──→ ┬── BM25 Search ───┬──→ RRF Fusion ──→ Results
                                       └── Semantic Search ┘       │
                                                              k=60, 1/(k+rank)

[MCP 플로우]
  Claude Code ──→ stdio/SSE ──→ MCP Server ──→ Tool Router
                                                   ├── search → Search Engine
                                                   ├── get-document → Store
                                                   ├── list-topics → Store (metadata)
                                                   └── get-related → Search (by doc ID)

[파일 감시 플로우]
  chokidar ──→ file change event ──→ debounce(5s) ──→ re-index changed file only
```

### 2.3 Dependencies (패키지 간)

```
cli/ ──depends──→ core/    (import search, indexer, mcp)
graph/ ──depends──→ core/  (import search, store — Phase 2)
sync/ ──independent──      (기존 그대로, core와 무관)
```

---

## 3. Data Model

### 3.1 Core Types

```typescript
// packages/core/src/types/document.ts
interface Document {
  id: string;              // SHA-256 hash of file path
  filePath: string;        // vault 기준 상대 경로
  title: string;           // frontmatter title 또는 첫 heading
  content: string;         // 전체 마크다운 텍스트
  frontmatter: Record<string, unknown>;  // YAML frontmatter
  tags: string[];          // #태그 목록
  lastModified: string;    // ISO 8601
  contentHash: string;     // SHA-256 of content (증분 인덱싱용)
}

// packages/core/src/types/chunk.ts
interface Chunk {
  id: string;              // document.id + "#" + chunkIndex
  documentId: string;      // 소속 문서 ID
  content: string;         // 청크 텍스트
  heading: string;         // 소속 heading (## 제목)
  startLine: number;       // 원문 시작 줄 번호
  endLine: number;         // 원문 끝 줄 번호
  tokenCount: number;      // 토큰 수
  embedding?: number[];    // 벡터 (모델 의존: MiniLM 384d, nomic 768d)
}

// packages/core/src/types/search.ts
interface SearchResult {
  chunk: Chunk;
  document: Document;
  score: number;           // RRF 통합 점수 (0~1)
  highlights: string[];    // 매칭 부분 하이라이트
}

interface SearchOptions {
  query: string;
  limit?: number;          // default: 10
  threshold?: number;      // minimum score, default: 0.1
  tags?: string[];         // 태그 필터
  dateRange?: { from?: string; to?: string };
}
```

### 3.2 인터페이스 정의 (교체 가능 설계)

```typescript
// packages/core/src/store/types.ts
interface VectorStore {
  initialize(): Promise<void>;
  upsertDocument(doc: Document): Promise<void>;
  upsertChunks(chunks: Chunk[]): Promise<void>;
  deleteByDocumentId(documentId: string): Promise<void>;
  searchSemantic(embedding: number[], limit: number): Promise<ScoredChunk[]>;
  searchKeyword(query: string, limit: number): Promise<ScoredChunk[]>;
  getDocument(documentId: string): Promise<Document | null>;
  getChunk(chunkId: string): Promise<Chunk | null>;
  getAllDocuments(): Promise<Document[]>;
  getTopics(): Promise<TopicInfo[]>;
  getStats(): Promise<StoreStats>;
  close(): Promise<void>;
}

// packages/core/src/indexer/embedder.ts
interface Embedder {
  initialize(): Promise<void>;
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
  dimensions: number;      // 모델 의존 (MiniLM: 384, nomic: 768)
  modelName: string;
}
```

### 3.3 SQLite-vec 스키마

```sql
-- 문서 메타데이터
CREATE TABLE documents (
  id TEXT PRIMARY KEY,
  file_path TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  frontmatter TEXT,          -- JSON
  tags TEXT,                 -- JSON array
  last_modified TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  indexed_at TEXT NOT NULL
);

-- 청크 + 임베딩
CREATE TABLE chunks (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  heading TEXT,
  start_line INTEGER,
  end_line INTEGER,
  token_count INTEGER
);

-- SQLite-vec 가상 테이블 (벡터 검색, 차원은 Embedder.dimensions에 의존)
CREATE VIRTUAL TABLE chunk_embeddings USING vec0(
  chunk_id TEXT PRIMARY KEY,
  embedding FLOAT[${dimensions}]  -- MiniLM: 384, nomic: 768
);

-- BM25 전문 검색 (FTS5)
CREATE VIRTUAL TABLE chunks_fts USING fts5(
  content,
  heading,
  content=chunks,
  content_rowid=rowid
);

-- 인덱스
CREATE INDEX idx_chunks_document_id ON chunks(document_id);
CREATE INDEX idx_documents_content_hash ON documents(content_hash);
```

---

## 4. API Specification

### 4.1 MCP Tools

MCP 서버는 4개 도구를 노출합니다. stdio 모드(기본)와 SSE 모드를 지원합니다.

#### Tool: `search`

```json
{
  "name": "search",
  "description": "개인 지식 베이스에서 관련 문서/청크를 검색합니다. 자연어 쿼리와 키워드 모두 지원합니다.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "query": { "type": "string", "description": "검색 쿼리 (자연어 또는 키워드)" },
      "limit": { "type": "number", "default": 5, "description": "반환할 결과 수" },
      "tags": { "type": "array", "items": { "type": "string" }, "description": "태그 필터" }
    },
    "required": ["query"]
  }
}
```

**Response**: `SearchResult[]` — 각 결과에 chunk.content, document.title, document.filePath, score 포함

#### Tool: `get-document`

```json
{
  "name": "get-document",
  "description": "문서 ID 또는 파일 경로로 전체 문서 내용을 가져옵니다.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "id": { "type": "string", "description": "문서 ID 또는 파일 경로" }
    },
    "required": ["id"]
  }
}
```

**Response**: Document 전문 (마크다운 + 프론트매터)

#### Tool: `list-topics`

```json
{
  "name": "list-topics",
  "description": "지식 베이스의 전체 토픽/태그 목록과 문서 수를 반환합니다.",
  "inputSchema": {
    "type": "object",
    "properties": {}
  }
}
```

**Response**: `TopicInfo[]` — { topic, count, recentDocuments }

#### Tool: `get-related`

```json
{
  "name": "get-related",
  "description": "특정 문서와 의미적으로 관련된 문서들을 반환합니다.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "id": { "type": "string", "description": "기준 문서 ID 또는 파일 경로" },
      "limit": { "type": "number", "default": 5 }
    },
    "required": ["id"]
  }
}
```

**Response**: 기준 문서의 평균 임베딩으로 semantic search → 관련 문서 목록

### 4.2 Core Internal API

```typescript
// packages/core/src/index.ts — 패키지 공개 API
export { createIndexer, type IndexerOptions } from './indexer/index.js';
export { createSearchEngine, type SearchOptions } from './search/index.js';
export { createStore, type VectorStore } from './store/index.js';
export { createMcpServer, type McpServerOptions } from './mcp/index.js';
export type { Document, Chunk, SearchResult } from './types/index.js';
```

### 4.3 Graph REST API (Phase 2)

```
GET /api/graph          → { nodes: Node[], edges: Edge[] }
GET /api/search?q=...   → SearchResult[]
GET /api/document/:id   → Document
GET /api/clusters       → ClusterInfo[]
```

core의 MCP 서버에 HTTP 엔드포인트를 추가하여 graph가 호출.

---

## 5. UI/UX Design

### 5.1 CLI UX (Phase 1)

```
$ ekh index ~/obsidian-vault
  ████████████████████░░░░  80% (800/1000 files)
  ⏱ Elapsed: 1m 42s | ETA: 25s

✅ Indexing complete
  📄 Files: 1000 | 🧩 Chunks: 4,523 | 🕐 2m 07s
  💾 Database: ~/.ekh/index.db (48 MB)

$ ekh search "OAuth 인증 설계 교훈"
  1. [0.89] 프로젝트A/lessons-learned.md §OAuth 리다이렉트 검증
     "redirect_uri를 화이트리스트로 검증하지 않아 3시간 디버깅..."
  2. [0.76] 프로젝트B/design.md §인증 아키텍처
     "JWT refresh token 전략: 7일 만료 + sliding window..."
  3. [0.71] 교훈/보안.md §API 보안 체크리스트
     "모든 OAuth callback에서 state 파라미터 필수 검증..."

$ ekh serve
  🚀 MCP Server running (stdio mode)
  📚 1000 documents indexed | 4523 chunks
  💡 Claude Code: claude mcp add ekh -- ekh serve
```

### 5.2 3D Graph UI (Phase 2 — 설계만)

```
┌──────────────────────────────────────────────────────────┐
│  🔍 [검색...]                        [클러스터 필터 ▼]  │
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
│  📊 1000 docs | 12 clusters | 3D rendering 60fps        │
└──────────────────────────────────────────────────────────┘
```

---

## 6. Core Algorithm Design

### 6.1 Chunking Strategy

```
문서: "# 제목\n## 섹션A\n내용...\n## 섹션B\n내용..."

Step 1: heading 기반 분할
  → ["# 제목", "## 섹션A\n내용...", "## 섹션B\n내용..."]

Step 2: 길이 검사
  - 300 tokens 이하 → 그대로 사용
  - 300 tokens 초과 → 문장 단위로 재분할 (300 tokens + 50 overlap)

Step 3: 메타데이터 보존
  각 청크에 {heading, startLine, endLine, documentId} 첨부

Step 4: 짧은 청크 병합
  50 tokens 미만인 청크는 이전 청크에 병합
```

**설계 근거**: heading 기반이 paragraph 기반보다 문맥 보존 우수 (Langent 분석). 오버랩 50 tokens으로 청크 경계에서의 정보 손실 최소화.

### 6.2 RRF Hybrid Search

```typescript
function rrfFusion(
  semanticResults: ScoredChunk[],   // cosine similarity 상위 N개
  keywordResults: ScoredChunk[],     // BM25 상위 N개
  k: number = 60                     // RRF 상수
): ScoredChunk[] {
  const scores = new Map<string, number>();

  for (let i = 0; i < semanticResults.length; i++) {
    const id = semanticResults[i].chunkId;
    scores.set(id, (scores.get(id) ?? 0) + 1 / (k + i + 1));
  }

  for (let i = 0; i < keywordResults.length; i++) {
    const id = keywordResults[i].chunkId;
    scores.set(id, (scores.get(id) ?? 0) + 1 / (k + i + 1));
  }

  // score 내림차순 정렬 → 상위 limit개 반환
  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id, score]) => ({ chunkId: id, score }));
}
```

**k=60 선택 근거**: RRF 원 논문(Cormack et al., 2009) 권장값. 실제 효과는 벤치마크에서 조정.

### 6.3 Incremental Indexing

```
파일 변경 감지 (chokidar 또는 수동 재인덱싱):

1. 파일 목록 스캔 → 각 파일의 content_hash 계산 (SHA-256)
2. DB의 기존 content_hash와 비교
   - 동일 → SKIP
   - 다름 → DELETE old chunks → re-chunk → re-embed → INSERT
   - DB에 없음 → 신규 파일, chunk → embed → INSERT
   - 파일 삭제됨 → DELETE document + cascading chunks
3. 체크포인트: 100개 파일마다 진행 상태 저장 → crash 후 이어서 처리
```

---

## 7. Security Considerations

- [x] **데이터 로컬 보관**: 모든 .md, 벡터 DB, 설정 파일이 로컬. 네트워크 요청 없음 (기본)
- [x] **임베딩 API 선택적**: 로컬 모델 기본. OpenAI API는 환경변수 설정 시에만 활성화
- [x] **MCP stdio 모드**: 네트워크 포트 열지 않음. Claude Code가 프로세스 직접 실행
- [ ] **SSE 모드 시**: localhost만 바인딩 (`127.0.0.1:3333`), 외부 접근 차단
- [ ] **환경변수 보안**: `.env`에 API 키 저장 시 `.gitignore`에 포함
- [ ] **.ekh.json**: vault 경로 등 사용자 설정만, 비밀 정보 미포함

---

## 8. Test Plan

### 8.1 Test Scope

| Type | Target | Tool | Phase |
|------|--------|------|:-----:|
| Unit | chunker, bm25, rrf, embedder(mock) | Vitest | 1 |
| Integration | indexer → store → search 파이프라인 | Vitest | 1 |
| MCP | MCP tool 호출 → 응답 검증 | MCP Inspector | 1 |
| Benchmark | 1000/5000/10000 문서 인덱싱·검색 성능 | custom script | 1 |
| E2E | `ekh index` → `ekh search` → 결과 확인 | Vitest + CLI | 1 |
| Visual | 3D 그래프 렌더링 60fps | Chrome DevTools | 2 |

### 8.2 Key Test Cases

```
Phase 1:
- [ ] 빈 vault → 에러 없이 "0 files indexed" 출력
- [ ] 1000개 .md → 3분 내 인덱싱 완료
- [ ] "인증 설계" 검색 → "authentication", "OAuth", "로그인" 문서도 반환 (시맨틱)
- [ ] 파일 수정 → 30초 내 검색 결과 반영 (watcher)
- [ ] MCP search tool → 상위 5개 관련 청크 + 메타데이터 반환
- [ ] 동일 파일 재인덱싱 → SKIP (content_hash 동일)
- [ ] Windows/macOS/Linux에서 SQLite-vec 정상 작동

Phase 2:
- [ ] 1만 노드 3D 그래프 60fps 렌더링
- [ ] 노드 클릭 → 1초 내 문서 미리보기
- [ ] 검색어 → 관련 노드 하이라이트
```

---

## 9. Clean Architecture

### 9.1 Layer Structure (Option C)

```
packages/core/src/
├── types/          [Domain Layer]      순수 타입, 인터페이스 정의
├── indexer/        [Application Layer] 비즈니스 로직: 스캔, 청킹, 임베딩
├── search/         [Application Layer] 비즈니스 로직: BM25, 시맨틱, RRF
├── store/          [Infrastructure]    SQLite-vec 구현체
├── mcp/            [Presentation]      MCP 프로토콜 처리, tool 라우팅
└── index.ts        [Facade]            공개 API 노출

packages/cli/src/
├── commands/       [Presentation]      CLI 명령어 (사용자 인터페이스)
└── utils/          [Infrastructure]    터미널 출력 포맷팅
```

### 9.2 Dependency Rules

```
types/ ← 의존 없음 (순수 타입)
  ↑
indexer/, search/ ← types/만 의존, store 인터페이스만 참조
  ↑
store/ ← types/ 의존, better-sqlite3 의존
  ↑
mcp/ ← search/, store/, types/ 의존
  ↑
cli/ ← core 패키지 전체 의존 (facade import)
```

**핵심 규칙**: `indexer/`, `search/`는 `store/` 구현체를 직접 import하지 않음. `VectorStore` 인터페이스만 참조. 의존성 주입으로 연결.

### 9.3 Dependency Injection Pattern

```typescript
// core/src/index.ts — 조립 포인트
export function createKnowledgeHub(config: EkhConfig) {
  const store = createSqliteVecStore(config.dbPath);
  const embedder = createLocalEmbedder(config.modelName);
  const indexer = createIndexer({ store, embedder });
  const search = createSearchEngine({ store, embedder });
  const mcp = createMcpServer({ search, store });

  return { store, embedder, indexer, search, mcp };
}
```

CLI와 graph 모두 이 `createKnowledgeHub()`로 초기화. 교체 시 config만 변경.

---

## 10. Coding Convention

### 10.1 This Feature's Conventions

| Item | Convention |
|------|-----------|
| **Language** | TypeScript strict (core, cli). 기존 sync: JS 유지 |
| **Module** | ESM (`"type": "module"`, `.ts` → `.js` import) |
| **Naming** | 파일: kebab-case.ts, 타입: PascalCase, 함수: camelCase |
| **Error** | `Result<T, Error>` 반환 패턴. throw는 예외적 상황만 |
| **Export** | 각 폴더에 index.ts barrel export. `core/src/index.ts`가 facade |
| **Test** | `*.test.ts` 파일, 동일 폴더에 위치 |
| **Import order** | node: → 외부 패키지 → 내부 모듈 → 상대 경로 → 타입 |

### 10.2 설정 파일 구조

```jsonc
// .ekh.json (사용자 설정 — vault 루트 또는 홈 디렉토리)
{
  "vaultPath": "~/obsidian-vault",
  "dbPath": "~/.ekh/index.db",
  "embedding": {
    "model": "local",           // "local" | "openai"
    "localModel": "all-MiniLM-L6-v2"
  },
  "chunking": {
    "maxTokens": 300,
    "overlap": 50,
    "minTokens": 50
  },
  "search": {
    "defaultLimit": 10,
    "rrfK": 60
  },
  "mcp": {
    "mode": "stdio",            // "stdio" | "sse"
    "port": 3333                // SSE 모드 시
  }
}
```

---

## 11. Implementation Guide

### 11.1 File Structure (Option C — Pragmatic Split)

```
evan-knowledge-hub/
├── package.json                     workspace root
├── .env                             공유 환경변수
├── .ekh.json                        사용자 설정 (git-ignored)
├── .gitignore
├── tsconfig.base.json               공유 TS 설정
├── docs/                            PDCA 문서
│
├── packages/
│   ├── sync/                        기존 notion-obsidian-sync (변경 없음)
│   │   ├── package.json
│   │   ├── .env                     sync 전용 환경변수
│   │   ├── sync-to-obsidian.mjs
│   │   ├── upload-pdca-to-notion.mjs
│   │   ├── run-sync.mjs
│   │   └── setup-scheduler.mjs
│   │
│   ├── core/                        핵심 엔진 + MCP
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── vitest.config.ts
│   │   ├── src/
│   │   │   ├── index.ts             facade (createKnowledgeHub)
│   │   │   ├── config.ts            .ekh.json 로딩
│   │   │   ├── types/
│   │   │   │   ├── document.ts
│   │   │   │   ├── chunk.ts
│   │   │   │   ├── search.ts
│   │   │   │   └── index.ts
│   │   │   ├── indexer/
│   │   │   │   ├── scanner.ts       vault .md 스캔 + frontmatter 파싱
│   │   │   │   ├── chunker.ts       heading 기반 청킹
│   │   │   │   ├── embedder.ts      Embedder 인터페이스 정의
│   │   │   │   ├── local-embedder.ts  로컬 임베딩 구현 (all-MiniLM-L6-v2)
│   │   │   │   ├── watcher.ts       chokidar 파일 감시
│   │   │   │   └── index.ts         indexVault()
│   │   │   ├── search/
│   │   │   │   ├── bm25.ts          BM25 키워드 검색 (FTS5)
│   │   │   │   ├── semantic.ts      벡터 유사도 검색
│   │   │   │   ├── rrf.ts           Reciprocal Rank Fusion
│   │   │   │   └── index.ts         createSearchEngine()
│   │   │   ├── store/
│   │   │   │   ├── types.ts         VectorStore 인터페이스
│   │   │   │   ├── sqlite-vec.ts    SQLite-vec 구현체
│   │   │   │   └── index.ts         createStore()
│   │   │   └── mcp/
│   │   │       ├── server.ts        MCP 서버 (stdio + SSE)
│   │   │       ├── tools/
│   │   │       │   ├── search.ts
│   │   │       │   ├── get-document.ts
│   │   │       │   ├── list-topics.ts
│   │   │       │   └── get-related.ts
│   │   │       └── index.ts         createMcpServer()
│   │   └── tests/
│   │       ├── chunker.test.ts      청킹 로직 (8 tests)
│   │       ├── rrf.test.ts          RRF 퓨전 (4 tests)
│   │       ├── store.test.ts        SQLite-vec CRUD (4 tests)
│   │       ├── bm25.test.ts         BM25 쿼리 전처리 (6 tests)
│   │       ├── search-integration.test.ts  파이프라인 통합 (6 tests)
│   │       └── mcp.test.ts          MCP 도구 핸들러 (11 tests)
│   │
│   ├── cli/                         CLI (npm 배포용)
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   └── commands/
│   │   │       ├── index-cmd.ts     ekh index
│   │   │       ├── search-cmd.ts    ekh search
│   │   │       ├── serve-cmd.ts     ekh serve
│   │   │       └── status-cmd.ts    ekh status
│   │   └── bin/
│   │       └── ekh.js               #!/usr/bin/env node
│   │
│   └── graph/                       Phase 2에서 추가
│
└── scripts/
    ├── migrate-to-monorepo.mjs
    └── benchmark.mjs
```

### 11.2 Implementation Order

#### Phase 1 (Session 순서)

```
1. [ ] 모노레포 셋업
       - workspace root package.json
       - packages/sync/ 이동 + 스케줄러 경로 수정
       - tsconfig.base.json
       - packages/core/ + packages/cli/ 빈 패키지 생성

2. [ ] types/ + config
       - Document, Chunk, SearchResult, SearchOptions 타입
       - VectorStore, Embedder 인터페이스
       - .ekh.json 로더

3. [ ] store/ (SQLite-vec)
       - better-sqlite3 + sqlite-vec 설정
       - 테이블 생성 (documents, chunks, chunk_embeddings, chunks_fts)
       - VectorStore 구현: upsert, delete, searchSemantic, searchKeyword

4. [ ] indexer/ (scanner + chunker + embedder)
       - scanner: glob + frontmatter 파싱
       - chunker: heading 분할 + 오버랩 + 병합
       - embedder: @xenova/transformers + nomic-embed-text
       - createIndexer: 스캔 → 청킹 → 임베딩 → 저장 파이프라인

5. [ ] search/ (BM25 + semantic + RRF)
       - bm25: FTS5 MATCH 쿼리
       - semantic: vec0 거리 검색
       - rrf: 두 결과 합산

6. [ ] mcp/ (서버 + 4 tools)
       - MCP SDK 서버 설정 (stdio)
       - search, get-document, list-topics, get-related 구현

7. [ ] cli/ (4 commands)
       - ekh index, ekh search, ekh serve, ekh status
       - bin/ekh.js 엔트리포인트

8. [ ] watcher + 증분 인덱싱
       - chokidar 파일 감시
       - content_hash 비교 → 변경분만 재처리

9. [ ] 테스트 + 벤치마크 + README
```

### 11.3 Session Guide

#### Module Map

| Module | Scope Key | Description | Estimated Effort |
|--------|-----------|-------------|:----------------:|
| 모노레포 셋업 + types | `module-1` | workspace, 패키지 뼈대, 타입 정의 | Small |
| Store (SQLite-vec) | `module-2` | 벡터 DB 스키마 + CRUD 구현 | Medium |
| Indexer (scan+chunk+embed) | `module-3` | 파일 스캔, 청킹, 임베딩 파이프라인 | Large |
| Search (BM25+semantic+RRF) | `module-4` | 하이브리드 검색 엔진 | Medium |
| MCP Server (4 tools) | `module-5` | MCP 프로토콜 + tool 구현 | Medium |
| CLI (4 commands) | `module-6` | 사용자 CLI 인터페이스 | Small |
| Watcher + 증분 | `module-7` | 파일 감시, 증분 인덱싱 | Small |
| 테스트 + 벤치마크 | `module-8` | 단위/통합 테스트, 성능 벤치마크 | Medium |

#### Recommended Session Plan

| Session | Scope | 내용 |
|---------|-------|------|
| **Session 1** | `--scope module-1` | 모노레포 전환 + types + config |
| **Session 2** | `--scope module-2,module-3` | Store + Indexer (핵심 파이프라인) |
| **Session 3** | `--scope module-4,module-5` | Search + MCP Server |
| **Session 4** | `--scope module-6,module-7` | CLI + Watcher |
| **Session 5** | `--scope module-8` | 테스트 + 벤치마크 + 마무리 |

---

## 12. Extended Features (Feature Discovery 반영)

> Feature Discovery 분석: `docs/00-pm/evan-knowledge-hub-features.md` (20개 기능)
> 마켓플레이스 컨셉 추가 (2026-03-30 세션)

### 12.1 Phase별 추가 기능 로드맵

#### Phase 1 추가 (MCP tool 확장 — 핵심 일정 영향 최소)

| ID | 기능 | MCP Tool | 설명 |
|----|------|----------|------|
| F13 | **CLAUDE.md 자동 생성** | `generate-claude-md` | vault에서 프로젝트 지식 추출 → CLAUDE.md 템플릿 생성. **킬러 유스케이스** |
| F10 | **컨텍스트 스냅샷** | `create-snapshot`, `load-snapshot` | 프로젝트별 관련 지식 묶음 저장/로딩 |
| F14 | **결정 저널** | `log-decision`, `find-decisions` | 기술 결정 구조화 기록 → decisions/ 폴더에 자동 저장 |
| F20 | **지식 내보내기** | `export` | 벡터 DB를 JSON-LD/CSV로 내보내기 (락인 방지) |
| F11 | **적응형 검색** | (search 확장) | 현재 작업 컨텍스트 기반 검색 가중치 동적 조정 |

#### Phase 1.5 (신규 — 3D 그래프 전 준비)

| ID | 기능 | 설명 |
|----|------|------|
| F05 | **시맨틱 클러스터링 + 자동 태깅** | HDBSCAN → 클러스터 라벨 → Obsidian frontmatter 역주입 |

#### Phase 2 추가 (3D 시각화 확장)

| ID | 기능 | 설명 |
|----|------|------|
| F06 | **지식 히트맵** | 노드 색상/크기를 수정일·접근빈도에 매핑. 활발=밝음, 방치=흐림 |
| F09 | **지식 감쇠 모델 (FSRS)** | 안 본 지식은 흐려지고, 자주 쓰는 건 강화. MCP 검색 가중치에도 반영 |
| F02 | **지식 진화 타임라인** | 시간 축 추가 (4D). 같은 주제의 시맨틱 드리프트 시각화 |
| F01 | **지식 공백 탐지** | 클러스터 간 브릿지 부족 영역 자동 감지 → "이 주제 노트 부족" 알림 |
| F16 | **그래프 스크린샷/임베드** | canvas → PNG/WebM 내보내기 + iframe 임베드 코드. **바이럴 엔진** |
| F15 | **코드-지식 링커** | git 커밋/PR에서 키워드 추출 → 관련 노트 자동 연결 |

#### Phase 2.5 추가 (모션 제어 + 별자리)

| ID | 기능 | 설명 |
|----|------|------|
| — | **웹캠 모션 제어** | MediaPipe Hands → 손 제스처로 3D 그래프 회전/줌/선택 |
| F07 | **별자리 뷰** | 클러스터를 별자리로 표현. 줌아웃=지식 우주, 줌인=개별 노드 |
| F17 | **지식 프로필 카드** | GitHub README용 SVG 카드 자동 생성 (레이더 차트 형태) |

#### Phase 3 추가 (마켓플레이스 + Pro)

| ID | 기능 | 설명 |
|----|------|------|
| F21 | **Knowledge Pack 포맷 + 이식** | 지식 청크를 표준 패키지로 내보내기/가져오기 (에이전트 간 이식) |
| F12 | **크로스 볼트 연합** | 여러 vault를 통합 검색, 물리적으로는 분리 |
| F18 | **커뮤니티 지식 템플릿** | 도메인별 vault 구조 scaffold |
| F19 | **암호화 볼트 동기화** | E2E 암호화 + 벡터 DB 동기화 |

### 12.2 Knowledge Pack 포맷 + 이식 (F21) — 상세 설계

#### 컨셉

```
마켓플레이스는 범위 밖. 표준 포맷만 정의하여 로컬 이식 가능하게.
.ekh-pack 파일을 Git, Dropbox, USB 등으로 자유롭게 주고받는 구조.
마켓플레이스는 포맷이 표준화되면 나중에 별도 프로젝트로 가능.
```

#### Knowledge Pack 스펙

```typescript
// .ekh-pack.json
interface KnowledgePack {
  name: string;                    // "react-auth-patterns"
  version: string;                 // semver
  author: string;
  license: string;                 // MIT, CC-BY 등
  description: string;
  tags: string[];

  // 청크 데이터
  chunks: PackChunk[];

  // 호환성
  embeddingModel: string;          // "nomic-embed-text-v1.5"
  embeddingDimensions: number;     // 768
  schemaVersion: string;           // "1.0"
}

interface PackChunk {
  id: string;
  content: string;                 // 지식 내용 (마크다운)
  heading: string;
  embedding: number[];             // 768차원 벡터
  metadata: {
    category: string;              // "pattern" | "antipattern" | "lesson" | "reference"
    severity?: string;             // "critical" | "important" | "tip"
    context?: string;              // "production" | "development" | "design"
    language?: string;             // "typescript" | "python" 등
    framework?: string;            // "react" | "nextjs" 등
  };
}
```

#### CLI 명령어

```bash
# 팩 생성 (내 vault에서 추출)
ekh pack create <name> --tags react,auth --from-cluster <cluster-id>
ekh pack create <name> --from-search "OAuth 인증 패턴"

# 팩 관리
ekh pack list                    # 설치된 팩 목록
ekh pack info <name>             # 팩 상세 정보
ekh pack remove <name>           # 팩 제거

# 이식 (로컬 파일 기반)
ekh pack export <name> -o ./react-auth.ekh-pack   # 파일로 내보내기
ekh pack import ./react-auth.ekh-pack              # 파일에서 가져오기 → 벡터 DB 병합
```

#### 에이전트 간 공유 시나리오

```
팀원 A: ekh pack create "our-project-patterns" --from-search "프로젝트X"
        ekh pack export "our-project-patterns" -o ./shared/
        → Git repo에 커밋

팀원 B: ekh pack import ./shared/our-project-patterns.ekh-pack
        → 팀원 A의 경험이 팀원 B의 Claude Code MCP에 로딩
        → "이 패턴은 our-project-patterns 팩에 따르면..." 자동 참조
```

#### 보안/프라이버시

```
팩 생성 시 자동 처리:
  1. PII 제거 (이름, 이메일, URL, API 키 감지 → 마스킹)
  2. 회사 내부 정보 경고 (proprietary 키워드 감지)
  3. 임베딩만 공유 옵션 (원문 없이 벡터만 → 검색 가능하지만 내용 열람 불가)
  4. 라이선스 명시 필수 (CC-BY, MIT 등)
```

### 12.3 모션 제어 상세 설계 (Phase 2.5)

#### 기술 스택

```
MediaPipe Hands (Google)
  → 21 hand landmarks, 30fps webcam tracking
  → WASM/WebGL 기반, 브라우저에서 직접 실행 (서버 불필요)

제스처 매핑:
  ✋ 펼친 손 + 이동       → 그래프 회전 (orbit)
  ✊ 주먹 쥐기 + 이동     → 그래프 패닝 (pan)
  🤏 핀치 (엄지+검지)     → 줌 인/아웃
  👆 검지 포인팅           → 노드 선택 (raycast)
  👋 손 흔들기             → 뒤로 가기 / 줌 리셋
  🤙 Rock 제스처           → 별자리 뷰 토글
```

#### 구현 구조

```typescript
// packages/graph/src/lib/motion-controller.ts
interface MotionController {
  enable(): Promise<void>;          // 웹캠 시작 + MediaPipe 초기화
  disable(): void;                   // 웹캠 종료
  onGesture(callback: (gesture: Gesture) => void): void;
  isEnabled: boolean;
}

interface Gesture {
  type: 'rotate' | 'pan' | 'zoom' | 'select' | 'reset' | 'toggle-constellation';
  position?: { x: number; y: number; z: number };
  delta?: { x: number; y: number };
  scale?: number;
  confidence: number;
}

// Three.js 카메라 컨트롤에 연결
// 기존 OrbitControls와 MotionController를 InputManager로 통합
```

#### UX

```
┌──────────────────────────────────────────────────────────┐
│  🔍 [검색...]       [👋 모션 ON/OFF]  [⭐ 별자리 뷰]   │
├──────────────────────────────────────┬───────────────────┤
│                                      │ 📷 웹캠 미리보기  │
│    ✨ ✨ ✨                          │ ┌─────────────┐  │
│   ✨ ✨✨ ✨  ✨ ✨                   │ │  ✋ 추적 중  │  │
│    ✨ ✨   ✨  ✨                     │ │  ← 회전 →   │  │
│             ✨                        │ └─────────────┘  │
│   [3D Knowledge Graph]               │                   │
│                                      │ 현재 제스처:      │
│    ✨ ✨✨                            │ ✋ 회전 모드      │
│   ✨ ✨ ✨✨                          │                   │
│    ✨ ✨                              │ [📄 문서 미리보기]│
├──────────────────────────────────────┴───────────────────┤
│  📊 1000 docs | 12 clusters | Motion: Active | 60fps    │
└──────────────────────────────────────────────────────────┘
```

### 12.4 킬러 조합 (Compound Features)

```
Combo 1: "지식의 생명력"
  히트맵(F06) + 감쇠 모델(F09) + 타임라인(F02)
  → 3D 그래프에서 지식이 살아 숨쉬는 유기체
  → "당신의 지식은 살아있습니다"

Combo 2: "개발자의 두 번째 뇌"
  CLAUDE.md 생성(F13) + 결정 저널(F14) + 스냅샷(F10) + 적응형 검색(F11)
  → Claude Code 워크플로우 완전 통합
  → "Claude가 당신의 모든 프로젝트를 기억합니다"

Combo 3: "지식 우주 공유"
  별자리 뷰(F07) + 모션 제어 + 스크린샷(F16) + 프로필 카드(F17)
  → 손으로 별자리 탐험하는 데모 = 바이럴 킬러
  → "Show your knowledge universe"

Combo 4: "경험의 이식" (신규)
  Knowledge Pack(F21) + 에이전트 간 공유
  → 팀원/커뮤니티 간 지식 팩 파일로 경험 이식
  → "ekh pack import senior-experience.ekh-pack"
```

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 0.1 | 2026-03-30 | Initial draft — Option C (Pragmatic Split) 선택 | Evan (KHS) |
| 0.2 | 2026-03-30 | Extended Features 20개 + 마켓플레이스(F21) + 모션 제어 상세 추가 | Evan (KHS) |
| 0.3 | 2026-03-30 | Phase 1 완료 동기화: 임베딩 모델(MiniLM 384d), VectorStore 메서드 추가, 테스트 6개 반영 | Evan (KHS) |
