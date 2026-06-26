// Stellavault Desktop — 하드닝된 단일 outbound fetcher (main process).
// Design Ref: multimedia-chat-design.md §3/§6.1 — SSRF critical.
// unfurl·원격미디어·url-capture가 공유하는 유일한 네트워크 출구. 렌더러는 절대 원격
// 호스트와 직접 통신하지 않으며(§2-A), 모든 원격 바이트는 여기서 받아 app://로 재서빙된다.
//
// 방어 계층:
//  ① 시작 URL을 core assertPublicUrl(resolve-then-check-IP)로 검증 — http/https만,
//     도메인이면 모든 A/AAAA를 해석해 사설/loopback/link-local/169.254.169.254/IPv6
//     매핑/decimal·hex 인코딩을 차단(fail-closed).
//  ② 매 홉 재검증: redirect:'manual'이라 electron이 'redirect'를 발생시키면, 우리는
//     followRedirect()로 같은 요청을 잇지 않고 현재 요청을 abort한 뒤, 검증된 리다이렉트
//     타깃으로 '새 net.request'를 발행한다(abort-and-reissue). 모든 홉의 URL이 동일한 async
//     assertPublicUrl을 통과하므로 DNS rebinding/리다이렉트 우회를 방어하면서도, electron 35의
//     "followRedirect는 'redirect' 핸들러 안에서 동기로 호출해야 한다"는 제약을 건드리지 않는다.
//     (async 검증과 동기 followRedirect는 양립 불가 → 절대 followRedirect를 쓰지 않음.)
//  ③ content-length 헤더 또는 누적 수신 바이트가 maxBytes 초과 시 abort.
//  ④ 전체 timeout 초과 시 abort(전 홉 합산 deadline).
//  ⑤ content-type이 화이트리스트 밖이면 거부(allowedContentTypes 지정 시).
//
// 에러 메시지는 generic하게 유지(resolve된 내부 IP를 호출자에 노출하지 않음).
import { net } from 'electron';
import { assertPublicUrl } from '@stellavault/core';

export interface SafeFetchOptions {
  /** 누적 응답 바이트 상한. 기본 8MiB. */
  maxBytes?: number;
  /** 전체 요청 타임아웃(ms). 기본 10s. 모든 리다이렉트 홉을 합산한 단일 deadline. */
  timeoutMs?: number;
  /** 허용 리다이렉트 홉 수. 기본 2. */
  maxRedirects?: number;
  /**
   * 허용 content-type 목록. 정확 일치 또는 trailing-'/' prefix 매칭
   * (예: 'image/'는 'image/png' 허용). 미지정 시 content-type 게이트 생략(호출자 판단).
   */
  allowedContentTypes?: string[];
}

export interface SafeFetchResult {
  buffer: Buffer;
  contentType: string;
  finalUrl: string;
  status: number;
}

const DEFAULT_MAX_BYTES = 8 * 1024 * 1024; // 8 MiB
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_REDIRECTS = 2;

/** content-type이 화이트리스트(정확 일치 또는 'prefix/' prefix)에 들어가는지. */
function contentTypeAllowed(contentType: string, allowed: string[]): boolean {
  // 'image/png; charset=...' → 'image/png' (파라미터 제거 후 소문자 비교)
  const ct = contentType.split(';')[0].trim().toLowerCase();
  for (const rule of allowed) {
    const r = rule.trim().toLowerCase();
    if (r.endsWith('/')) {
      if (ct.startsWith(r)) return true;
    } else if (ct === r) {
      return true;
    }
  }
  return false;
}

/** electron 헤더 값(string | string[])을 단일 문자열로 정규화. */
function headerValue(value: string | string[] | undefined): string {
  if (value === undefined) return '';
  return Array.isArray(value) ? (value[0] ?? '') : value;
}

// 단일 홉(net.request 1회)의 결과. 리다이렉트면 다음 Location만 반환하고 바디는 받지 않는다.
type HopResult =
  | { kind: 'redirect'; location: string }
  | { kind: 'response'; buffer: Buffer; contentType: string; status: number };

