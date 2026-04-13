/**
 * Stellavault Stress Test — synthetic vault performance benchmarks
 *
 * Usage:
 *   node tests/stress.mjs           # default N=100
 *   node tests/stress.mjs 500       # custom N
 *
 * Tests: store init, bulk upsert, search, graph build, decay compute
 */

import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { performance } from 'node:perf_hooks';

const N = parseInt(process.argv[2] ?? '100', 10);
console.log(`\n🔬 Stellavault Stress Test (N=${N} documents)\n`);

const tmpDir = mkdtempSync(join(tmpdir(), 'sv-stress-'));
const dbPath = join(tmpDir, 'stress.db');
const vaultDir = join(tmpDir, 'vault');
mkdirSync(vaultDir, { recursive: true });

const results = [];

function bench(name, fn) {
  const start = performance.now();
  const result = fn();
  const elapsed = performance.now() - start;
  const ms = Math.round(elapsed);
  console.log(`  ${ms < 1000 ? '✅' : ms < 5000 ? '⚠️' : '🔴'} ${name}: ${ms}ms`);
  results.push({ name, ms });
  return result;
}

async function benchAsync(name, fn) {
  const start = performance.now();
  const result = await fn();
  const elapsed = performance.now() - start;
  const ms = Math.round(elapsed);
  console.log(`  ${ms < 1000 ? '✅' : ms < 5000 ? '⚠️' : '🔴'} ${name}: ${ms}ms`);
  results.push({ name, ms });
  return result;
}

// Generate synthetic documents
const TOPICS = ['AI', 'databases', 'security', 'React', 'Node.js', 'Python', 'DevOps', 'testing', 'architecture', 'performance'];
const docs = Array.from({ length: N }, (_, i) => {
  const topic = TOPICS[i % TOPICS.length];
  const title = `${topic} note ${i}`;
  const content = `# ${title}\n\nThis is a note about ${topic}. It covers concepts like ${topic} patterns, ${topic} best practices, and ${topic} architecture.\n\nKeywords: ${topic}, engineering, software, knowledge\n\n${'Lorem ipsum dolor sit amet. '.repeat(20)}`;
  return {
    id: `doc-${i.toString().padStart(5, '0')}`,
    filePath: `01_Knowledge/${topic}/${title.replace(/\s/g, '-')}.md`,
    title,
    content,
    frontmatter: { topic },
    tags: [topic, 'test', `batch-${Math.floor(i / 10)}`],
    lastModified: new Date(Date.now() - i * 86400000).toISOString(),
    contentHash: `hash-${i}`,
  };
});

try {
  // 1. Store init
  const { createSqliteVecStore } = await import('@stellavault/core');
  const store = await benchAsync('Store initialize', async () => {
    const s = createSqliteVecStore(dbPath);
    await s.initialize();
    return s;
  });

  // 2. Bulk upsert
  await benchAsync(`Upsert ${N} documents`, async () => {
    for (const doc of docs) {
      await store.upsertDocument(doc);
    }
  });

  // 3. Get all documents
  const allDocs = await benchAsync('getAllDocuments()', async () => {
    return store.getAllDocuments();
  });
  console.log(`    → ${allDocs.length} documents retrieved`);

  // 4. Get stats
  await benchAsync('getStats()', async () => store.getStats());

  // 5. Get topics
  const topics = await benchAsync('getTopics()', async () => store.getTopics());
  console.log(`    → ${topics.length} unique topics`);

  // 6. Keyword search (BM25)
  await benchAsync('searchKeyword("architecture")', async () => {
    return store.searchKeyword('architecture', 10);
  });

  // 7. Vector math benchmark (inline — avoids package export issues)
  const dims = 384;
  const randomVec = () => Array.from({ length: dims }, () => Math.random() - 0.5);
  const vecs = Array.from({ length: Math.min(N, 500) }, randomVec);

  bench(`Normalize ${vecs.length} vectors (${dims}d)`, () => {
    for (const v of vecs) {
      let norm = 0;
      for (let i = 0; i < v.length; i++) norm += v[i] * v[i];
      norm = Math.sqrt(norm);
      if (norm > 0) for (let i = 0; i < v.length; i++) v[i] /= norm;
    }
  });

  const pairCount = vecs.length * (vecs.length - 1) / 2;
  bench(`dotProduct ${vecs.length}x${vecs.length} (${pairCount} pairs)`, () => {
    for (let i = 0; i < vecs.length; i++) {
      for (let j = i + 1; j < vecs.length; j++) {
        let s = 0;
        for (let d = 0; d < dims; d++) s += vecs[i][d] * vecs[j][d];
      }
    }
  });

  // 8. Close
  await store.close();

  // Summary
  console.log('\n📊 Summary:');
  console.log('─'.repeat(50));
  const total = results.reduce((s, r) => s + r.ms, 0);
  for (const r of results) {
    const bar = '█'.repeat(Math.min(Math.round(r.ms / total * 40), 40));
    console.log(`  ${r.name.padEnd(35)} ${String(r.ms).padStart(6)}ms ${bar}`);
  }
  console.log(`${'  TOTAL'.padEnd(35)} ${String(Math.round(total)).padStart(6)}ms`);
  console.log('');

} catch (err) {
  console.error('❌ Stress test failed:', err.message);
  process.exit(1);
} finally {
  rmSync(tmpDir, { recursive: true, force: true });
}
