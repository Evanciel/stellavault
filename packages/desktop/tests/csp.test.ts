import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// SP0 Task 4: lock the renderer CSP so a future "allow remote images/media" PR is
// blocked by CI. Per design §5 risk #2, remote bytes are re-served via app://, never
// fetched directly by the renderer. The regression assertion below fails the build if
// any img-src / media-src / connect-src / default-src ever gains a remote origin.

const HTML = readFileSync(new URL('../src/renderer/index.html', import.meta.url), 'utf-8');

/** Pull the content="…" of the <meta http-equiv="Content-Security-Policy"> tag.
 * The value itself contains single quotes ('self', 'unsafe-inline'), so the regex
 * captures everything up to the matching outer delimiter (" or ') — NOT the first
 * inner quote. */
function extractCsp(html: string): string {
  const tag = html.match(/<meta\s+http-equiv=["']Content-Security-Policy["'][^>]*>/i);
  expect(tag, 'CSP <meta> tag must exist in index.html').not.toBeNull();
  const content = tag![0].match(/content=("([^"]*)"|'([^']*)')/i);
  expect(content, 'CSP <meta> must have a content attribute').not.toBeNull();
  return content![2] ?? content![3];
}

/** directive name -> source tokens. Tolerant of extra whitespace and a trailing ';'. */
function parseCsp(csp: string): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const raw of csp.split(';')) {
    const part = raw.trim();
    if (!part) continue; // skip empties (incl. trailing ';')
    const tokens = part.split(/\s+/);
    const name = tokens[0];
    map.set(name, tokens.slice(1));
  }
  return map;
}

const csp = parseCsp(extractCsp(HTML));

// A "remote origin" is any source that names a network host: a full http(s):// URL
// OR the bare http:/https: scheme (which would allow ALL remote hosts). Local schemes
// (app:, blob:, data:) and keywords ('self', 'unsafe-inline') are fine.
const REMOTE = /^https?:/i;

describe('renderer CSP — media-src lock', () => {
  it('defines a media-src directive', () => {
    expect(csp.has('media-src')).toBe(true);
  });

  it("media-src allows the local sources 'self', app:, blob:", () => {
    const sources = csp.get('media-src') ?? [];
    expect(sources).toContain("'self'");
    expect(sources).toContain('app:');
    expect(sources).toContain('blob:');
  });

  it("img-src still allows 'self' and app: (no regression)", () => {
    const sources = csp.get('img-src') ?? [];
    expect(sources).toContain("'self'");
    expect(sources).toContain('app:');
  });

  // The regression lock: this is what fails CI if someone later adds a remote origin
  // (e.g. https://evil.com, or the bare `https:` scheme) to a content-bearing directive.
  it.each(['default-src', 'img-src', 'media-src', 'connect-src'])(
    'forbids any remote http(s) origin in %s',
    (directive) => {
      const sources = csp.get(directive) ?? [];
      for (const token of sources) {
        expect(token, `${directive} must not contain remote origin "${token}"`).not.toMatch(REMOTE);
      }
    },
  );
});