interface RequestOnceOptions {
  maxBytes: number;
  /** 이 홉에 남은 시간(ms). 전체 deadline에서 차감한 값. */
  timeoutMs: number;
  allowedContentTypes?: string[];
}

/**
 * 단일 net.request를 발행해 한 홉만 처리한다.
 *  - redirect:'manual'이라 'redirect' 발생 시 즉시 abort하고 { kind:'redirect', location } resolve
 *    (followRedirect를 호출하지 않음 — 상위 루프가 검증 후 새 요청을 발행).
 *  - 'response' 발생 시 content-type 게이트 + content-length 선검사 + 누적 바이트 캡을 적용,
 *    'end'에서 { kind:'response', buffer, contentType, status } resolve.
 *  - 이 홉 timeout 초과 시 abort + reject. 'error' 시 reject.
 * settled 플래그로 이중 settle을 방지하고, reject/redirect/timeout 경로 모두에서 abort한다.
 */
function requestOnce(url: string, opts: RequestOnceOptions): Promise<HopResult> {
  const { maxBytes, timeoutMs, allowedContentTypes } = opts;

  return new Promise<HopResult>((resolve, reject) => {
    const request = net.request({ method: 'GET', url, redirect: 'manual' });

    const chunks: Buffer[] = [];
    let received = 0;
    let settled = false;

    const timer = setTimeout(() => {
      // ④ 이 홉 타임아웃(= 남은 전체 deadline): abort + reject.
      fail(new Error('Outbound fetch timed out'));
    }, timeoutMs);

    function cleanup() {
      clearTimeout(timer);
    }

    // reject 경로: 현재 요청을 abort하고 거부. abort 자체 실패는 무시.
    function fail(err: Error) {
      if (settled) return;
      settled = true;
      cleanup();
      try {
        request.abort();
      } catch {
        // 이미 종료된 요청 등 — 무시.
      }
      reject(err);
    }

    // 리다이렉트 경로: 바디를 받지 않고 현재 요청을 abort한 뒤 Location만 반환.
    function redirectTo(location: string) {
      if (settled) return;
      settled = true;
      cleanup();
      try {
        request.abort();
      } catch {
        // 무시.
      }
      resolve({ kind: 'redirect', location });
    }

    function succeed(result: HopResult) {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    }

    request.on('response', (response: Electron.IncomingMessage) => {
      if (settled) return;
      const status = response.statusCode;
      const contentType = headerValue(response.headers['content-type']);

      // ⑤ content-type 게이트(지정 시).
      if (allowedContentTypes && !contentTypeAllowed(contentType, allowedContentTypes)) {
        fail(new Error('Disallowed content-type'));
        return;
      }

      // ③ content-length 선검사: 헤더가 있고 maxBytes 초과면 바디 받기 전에 거부.
      const lenHeader = headerValue(response.headers['content-length']);
      if (lenHeader) {
        const declared = Number(lenHeader);
        if (Number.isFinite(declared) && declared > maxBytes) {
          fail(new Error('Response too large'));
          return;
        }
      }

      response.on('data', (chunk: Buffer) => {
        if (settled) return;
        received += chunk.length;
        // ③ 누적 바이트 캡(content-length 없거나 거짓일 때의 방어선).
        if (received > maxBytes) {
          fail(new Error('Response too large'));
          return;
        }
        chunks.push(chunk);
      });

      response.on('end', () => {
        succeed({
          kind: 'response',
          buffer: Buffer.concat(chunks),
          contentType,
          status,
        });
      });

      response.on('error', (err: Error) => {
        fail(err instanceof Error ? err : new Error('Response stream error'));
      });
    });

    // ② redirect:'manual' → 'redirect' 발생. followRedirect를 쓰지 않고 abort + Location 반환.
    //    상대 Location의 절대화/재검증은 상위 루프(safeFetch)가 수행한다.
    request.on('redirect', (
      _statusCode: number,
      _method: string,
      redirectUrl: string,
      _responseHeaders: Record<string, string[]>,
    ) => {
      redirectTo(redirectUrl);
    });

    request.on('error', (err: Error) => {
      fail(err instanceof Error ? err : new Error('Outbound fetch failed'));
    });

    request.end();
  });
}

