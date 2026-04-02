import chalk from 'chalk';
import { loadConfig, createKnowledgeHub } from '@stellavault/core';

export async function serveCommand() {
  const config = loadConfig();
  const hub = createKnowledgeHub(config);

  await hub.store.initialize();
  await hub.embedder.initialize();

  const stats = await hub.store.getStats();
  console.error(chalk.green('🚀 MCP Server running (stdio mode)'));
  console.error(`📚 ${stats.documentCount} documents | ${stats.chunkCount} chunks`);
  console.error(chalk.dim('💡 Claude Code: claude mcp add stellavault -- stellavault serve'));

  await hub.mcpServer.startStdio();
}
