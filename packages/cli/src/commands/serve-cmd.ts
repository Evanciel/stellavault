import chalk from 'chalk';
import { loadConfig, createKnowledgeHub, createWatcher, createLocalEmbedder, invalidateGapCache } from '@stellavault/core';

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
      await hub.store.initialize();
      await hub.embedder.initialize();
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
              console.error(`👀 watcher reindex: ${r.indexed} indexed, ${r.skipped} unchanged`);
              // 2026-05-15: reindex 후 gap-cache invalidate — 다음 detect-gaps
              // 호출 시 fresh compute 보장 (6h TTL 의 stale 위험 제거).
              try { invalidateGapCache(hub.store.getDb() as any); } catch { /* ignore */ }
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
