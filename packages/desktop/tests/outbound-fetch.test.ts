// outbound-fetch SSRF 회귀 + 캡 테스트 (SP0 Task 2, design.md §3/§6).
// electron net.request를 mock하고, 실제 core assertPublicUrl을 IP 리터럴 URL에 적용해
// 매 홉 재검증(rebinding 방어)을 DNS 없이 검증한다.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';

// ── electron net.request mock ─────────────────────────────────────────────
// FakeResponse: data/end/error를 테스트가 직접 emit. statusCode/headers 노출.
class FakeResponse extends EventEmitter {
  statusCode: number;
  headers: Record<string, string | string[]>;
  constructor(statusCode = 200, headers: Record<string, string | string[]> = {}) {
    super();
    this.statusCode = statusCode;
    this.headers = headers;
  }
}

// FakeRequest: net.request 반환물. on/end/abort/followRedirect 제공.
// 테스트는 reqs[]에서 인스턴스를 꺼내 response/redirect/error를 구동한다.
class FakeRequest extends EventEmitter {
  url: string;
  ended = false;
  aborted = false;
  followed = 0;
  constructor(opts: { url: string }) {
    super();
    this.url = opts.url;
  }
  end() { this.ended = true; }
  abort() { this.aborted = true; this.emit('abort'); }
  followRedirect() { this.followed += 1; }
}

const reqs: FakeRequest[] = [];
const mockRequest = vi.fn((opts: { url: string }) => {
  const r = new FakeRequest(opts);
  reqs.push(r);
  return r;
});

vi.mock('electron', () => ({
  net: { request: mockRequest },
}));

// 가장 최근 생성된 요청을 얻어 비동기 이벤트를 구동하기 위한 헬퍼.
function lastReq(): FakeRequest {
  return reqs[reqs.length - 1];
}
// 마이크로태스크 한 틱 양보(safeFetch 내부 await assertPublicUrl 통과 후 net.request 호출 보장).
const tick = () => new Promise((r) => setTimeout(r, 0));

const PUBLIC = 'http://93.184.216.34/';      // example.com IP 리터럴 (공개, DNS 불필요)
const METADATA = 'http://169.254.169.254/';   // 클라우드 메타데이터 (link-local, 사설)
const RFC1918 = 'http://10.0.0.1/';           // 사설

