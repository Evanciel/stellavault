# Stellavault Lazy Init for MCP Server — Implementation Spec

**작성자**: jarvis-agent 세션 (2026-04-17)
**대상**: 이 문서를 읽는 새 세션 (또는 Evan 본인)
**예상 작업**: 30분~1시간
**우선순위**: HIGH — Jarvis 같은 MCP 클라이언트의 `initialize` timeout 이슈 영구 해결

---

## 1. 문제

현재 `stellavault serve` 는 MCP stdio 핸드셰이크 전에 heavy init을 전부 끝낸다.

```ts
// packages/cli/src/commands/serve-cmd.ts (현재)
await hub.store.initialize();      // ← BLOCKS: DB 오픈 + 인덱스 로드
await hub.embedder.initialize();   // ← BLOCKS: 임베딩 모델 로드
const stats = await hub.store.getStats();
console.error(...);
await hub.mcpServer.startStdio();  // ← 여기서 비로소 MCP 프로토콜 응답 시작
```

MCP 클라이언트(예: Jarvis)는 spawn 후 JSON-RPC `initialize` 요청을 보내고 응답을 기다린다. 위 구조에서는 **인덱스 로딩이 끝나야만** 응답한다.

### 재현 증거 (jarvis-agent 측 측정, 1215 노트 기준)

```
[mcp:stellavault] slow init: ~3000ms   (노트 1215개)
[mcp:filesystem]  slow init: 3571ms    (정상 MCP 서버도 cold start는 3~4s)
```

선형 외삽:
- 10K 노트 → ~30s 초과 가능성 (Jarvis timeout 45s 근접)
- 30K+ → 확실히 timeout
- Jarvis가 아닌 다른 MCP 클라이언트(Claude Desktop 등)는 더 짧은 timeout 쓸 수 있음

## 2. 원인 (파일 단위)

### 2-1. `packages/cli/src/commands/serve-cmd.ts`
현재 17줄. `hub.store.initialize()` + `hub.embedder.initialize()` 를 순차 await 하고 나서야 `mcpServer.startStdio()` 를 호출.

### 2-2. `packages/core/src/mcp/server.ts`
`createMcpServer({ store, searchEngine, vaultPath })` — 핸들러들이 `store`, `searchEngine` 을 **참조**로 받음. init 여부를 알지 못함.
- `ListToolsRequestSchema` 핸들러: 정적 스키마만 반환 — **store 필요 없음** ✓
- `CallToolRequestSchema` 핸들러: `handleSearch(searchEngine, ...)` 등 → **store/embedder 필요** ✗

### 2-3. `packages/core/src/index.ts`
`createKnowledgeHub` 이 store/embedder/searchEngine/mcpServer 를 전부 동시 생성 후 묶음. ready 상태 개념 없음.

## 3. Fix 플랜

**핵심 원칙**: `initialize` 는 즉시 응답 → `tools/call` 에서만 인덱스 준비 대기.

### 3-1. `createMcpServer` — `ready` 옵션 추가

```ts
// packages/core/src/mcp/server.ts
export interface McpServerOptions {
  store: KnowledgeStore;
  searchEngine: SearchEngine;
  vaultPath: string;
  embedder?: Embedder;
  decayEngine?: DecayEngine;
  /** Resolves once store/embedder are fully initialized.
   *  Tool handlers await this before running any query.
   *  Default: already-resolved Promise (backward compatible). */
  ready?: Promise<void>;
}

export function createMcpServer(opts: McpServerOptions) {
  const { store, searchEngine, vaultPath, embedder, decayEngine } = opts;
  const ready = opts.ready ?? Promise.resolve();

  // ... existing tool creation ...

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [...]  // unchanged — static schemas, no index needed
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    await ready;  // ← block until index is loaded (first call only; subsequent calls no-op)
    const { name, arguments: args } = request.params;
    // ... existing switch ...
  });

  return {
    async startStdio() { ... },
    async startHttp(port) { ... },
  };
}
```

### 3-2. `createKnowledgeHub` — `ready` 플러밍

```ts
// packages/core/src/index.ts
export function createKnowledgeHub(
  config: StellavaultConfig,
  options: { ready?: Promise<void> } = {},
) {
  const embedder = _createEmbedder(config.embedding.localModel);
  const dims = embedder.dimensions;
  const store = _createStore(config.dbPath, dims);
  const searchEngine = _createSearch({ store, embedder, rrfK: config.search.rrfK });
  const mcpServer = _createMcp({
    store, searchEngine, vaultPath: config.vaultPath,
    ready: options.ready,
  });
  return { store, embedder, searchEngine, mcpServer, config };
}
```

