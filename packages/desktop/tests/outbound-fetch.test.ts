// outbound-fetch SSRF 회귀 + 캡 테스트 (SP0 Task 2, design.md §3/§6).
// electron net.request를 mock하고, 실제 core assertPublicUrl을 IP 리터럴 URL에 적용해
// 매 홉 재검증(rebinding 방어)을 DNS 없이 검증한다.
//
// 모델: safeFetch는 abort-and-reissue 루프 — 리다이렉트마다 현재 net.request를 abort하고
// 검증된 다음 타깃으로 '새 net.request'를 발행한다(followRedirect 미사용). 따라서 mock은
// net.request 호출마다 '새 FakeRequest'를 반환하고, 테스트는 홉별 인스턴스를 reqs[]에서
// 꺼내 response/redirect/error를 구동한다. URL 시퀀스와 홉별 abort를 추적해 검증한다.
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

// FakeRequest: net.request 1회 호출당 하나. on/end/abort 제공(followRedirect 없음 — 루프가
// abort 후 새 요청을 발행하는 모델이라 더 이상 존재하지 않는다).
class FakeRequest extends EventEmitter {
  url: string;
  ended = false;
  aborted = false;
  constructor(opts: { url: string }) {
    super();
    this.url = opts.url;
  }
  end() { this.ended = true; }
  abort() { this.aborted = true; this.emit('abort'); }
}

const reqs: FakeRequest[] = [];
// net.request에 전달된 URL 시퀀스(홉 순서 검증용).
const requestedUrls: string[] = [];
const mockRequest = vi.fn((opts: { url: string }) => {
  const r = new FakeRequest(opts);
  reqs.push(r);
  requestedUrls.push(opts.url);
  return r;
});

vi.mock('electron', () => ({
  net: { request: mockRequest },
}));

// 가장 최근 생성된 요청을 얻어 비동기 이벤트를 구동하기 위한 헬퍼.
function lastReq(): FakeRequest {
  return reqs[reqs.length - 1];
}
// 마이크로태스크/타이머 한 틱 양보(safeFetch 내부 await assertPublicUrl 통과 후
// net.request 호출 또는 다음 홉 재발행 보장).
const tick = () => new Promise((r) => setTimeout(r, 0));

const PUBLIC = 'http://93.184.216.34/';      // example.com IP 리터럴 (공개, DNS 불필요)
const PUBLIC2 = 'http://198.51.100.7/img.png'; // TEST-NET-2 (공개, DNS 불필요) — 리다이렉트 타깃
const METADATA = 'http://169.254.169.254/';   // 클라우드 메타데이터 (link-local, 사설)
const RFC1918 = 'http://10.0.0.1/';           // 사설

beforeEach(() => {
  reqs.length = 0;
  requestedUrls.length = 0;
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

  it('(c) redirect to a private target → reject AND abort, with NO second request issued', async () => {
    const { safeFetch } = await import('../src/main/outbound-fetch.js');
    const p = safeFetch(PUBLIC);
    await tick();
    const req = lastReq();
    // 공개→메타데이터 리다이렉트: 루프가 현재 요청을 abort하고, 재발행 전 assertPublicUrl이
    // 사설 타깃을 거부 → 두 번째 net.request는 절대 발행되지 않아야 함.
    req.emit('redirect', 302, 'GET', METADATA, {});
    await expect(p).rejects.toThrow();
    expect(req.aborted).toBe(true);                 // 홉1 요청은 abort됨
    expect(mockRequest).toHaveBeenCalledTimes(1);   // 사설 타깃으로 재발행 안 됨
    expect(requestedUrls).toEqual([PUBLIC]);        // 시퀀스에 METADATA 없음
  });

  it('(c2) happy redirect (public→public): second request issued to the target, then resolves', async () => {
    const { safeFetch } = await import('../src/main/outbound-fetch.js');
    const p = safeFetch(PUBLIC, { allowedContentTypes: ['image/'], maxRedirects: 2 });
    await tick();
    // 홉1: 공개 리터럴 → 다른 공개 리터럴로 리다이렉트.
    const req1 = lastReq();
    expect(req1.url).toBe(PUBLIC);
    req1.emit('redirect', 302, 'GET', PUBLIC2, {});
    await tick(); // 루프가 assertPublicUrl(PUBLIC2) 통과 후 새 요청 발행
    // 홉2: 검증된 리다이렉트 타깃으로 '새 net.request'가 발행되어야 함(= 실 런타임 follow 경로).
    expect(mockRequest).toHaveBeenCalledTimes(2);
    expect(requestedUrls).toEqual([PUBLIC, PUBLIC2]);
    expect(req1.aborted).toBe(true);                // 홉1 요청은 abort됨
    const req2 = lastReq();
    expect(req2).not.toBe(req1);                    // 새 인스턴스
    expect(req2.url).toBe(PUBLIC2);
    expect(req2.ended).toBe(true);
    // 홉2가 정상 응답 → 전체 resolve, finalUrl = 리다이렉트 타깃.
    const res = new FakeResponse(200, { 'content-type': 'image/png' });
    req2.emit('response', res);
    res.emit('data', Buffer.from('XY'));
    res.emit('end');
    const out = await p;
    expect(out.finalUrl).toBe(PUBLIC2);
    expect(out.buffer.toString()).toBe('XY');
    expect(req2.aborted).toBe(false);
  });

  it('(d) exceeding maxRedirects (3 hops, max 2) → reject', async () => {
    const { safeFetch } = await import('../src/main/outbound-fetch.js');
    const p = safeFetch(PUBLIC, { maxRedirects: 2 });
    await tick();
    // 공개 호스트 간 3회 연속 리다이렉트 — 모두 public이지만 홉 수 초과로 거부.
    // 매 리다이렉트마다 새 요청이 발행되므로 lastReq()로 현재 홉 요청을 구동한다.
    lastReq().emit('redirect', 302, 'GET', 'http://93.184.216.35/', {});
    await tick();
    lastReq().emit('redirect', 302, 'GET', 'http://93.184.216.36/', {});
    await tick();
    lastReq().emit('redirect', 302, 'GET', 'http://93.184.216.37/', {});
    await expect(p).rejects.toThrow();
    // 2회까지 follow(총 3개 요청 발행), 3번째 리다이렉트에서 초과 거부.
    expect(mockRequest).toHaveBeenCalledTimes(3);
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
    const req1 = lastReq();
    // 상대 경로 리다이렉트 → 현재 URL 기준 해석되어 여전히 public → 새 요청 발행.
    req1.emit('redirect', 302, 'GET', '/img.png', {});
    await tick();
    // 절대화된 URL로 두 번째 요청이 발행되어야 함.
    expect(mockRequest).toHaveBeenCalledTimes(2);
    expect(requestedUrls[1]).toBe('http://93.184.216.34/img.png');
    expect(req1.aborted).toBe(true);
    const req2 = lastReq();
    expect(req2.url).toBe('http://93.184.216.34/img.png');
    const res = new FakeResponse(200, { 'content-type': 'image/png' });
    req2.emit('response', res);
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
