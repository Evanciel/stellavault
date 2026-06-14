// Markdown round-trip / serialization guards (run under node --experimental-strip-types).
//   node --experimental-strip-types packages/desktop/tests/md-roundtrip.mjs
//
// Targets the PURE helpers in renderer/lib/markdown.ts (the editor-independent
// serialization layer). Editor-level round-trips (TipTap NodeViews) can't run
// headless here, so we assert the markdown.ts guarantees the editor relies on.
//
// T1-14 (code block language picker): the language attr round-trips as a
// ```<lang> fence. The guard that matters in THIS module is that
// restoreEscapedSyntax never mangles fenced code (it must leave the ```lang
// line + body byte-identical), so a `ts`/`python` fence survives a save.

import {
  restoreEscapedSyntax,
  parseWikilinkInner,
  serializeWikilink,
  isSafeCssColor,
} from '../src/renderer/lib/markdown.ts';

let pass = 0;
let fail = 0;

function eq(actual, expected, name) {
  if (actual === expected) {
    pass++;
  } else {
    fail++;
    console.error(`FAIL: ${name}`);
    console.error(`  expected: ${JSON.stringify(expected)}`);
    console.error(`  actual:   ${JSON.stringify(actual)}`);
  }
}

function ok(cond, name) {
  if (cond) pass++;
  else { fail++; console.error(`FAIL: ${name}`); }
}

// ─── T1-14: fenced code blocks with a language tag survive restoreEscapedSyntax ─
{
  const ts = '```ts\nconst x: number = 1;\nconst arr = [[1], [2]];\n```';
  eq(restoreEscapedSyntax(ts), ts, 'ts code fence preserved byte-for-byte');

  const py = '```python\nprint("[[not a wikilink]]")\nx = a_b_c * d\n```';
  eq(restoreEscapedSyntax(py), py, 'python code fence: no escape restore inside fence');

  // The language line itself must never be rewritten.
  const lang = '```javascript\n// $math$ should stay literal here\n```';
  eq(restoreEscapedSyntax(lang), lang, 'js fence: math/wikilink restore skipped inside fence');

  // A bare fence (no language) also passes through untouched.
  const bare = '```\nplain code\n```';
  eq(restoreEscapedSyntax(bare), bare, 'bare code fence preserved');

  // Tilde fences too.
  const tilde = '~~~rust\nfn main() {}\n~~~';
  eq(restoreEscapedSyntax(tilde), tilde, 'tilde rust fence preserved');
}

// ─── Wikilink restore OUTSIDE code fences still works ───
{
  const escaped = 'See \\[\\[My Note\\]\\] here.';
  eq(restoreEscapedSyntax(escaped), 'See [[My Note]] here.', 'escaped wikilink restored');

  // Wikilink-looking text INSIDE a fence must NOT be restored (stays as written).
  const mixed = 'before [[Real]]\n```ts\n[[InCode]]\n```\nafter [[Also]]';
  const out = restoreEscapedSyntax(mixed);
  ok(out.includes('```ts\n[[InCode]]\n```'), 'code fence wikilink untouched');
}

// ─── Wikilink helper round-trip ───
{
  eq(serializeWikilink('Note', null), '[[Note]]', 'serialize plain wikilink');
  eq(serializeWikilink('Note', 'alias'), '[[Note|alias]]', 'serialize aliased wikilink');
  const p = parseWikilinkInner('Note|alias');
  eq(p.target, 'Note', 'parse target');
  eq(p.alias, 'alias', 'parse alias');
  const p2 = parseWikilinkInner('Note');
  eq(p2.alias, null, 'parse no-alias → null');
}

// ─── isSafeCssColor sanity (used by color serializers) ───
{
  ok(isSafeCssColor('#fff'), 'hex3 safe');
  ok(isSafeCssColor('rgba(0,0,0,0.5)'), 'rgba safe');
  ok(!isSafeCssColor('url(javascript:alert(1))'), 'url() rejected');
}

console.log(`\nmd-roundtrip: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
