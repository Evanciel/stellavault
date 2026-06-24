// SP1 chat sanitize boundary tests (multimedia-chat-sp1-plan §6, §9).
//
// We render the SanitizedMarkdown component to a STATIC HTML string with
// react-dom/server (no jsdom / browser needed — vitest runs in node) and assert
// on the resulting markup. This exercises the real trust boundary: the fixed
// CHAT_SANITIZE_SCHEMA + the enforceAppHost rehype plugin + the identity
// urlTransform, exactly as MessageBubble uses them.
//
// Security intent under test:
//   - inline event handlers (onerror/onclick/…) never survive
//   - javascript: / data: / http: URLs are dropped
//   - remote <img> beacons are blocked (src = app: only)
//   - app:// is host-pinned to `vault` (app://evil-host rejected)
//   - app://vault is preserved; https links are preserved
//   - raw <script> / raw <img onerror> produce no live element

import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  SanitizedMarkdown,
  CHAT_SANITIZE_SCHEMA,
  enforceAppHost,
} from '../src/renderer/lib/sanitize.js';

function render(markdown: string): string {
  return renderToStaticMarkup(React.createElement(SanitizedMarkdown, null, markdown));
}

describe('CHAT_SANITIZE_SCHEMA shape', () => {
  it('drops script/iframe/object/embed/style from tagNames', () => {
    for (const t of ['script', 'iframe', 'object', 'embed', 'style']) {
      expect(CHAT_SANITIZE_SCHEMA.tagNames).not.toContain(t);
    }
  });

  it('strips all global attributes (* = empty allowlist)', () => {
    expect(CHAT_SANITIZE_SCHEMA.attributes['*']).toEqual([]);
  });

  it('allows only href on a, and src/alt/title on img', () => {
    expect(CHAT_SANITIZE_SCHEMA.attributes.a).toEqual(['href']);
    expect(CHAT_SANITIZE_SCHEMA.attributes.img).toEqual(['src', 'alt', 'title']);
  });

  it('allows className ONLY on code/pre (the fenced-code language hint), nowhere else', () => {
    expect(CHAT_SANITIZE_SCHEMA.attributes.code).toEqual(['className']);
    expect(CHAT_SANITIZE_SCHEMA.attributes.pre).toEqual(['className']);
    // a non-code tag must NOT gain className — the '*' rule stays empty.
    expect(CHAT_SANITIZE_SCHEMA.attributes['*']).toEqual([]);
    expect((CHAT_SANITIZE_SCHEMA.attributes as Record<string, unknown>).p).toBeUndefined();
  });

  it('renders a fenced code block: language label, syntax highlighting, content (className survives)', () => {
    const html = render('```python\nprint(1)\n```');
    expect(html).toContain('python');   // language label from the surviving className
    expect(html).toContain('print');    // code content (lowlight splits print(1) into tokens)
    expect(html).toContain('hljs-');    // syntax highlighting was applied (lowlight token spans)
  });

  it('restricts protocols: href https|app, src app — no http/javascript/data/mailto', () => {
    expect(CHAT_SANITIZE_SCHEMA.protocols.href).toEqual(['https', 'app']);
    expect(CHAT_SANITIZE_SCHEMA.protocols.src).toEqual(['app']);
    expect(CHAT_SANITIZE_SCHEMA.protocols.href).not.toContain('http');
    expect(CHAT_SANITIZE_SCHEMA.protocols.href).not.toContain('javascript');
    expect(CHAT_SANITIZE_SCHEMA.protocols.href).not.toContain('data');
    expect(CHAT_SANITIZE_SCHEMA.protocols.href).not.toContain('mailto');
  });
});

