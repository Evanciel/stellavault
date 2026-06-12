/**
 * Stellavault Desktop — Markdown round-trip tests (B1, plan §4-A)
 *
 * Pure Node.js ESM — no test framework (follows tests/smoke.mjs style).
 *
 * Usage:  node tests/md-roundtrip.mjs
 *
 * What this CAN verify under Node:
 *   1. Static config of renderer/lib/markdown.ts (html:false, tightLists,
 *      transformPastedText, getMarkdown usage) + that MarkdownEditor no
 *      longer saves getHTML() or uses window.prompt().
 *   2. Golden cases for restoreEscapedSyntax() — the post-serialize guard
 *      that un-mangles [[wikilinks]] and $math$ — by importing markdown.ts
 *      in a child `node --experimental-strip-types` process (Node >= 22.6).
 *      On older Node the dynamic part is SKIPped; static checks still run.
 *
 * What this CANNOT verify (requires the app's DOM context):
 *   The full TipTap parse→serialize round-trip (markdown-it parsing uses
 *   window.DOMParser). Full-fidelity round-trip must be confirmed in the
 *   running app (Browser/Device Manual Smoke Gate).
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(__dirname, '..');
const MD_LIB = join(ROOT, 'packages/desktop/src/renderer/lib/markdown.ts');
const EDITOR = join(ROOT, 'packages/desktop/src/renderer/components/editor/MarkdownEditor.tsx');
const STORE = join(ROOT, 'packages/desktop/src/renderer/stores/app-store.ts');

// ─── Child mode: import markdown.ts (types stripped) and run golden cases ───
if (process.env.MD_RT_CHILD === '1') {
  const mod = await import(pathToFileURL(MD_LIB).href);
  const { restoreEscapedSyntax, markdownConfig } = mod;
  const results = [];
  const eq = (name, actual, expected) => {
    results.push({ name, ok: actual === expected, actual, expected });
  };

  // Config sanity (runtime, not just source text)
  eq('config: html is false', markdownConfig.html, false);
  eq('config: tightLists is true', markdownConfig.tightLists, true);
  eq('config: transformPastedText is true', markdownConfig.transformPastedText, true);

  // Golden cases — plain markdown must pass through unchanged
  eq('heading unchanged', restoreEscapedSyntax('# Title'), '# Title');
  eq('bold unchanged', restoreEscapedSyntax('**bold** and *em*'), '**bold** and *em*');
  eq('list unchanged', restoreEscapedSyntax('- a\n- b'), '- a\n- b');
  eq('tasklist unchanged', restoreEscapedSyntax('- [ ] todo\n- [x] done'), '- [ ] todo\n- [x] done');
  eq('table unchanged',
    restoreEscapedSyntax('| a | b |\n| --- | --- |\n| 1 | 2 |'),
    '| a | b |\n| --- | --- |\n| 1 | 2 |');

  // Wikilinks — serializer escapes [ ] _ ; guard must restore them
  eq('wikilink restored', restoreEscapedSyntax('\\[\\[Note\\]\\]'), '[[Note]]');
  eq('wikilink with alias + underscore restored',
    restoreEscapedSyntax('\\[\\[my\\_note|alias\\]\\]'), '[[my_note|alias]]');
  eq('wikilink idempotent (already clean)', restoreEscapedSyntax('See [[Note]] here'), 'See [[Note]] here');

  // Math — $…$ survives, inner escapes removed
  eq('inline math underscore restored', restoreEscapedSyntax('$x\\_1$'), '$x_1$');
  eq('display math restored', restoreEscapedSyntax('$$a\\_b = c\\_d$$'), '$$a_b = c_d$$');
  eq('math idempotent', restoreEscapedSyntax('$E = mc^2$'), '$E = mc^2$');
  eq('dollar amounts untouched', restoreEscapedSyntax('costs $5 and $10 total'), 'costs $5 and $10 total');

  // Code must be left verbatim (user backslashes are content there)
  eq('fenced code untouched',
    restoreEscapedSyntax('```\n\\[\\[not-a-link\\]\\]\n```'),
    '```\n\\[\\[not-a-link\\]\\]\n```');
  eq('inline code untouched',
    restoreEscapedSyntax('use `\\[\\[raw\\]\\]` syntax'),
    'use `\\[\\[raw\\]\\]` syntax');

  process.stdout.write(JSON.stringify(results));
  process.exit(0);
}

// ─── Parent mode ───
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

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

console.log('\n=== Desktop Markdown Round-trip Tests (B1) ===\n');

// ---------------------------------------------------------------------------
// 1. Static checks — serialize config + editor wiring
// ---------------------------------------------------------------------------
console.log('--- static: markdown.ts config ---');

const libSrc = readFileSync(MD_LIB, 'utf8');
const editorSrc = readFileSync(EDITOR, 'utf8');
const storeSrc = readFileSync(STORE, 'utf8');

await test('markdown.ts: html: false (no raw HTML in .md output)', () => {
  assert(/html:\s*false/.test(libSrc), 'expected html: false in markdownConfig');
});

await test('markdown.ts: tightLists: true', () => {
  assert(/tightLists:\s*true/.test(libSrc), 'expected tightLists: true');
});

await test('markdown.ts: transformPastedText: true', () => {
  assert(/transformPastedText:\s*true/.test(libSrc), 'expected transformPastedText: true');
});

await test('markdown.ts: serializes via editor.storage.markdown.getMarkdown()', () => {
  assert(libSrc.includes('storage.markdown.getMarkdown()'), 'expected getMarkdown() serialize path');
});

await test('markdown.ts: exports editorToMarkdown + restoreEscapedSyntax', () => {
  assert(/export function editorToMarkdown/.test(libSrc), 'missing editorToMarkdown export');
  assert(/export function restoreEscapedSyntax/.test(libSrc), 'missing restoreEscapedSyntax export');
});

console.log('--- static: MarkdownEditor wiring ---');

await test('MarkdownEditor: no longer emits getHTML()', () => {
  assert(!editorSrc.includes('getHTML()'), 'MarkdownEditor still calls getHTML() — B1 regression');
});

await test('MarkdownEditor: uses editorToMarkdown in onUpdate', () => {
  assert(editorSrc.includes('editorToMarkdown'), 'onUpdate must serialize via editorToMarkdown');
});

await test('MarkdownEditor: registers the shared Markdown extension', () => {
  assert(editorSrc.includes('MarkdownSerializerExtension'), 'Markdown extension not registered');
});

await test('MarkdownEditor: no window.prompt() (B4 — freezes Electron)', () => {
  assert(!/window\.prompt|[^.\w]prompt\(/.test(editorSrc), 'prompt() still present');
  assert(editorSrc.includes('PromptModal'), 'expected PromptModal replacement');
});

await test('app-store: OpenTab.content documented as markdown source', () => {
  assert(/[Mm]arkdown SOURCE|markdown source/.test(storeSrc), 'OpenTab.content semantics comment missing');
});

// ---------------------------------------------------------------------------
// 2. Golden cases via child process (needs node --experimental-strip-types)
// ---------------------------------------------------------------------------
console.log('--- golden: restoreEscapedSyntax (library level) ---');

const [major, minor] = process.versions.node.split('.').map(Number);
const supportsStrip = major > 22 || (major === 22 && minor >= 6);

if (!supportsStrip) {
  skipped++;
  console.log(`  \x1b[33mSKIP\x1b[0m  golden cases (Node ${process.versions.node} lacks --experimental-strip-types)`);
} else {
  let results = null;
  try {
    const out = execFileSync(process.execPath, ['--experimental-strip-types', fileURLToPath(import.meta.url)], {
      encoding: 'utf8',
      timeout: 60000,
      env: { ...process.env, MD_RT_CHILD: '1', NODE_NO_WARNINGS: '1' },
    });
    results = JSON.parse(out);
  } catch (err) {
    failed++;
    console.log(`  \x1b[31mFAIL\x1b[0m  child import of markdown.ts`);
    console.log(`        ${String(err.message).slice(0, 400)}`);
  }
  if (results) {
    for (const r of results) {
      await test(r.name, () => {
        assert(r.ok, `expected ${JSON.stringify(r.expected)}, got ${JSON.stringify(r.actual)}`);
      });
    }
  }
}

// ---------------------------------------------------------------------------
console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped\n`);
if (failed > 0) {
  console.log('\x1b[31mROUND-TRIP TESTS FAILED\x1b[0m');
  process.exit(1);
} else {
  console.log('\x1b[32mALL PASS\x1b[0m');
}
