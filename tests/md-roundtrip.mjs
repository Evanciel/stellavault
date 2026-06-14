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
const FM_LIB = join(ROOT, 'packages/desktop/src/renderer/lib/frontmatter.ts');
const EDITOR = join(ROOT, 'packages/desktop/src/renderer/components/editor/MarkdownEditor.tsx');
const STORE = join(ROOT, 'packages/desktop/src/renderer/stores/app-store.ts');
const WIKILINK_NODE = join(ROOT, 'packages/desktop/src/renderer/components/editor/WikilinkNode.ts');
const SUGGESTION = join(ROOT, 'packages/desktop/src/renderer/components/editor/WikilinkSuggestion.ts');

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

  // ── W1-9: wikilink node serialize/parse rules (lib/markdown.ts) ──
  const { parseWikilinkInner, serializeWikilink, registerWikilinkRule } = mod;
  const wlRoundtrip = (md) => {
    const inner = md.slice(2, -2);
    const { target, alias } = parseWikilinkInner(inner);
    return serializeWikilink(target, alias);
  };
  // Byte-identical attr round-trips (verbatim — no trimming)
  eq('wikilink node: [[Note]] byte-identical', wlRoundtrip('[[Note]]'), '[[Note]]');
  eq('wikilink node: [[my_note|alias]] byte-identical', wlRoundtrip('[[my_note|alias]]'), '[[my_note|alias]]');
  eq('wikilink node: spaces preserved verbatim', wlRoundtrip('[[ A B |c d ]]'), '[[ A B |c d ]]');
  eq('wikilink node: empty alias preserved', wlRoundtrip('[[a|]]'), '[[a|]]');
  eq('wikilink node: anchor preserved', wlRoundtrip('[[Note#Heading]]'), '[[Note#Heading]]');

  // markdown-it parse rule (same instance type tiptap-markdown hands to setup)
  const markdownit = (await import('markdown-it')).default;
  const mdIt = markdownit({ html: false });
  registerWikilinkRule(mdIt);
  registerWikilinkRule(mdIt); // idempotence — setup() runs on EVERY parse
  const rendered = mdIt.renderInline('See [[Note|N]] here');
  eq('wikilink parse: emits data-target span',
    rendered.includes('data-type="wikilink"') && rendered.includes('data-target="Note"') && rendered.includes('data-alias="N"'),
    true);
  eq('wikilink parse: alias is the label', rendered.includes('>N</span>'), true);
  eq('wikilink parse: idempotent registration (one span per link)',
    (mdIt.renderInline('[[A]] and [[B]]').match(/data-type="wikilink"/g) ?? []).length, 2);
  eq('wikilink parse: inline code not converted',
    mdIt.renderInline('use `[[x]]` raw').includes('data-type="wikilink"'), false);
  eq('wikilink parse: unclosed [[ left alone',
    mdIt.renderInline('just [[ text').includes('data-type="wikilink"'), false);

  // ── W1-7: frontmatter split/recombine (lib/frontmatter.ts) ──
  const fm = await import(pathToFileURL(FM_LIB).href);
  const SRC = '---\ntitle: My Note\ntags:\n  - a\n  - b\n---\n# Body\n\ntext\n';
  const parsed = fm.parse(SRC);
  eq('frontmatter: title parsed', parsed.frontmatter.title, 'My Note');
  eq('frontmatter: body excludes YAML', parsed.body, '# Body\n\ntext\n');
  eq('frontmatter: fmBlock+body is byte-identical to raw', parsed.fmBlock + parsed.body, SRC);
  eq('frontmatter: stringify round-trip (key order kept)',
    fm.stringify(parsed.body, parsed.frontmatter), SRC);
  eq('frontmatter: no-fm file passes through', fm.parse('# T\nx\n').body, '# T\nx\n');
  eq('frontmatter: empty fm object → body unchanged', fm.stringify('# T\nx\n', {}), '# T\nx\n');
  eq('frontmatter: date stays YYYY-MM-DD (no ISO timestamp rewrite)',
    fm.parse('---\ndate: 2026-06-12\n---\nx\n').frontmatter.date, '2026-06-12');
  eq('frontmatter: malformed YAML treated as body (no throw)',
    fm.parse('---\n: : bad\n---\nx').body, '---\n: : bad\n---\nx');

  // ── Editor upgrade: colored text / colored highlight inline-HTML rules ──
  const { registerInlineStyleRule, isSafeCssColor } = mod;
  const mdColor = markdownit({ html: false });
  registerInlineStyleRule(mdColor);
  registerInlineStyleRule(mdColor); // idempotence — setup() runs on EVERY parse
  eq('color: safe css values accepted',
    isSafeCssColor('#ef4444') && isSafeCssColor('rgb(253, 224, 71)') && isSafeCssColor('red'), true);
  eq('color: unsafe css values rejected',
    isSafeCssColor('url(x)') || isSafeCssColor('red;background:url(1)') || isSafeCssColor('expression(a)'), false);
  eq('color span parse: raw span emitted',
    mdColor.renderInline('a <span style="color: #ef4444">red</span> b')
      .includes('<span style="color: #ef4444">red</span>'), true);
  eq('highlight mark parse: raw mark emitted',
    mdColor.renderInline('<mark style="background-color: #facc1555">hi</mark>')
      .includes('<mark style="background-color: #facc1555">hi</mark>'), true);
  eq('color span parse: inner markdown still parsed',
    mdColor.renderInline('<span style="color: #ef4444">**bold**</span>').includes('<strong>bold</strong>'), true);
  eq('color span parse: unsafe value stays escaped text',
    mdColor.renderInline('<span style="color: url(javascript:1)">x</span>').includes('<span style='), false);
  eq('color span parse: mismatched tag/prop rejected',
    mdColor.renderInline('<mark style="color: #ef4444">x</mark>').includes('<mark style='), false);
  eq('color span parse: arbitrary html still escaped (html:false intact)',
    mdColor.renderInline('<script>alert(1)</script>').includes('<script>'), false);
  // restoreEscapedSyntax guard must leave the serialized spans untouched
  eq('colored span survives restore guard',
    restoreEscapedSyntax('x <span style="color: #ef4444">red</span> y'),
    'x <span style="color: #ef4444">red</span> y');
  eq('colored mark survives restore guard',
    restoreEscapedSyntax('<mark style="background-color: #facc1555">hi</mark>'),
    '<mark style="background-color: #facc1555">hi</mark>');

  // ── Editor upgrade: callout rule (> [!type] ↔ div[data-callout]) ──
  const { registerCalloutRule } = mod;
  const mdCallout = markdownit({ html: false });
  registerCalloutRule(mdCallout);
  registerCalloutRule(mdCallout); // idempotence
  const calloutHtml = mdCallout.render('> [!info]\n> Hello **world**');
  eq('callout parse: blockquote becomes div[data-callout]',
    calloutHtml.includes('data-callout="info"') && !calloutHtml.includes('<blockquote>'), true);
  eq('callout parse: marker stripped from body', calloutHtml.includes('[!info]'), false);
  eq('callout parse: inner markdown still parsed', calloutHtml.includes('<strong>world</strong>'), true);
  eq('callout parse: warning type detected',
    mdCallout.render('> [!warning]\n> careful').includes('data-callout="warning"'), true);
  eq('callout parse: marker-only first paragraph removed',
    mdCallout.render('> [!tip]\n>\n> body text').includes('data-callout="tip"'), true);
  eq('callout parse: plain blockquote untouched',
    mdCallout.render('> just a quote').includes('<blockquote>'), true);
  eq('callout parse: [!type] mid-paragraph not converted',
    mdCallout.render('> note [!info] inline').includes('<blockquote>'), true);
  // serialized form `> [!info]` must pass the restore guard unmangled
  eq('callout marker survives restore guard',
    restoreEscapedSyntax('> [!info]\n> body'), '> [!info]\n> body');

  // ── T3-10: embed / transclusion (![[Note]] / ![[Note#heading]]) ──
  const { parseEmbedInner, serializeEmbed, registerEmbedRule } = mod;
  const embedRoundtrip = (md) => {
    const inner = md.slice(3, -2); // strip ![[ and ]]
    const { target, heading } = parseEmbedInner(inner);
    return serializeEmbed(target, heading);
  };
  eq('embed node: ![[Note]] byte-identical', embedRoundtrip('![[Note]]'), '![[Note]]');
  eq('embed node: ![[Note#Heading]] byte-identical', embedRoundtrip('![[Note#Heading]]'), '![[Note#Heading]]');
  eq('embed node: spaces preserved verbatim', embedRoundtrip('![[ A B # C D ]]'), '![[ A B # C D ]]');
  eq('embed node: heading with inner # preserved',
    embedRoundtrip('![[Note#a#b]]'), '![[Note#a#b]]');
  eq('embed parseEmbedInner: no heading → null',
    parseEmbedInner('Note').heading, null);
  eq('embed parseEmbedInner: heading split at first #',
    JSON.stringify(parseEmbedInner('Note#H')), JSON.stringify({ target: 'Note', heading: 'H' }));

  // markdown-it parse rule — emits a data-type="embed" span (EmbedNode picks up)
  const mdEmbed = markdownit({ html: false });
  registerEmbedRule(mdEmbed);
  registerWikilinkRule(mdEmbed); // embed rule must win over wikilink for ![[…]]
  registerEmbedRule(mdEmbed);    // idempotence — setup() runs on EVERY parse
  const embRendered = mdEmbed.renderInline('See ![[Note#H]] here');
  eq('embed parse: emits data-target span',
    embRendered.includes('data-type="embed"') && embRendered.includes('data-target="Note"') && embRendered.includes('data-heading="H"'),
    true);
  eq('embed parse: plain ![[Note]] has no data-heading',
    mdEmbed.renderInline('![[Note]]').includes('data-heading'), false);
  eq('embed parse: bare [[Note]] is still a wikilink (not an embed)',
    mdEmbed.renderInline('[[Note]]').includes('data-type="wikilink"'), true);
  eq('embed parse: ![[Note]] is an embed, NOT a wikilink',
    mdEmbed.renderInline('![[Note]]').includes('data-type="wikilink"'), false);
  eq('embed parse: inline code not converted',
    mdEmbed.renderInline('use `![[x]]` raw').includes('data-type="embed"'), false);
  eq('embed parse: unclosed ![[ left alone',
    mdEmbed.renderInline('just ![[ text').includes('data-type="embed"'), false);

  // restore guard: serialized ![[…]] must survive untouched; escaped form restored
  eq('embed survives restore guard (clean)',
    restoreEscapedSyntax('a ![[Note#H]] b'), 'a ![[Note#H]] b');
  eq('embed restored from escaped form',
    restoreEscapedSyntax('!\\[\\[Note\\]\\]'), '![[Note]]');
  eq('embed does not eat a following bare wikilink',
    restoreEscapedSyntax('![[A]] and [[B]]'), '![[A]] and [[B]]');

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