describe('SanitizedMarkdown rendering', () => {
  it('strips onerror from a raw <img> (no event handler, no live element)', () => {
    const out = render('<img src=x onerror=alert(1)>');
    expect(out).not.toContain('onerror');
    expect(out).not.toContain('alert(1)');
  });

  it('drops a javascript: link href', () => {
    const out = render('[x](javascript:alert(1))');
    expect(out).toContain('x'); // text survives
    expect(out).not.toContain('javascript:');
    expect(out).not.toContain('href="javascript');
  });

  it('drops a data: link href', () => {
    const out = render('[x](data:text/html,<b>hi</b>)');
    expect(out).not.toContain('data:text/html');
    expect(out).not.toContain('href="data:');
  });

  it('preserves an https markdown link', () => {
    const out = render('[ok](https://ok.example/page)');
    expect(out).toContain('href="https://ok.example/page"');
    expect(out).toContain('>ok</a>');
  });

  it('preserves an app://vault image src', () => {
    const out = render('![pic](app://vault/attachments/a.png)');
    expect(out).toContain('src="app://vault/attachments/a.png"');
  });

  it('drops a remote (https) image src — only app: allowed for img', () => {
    const out = render('![remote](https://remote.example/x.png)');
    expect(out).not.toContain('https://remote.example/x.png');
    expect(out).not.toContain('src="https://');
  });

  it('rejects app://evil-host image via enforceAppHost (host pin to vault)', () => {
    const out = render('![evil](app://evil-host/x.png)');
    expect(out).not.toContain('app://evil-host');
    expect(out).not.toContain('evil-host');
  });

  it('rejects app://evil-host link via enforceAppHost', () => {
    const out = render('[e](app://evil-host/note)');
    expect(out).toContain('e'); // text survives, href removed
    expect(out).not.toContain('app://evil-host');
  });

  it('preserves an app://vault link', () => {
    const out = render('[v](app://vault/Some%20Note)');
    expect(out).toContain('href="app://vault/Some%20Note"');
  });

  it('produces no live element for a raw <script> tag', () => {
    const out = render('<script>alert(1)</script>');
    expect(out).not.toContain('<script');
    expect(out).not.toContain('alert(1)');
  });

  it('strips target/style/class via the * = [] allowlist (markdown image alt only)', () => {
    // Markdown cannot emit target/style/class directly; assert the schema would
    // not carry them by rendering a normal image and confirming no extra attrs.
    const out = render('![a](app://vault/a.png)');
    expect(out).not.toContain('target=');
    expect(out).not.toContain('style=');
    expect(out).not.toContain('class=');
  });

  // Defense-in-depth: prove no live element/event from raw SVG/MathML/input or a
  // raw <a target=_blank> survives the pipeline (raw HTML is inert — rehype-raw
  // is NOT enabled — and markdown-emitted handlers are stripped by * = []).
  it('produces no live <svg onload> / <math> / <input>', () => {
    const out = render('<svg onload=alert(1)></svg><math></math><input value=x>');
    expect(out).not.toContain('onload');
    expect(out).not.toContain('alert(1)');
    expect(out).not.toContain('<svg');
    expect(out).not.toContain('<math');
    expect(out).not.toContain('<input');
  });

  it('strips target/style/class on a raw <a> (raw HTML inert, attrs gone)', () => {
    const out = render('<a href="https://x" target="_blank" style="x" class="y">k</a>');
    expect(out).not.toContain('target=');
    expect(out).not.toContain('style=');
    expect(out).not.toContain('class=');
    expect(out).not.toContain('_blank');
  });
});

describe('enforceAppHost fail-closed (host-less / wrong-case app: forms)', () => {
  // The renderer-layer host-pin must enforce its OWN invariant, not lean entirely
  // on the main asset handler. Every app: URL not exactly app://vault/… is dropped.
  it('drops the host-less / opaque app: forms (app:a.png, app:/a.png, app:///x)', () => {
    for (const bad of ['app:a.png', 'app:/a.png', 'app:///x.png']) {
      const out = render(`![x](${bad})`);
      expect(out, `${bad} must not survive`).not.toContain(bad);
      expect(out).not.toContain('src="app:');
    }
  });

  it('drops a wrong-case host app://VAULT/x (matches the case-sensitive main handler)', () => {
    const out = render('![x](app://VAULT/a.png)');
    expect(out).not.toContain('app://VAULT');
    expect(out).not.toContain('src="app:');
  });

  it('keeps the bare app://vault root and app://vault/<path>', () => {
    expect(render('[r](app://vault)')).toContain('href="app://vault"');
    expect(render('[r](app://vault/)')).toContain('href="app://vault/"');
    expect(render('![p](app://vault/x.png)')).toContain('src="app://vault/x.png"');
  });

  it('does not host-pin non-app schemes (https passes through untouched)', () => {
    expect(render('[ok](https://ok.example/)')).toContain('href="https://ok.example/"');
  });
});

describe('SanitizedMarkdown plugin-list lock (no rehype-raw / remark-gfm)', () => {
  // Locks the trust boundary against a future dependency/plugin addition that
  // would re-open raw-HTML (rehype-raw) or autolink (remark-gfm) surfaces.
  // Empirical assertion: raw HTML stays escaped to text and never becomes a live
  // element — if rehype-raw were ever added, this would start failing.
  it('keeps raw HTML inert (escaped to text, never a live element)', () => {
    const out = render('before <img src=x onerror=alert(1)> <b>bold</b> after');
    expect(out).not.toContain('onerror');
    expect(out).not.toContain('alert(1)');
    // The <b> tag, written as raw HTML, must NOT become a live <b> element.
    expect(out).not.toContain('<b>bold</b>');
    // Visible text is preserved (escaped), proving the raw markup rendered inert.
    expect(out).toContain('before');
    expect(out).toContain('after');
  });
});

describe('enforceAppHost plugin (direct hast)', () => {
  // Exercise the plugin on a minimal hast tree to prove the host-pin logic
  // independent of react-markdown's pipeline.
  it('deletes app:// attrs whose host is not vault, keeps vault + https', () => {
    const tree = {
      type: 'root',
      children: [
        { type: 'element', tagName: 'a', properties: { href: 'app://evil-host/x' }, children: [] },
        { type: 'element', tagName: 'a', properties: { href: 'app://vault/ok' }, children: [] },
        { type: 'element', tagName: 'a', properties: { href: 'https://ok.example/' }, children: [] },
        { type: 'element', tagName: 'img', properties: { src: 'app://localhost/x.png' }, children: [] },
        { type: 'element', tagName: 'img', properties: { src: 'app://vault/a.png' }, children: [] },
      ],
    };
    enforceAppHost()(tree);
    const [evilA, vaultA, httpsA, badImg, okImg] = tree.children as Array<{
      properties: Record<string, unknown>;
    }>;
    expect(evilA.properties.href).toBeUndefined();
    expect(vaultA.properties.href).toBe('app://vault/ok');
    expect(httpsA.properties.href).toBe('https://ok.example/');
    expect(badImg.properties.src).toBeUndefined();
    expect(okImg.properties.src).toBe('app://vault/a.png');
  });
});
