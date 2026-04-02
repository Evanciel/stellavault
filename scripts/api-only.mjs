import { loadConfig, createKnowledgeHub, createApiServer, DecayEngine } from '../packages/core/dist/index.js';

const config = loadConfig();
const hub = createKnowledgeHub(config);
await hub.store.initialize();
await hub.embedder.initialize();

const vaultName = config.vaultPath
  ? config.vaultPath.replace(/\\/g, '/').replace(/\/$/, '').split('/').pop()
  : '';

// DecayEngine 초기화
const db = hub.store.getDb();
const decayEngine = db ? new DecayEngine(db) : undefined;

const api = createApiServer({
  store: hub.store,
  searchEngine: hub.searchEngine,
  port: 3333,
  vaultName,
  vaultPath: config.vaultPath,
  decayEngine,
});
await api.start();
const stats = await hub.store.getStats();
console.error(`API ready — vault: ${vaultName}, docs: ${stats.documentCount}, decay: ${decayEngine ? 'ON' : 'OFF'}`);

// Keep process alive
process.stdin.resume();