beforeEach(() => {
  reqs.length = 0;
  vi.clearAllMocks();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('safeFetch — SSRF + caps', () => {
  it('(a) rejects a private start URL before issuing any request', async () => {
    const { safeFetch } = await import('../src/main/outbound-fetch.js');
    await expect(safeFetch(RFC1918)).rejects.toThrow();
    expect(mockRequest).not.toHaveBeenCalled(); // 가드가 net.request 이전에 차단
  });

  it('(b) happy path: public literal within caps + allowed content-type resolves', async () => {
    const { safeFetch } = await import('../src/main/outbound-fetch.js');
    const p = safeFetch(PUBLIC, { allowedContentTypes: ['image/'] });
    await tick();
    expect(mockRequest).toHaveBeenCalledTimes(1);
    const req = lastReq();
    expect(req.ended).toBe(true);
    const res = new FakeResponse(200, { 'content-type': 'image/png', 'content-length': '4' });
    req.emit('response', res);
    res.emit('data', Buffer.from('AB'));
    res.emit('data', Buffer.from('CD'));
    res.emit('end');
    const out = await p;
    expect(out.status).toBe(200);
    expect(out.contentType).toBe('image/png');
    expect(out.finalUrl).toBe(PUBLIC);
    expect(out.buffer.toString()).toBe('ABCD');
    expect(req.aborted).toBe(false);
  });

  it('(c) redirect to a private target → reject AND abort', async () => {
    const { safeFetch } = await import('../src/main/outbound-fetch.js');
    const p = safeFetch(PUBLIC);
    await tick();
    const req = lastReq();
    // 공개→메타데이터 리다이렉트: 매 홉 재검증이 차단해야 함
    req.emit('redirect', 302, 'GET', METADATA, {});
    await expect(p).rejects.toThrow();
    expect(req.aborted).toBe(true);
    expect(req.followed).toBe(0); // followRedirect 호출 안 됨
  });

  it('(d) exceeding maxRedirects (3 hops, max 2) → reject', async () => {
    const { safeFetch } = await import('../src/main/outbound-fetch.js');
    const p = safeFetch(PUBLIC, { maxRedirects: 2 });
    await tick();
    const req = lastReq();
    // 공개 호스트 간 3회 리다이렉트 — 모두 public이지만 홉 수 초과로 거부
    req.emit('redirect', 302, 'GET', 'http://93.184.216.35/', {});
    await tick();
    req.emit('redirect', 302, 'GET', 'http://93.184.216.36/', {});
    await tick();
    req.emit('redirect', 302, 'GET', 'http://93.184.216.37/', {});
    await expect(p).rejects.toThrow();
    expect(req.aborted).toBe(true);
  });

  it('(e) content-length header > maxBytes → reject early', async () => {
    const { safeFetch } = await import('../src/main/outbound-fetch.js');
    const p = safeFetch(PUBLIC, { maxBytes: 100 });
    await tick();
    const req = lastReq();
    const res = new FakeResponse(200, { 'content-type': 'image/png', 'content-length': '999' });
    req.emit('response', res);
    await expect(p).rejects.toThrow();
    expect(req.aborted).toBe(true);
  });

  it('(f) streamed bytes exceed maxBytes (no content-length) → abort + reject', async () => {
    const { safeFetch } = await import('../src/main/outbound-fetch.js');
    const p = safeFetch(PUBLIC, { maxBytes: 4 });
    await tick();
    const req = lastReq();
    const res = new FakeResponse(200, { 'content-type': 'image/png' }); // content-length 없음
    req.emit('response', res);
    res.emit('data', Buffer.from('AB'));
    res.emit('data', Buffer.from('CDE')); // 누적 5 > 4
    await expect(p).rejects.toThrow();
    expect(req.aborted).toBe(true);
  });

  it('(g) content-type not in allowedContentTypes → reject', async () => {
    const { safeFetch } = await import('../src/main/outbound-fetch.js');
    const p = safeFetch(PUBLIC, { allowedContentTypes: ['image/'] });
    await tick();
    const req = lastReq();
    const res = new FakeResponse(200, { 'content-type': 'text/html' });
    req.emit('response', res);
    await expect(p).rejects.toThrow();
    expect(req.aborted).toBe(true);
  });

  it('(h) timeout (response never ends) → abort + reject', async () => {
    const { safeFetch } = await import('../src/main/outbound-fetch.js');
    const p = safeFetch(PUBLIC, { timeoutMs: 20 });
    await tick();
    const req = lastReq();
    const res = new FakeResponse(200, { 'content-type': 'image/png' });
    req.emit('response', res);
    res.emit('data', Buffer.from('AB'));
    // end를 절대 emit하지 않음 → 타임아웃이 abort + reject 해야 함
    await expect(p).rejects.toThrow();
    expect(req.aborted).toBe(true);
  });

  it('redirect to a relative Location is resolved against current URL and re-validated', async () => {
    const { safeFetch } = await import('../src/main/outbound-fetch.js');
    const p = safeFetch(PUBLIC, { allowedContentTypes: ['image/'], maxRedirects: 2 });
    await tick();
    const req = lastReq();
    // 상대 경로 리다이렉트 → 현재 URL 기준 해석되어 여전히 public, followRedirect 진행
    req.emit('redirect', 302, 'GET', '/img.png', {});
    await tick();
    expect(req.followed).toBe(1);
    expect(req.aborted).toBe(false);
    const res = new FakeResponse(200, { 'content-type': 'image/png' });
    req.emit('response', res);
    res.emit('data', Buffer.from('XY'));
    res.emit('end');
    const out = await p;
    expect(out.finalUrl).toBe('http://93.184.216.34/img.png'); // 홉 추적
    expect(out.buffer.toString()).toBe('XY');
  });

  it('content-type gate is skipped when allowedContentTypes is omitted', async () => {
    const { safeFetch } = await import('../src/main/outbound-fetch.js');
    const p = safeFetch(PUBLIC); // allowedContentTypes 미지정
    await tick();
    const req = lastReq();
    const res = new FakeResponse(200, { 'content-type': 'application/octet-stream' });
    req.emit('response', res);
    res.emit('data', Buffer.from('Z'));
    res.emit('end');
    const out = await p;
    expect(out.contentType).toBe('application/octet-stream');
  });
});
