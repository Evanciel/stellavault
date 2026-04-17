import chalk from 'chalk';
import { loadConfig, createKnowledgeHub } from '@stellavault/core';

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
    } catch (err) {
      console.error(chalk.red('❌ Index load failed: ' + (err as Error).message));
      // Resolve anyway so tool handlers don't hang forever — they'll get errors from store
      resolveReady();
    }
  })();

  await serverPromise;
}