/**
 * 공개 대상에서만, size/timeout/content-type 캡과 매 홉 SSRF 재검증을 적용해 fetch.
 * 사설/내부 대상이거나 캡 초과 시 throw(generic 메시지).
 *
 * abort-and-reissue 루프: 각 홉 직전에 assertPublicUrl로 현재 URL을 검증한 뒤 새 요청을
 * 발행하고, 'redirect'면 그 요청을 버리고 검증된 다음 타깃으로 재발행한다. 따라서 시작 URL과
 * 모든 리다이렉트 타깃이 동일한 가드를 통과하며, electron의 동기 followRedirect 제약을 피한다.
 */
export async function safeFetch(url: string, opts: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRedirects = opts.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const allowedContentTypes = opts.allowedContentTypes;

  // 전 홉을 합산한 단일 deadline(개별 홉이 아니라 전체 요청에 대한 타임아웃).
  const deadline = Date.now() + timeoutMs;
  let currentUrl = url;

  for (let hop = 0; ; hop++) {
    // ① + ② 시작 URL 및 매 리다이렉트 타깃을 새 요청 발행 전에 fail-closed로 검증.
    await assertPublicUrl(currentUrl);

    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new Error('Outbound fetch timed out');
    }

    const hopResult = await requestOnce(currentUrl, {
      maxBytes,
      timeoutMs: remaining,
      allowedContentTypes,
    });

    if (hopResult.kind === 'redirect') {
      // 홉 0이 첫 리다이렉트(redirects=1) → hop >= maxRedirects면 초과.
      if (hop >= maxRedirects) {
        throw new Error('Too many redirects');
      }
      // 상대 Location은 현재 URL 기준으로 절대화. 파싱 불가 시 거부.
      let nextUrl: string;
      try {
        nextUrl = new URL(hopResult.location, currentUrl).toString();
      } catch {
        throw new Error('Invalid redirect target');
      }
      currentUrl = nextUrl; // 다음 루프에서 assertPublicUrl 재검증 후 새 요청 발행
      continue;
    }

    return {
      buffer: hopResult.buffer,
      contentType: hopResult.contentType,
      finalUrl: currentUrl,
      status: hopResult.status,
    };
  }
}

// ════════════════════════════════════════════════════════════════════════════
// Track B (Sign in with ChatGPT) hardened POST helpers — used by oauth-openai.ts for the
// device/exchange/refresh calls to auth.openai.com. Every call is redirect:'error' (a Bearer/
// secret-carrying POST has NO benign redirect — hard-fail is strictly safer than re-issuing) +
// per-hop assertPublicUrl (SSRF/IP) + a SYNCHRONOUS exact-host pin BEFORE the request is sent.
// NOTE: the STREAMING Responses path is NOT routed here (safeFetch/these helpers buffer + cannot
// stream SSE); chat-engine hardens its OWN net.request for that path.
// ════════════════════════════════════════════════════════════════════════════

/** Exact host pin: case-folded equality with a trailing-dot strip. This is NOT `endsWith` —
 *  `endsWith('chatgpt.com')` would accept `chatgpt.com.evil.com`, and a trailing-dot host
 *  ("chatgpt.com.") must also be rejected (it resolves to the same site, bypassing a naive
 *  equality). Throws on mismatch so it can guard a request BEFORE any token header is attached. */
export function assertExactHost(host: string, allowed: string): void {
  const norm = (h: string) => String(h).trim().toLowerCase().replace(/\.+$/, '');
  if (norm(host) !== norm(allowed)) {
    throw new Error('Outbound host not allowed');
  }
}