### 3-3. `serveCommand` — 인덱스 로드를 백그라운드로

```ts
// packages/cli/src/commands/serve-cmd.ts
import chalk from 'chalk';
import { loadConfig, createKnowledgeHub } from '@stellavault/core';

export async function serveCommand() {
  const config = loadConfig();

  // Create the hub FIRST (shells only — no I/O yet)
  // Pass a ready promise so MCP tool handlers await it.
  let resolveReady!: () => void;
  const ready = new Promise<void>((r) => { resolveReady = r; });
  const hub = createKnowledgeHub(config, { ready });

  console.error(chalk.green('🚀 MCP Server running (stdio mode) — index loading in background'));

  // Start MCP transport IMMEDIATELY so handshake responds
  const serverPromise = hub.mcpServer.startStdio();

  // Load stores in background. First tool call will await ready.
  (async () => {
    try {
      await hub.store.initialize();
      await hub.embedder.initialize();
      const stats = await hub.store.getStats();
      console.error(`📚 ${stats.documentCount} documents | ${stats.chunkCount} chunks (ready)`);
      resolveReady();
    } catch (err) {
      console.error(chalk.red('index load failed: ' + (err as Error).message));
      // Keep server running but tools/call will hang on `ready` — acceptable.
      // Alternative: resolveReady anyway and let individual tool calls throw.
    }
  })();

  await serverPromise; // runs until stdio closes
}
```

## 4. 왜 이게 안전한가

- `ListToolsRequestSchema` 핸들러는 **정적 스키마만** 반환 — 어떤 init 상태에서도 안전
- `CallToolRequestSchema` 핸들러의 `await ready` 는 인덱스가 **이미 준비됐으면 즉시 통과** — 비용 거의 0
- 후속 호출들은 `ready` promise 가 이미 resolve 된 상태 → 일반적인 await 노이즈 수준
- 기존 Tests — `ready` 기본값이 `Promise.resolve()` 라 시그니처 변경 backward compatible

## 5. 검증 계획

### 5-1. Standalone (Stellavault 단독)
```bash
cd E:/AI코딩프로젝트/클로드코드/notion-obsidian-sync
npm run build
# initialize 핸드셰이크 시간 측정
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"0"}}}' \
  | node dist/stellavault.js serve \
  | head -1
# 목표: 100ms 이내 응답 (이전엔 3000ms)
```

### 5-2. tools/call 지연 확인
`initialize` 직후 바로 `tools/call` (search) 보냈을 때:
- 첫 호출: 인덱스 로딩 대기 → ~3s (정상)
- 두 번째 호출: 즉시 반환 (<100ms)

### 5-3. Jarvis 측 telemetry 로그 확인
Jarvis 재시작 시 stellavault init 로그:
- Before: `[mcp:stellavault] slow init: ~3000ms`
- After: (3s 경고 없음 — 초기 init 즉시 통과)

## 6. 리스크 & 완화

| 리스크 | 완화 |
|--------|------|
| `embedder.initialize()` 실패 → `ready` 영구 pending | catch 블록에서 `resolveReady()` 여도 호출, 개별 tool 핸들러에서 상태 확인해 에러 리턴 |
| HTTP 모드 (`startHttp`) 에도 같은 이슈 | 동일 패턴 적용 — 이미 같은 `createMcpServer` 사용하므로 자동 커버 |
| 기존 클라이언트가 `capabilities` 를 fully-init 기준으로 협상 | 현재 `capabilities: { tools: {} }` 만 선언 — 정적 → 영향 없음 |

## 7. 체크리스트

- [ ] `packages/core/src/mcp/server.ts` — `McpServerOptions` 타입에 `ready` 추가
- [ ] `packages/core/src/mcp/server.ts` — `CallToolRequestSchema` 핸들러 상단에 `await ready`
- [ ] `packages/core/src/index.ts` — `createKnowledgeHub` signature + 전달
- [ ] `packages/cli/src/commands/serve-cmd.ts` — background init 패턴
- [ ] `npm run build --workspaces` + `npm run bundle`
- [ ] `dist/stellavault.js` 갱신 확인
- [ ] 위 §5 검증 수행
- [ ] (선택) Jarvis `STELLAVAULT_INIT_TIMEOUT_MS` 기본값을 45s → 10s 로 롤백 가능 확인

## 8. 참고: Jarvis 측 관련 변경 (이미 완료)

`jarvis-agent` 리포 commit `5a18073` 에서 MCP timeout 을 configurable 로 리팩터 + per-server override + slow-init 로그 추가. Stellavault 의 lazy init 이 완료되면 Jarvis 의 45s 버퍼는 불필요해짐 (그냥 기본 30s 로 둬도 됨).