console.log('--- static: W1-7/W1-9 wiring ---');

const wikilinkNodeSrc = readFileSync(WIKILINK_NODE, 'utf8');
const suggestionSrc = readFileSync(SUGGESTION, 'utf8');

await test('WikilinkNode: serializes via shared serializeWikilink (raw write)', () => {
  assert(wikilinkNodeSrc.includes('serializeWikilink'), 'node must delegate to lib/markdown.ts serializeWikilink');
  assert(wikilinkNodeSrc.includes('registerWikilinkRule'), 'node must register the shared parse rule');
});

await test('WikilinkSuggestion: inserts wikilink NODE (not plain text)', () => {
  assert(suggestionSrc.includes(`type: 'wikilink'`), 'suggestion must insert the wikilink node');
  assert(!suggestionSrc.includes('insertContent(`[[${props.id}]]`)'), 'plain-text insertion still present');
});

await test('WikilinkSuggestion: extension name does not collide with node', () => {
  assert(suggestionSrc.includes(`name: 'wikilinkSuggestion'`), 'suggestion extension must not be named "wikilink"');
});

await test('MarkdownEditor: registers WikilinkNode', () => {
  assert(editorSrc.includes('WikilinkNode'), 'WikilinkNode not registered in editor extensions');
});

await test('app-store: OpenTab gains frontmatter field (W1-7, additive)', () => {
  assert(/frontmatter\?:\s*Record<string,\s*unknown>/.test(storeSrc), 'OpenTab.frontmatter missing');
});

