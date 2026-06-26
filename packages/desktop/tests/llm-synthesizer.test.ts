// llm-synthesizer key-exfil regression — the buffered Ask/Wiki POST (postJson) must be
// redirect-safe + host-pinned: a 3xx at api.anthropic.com / api.openai.com must NEVER
// replay the x-api-key / Bearer / Gemini key-in-URL to the redirect host.
// Reuses the FakeRequest/FakeResponse + vi.mock('electron') net pattern.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';

class FakeResponse extends EventEmitter {
  statusCode: number;
  headers: Record<string, string | string[]>;
  constructor(statusCode = 200, headers: Record<string, string | string[]> = {}) {
    super();
    this.statusCode = statusCode;
    this.headers = headers;
  }
}

class FakeRequest extends EventEmitter {
  opts: any;
  ended = false;
  aborted = false;
  headers: Record<string, string> = {};
  body = '';
  constructor(opts: any) { super(); this.opts = opts; }
  setHeader(k: string, v: string) { this.headers[k.toLowerCase()] = v; }
  write(b: string) { this.body += b; }
  end() { this.ended = true; }
  abort() { this.aborted = true; this.emit('abort'); }
}

const reqs: FakeRequest[] = [];
const mockRequest = vi.fn((opts: any) => {
  const r = new FakeRequest(opts);
  reqs.push(r);
  return r;
});

vi.mock('electron', () => ({ net: { request: mockRequest } }));

const tick = () => new Promise((r) => setTimeout(r, 0));
function lastReq(): FakeRequest { return reqs[reqs.length - 1]; }

beforeEach(() => { reqs.length = 0; vi.clearAllMocks(); });
afterEach(() => { vi.restoreAllMocks(); });

const ANTHROPIC = { provider: 'anthropic' as const, apiKey: 'sk-ant-SECRET-KEY', model: '', baseURL: '' };
const OPENAI = { provider: 'openai' as const, apiKey: 'sk-SECRET-OPENAI', model: 'gpt-4o-mini', baseURL: '' };

describe('llm-synthesizer postJson — redirect-safe + host-pinned', () => {
  it('anthropic Ask: redirect:error + host-pinned request carries x-api-key, resolves on 200', async () => {
    const { makeSynthesizer } = await import('../src/main/llm-synthesizer.js');
    const syn = makeSynthesizer(ANTHROPIC)!;
    const p = syn.synthesize({ question: 'hi', sources: [], mode: 'ask' });
    await tick();
    const req = lastReq();
    expect(req.opts.redirect).toBe('error');
    expect(req.opts.hostname).toBe('api.anthropic.com');
    expect(req.headers['x-api-key']).toBe('sk-ant-SECRET-KEY');
    const res = new FakeResponse(200, {});
    req.emit('response', res);
    res.emit('data', Buffer.from(JSON.stringify({ content: [{ type: 'text', text: 'ok' }] })));
    res.emit('end');
    await expect(p).resolves.toBe('ok');
  });

  it('openai Ask: redirect:error + pinned to api.openai.com, carries the Bearer', async () => {
    const { makeSynthesizer } = await import('../src/main/llm-synthesizer.js');
    const syn = makeSynthesizer(OPENAI)!;
    const p = syn.synthesize({ question: 'hi', sources: [], mode: 'ask' });
    await tick();
    const req = lastReq();
    expect(req.opts.redirect).toBe('error');
    expect(req.opts.hostname).toBe('api.openai.com');
    expect(req.headers['authorization']).toBe('Bearer sk-SECRET-OPENAI');
    // settle so the promise doesn't dangle
    const res = new FakeResponse(200, {});
    req.emit('response', res);
    res.emit('data', Buffer.from(JSON.stringify({ choices: [{ message: { content: 'ok' } }] })));
    res.emit('end');
    await expect(p).resolves.toBe('ok');
  });

  it('a 3xx on the key-bearing POST (redirect:error → error event) rejects with NO replay to a 2nd host', async () => {
    const { makeSynthesizer } = await import('../src/main/llm-synthesizer.js');
    const syn = makeSynthesizer(ANTHROPIC)!;
    const p = syn.synthesize({ question: 'hi', sources: [], mode: 'ask' });
    await tick();
    const req = lastReq();
    // Under redirect:'error' Electron emits 'error' on a 3xx instead of following it.
    req.emit('error', new Error('net::ERR_UNEXPECTED_REDIRECT'));
    await expect(p).rejects.toThrow();
    // The key only ever touched api.anthropic.com — no follow-up request to any redirect host.
    expect(reqs.length).toBe(1);
    expect(reqs[0].opts.hostname).toBe('api.anthropic.com');
    expect(reqs[0].headers['x-api-key']).toBe('sk-ant-SECRET-KEY');
  });
});