const DEFAULT_POST_TIMEOUT_MS = 30_000;
const DEFAULT_POST_MAX_BYTES = 1 * 1024 * 1024; // 1 MiB — OAuth/token responses are tiny

export interface SafePostResult {
  status: number;
  body: string;
}

interface SafePostOptions {
  allowedHost: string;            // exact-host pin (auth.openai.com)
  headers?: Record<string, string>;
  contentType: string;            // 'application/json' | 'application/x-www-form-urlencoded'
  payload: string;               // serialized body
  timeoutMs?: number;
  maxBytes?: number;
}

/** Single hardened POST: assertPublicUrl (SSRF) → exact-host pin → net.request redirect:'error'.
 *  Buffers the (small) response and resolves {status, body}; rejects on redirect/timeout/transport
 *  error / oversize. The host pin runs SYNCHRONOUSLY before request.end(). */
async function safePost(url: string, opts: SafePostOptions): Promise<SafePostResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_POST_TIMEOUT_MS;
  const maxBytes = opts.maxBytes ?? DEFAULT_POST_MAX_BYTES;

  // ① SSRF/IP gate (resolve-then-check, fail-closed). NOT a host allowlist — the exact-host pin is.
  await assertPublicUrl(url);

  let u: URL;
  try { u = new URL(url); } catch { throw new Error('Invalid outbound URL'); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('Unsupported outbound protocol');
  // ② Exact-host pin BEFORE the request is issued (and thus before any token header is attached).
  assertExactHost(u.hostname, opts.allowedHost);

  return new Promise<SafePostResult>((resolve, reject) => {
    const request = net.request({ method: 'POST', url, redirect: 'error' });
    const chunks: Buffer[] = [];
    let received = 0;
    let settled = false;

    const timer = setTimeout(() => fail(new Error('Outbound POST timed out')), timeoutMs);
    const cleanup = () => clearTimeout(timer);
    function fail(err: Error) {
      if (settled) return; settled = true; cleanup();
      try { request.abort(); } catch { /* already done */ }
      reject(err);
    }
    function succeed(r: SafePostResult) { if (settled) return; settled = true; cleanup(); resolve(r); }

    request.setHeader('content-type', opts.contentType);
    for (const [k, v] of Object.entries(opts.headers ?? {})) request.setHeader(k, v);

    // redirect:'error' makes electron emit 'error' on a redirect; we never followRedirect.
    request.on('redirect', () => fail(new Error('Outbound POST redirect refused')));
    request.on('response', (response: Electron.IncomingMessage) => {
      if (settled) return;
      const status = response.statusCode;
      response.on('data', (chunk: Buffer) => {
        if (settled) return;
        received += chunk.length;
        if (received > maxBytes) { fail(new Error('Outbound POST response too large')); return; }
        chunks.push(chunk);
      });
      response.on('end', () => succeed({ status, body: Buffer.concat(chunks).toString('utf-8') }));
      response.on('error', (err: Error) => fail(err instanceof Error ? err : new Error('Outbound POST stream error')));
    });
    request.on('error', (err: Error) => fail(err instanceof Error ? err : new Error('Outbound POST failed')));

    request.write(opts.payload);
    request.end();
  });
}

/** Hardened JSON POST (Track B). Body is a plain object → JSON.stringify (zod-free). */
export function safePostJson(
  url: string, allowedHost: string, body: unknown, headers?: Record<string, string>,
): Promise<SafePostResult> {
  return safePost(url, { allowedHost, contentType: 'application/json', payload: JSON.stringify(body ?? {}), headers });
}

/** Hardened x-www-form-urlencoded POST (Track B token exchange). */
export function safePostForm(
  url: string, allowedHost: string, fields: Record<string, string>, headers?: Record<string, string>,
): Promise<SafePostResult> {
  const payload = Object.entries(fields)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  return safePost(url, { allowedHost, contentType: 'application/x-www-form-urlencoded', payload, headers });
}
