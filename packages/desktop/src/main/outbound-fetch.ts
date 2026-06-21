// Stellavault Desktop — 하드닝된 단일 outbound fetcher (main process).
// Design Ref: multimedia-chat-design.md §3/§6.1 — SSRF critical.
// unfurl·원격미디어·url-capture가 공유하는 유일한 네트워크 출구. 렌더러는 절대 원격
// 호스트와 직접 통신하지 않으며(§2-A), 모든 원격 바이트는 여기서 받아 app://로 재서빙된다.
//
// 방어 계층:
//  ① 시작 URL을 core assertPublicUrl(resolve-then-check-IP)로 검증 — http/https만,
//     도메인이면 모든 A/AAAA를 해석해 사설/loopback/link-local/169.254.169.254/IPv6
//     매핑/decimal·hex 인코딩을 차단(fail-closed).
//  ② 매 홉 재검증: redirect:'manual'이라 electron이 'redirect'를 발생시키고, 우리가
//     followRedirect()를 호출해야 진행된다. 리다이렉트 타깃을 assertPublicUrl로 다시
//     검증(DNS rebinding/리다이렉트 우회 방어) + maxRedirects 초과 시 거부.
//  ③ content-length 헤더 또는 누적 수신 바이트가 maxBytes 초과 시 abort.
//  ④ 전체 timeout 초과 시 abort.
//  ⑤ content-type이 화이트리스트 밖이면 거부(allowedContentTypes 지정 시).
//
// 에러 메시지는 generic하게 유지(resolve된 내부 IP를 호출자에 노출하지 않음).
import { net } from 'electron';
import { assertPublicUrl } from '@stellavault/core';

export interface SafeFetchOptions {
  /** 누적 응답 바이트 상한. 기본 8MiB. */
  maxBytes?: number;
  /** 전체 요청 타임아웃(ms). 기본 10s. */
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

/**
 * 공개 대상에서만, size/timeout/content-type 캡과 매 홉 SSRF 재검증을 적용해 fetch.
 * 사설/내부 대상이거나 캡 초과 시 throw(generic 메시지).
 */
export async function safeFetch(url: string, opts: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRedirects = opts.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const allowedContentTypes = opts.allowedContentTypes;

  // ① 시작 URL 검증 — net.request 이전에 fail-closed.
  await assertPublicUrl(url);

  return new Promise<SafeFetchResult>((resolve, reject) => {
    const request = net.request({ method: 'GET', url, redirect: 'manual' });

    const chunks: Buffer[] = [];
    let received = 0;
    let redirects = 0;
    let currentUrl = url; // 매 홉마다 갱신해 finalUrl/상대경로 해석 기준으로 사용
    let settled = false;

    const timer = setTimeout(() => {
      // ④ 전체 타임아웃: abort + reject.
      fail(new Error('Outbound fetch timed out'));
    }, timeoutMs);

    function cleanup() {
      clearTimeout(timer);
    }

    function fail(err: Error) {
      if (settled) return;
      settled = true;
      cleanup();
      try {
        request.abort();
      } catch {
        // abort 자체 실패는 무시(이미 종료된 요청 등).
      }
      reject(err);
    }

    function succeed(result: SafeFetchResult) {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    }

    request.on('response', (response: Electron.IncomingMessage) => {
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
          buffer: Buffer.concat(chunks),
          contentType,
          finalUrl: currentUrl,
          status,
        });
      });

      response.on('error', (err: Error) => {
        fail(err instanceof Error ? err : new Error('Response stream error'));
      });
    });

    // ② 매 홉 재검증 — redirect:'manual'이라 발생. 검증 통과 시에만 followRedirect().
    request.on('redirect', (
      _statusCode: number,
      _method: string,
      redirectUrl: string,
      _responseHeaders: Record<string, string[]>,
    ) => {
      if (settled) return;

      redirects += 1;
      if (redirects > maxRedirects) {
        fail(new Error('Too many redirects'));
        return;
      }

      // 상대 Location은 현재 URL 기준으로 절대화. 파싱 불가 시 거부.
      let nextUrl: string;
      try {
        nextUrl = new URL(redirectUrl, currentUrl).toString();
      } catch {
        fail(new Error('Invalid redirect target'));
        return;
      }

      // 새 홉을 assertPublicUrl로 재검증(rebinding/사설 타깃 차단). async라 then/catch.
      assertPublicUrl(nextUrl).then(
        () => {
          if (settled) return; // 검증 중 타임아웃/취소되었을 수 있음
          currentUrl = nextUrl;
          try {
            request.followRedirect();
          } catch (err) {
            fail(err instanceof Error ? err : new Error('followRedirect failed'));
          }
        },
        () => {
          // 사설/내부 타깃 → 거부 + abort.
          fail(new Error('Redirect to a non-public target'));
        },
      );
    });

    request.on('error', (err: Error) => {
      fail(err instanceof Error ? err : new Error('Outbound fetch failed'));
    });

    request.end();
  });
}
