// SP1 chat — model-output XSS boundary (multimedia-chat-sp1-plan §6).
//
// This module is the SINGLE trust boundary for rendering assistant (LLM) output.
// Assistant text is untrusted: it may try to smuggle <script>, inline event
// handlers (onerror/onclick/…), javascript:/data: URLs, remote <img> beacons, or
// app:// URLs pointing outside the vault host. Everything below is deliberately
// STRICT — start from rehype-sanitize's defaultSchema and remove, never add.
//
// Two layers, in order:
//   1. rehypeSanitize(CHAT_SANITIZE_SCHEMA) — drops script/iframe/object/embed/
//      style tags, strips ALL attributes except a small per-tag allowlist, and
//      restricts URL protocols (href: https|app, src: app — NO http/javascript/
//      data/mailto/tel).
//   2. enforceAppHost — runs AFTER sanitize and FAIL-CLOSED drops any surviving
//      app: URL that is not exactly app://vault/… . This covers app://evil-host,
//      app://localhost, the host-less/opaque forms (app:a.png, app:/a.png,
//      app:///x), AND a wrong-case host (app://VAULT — which the main asset
//      handler also rejects case-sensitively). Only app://vault/… survives;
//      remote media for later SPs arrives pre-rewritten to app://vault.
//
// react-markdown note: we pass `urlTransform={identityUrlTransform}` so the
// sanitize schema's `protocols` is the SOLE URL authority. react-markdown's
// built-in defaultUrlTransform would otherwise strip `app://` before sanitize
// runs (it only allows http/https/mailto/tel), which would silently break vault
// images. We do NOT enable rehype-raw, so raw HTML in the model output is NOT
// parsed into live elements — it is escaped to text (inert) by default. The
// schema + plugin therefore govern only markdown-produced elements; raw HTML
// like `<script>`/`<img onerror>` can never execute regardless.

import React from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import { visit } from 'unist-util-visit';
import { chatMarkdownComponents, remarkChatMath } from './chat-markdown.js';

// Tags we never want from model output, even though defaultSchema permits some.
const DROP_TAGS = new Set(['script', 'iframe', 'object', 'embed', 'style']);

/**
 * The authoritative sanitize schema for chat assistant output. Built from
 * rehype-sanitize's defaultSchema by REMOVING capabilities:
 *  - tagNames: drop script/iframe/object/embed/style.
 *  - attributes: '*' = [] strips every global attribute (on*, style, class,
 *    target, id, …). Only a tiny per-tag allowlist is re-added:
 *      a   → href              (no target/rel/download)
 *      img → src, alt, title   (no srcset/width/height/loading)
 *  - protocols: href https|app, src app only. http/javascript/data/mailto/tel
 *    are NOT listed → those URLs are dropped.
 */
export const CHAT_SANITIZE_SCHEMA = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? [])].filter((t) => !DROP_TAGS.has(t)),
  attributes: {
    // NOTE: we deliberately do NOT spread defaultSchema.attributes — that would
    // re-introduce per-tag allowances (e.g. img longDesc, a aria*) we want gone.
    // The model only needs links + images; '*' = [] strips everything else.
    a: ['href'],
    img: ['src', 'alt', 'title'],
    // `className` on code/pre carries ONLY the fenced-code language hint
    // (e.g. 'language-ts'). It is an inert string — it cannot execute and (with
    // clobberPrefix on ids/names) cannot clobber the DOM; the chat-markdown
    // renderer reads it to label the code block. No other tag gets className.
    code: ['className'],
    pre: ['className'],
    '*': [],
  },
  // Only https links and app: (vault) URLs survive. enforceAppHost then pins the
  // app: host to 'vault'. No http (downgrade), no javascript:/data: (XSS), no
  // mailto/tel (not meaningful in this surface).
  protocols: {
    href: ['https', 'app'],
    src: ['app'],
  },
  // Namespace any clobberable ids/names so model output cannot shadow real DOM
  // ids (defaultSchema sets this too; kept explicit for the security boundary).
  clobberPrefix: 'sv-chat-',
} as const;