console.log('--- static: editor upgrade (callout / color / bubble menu) wiring ---');

const CALLOUT_NODE = join(ROOT, 'packages/desktop/src/renderer/components/editor/CalloutNode.ts');
const BUBBLE_MENU = join(ROOT, 'packages/desktop/src/renderer/components/editor/BubbleMenuBar.tsx');
const PRELOAD = join(ROOT, 'packages/desktop/src/preload/index.ts');
const MAIN = join(ROOT, 'packages/desktop/src/main/index.ts');

await test('CalloutNode: delegates to shared serializeCallout + registerCalloutRule', () => {
  const src = readFileSync(CALLOUT_NODE, 'utf8');
  assert(src.includes('serializeCallout'), 'CalloutNode must delegate serialization to lib/markdown.ts');
  assert(src.includes('registerCalloutRule'), 'CalloutNode must register the shared parse rule');
});

await test('MarkdownEditor: registers CalloutNode + MarkdownTextColor + BubbleMenuBar', () => {
  assert(editorSrc.includes('CalloutNode'), 'CalloutNode not registered');
  assert(editorSrc.includes('MarkdownTextColor'), 'MarkdownTextColor not registered');
  assert(editorSrc.includes('BubbleMenuBar'), 'BubbleMenuBar not rendered');
  assert(editorSrc.includes('TableControls'), 'TableControls not rendered');
});

