/**
 * Stellavault Smoke Test Suite
 *
 * Pure Node.js 20+ ESM — no test framework dependencies.
 * Verifies CLI, core modules, and bundle integrity.
 *
 * Usage:  node tests/smoke.mjs
 */

import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(__dirname, '..');
const DIST = join(ROOT, 'dist');
const CLI = join(DIST, 'stellavault.js');

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  \x1b[32mPASS\x1b[0m  ${name}`);
  } catch (err) {
    failed++;
    console.log(`  \x1b[31mFAIL\x1b[0m  ${name}`);
    console.log(`        ${err.message}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

console.log('\n=== Stellavault Smoke Tests ===\n');

// ---------------------------------------------------------------------------
// 1. CLI smoke tests
// ---------------------------------------------------------------------------
console.log('--- CLI ---');

await test('cli: --version outputs version string', () => {
  const out = execSync(`node "${CLI}" --version`, { encoding: 'utf8', timeout: 15000 }).trim();
  assert(/\d+\.\d+\.\d+/.test(out), `Expected semver, got: "${out}"`);
});

await test('cli: --help exits 0 and contains "stellavault"', () => {
  const out = execSync(`node "${CLI}" --help`, { encoding: 'utf8', timeout: 15000 });
  assert(out.toLowerCase().includes('stellavault'), `Help output missing "stellavault"`);
});

await test('cli: doctor runs without crash', () => {
  // doctor may exit non-zero if vault is not configured, but it should not crash
  try {
    execSync(`node "${CLI}" doctor`, { encoding: 'utf8', timeout: 30000, stdio: 'pipe' });
  } catch (err) {
    // Allow non-zero exit as long as it produced output (not a crash)
    assert(
      err.stdout || err.stderr,
      `doctor crashed with no output: ${err.message}`,
    );
  }
});

// ---------------------------------------------------------------------------
// 2. Core module tests
// ---------------------------------------------------------------------------
console.log('\n--- Core Modules ---');

await test('core: loadConfig() returns object with vaultPath', async () => {
  const { loadConfig } = await import('@stellavault/core');
  const config = loadConfig();
  assert(typeof config === 'object' && config !== null, 'loadConfig() did not return an object');
  assert('vaultPath' in config, 'config missing vaultPath property');
});

await test('core: createSqliteVecStore() create, init, close', async () => {
  const { createSqliteVecStore } = await import('@stellavault/core');
  const tmpDir = mkdtempSync(join(tmpdir(), 'sv-smoke-'));
  const dbPath = join(tmpDir, 'test.db');
  try {
    const store = createSqliteVecStore(dbPath);
    assert(typeof store === 'object' && store !== null, 'store is not an object');
    assert(typeof store.initialize === 'function', 'store missing initialize()');

    await store.initialize();
    assert(existsSync(dbPath), 'DB file was not created');

    if (typeof store.close === 'function') {
      await store.close();
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 3. Bundle integrity
// ---------------------------------------------------------------------------
console.log('\n--- Bundle Integrity ---');

await test('bundle: dist/stellavault.js exists and >100KB', () => {
  assert(existsSync(CLI), `${CLI} does not exist`);
  const size = statSync(CLI).size;
  assert(size > 100 * 1024, `stellavault.js is only ${(size / 1024).toFixed(1)}KB, expected >100KB`);
});

await test('bundle: dist/graph-ui/index.html exists', () => {
  const p = join(DIST, 'graph-ui', 'index.html');
  assert(existsSync(p), `${p} does not exist`);
});

await test('bundle: dist/graph-ui/assets/ has at least 1 .js file', () => {
  const assetsDir = join(DIST, 'graph-ui', 'assets');
  assert(existsSync(assetsDir), `${assetsDir} does not exist`);
  const jsFiles = readdirSync(assetsDir).filter((f) => f.endsWith('.js'));
  assert(jsFiles.length >= 1, `No .js files found in ${assetsDir}`);
});

// ---------------------------------------------------------------------------
// 4. Demo vault integration
// ---------------------------------------------------------------------------
console.log('\n--- Demo Vault ---');

await test('demo-vault: 10 markdown files exist', () => {
  const demoDir = join(ROOT, 'examples', 'demo-vault');
  assert(existsSync(demoDir), 'examples/demo-vault/ does not exist');
  const mdFiles = [];
  for (const sub of ['00_Fleeting', '01_Knowledge', '02_Literature']) {
    const dir = join(demoDir, sub);
    if (existsSync(dir)) {
      mdFiles.push(...readdirSync(dir).filter(f => f.endsWith('.md')));
    }
  }
  assert(mdFiles.length >= 10, `Expected 10+ md files, found ${mdFiles.length}`);
});

await test('demo-vault: all notes have frontmatter', () => {
  const demoDir = join(ROOT, 'examples', 'demo-vault');
  for (const sub of ['00_Fleeting', '01_Knowledge', '02_Literature']) {
    const dir = join(demoDir, sub);
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir).filter(f => f.endsWith('.md'))) {
      const content = readFileSync(join(dir, file), 'utf-8');
      assert(content.startsWith('---'), `${sub}/${file} missing frontmatter`);
      assert(content.includes('title:'), `${sub}/${file} missing title in frontmatter`);
      assert(content.includes('tags:'), `${sub}/${file} missing tags in frontmatter`);
    }
  }
});

await test('demo-vault: wikilinks cross-reference correctly', () => {
  const demoDir = join(ROOT, 'examples', 'demo-vault');
  const allTitles = new Set();
  const allLinks = [];
  for (const sub of ['00_Fleeting', '01_Knowledge', '02_Literature']) {
    const dir = join(demoDir, sub);
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir).filter(f => f.endsWith('.md'))) {
      const content = readFileSync(join(dir, file), 'utf-8');
      const titleMatch = content.match(/title:\s*"([^"]+)"/);
      if (titleMatch) allTitles.add(titleMatch[1]);
      const links = [...content.matchAll(/\[\[([^\]]+)\]\]/g)].map(m => m[1]);
      allLinks.push(...links);
    }
  }
  const validLinks = allLinks.filter(l => allTitles.has(l));
  assert(validLinks.length >= 5, `Expected 5+ valid wikilinks, found ${validLinks.length} (titles: ${allTitles.size})`);
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);

if (failed > 0) {
  console.log('\x1b[31mSMOKE TEST FAILED\x1b[0m');
} else {
  console.log('\x1b[32mALL PASS\x1b[0m');
}

process.exit(failed > 0 ? 1 : 0);