/** Minimal hast node shape we touch (avoids a hard @types/hast dependency). */
interface HastElement {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: unknown[];
}

// CANONICAL app://vault host-pin policy (renderer half). The ONLY app: form the
// renderer permits. Host matched CASE-SENSITIVELY ('vault', lowercase) to mirror
// the main-process asset handler — these two layers MUST stay in lockstep:
//   • renderer (this file): APP_VAULT_RE below + enforceAppHost (fail-closed drop)
//   • main: packages/desktop/src/main/index.ts → registerAssetProtocol →
//     `if (url.hostname !== 'vault') return 404` (also case-sensitive — new URL()
//     does NOT lowercase a custom-scheme host, so app://VAULT → hostname 'VAULT').
// Changing case-handling on EITHER side without the other reopens host-pin drift.
// tests/app-host-consistency.test.ts asserts both agree (incl. app://VAULT) and
// fails CI if they diverge. Exported for that test. `app://vault` or
// `app://vault/<path>` only — a trailing `/` or end-of-string after the host.
export const APP_VAULT_RE = /^app:\/\/vault(\/|$)/;
// Any value whose scheme is `app:` (in ANY form: app://…, app:/…, app:…). Used to
// fail closed: every app: URL that is NOT exactly app://vault/… is dropped.
const APP_SCHEME_RE = /^app:/i;

/**
 * rehype plugin — runs AFTER rehypeSanitize. Enforces the app:// host-pin
 * invariant FAIL-CLOSED: for a[href] / img[src], any value with the `app:`
 * scheme that does not match `app://vault/…` is removed. This catches not only
 * `app://evil-host/…` and `app://localhost/…` but also the host-less / opaque
 * forms (`app:a.png`, `app:/a.png`, `app:///x`) and a wrong-case host
 * (`app://VAULT/x`, which the main handler also rejects). https links are
 * untouched here (the schema already vetted their protocol).
 */
export function enforceAppHost() {
  return (tree: unknown): void => {
    visit(tree as never, 'element', (node: HastElement) => {
      const props = node.properties;
      if (!props) return;
      const key = node.tagName === 'a' ? 'href' : node.tagName === 'img' ? 'src' : null;
      if (!key) return;
      const value = props[key];
      if (typeof value !== 'string') return;
      // Only the app: scheme is host-pinned; https (already vetted) passes through.
      if (APP_SCHEME_RE.test(value) && !APP_VAULT_RE.test(value)) {
        delete props[key];
      }
    });
  };
}

/**
 * Identity URL transform. react-markdown's default would strip `app://` before
 * the schema runs; we delegate ALL URL filtering to CHAT_SANITIZE_SCHEMA +
 * enforceAppHost so there is one trust boundary, not two competing ones.
 */
export function identityUrlTransform(url: string): string {
  return url;
}

export interface SanitizedMarkdownProps {
  children: string;
}

/**
 * The ONLY component that should render assistant/LLM markdown. Wraps
 * ReactMarkdown with the fixed sanitize schema + host-pin plugin. Do not pass
 * extra rehype/remark plugins here — that would widen the trust boundary.
 */
export function SanitizedMarkdown({ children }: SanitizedMarkdownProps) {
  return React.createElement(
    ReactMarkdown,
    {
      urlTransform: identityUrlTransform,
      // remarkChatMath runs on the mdast (BEFORE remark-rehype) and only re-tags $…$ runs as
      // math code nodes — it emits NO HTML and never touches the sanitize boundary below.
      remarkPlugins: [remarkChatMath],
      rehypePlugins: [[rehypeSanitize, CHAT_SANITIZE_SCHEMA], enforceAppHost],
      components: chatMarkdownComponents,
    },
    children,
  );
}