await test('BubbleMenuBar: uses @tiptap/react BubbleMenu and hides in code blocks', () => {
  const src = readFileSync(BUBBLE_MENU, 'utf8');
  assert(/BubbleMenu/.test(src), 'BubbleMenu component missing');
  assert(src.includes("isActive('codeBlock')"), 'bubble menu must hide inside code blocks');
});

await test('vault:import-asset: main handler + preload allowlist entry exist', () => {
  assert(readFileSync(MAIN, 'utf8').includes("ipcMain.handle('vault:import-asset'"), 'main handler missing');
  assert(readFileSync(PRELOAD, 'utf8').includes("'vault:import-asset'"), 'preload allowlist entry missing');
});

console.log('--- static: T3-10/T3-11/T3-12 (embed / drag handle / auto-update) wiring ---');

const EMBED_NODE = join(ROOT, 'packages/desktop/src/renderer/components/editor/EmbedNode.ts');
const DRAG_HANDLE = join(ROOT, 'packages/desktop/src/renderer/components/editor/DragHandle.ts');
const COMMANDS = join(ROOT, 'packages/desktop/src/renderer/lib/commands.ts');
const APP_MENU = join(ROOT, 'packages/desktop/src/renderer/components/layout/AppMenu.tsx');
const DESKTOP_PKG = join(ROOT, 'packages/desktop/package.json');

await test('EmbedNode: delegates to shared serializeEmbed + registerEmbedRule (T3-10)', () => {
  const src = readFileSync(EMBED_NODE, 'utf8');
  assert(src.includes('serializeEmbed'), 'EmbedNode must delegate serialization to lib/markdown.ts');
  assert(src.includes('registerEmbedRule'), 'EmbedNode must register the shared parse rule');
  assert(src.includes("ipc('vault:read-file'"), 'EmbedNode must load the target via vault:read-file');
  assert(src.includes("contentEditable = 'false'") || src.includes('contentEditable="false"'),
    'EmbedNode transclusion must be read-only (contentEditable=false)');
});

await test('MarkdownEditor: registers EmbedNode + DragHandleExtension (T3-10/T3-11)', () => {
  assert(editorSrc.includes('EmbedNode'), 'EmbedNode not registered in editor extensions');
  assert(editorSrc.includes('DragHandleExtension'), 'DragHandleExtension not registered');
});

await test('DragHandle: uses a ProseMirror plugin + move via single transaction (T3-11)', () => {
  const src = readFileSync(DRAG_HANDLE, 'utf8');
  assert(src.includes('new Plugin'), 'DragHandle must be a ProseMirror plugin');
  assert(src.includes('tr.delete') && src.includes('tr.insert') || src.includes('.delete(') && src.includes('.insert('),
    'DragHandle must move whole nodes (delete + insert) to keep markdown intact');
});

await test('auto-update: main wiring + IPC + menu + dep (T3-12)', () => {
  const mainSrc = readFileSync(MAIN, 'utf8');
  assert(mainSrc.includes('setupAutoUpdate'), 'main: setupAutoUpdate missing');
  assert(mainSrc.includes("ipcMain.handle('update:check'"), 'main: update:check handler missing');
  assert(mainSrc.includes("ipcMain.handle('app:get-version'"), 'main: app:get-version handler missing');
  assert(mainSrc.includes('STELLAVAULT_AUTO_UPDATE'), 'main: signing gate flag missing');
  assert(readFileSync(PRELOAD, 'utf8').includes("'update:check'"), 'preload: update:check allowlist missing');
  assert(readFileSync(COMMANDS, 'utf8').includes('help.check-updates'), 'commands: check-updates command missing');
  assert(readFileSync(APP_MENU, 'utf8').includes('help.check-updates'), 'AppMenu: check-updates item missing');
  assert(readFileSync(DESKTOP_PKG, 'utf8').includes('update-electron-app'), 'package.json: update-electron-app dep missing');
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
