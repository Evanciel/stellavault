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

const IS_CI = !!process.env.CI;
let passed = 0;
let failed = 0;
let skipped = 0;

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

/** Tests that may fail in CI due to missing native deps or optional builds */
async function optionalTest(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  \x1b[32mPASS\x1b[0m  ${name}`);
  } catch (err) {
    if (IS_CI) {
      skipped++;
      console.log(`  \x1b[33mSKIP\x1b[0m  ${name} (CI — ${err.message})`);
    } else {
      failed++;
      console.log(`  \x1b[31mFAIL\x1b[0m  ${name}`);
      console.log(`        ${err.message}`);
    }
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

await test('cli: setup writes MCP client config (isolated, non-destructive)', () => {
  // Upgrade A1 regression: `setup --client cursor` must write a valid mcp.json
  // into an isolated HOME without touching the real user config.
  const tmpHome = mkdtempSync(join(tmpdir(), 'sv-setup-'));
  try {
    execSync(`node "${CLI}" setup --client cursor`, {
      encoding: 'utf8',
      timeout: 20000,
      stdio: 'pipe',
      env: { ...process.env, USERPROFILE: tmpHome, HOME: tmpHome, APPDATA: join(tmpHome, 'AppData', 'Roaming') },
    });
    const cfg = join(tmpHome, '.cursor', 'mcp.json');
    assert(existsSync(cfg), 'cursor mcp.json was not written');
    const json = JSON.parse(readFileSync(cfg, 'utf-8'));
    assert(json.mcpServers && json.mcpServers.stellavault, 'stellavault entry missing from mcpServers');
    assert(Array.isArray(json.mcpServers.stellavault.args), 'stellavault entry missing args[]');
  } finally {
    rmSync(tmpHome, { recursive: true, force: true });
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

await optionalTest('core: createSqliteVecStore() create, init, close', async () => {
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

await optionalTest('bundle: dist/graph-ui/index.html exists', () => {
  const p = join(DIST, 'graph-ui', 'index.html');
  assert(existsSync(p), `${p} does not exist`);
});

await optionalTest('bundle: dist/graph-ui/assets/ has at least 1 .js file', () => {
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
// 5. SP1 Multimedia Chat
// ---------------------------------------------------------------------------
console.log('\n--- SP1 Multimedia Chat ---');

const DESKTOP_SRC = join(ROOT, 'packages', 'desktop', 'src');

await test('chat: preload allowlists chat:send (channel) + chat:chunk (event)', () => {
  // The preload Sets are the runtime IPC trust boundary (TS types are erased).
  // The renderer can only reach main over these allowlisted channels, so the
  // chat surface is dead unless both the command and the stream event are listed.
  const preload = readFileSync(join(DESKTOP_SRC, 'preload', 'index.ts'), 'utf-8');

  // Each Set literal ends with `])`; slice to that close so a stray `]` inside a
  // line comment (e.g. `// [editor-upgrade additive]`) doesn't truncate the block.
  const setBlock = (decl) => {
    const start = preload.indexOf(`${decl} = new Set`);
    assert(start !== -1, `${decl} Set not found in preload`);
    const end = preload.indexOf('])', start);
    assert(end !== -1, `${decl} Set close not found in preload`);
    return preload.slice(start, end);
  };

  assert(setBlock('ALLOWED_CHANNELS').includes("'chat:send'"), "'chat:send' missing from ALLOWED_CHANNELS");
  assert(setBlock('ALLOWED_EVENTS').includes("'chat:chunk'"), "'chat:chunk' missing from ALLOWED_EVENTS");
});

await test('chat: SSE parser is pure (parses a static frame, issues no network call)', () => {
  // parseAnthropicSse lives in a TS module that imports electron, so it can't be
  // imported under plain node. Extract its body (+ its only helper, frameLines),
  // stub the categorized-error class, and execute it on a STATIC frame string.
  // Purity is asserted directly: the parser source must contain no net/fetch call.
  const src = readFileSync(join(DESKTOP_SRC, 'main', 'chat-engine.ts'), 'utf-8');

  const grab = (name) => {
    const sig = `export function ${name}(frame: string)`;
    const altSig = `function ${name}(frame: string)`;
    let start = src.indexOf(sig);
    if (start === -1) start = src.indexOf(altSig);
    assert(start !== -1, `${name} not found in chat-engine.ts`);
    const braceOpen = src.indexOf('{', start);
    let depth = 0;
    let i = braceOpen;
    for (; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') { depth--; if (depth === 0) { i++; break; } }
    }
    return src.slice(start, i);
  };

  const anthropicSrc = grab('parseAnthropicSse');
  // Purity: the parser body must never reach the network.
  for (const banned of ['net.request', 'fetch(', 'https.request', 'http.request', "require('electron')"]) {
    assert(!anthropicSrc.includes(banned), `parseAnthropicSse is not pure — found "${banned}"`);
  }

  // Strip TS so plain JS can run: type annotations, `as <type>`, and the export kw.
  const toJs = (s) => s
    .replace(/export\s+function/g, 'function')
    .replace(/:\s*FrameResult/g, '')
    .replace(/:\s*string\[\]/g, '')
    .replace(/:\s*string/g, '')
    .replace(/:\s*ErrorCategory/g, '')
    .replace(/:\s*any/g, '')
    .replace(/\bas\s+ErrorCategory\b/g, '')
    .replace(/\bas\s+any\b/g, '');

  const frameLinesSrc = toJs(grab('frameLines'));
  const parserSrc = toJs(anthropicSrc);

  // Minimal stub for the categorized error the parser throws on `error` frames.
  const factory = new Function(
    'ChatStreamError',
    `${frameLinesSrc}\n${parserSrc}\nreturn parseAnthropicSse;`,
  );
  class StubErr extends Error {}
  const parseAnthropicSse = factory(StubErr);

  const frame =
    'event: content_block_delta\n' +
    'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello"}}';
  const result = parseAnthropicSse(frame);
  assert(Array.isArray(result.deltas), 'parser did not return a deltas array');
  assert(result.deltas.join('') === 'Hello', `expected delta "Hello", got "${result.deltas.join('')}"`);

  const stopFrame = 'event: message_stop\ndata: {"type":"message_stop"}';
  assert(parseAnthropicSse(stopFrame).done === true, 'message_stop did not mark done');
});

await test('chat: sanitize schema strips onerror + blocks javascript:', () => {
  // sanitize.ts imports react/react-markdown, so assert on the SOURCE schema.
  // attributes['*'] = [] strips every global attribute (including on* like
  // onerror); protocols.href/src exclude `javascript` so javascript: URLs drop.
  const raw = readFileSync(join(DESKTOP_SRC, 'renderer', 'lib', 'sanitize.ts'), 'utf-8');
  // Strip comments first — the doc comments mention "javascript"/"onerror" as
  // prose, which would false-trigger the protocol check against the real schema.
  const src = raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    // CRLF-safe: JS regex `.` does NOT match `\r`, and `$` (no `m` flag) won't match before a
    // trailing `\r`, so `/\/\/.*$/` failed to strip line comments on a CRLF-checked-out file
    // (git autocrlf), leaking the comment's "javascript" prose into the schema slice. Drop the `$`.
    .split('\n').map((l) => l.replace(/\/\/.*/, '')).join('\n');

  const schemaStart = src.indexOf('CHAT_SANITIZE_SCHEMA');
  assert(schemaStart !== -1, 'CHAT_SANITIZE_SCHEMA not found in sanitize.ts');
  const schemaEnd = src.indexOf('} as const', schemaStart);
  assert(schemaEnd !== -1, 'CHAT_SANITIZE_SCHEMA block end not found');
  const schema = src.slice(schemaStart, schemaEnd);

  // Global-attribute wipe → on* (onerror/onclick/…) never survive.
  assert(/'\*'\s*:\s*\[\s*\]/.test(schema), "schema missing `'*': []` global-attribute wipe (onerror would survive)");
  // protocols allowlist must NOT include javascript (and must include the safe ones).
  assert(!/javascript/i.test(schema), 'schema protocols allowlist must not include javascript:');
  assert(/href\s*:\s*\[[^\]]*'https'/.test(schema), "schema href protocols must allow 'https'");
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
const skipMsg = skipped > 0 ? `, ${skipped} skipped` : '';
console.log(`\n=== ${passed} passed, ${failed} failed${skipMsg} ===\n`);

if (failed > 0) {
  console.log('\x1b[31mSMOKE TEST FAILED\x1b[0m');
} else {
  console.log('\x1b[32mALL PASS\x1b[0m');
}

process.exit(failed > 0 ? 1 : 0);
