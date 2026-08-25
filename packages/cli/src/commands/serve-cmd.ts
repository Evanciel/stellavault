import chalk from 'chalk';
import { loadConfig, createKnowledgeHub, createWatcher, createLocalEmbedder, invalidateGapCache, summarizeIndexRun, runMaintenanceIfOwned } from '@stellavault/core';
import { refuseForeignDbEarly } from '../db-guard.js';

export async function serveCommand() {
  const config = loadConfig();

  // Lazy init: MCP handshake responds immediately, heavy init runs in background.
  // First tools/call blocks on `ready` until store + embedder are loaded.
  let resolveReady!: () => void;
  const ready = new Promise<void>((r) => { resolveReady = r; });
  const hub = createKnowledgeHub(config, { ready });

  console.error(chalk.green('🚀 MCP Server running (stdio mode) — index loading in background'));
  console.error(chalk.dim('💡 Claude Code: claude mcp add stellavault -- stellavault serve'));

  // Start MCP transport IMMEDIATELY so handshake responds
  const serverPromise = hub.mcpServer.startStdio();

  // 2026-05-15: chokidar watcher 통합. 기존엔 createWatcher 가 export 만 되고
  // 어디서도 호출 안 됐음. serve 가 동작 중인 동안 vault 변경 (자비스 daily
  // deep-notes 등) 을 자동 incremental re-index → DB 항상 fresh. STELLAVAULT_
  // WATCH=0 env 로 비활성 가능 (특수 환경에서 watcher 불필요한 경우).
  const watcherEnabled = (process.env.STELLAVAULT_WATCH ?? '1').trim() !== '0';
  let watcherHandle: { start(): void; stop(): void } | null = null;

  // Load stores in background. First tool call will await ready.
  (async () => {
    try {
      const t0 = Date.now();
      // 🔴 여는 것 자체가 WAL·스키마를 쓴다 — 그 전에 묻는다 (코덱스 15차 P1).
      refuseForeignDbEarly(config.dbPath, config.vaultPath ?? '', 'serve');
      await hub.store.initialize();
      await hub.embedder.initialize();
      // 🔴 유지보수를 initialize() 에서 뺀 이유는 "색인기만 부르게 하려고" 가 아니라
      //    <소유를 묻기 전에 돌지 않게> 하려는 것이다 (12차 P1). 한때 여기 "색인기만
      //    부른다" 고 적고 <바로 다음 줄에서> 스스로 불렀다 — 문구가 구현과 반대였고,
      //    코덱스 15차가 그것을 짚었다.
      //    serve 의 감시자는 `ignoreInitial: true` 라 파일이 안 바뀌면 색인기가 아예
      //    안 돌고, 그러면 고아 임베딩이 KNN 슬롯을 계속 차지한다 (코덱스 13차 P2).
      //    소유가 <이미 확정된> DB 에서만 돈다 — 모르면 안 만진다.
      runMaintenanceIfOwned(hub.store, config.vaultPath ?? '');
      const stats = await hub.store.getStats();
      const elapsed = Date.now() - t0;
      console.error(`📚 ${stats.documentCount} documents | ${stats.chunkCount} chunks (ready in ${elapsed}ms)`);
      resolveReady();

      // store/embedder ready → watcher 시작 (이전엔 진입점 부재로 dead code).
      if (watcherEnabled && config.vaultPath) {
        try {
          watcherHandle = createWatcher({
            vaultPath: config.vaultPath,
            store: hub.store,
            embedder: hub.embedder,
            chunkOptions: config.chunking,
            debounceMs: Number(process.env.STELLAVAULT_WATCH_DEBOUNCE_MS ?? 5000),
            onReindex: (r) => {
              // 🔴 미룬 삭제·실패·"남의 DB" 를 <조용히 삼키지> 않는다 (코덱스 10차 P2).
              //    ⚠️ 이 꼬리말을 손으로 조립하던 시절, 문구가 구현보다 오래 살았다:
              //    "소유 미확인 → 삭제만 건너뜀" 은 <이미 폐기된 규칙>인데 계속 찍혔고,
              //    실패 수는 아예 빠져 있었다 (코덱스 12차 P2). 이제 한 곳에서 만든다.
              const summary = summarizeIndexRun(r);
              const extra = summary.note ? ', ' + summary.note : '';
              console.error(`👀 watcher reindex: ${r.indexed} indexed, ${r.skipped} unchanged${extra}`);
              // 2026-05-15: reindex 후 gap-cache invalidate — 다음 detect-gaps
              // 호출 시 fresh compute 보장 (6h TTL 의 stale 위험 제거).
              // 🔴 <성공한 실행에서만> 건드린다 (코덱스 14차 P1). 색인기가 "남의 DB" 라고
              //    아무것도 안 하고 돌아왔는데 여기서 캐시를 지우면, 그 DB 에 <쓰기가
              //    일어난다>. 색인기가 한 글자도 안 쓰기로 한 약속이 옆문으로 깨진다.
              //    ★그리고 지울 이유도 없다 — 색인이 아무것도 안 바꿨으니 캐시는 여전히 맞다.
              if (summary.ok) {
                try { invalidateGapCache(hub.store.getDb() as any); } catch { /* ignore */ }
              }
            },
          });
          watcherHandle.start();
          console.error(chalk.green(`👀 Watcher started (debounce ${process.env.STELLAVAULT_WATCH_DEBOUNCE_MS ?? 5000}ms) — vault changes auto-reindex`));
        } catch (err) {
          console.error(chalk.yellow('⚠️ Watcher init failed: ' + (err as Error).message));
        }
      } else if (!watcherEnabled) {
        console.error(chalk.dim('👀 Watcher disabled (STELLAVAULT_WATCH=0)'));
      } else {
        console.error(chalk.dim('👀 Watcher skipped (no config.vaultPath set)'));
      }
    } catch (err) {
      console.error(chalk.red('❌ Index load failed: ' + (err as Error).message));
      // Resolve anyway so tool handlers don't hang forever — they'll get errors from store
      resolveReady();
    }
  })();

  // Graceful shutdown — watcher cleanup on signal
  const cleanup = () => {
    try { watcherHandle?.stop(); } catch { /* ignore */ }
  };
  process.once('SIGINT', () => { cleanup(); process.exit(130); });
  process.once('SIGTERM', () => { cleanup(); process.exit(143); });

  await serverPromise;
  cleanup();
}
