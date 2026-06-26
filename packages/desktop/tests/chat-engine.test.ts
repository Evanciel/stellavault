// chat-engine SSE streaming + pure-parser tests (SP1 T2, Plan §8/§9).
// Reuses the FakeRequest/FakeResponse + vi.mock('electron') net pattern from
// outbound-fetch.test.ts. vi.mock('electron') is hoisted BEFORE the dynamic import.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';

// ── electron net.request mock ─────────────────────────────────────────────
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
  constructor(opts: any) {
    super();
    this.opts = opts;
  }
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

vi.mock('electron', () => ({
  net: { request: mockRequest },
}));

function lastReq(): FakeRequest { return reqs[reqs.length - 1]; }
const tick = () => new Promise((r) => setTimeout(r, 0));

const ANTHROPIC_CFG = { provider: 'anthropic' as const, apiKey: 'sk-ant-secret-KEY-12345', model: '', baseURL: '' };
const OPENAI_CFG = { provider: 'openai' as const, apiKey: 'sk-secret-OPENAI', model: 'gpt-4o-mini', baseURL: '' };
const GEMINI_CFG = { provider: 'google' as const, apiKey: 'AIza-SECRET-GEMINI-KEY', model: '', baseURL: '' };

function userMsg(text: string) {
  return [{ id: 'u1', role: 'user' as const, text, ts: 1 }];
}

beforeEach(() => {
  reqs.length = 0;
  vi.clearAllMocks();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// ── Pure parsers (no net) ──────────────────────────────────────────────────
describe('pure SSE parsers', () => {
  it('parseAnthropicSse: text_delta accumulation', async () => {
    const { parseAnthropicSse } = await import('../src/main/chat-engine.js');
    const r = parseAnthropicSse(
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello"}}',
    );
    expect(r.deltas).toEqual(['Hello']);
    expect(r.done).toBe(false);
  });

  it('parseAnthropicSse: ping yields no delta, not done', async () => {
    const { parseAnthropicSse } = await import('../src/main/chat-engine.js');
    const r = parseAnthropicSse('event: ping\ndata: {"type":"ping"}');
    expect(r.deltas).toEqual([]);
    expect(r.done).toBe(false);
    expect(r.refusal).toBeFalsy();
  });

  it('parseAnthropicSse: message_stop → done', async () => {
    const { parseAnthropicSse } = await import('../src/main/chat-engine.js');
    const r = parseAnthropicSse('event: message_stop\ndata: {"type":"message_stop"}');
    expect(r.done).toBe(true);
  });

  it('parseAnthropicSse: message_delta stop_reason refusal → refusal flag', async () => {
    const { parseAnthropicSse } = await import('../src/main/chat-engine.js');
    const r = parseAnthropicSse(
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"refusal"}}',
    );
    expect(r.refusal).toBe(true);
  });

  it('parseAnthropicSse: error event throws categorized', async () => {
    const { parseAnthropicSse } = await import('../src/main/chat-engine.js');
    expect(() =>
      parseAnthropicSse('event: error\ndata: {"type":"error","error":{"type":"overloaded_error","message":"busy"}}'),
    ).toThrow();
  });

  it('parseOpenAiSse: [DONE] + null delta skipped', async () => {
    const { parseOpenAiSse } = await import('../src/main/chat-engine.js');
    const frame =
      'data: {"choices":[{"delta":{"content":"Hi"}}]}\n' +
      'data: {"choices":[{"delta":{"content":null}}]}\n' +
      'data: {"choices":[{"delta":{}}]}\n' +
      'data: [DONE]';
    const r = parseOpenAiSse(frame);
    expect(r.deltas).toEqual(['Hi']);
    expect(r.done).toBe(true);
  });

  it('parseGeminiSse: candidates parts text', async () => {
    const { parseGeminiSse } = await import('../src/main/chat-engine.js');
    const r = parseGeminiSse('data: {"candidates":[{"content":{"parts":[{"text":"Gem"}]}}]}');
    expect(r.deltas).toEqual(['Gem']);
  });

  it('malformed JSON frame skipped (no throw)', async () => {
    const { parseOpenAiSse, parseAnthropicSse, parseGeminiSse } = await import('../src/main/chat-engine.js');
    expect(() => parseOpenAiSse('data: {not json')).not.toThrow();
    expect(parseOpenAiSse('data: {not json').deltas).toEqual([]);
    expect(() => parseAnthropicSse('event: x\ndata: {bad')).not.toThrow();
    expect(() => parseGeminiSse('data: {bad')).not.toThrow();
  });

  // ─── Track B: parseResponsesSse (OpenAI Responses API) ───
  it('parseResponsesSse: output_text.delta accumulation', async () => {
    const { parseResponsesSse } = await import('../src/main/chat-engine.js');
    const r = parseResponsesSse(
      'data: {"type":"response.output_text.delta","delta":"Hel"}\n' +
      'data: {"type":"response.output_text.delta","delta":"lo"}',
    );
    expect(r.deltas).toEqual(['Hel', 'lo']);
    expect(r.done).toBe(false);
  });

  it('parseResponsesSse: response.completed → done; response.created → ignored', async () => {
    const { parseResponsesSse } = await import('../src/main/chat-engine.js');
    expect(parseResponsesSse('data: {"type":"response.created"}').done).toBe(false);
    expect(parseResponsesSse('data: {"type":"response.completed","response":{}}').done).toBe(true);
  });

  it('parseResponsesSse: refusal.delta / refusal.done → refusal', async () => {
    const { parseResponsesSse } = await import('../src/main/chat-engine.js');
    expect(parseResponsesSse('data: {"type":"response.refusal.delta","delta":"no"}').refusal).toBe(true);
    expect(parseResponsesSse('data: {"type":"response.refusal.done"}').refusal).toBe(true);
  });

  it('parseResponsesSse: failed/error throws categorized (401 account, 403 distinct, 429 rate)', async () => {
    const { parseResponsesSse } = await import('../src/main/chat-engine.js');
    // 401 → key-missing (account)
    try { parseResponsesSse('data: {"type":"response.failed","response":{"status":401,"error":{"message":"x"}}}'); expect.fail('should throw'); }
    catch (e: any) { expect(e.category).toBe('key-missing'); }
    // 429 → rate-limited
    try { parseResponsesSse('data: {"type":"error","error":{"code":"rate_limit","message":"slow"}}'); expect.fail('should throw'); }
    catch (e: any) { expect(e.category).toBe('rate-limited'); }
    // 403 (region/WAF) → generic, NOT key-missing (must not be mistaken for an auth-401)
    try { parseResponsesSse('data: {"type":"response.failed","response":{"status":403,"error":{"message":"blocked"}}}'); expect.fail('should throw'); }
    catch (e: any) { expect(e.category).toBe('generic'); }
  });

  it('parseResponsesSse: malformed JSON line skipped (no throw)', async () => {
    const { parseResponsesSse } = await import('../src/main/chat-engine.js');
    expect(() => parseResponsesSse('data: {not json')).not.toThrow();
    expect(parseResponsesSse('data: {not json').deltas).toEqual([]);
  });
});

// ── Track B: redactForLog regression (eyJ JWT + PKCE + token fields) ───
describe('redactForLog — Track B secret scrub', () => {
  it('scrubs a JWT (eyJ…), bare refresh_token, and PKCE / device fields', async () => {
    const { redactForLog } = await import('../src/main/chat-engine.js');
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.SflKxwRJSMeKKF2QT4';
    expect(redactForLog(`Authorization: Bearer ${jwt}`)).not.toContain(jwt);
    expect(redactForLog(`token=${jwt}`)).not.toContain('eyJzdWI');
    expect(redactForLog('{"refresh_token":"rt-SECRET-123"}')).not.toContain('rt-SECRET-123');
    expect(redactForLog('code_verifier=VERIFIER-SECRET')).not.toContain('VERIFIER-SECRET');
    expect(redactForLog('"authorization_code":"AC-SECRET"')).not.toContain('AC-SECRET');
    expect(redactForLog('device_auth_id=DAID-SECRET')).not.toContain('DAID-SECRET');
    expect(redactForLog('"user_code":"WXYZ-1234"')).not.toContain('WXYZ-1234');
  });
});

// ── Track B: assertExactHost (outbound-fetch) ───
describe('assertExactHost — exact-host pin (NOT endsWith)', () => {
  it('accepts the exact host, rejects subdomain-suffix spoofs and trailing dots', async () => {
    const { assertExactHost } = await import('../src/main/outbound-fetch.js');
    expect(() => assertExactHost('chatgpt.com', 'chatgpt.com')).not.toThrow();
    expect(() => assertExactHost('CHATGPT.COM', 'chatgpt.com')).not.toThrow(); // case-fold
    expect(() => assertExactHost('chatgpt.com.', 'chatgpt.com')).not.toThrow(); // trailing-dot strip
    expect(() => assertExactHost('chatgpt.com.evil.com', 'chatgpt.com')).toThrow(); // suffix spoof
    expect(() => assertExactHost('evilchatgpt.com', 'chatgpt.com')).toThrow();
    expect(() => assertExactHost('auth.openai.com', 'chatgpt.com')).toThrow();
  });
});

// ── buildChatBody ───────────────────────────────────────────────────────────
describe('buildChatBody', () => {
  it('anthropic: no sampling/thinking params; model from default; system top-level', async () => {
    const { buildChatBody, CHAT_MAX_TOKENS } = await import('../src/main/chat-engine.js');
    const spec = buildChatBody(ANTHROPIC_CFG, 'SYS', userMsg('hi'));
    const b: any = spec.body;
    expect(spec.url).toBe('https://api.anthropic.com/v1/messages');
    expect(spec.headers['x-api-key']).toBe(ANTHROPIC_CFG.apiKey);
    expect(b.model).toBe('claude-fable-5');
    expect(b.max_tokens).toBe(CHAT_MAX_TOKENS);
    expect(b.stream).toBe(true);
    expect(b.system).toBe('SYS');
    expect(b.temperature).toBeUndefined();
    expect(b.top_p).toBeUndefined();
    expect(b.top_k).toBeUndefined();
    expect(b.thinking).toBeUndefined();
    expect(b.budget_tokens).toBeUndefined();
    expect(b.messages).toEqual([{ role: 'user', content: 'hi' }]);
  });

  it('anthropic: filters renderer-supplied system role out of messages', async () => {
    const { buildChatBody } = await import('../src/main/chat-engine.js');
    const msgs = [
      { id: 's', role: 'system' as const, text: 'EVIL', ts: 1 },
      { id: 'u', role: 'user' as const, text: 'hi', ts: 2 },
    ];
    const b: any = buildChatBody(ANTHROPIC_CFG, 'SYS', msgs).body;
    expect(b.messages).toEqual([{ role: 'user', content: 'hi' }]);
  });

  it('openai: system message first + Bearer auth', async () => {
    const { buildChatBody } = await import('../src/main/chat-engine.js');
    const spec = buildChatBody(OPENAI_CFG, 'SYS', userMsg('hi'));
    const b: any = spec.body;
    expect(spec.url).toBe('https://api.openai.com/v1/chat/completions');
    expect(spec.headers.authorization).toBe('Bearer sk-secret-OPENAI');
    expect(b.messages[0]).toEqual({ role: 'system', content: 'SYS' });
    expect(b.stream).toBe(true);
  });

  it('openai-compat: a user turn with image attachments → multimodal content array (SP2)', async () => {
    const { buildChatBody } = await import('../src/main/chat-engine.js');
    const msg = [{
      id: 'u', role: 'user' as const, text: 'what is this?', ts: 1,
      attachments: [{ type: 'image' as const, mimeType: 'image/png', dataUrl: 'data:image/png;base64,AAAB', fileName: 'a.png', size: 3 }],
    }];
    const b: any = buildChatBody(OPENAI_CFG, 'SYS', msg).body;
    const userContent = b.messages[1].content;
    expect(Array.isArray(userContent)).toBe(true);
    expect(userContent[0]).toEqual({ type: 'text', text: 'what is this?' });
    expect(userContent[1]).toEqual({ type: 'image_url', image_url: { url: 'data:image/png;base64,AAAB' } });
  });

  it('openai-compat: a text-only turn stays a plain string (no multimodal array)', async () => {
    const { buildChatBody } = await import('../src/main/chat-engine.js');
    const b: any = buildChatBody(OPENAI_CFG, 'SYS', userMsg('hi')).body;
    expect(b.messages[1]).toEqual({ role: 'user', content: 'hi' });
  });

  it('openai-chatgpt: Responses body shape (input_text parts, instructions top-level, store:false stream:true)', async () => {
    const { buildChatBody } = await import('../src/main/chat-engine.js');
    const cfg = { provider: 'openai-chatgpt' as const, apiKey: '', model: 'gpt-5', baseURL: '', authHeaders: { Authorization: 'Bearer tok', 'ChatGPT-Account-ID': 'acct-1' } };
    const spec = buildChatBody(cfg, 'SYS', userMsg('hi'));
    const b: any = spec.body;
    expect(spec.url).toBe('https://chatgpt.com/backend-api/codex/responses');
    // Auth headers ride from cfg; the codex client-identity headers are present.
    expect(spec.headers.Authorization).toBe('Bearer tok');
    expect(spec.headers['ChatGPT-Account-ID']).toBe('acct-1');
    expect(spec.headers.originator).toBe('codex_cli_rs');
    expect(String(spec.headers['User-Agent']).startsWith('codex_cli_rs/')).toBe(true);
    expect(spec.headers['OpenAI-Beta']).toBe('responses=experimental');
    expect(spec.headers.session_id).toBeTruthy();
    // system → top-level instructions (NOT an input item); input parts are input_text.
    expect(b.instructions).toBe('SYS');
    expect(b.input).toEqual([{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi' }] }]);
    expect(b.store).toBe(false);
    expect(b.stream).toBe(true);
    expect(b.include).toEqual([]);
  });

  it('openai-chatgpt: empty system → no instructions field', async () => {
    const { buildChatBody } = await import('../src/main/chat-engine.js');
    const cfg = { provider: 'openai-chatgpt' as const, apiKey: '', model: 'gpt-5', baseURL: '', authHeaders: {} };
    const b: any = buildChatBody(cfg, '', userMsg('hi')).body;
    expect('instructions' in b).toBe(false);
  });

  it('looksLikeNoImageReply: flags gemma4 "no image" misses, accepts real descriptions (SP3)', async () => {
    const { looksLikeNoImageReply } = await import('../src/main/chat-engine.js');
    for (const miss of [
      'Please provide the image you would like me to describe.',
      'I need an image attached to generate a description.',
      'There is no image in the prompt.',
      'I cannot describe what is not there.',
      '', 'ok',
    ]) expect(looksLikeNoImageReply(miss)).toBe(true);
    for (const hit of [
      'The image displays a dark background with abstract patterns and a glowing blue robot.',
      'A red square on the left, a blue square on the right.',
    ]) expect(looksLikeNoImageReply(hit)).toBe(false);
  });

  it('streamOnceNative: an already-aborted signal settles {aborted:true} with no request (SP3)', async () => {
    const { streamOnceNative } = await import('../src/main/chat-engine.js');
    const ac = new AbortController();
    ac.abort();
    const res = await streamOnceNative('http://127.0.0.1:11434/api/chat', { model: 'x' }, ac.signal, () => {});
    expect(res).toEqual({ text: '', toolCalls: [], aborted: true, refusal: false });
  });

  it('isEmptyToolResult: error / [] / {results:[]} / {} are empty; {ok:true} / non-empty are not (plan-act-reflect)', async () => {
    const { isEmptyToolResult } = await import('../src/main/chat-engine.js');
    for (const empty of [null, undefined, [], {}, { error: 'nope' }, { results: [] }, { related: [] }, { gaps: [] }, { decisions: [] }]) {
      expect(isEmptyToolResult(empty)).toBe(true);
    }
    for (const full of [{ ok: true }, { results: [{ x: 1 }] }, { content: 'hi' }, { ok: true, filePath: 'a.md' }, 'text']) {
      expect(isEmptyToolResult(full)).toBe(false);
    }
  });

  it('foldAttachmentsIntoText: appends audio/video transcripts to user text, ignores images (SP4)', async () => {
    const { foldAttachmentsIntoText } = await import('../src/main/chat-engine.js');
    const m = {
      id: 'u', role: 'user' as const, text: 'what did they say?', ts: 1,
      attachments: [
        { type: 'audio' as const, mimeType: 'audio/mpeg', fileName: 'note.mp3', size: 1, transcript: 'hello world' },
        { type: 'image' as const, mimeType: 'image/png', dataUrl: 'data:image/png;base64,AA', fileName: 'p.png', size: 1 },
        { type: 'video' as const, mimeType: 'video/mp4', fileName: 'clip.mp4', size: 1, transcript: 'a red car drives by' },
      ],
    };
    const folded = foldAttachmentsIntoText(m);
    expect(folded).toContain('what did they say?');
    expect(folded).toContain('note.mp3');
    expect(folded).toContain('hello world');
    expect(folded).toContain('clip.mp4');
    expect(folded).toContain('a red car drives by');
    expect(folded).not.toContain('base64'); // the image is NOT folded into text
    // no audio/video → unchanged text
    expect(foldAttachmentsIntoText({ id: 'u', role: 'user', text: 'hi', ts: 1 })).toBe('hi');
  });

  it('describeImages: no images or non-local provider → "" without a network call (SP3 guard)', async () => {
    const { describeImages } = await import('../src/main/chat-engine.js');
    const ac = new AbortController();
    expect(await describeImages(OPENAI_CFG, [], ac.signal)).toBe(''); // no images
    // anthropic/google are not the local native path → '' (vision-describe is Ollama-only)
    expect(await describeImages(ANTHROPIC_CFG, ['AAAA'], ac.signal)).toBe('');
    expect(await describeImages(GEMINI_CFG, ['AAAA'], ac.signal)).toBe('');
  });

  it('attachmentsToBase64 strips the data: prefix → bare base64 (Ollama native vision)', async () => {
    const { attachmentsToBase64 } = await import('../src/main/chat-engine.js');
    const m = { id: 'u', role: 'user' as const, text: '', ts: 1,
      attachments: [{ type: 'image' as const, mimeType: 'image/png', dataUrl: 'data:image/png;base64,ZZZ9', fileName: 'a.png', size: 3 }] };
    expect(attachmentsToBase64(m)).toEqual(['ZZZ9']);
    expect(attachmentsToBase64({ id: 'u', role: 'user', text: 'hi', ts: 1 })).toBeUndefined();
  });

  it('google: ?alt=sse URL + key in x-goog-api-key header (NOT url)', async () => {
    const { buildChatBody } = await import('../src/main/chat-engine.js');
    const spec = buildChatBody(GEMINI_CFG, 'SYS', userMsg('hi'));
    expect(spec.url).toContain(':streamGenerateContent?alt=sse');
    expect(spec.url).not.toContain(GEMINI_CFG.apiKey);
    expect(spec.url).not.toContain('key=');
    expect(spec.headers['x-goog-api-key']).toBe(GEMINI_CFG.apiKey);
    const b: any = spec.body;
    expect(b.systemInstruction.parts[0].text).toBe('SYS');
    expect(b.contents[0].role).toBe('user');
  });

  it('google: multi-turn maps assistant→model and preserves user/model/user order', async () => {
    const { buildChatBody } = await import('../src/main/chat-engine.js');
    const msgs = [
      { id: '1', role: 'user' as const, text: 'q1', ts: 1 },
      { id: '2', role: 'assistant' as const, text: 'a1', ts: 2 },
      { id: '3', role: 'user' as const, text: 'q2', ts: 3 },
    ];
    const b: any = buildChatBody(GEMINI_CFG, 'SYS', msgs).body;
    expect(b.contents.map((c: any) => c.role)).toEqual(['user', 'model', 'user']);
    expect(b.contents.map((c: any) => c.parts[0].text)).toEqual(['q1', 'a1', 'q2']);
  });

  it('openai: multi-turn keeps [system, user, assistant, user] order', async () => {
    const { buildChatBody } = await import('../src/main/chat-engine.js');
    const msgs = [
      { id: '1', role: 'user' as const, text: 'q1', ts: 1 },
      { id: '2', role: 'assistant' as const, text: 'a1', ts: 2 },
      { id: '3', role: 'user' as const, text: 'q2', ts: 3 },
    ];
    const b: any = buildChatBody(OPENAI_CFG, 'SYS', msgs).body;
    expect(b.messages).toEqual([
      { role: 'system', content: 'SYS' },
      { role: 'user', content: 'q1' },
      { role: 'assistant', content: 'a1' },
      { role: 'user', content: 'q2' },
    ]);
  });

  // reasoning_effort:'none' — disables a local reasoning model's default chain-of-thought
  // (gemma3/4, qwen3) so the OpenAI-compat endpoint returns the answer, not an empty
  // thinking-only stream. Scoped to LOCAL servers (remote hosts may 400 on it).
  it('openai-compatible (local Ollama): adds reasoning_effort:none', async () => {
    const { buildChatBody } = await import('../src/main/chat-engine.js');
    const cfg = { provider: 'openai-compatible' as const, apiKey: '', model: 'gemma4:e4b', baseURL: 'http://localhost:11434/v1' };
    const b: any = buildChatBody(cfg, 'SYS', userMsg('hi')).body;
    expect(b.reasoning_effort).toBe('none');
  });

  it('openai-compatible (blank baseURL → loopback default): adds reasoning_effort:none', async () => {
    const { buildChatBody } = await import('../src/main/chat-engine.js');
    const cfg = { provider: 'openai-compatible' as const, apiKey: '', model: 'm', baseURL: '' };
    const b: any = buildChatBody(cfg, 'SYS', userMsg('hi')).body;
    expect(b.reasoning_effort).toBe('none');
  });

  it('openai-compatible (remote Groq host): does NOT add reasoning_effort', async () => {
    const { buildChatBody } = await import('../src/main/chat-engine.js');
    const cfg = { provider: 'openai-compatible' as const, apiKey: 'gsk_x', model: 'llama', baseURL: 'https://api.groq.com/openai/v1' };
    const b: any = buildChatBody(cfg, 'SYS', userMsg('hi')).body;
    expect(b.reasoning_effort).toBeUndefined();
  });

  it('real OpenAI: never adds reasoning_effort', async () => {
    const { buildChatBody } = await import('../src/main/chat-engine.js');
    const b: any = buildChatBody(OPENAI_CFG, 'SYS', userMsg('hi')).body;
    expect(b.reasoning_effort).toBeUndefined();
  });
});

// ── Native Ollama /api/chat (agent SP-A) ─────────────────────────────────────
describe('buildOllamaChatBody', () => {
  it('prepends system as a role:system message and passes tools + think flag', async () => {
    const { buildOllamaChatBody } = await import('../src/main/chat-engine.js');
    const cfg = { provider: 'openai-compatible' as const, apiKey: '', model: 'gemma4:e4b', baseURL: 'http://localhost:11434/v1' };
    const tools = [{ type: 'function', function: { name: 'search_vault', parameters: {} } }];
    const b: any = buildOllamaChatBody(cfg, 'SYS', [{ role: 'user', content: 'hi' }], tools, false);
    expect(b.model).toBe('gemma4:e4b');
    expect(b.stream).toBe(true);
    expect(b.think).toBe(false);
    expect(b.messages[0]).toEqual({ role: 'system', content: 'SYS' });
    expect(b.messages[1]).toEqual({ role: 'user', content: 'hi' });
    expect(b.tools).toBe(tools);
  });
  it('carries assistant tool_calls + role:tool result turns through verbatim', async () => {
    const { buildOllamaChatBody } = await import('../src/main/chat-engine.js');
    const cfg = { provider: 'openai-compatible' as const, apiKey: '', model: 'm', baseURL: '' };
    const turns = [
      { role: 'user' as const, content: 'q' },
      { role: 'assistant' as const, content: '', tool_calls: [{ function: { name: 'search_vault', arguments: { query: 'x' } } }] },
      { role: 'tool' as const, content: '{"hits":1}', tool_name: 'search_vault' },
    ];
    const b: any = buildOllamaChatBody(cfg, 'SYS', turns, [], true);
    expect(b.think).toBe(true);
    expect(b.messages[2].tool_calls[0].function.name).toBe('search_vault');
    expect(b.messages[3]).toEqual({ role: 'tool', content: '{"hits":1}', tool_name: 'search_vault' });
  });
});

describe('parseOllamaChatChunk — native NDJSON', () => {
  it('extracts a text content delta', async () => {
    const { parseOllamaChatChunk } = await import('../src/main/chat-engine.js');
    const r = parseOllamaChatChunk(JSON.stringify({ message: { role: 'assistant', content: '안녕' }, done: false }));
    expect(r.deltas).toEqual(['안녕']);
    expect(r.toolCalls).toEqual([]);
    expect(r.done).toBe(false);
  });
  it('collects WHOLE tool_calls (pre-parsed object arguments, no fragmentation)', async () => {
    const { parseOllamaChatChunk } = await import('../src/main/chat-engine.js');
    const r = parseOllamaChatChunk(JSON.stringify({
      message: { role: 'assistant', content: '', tool_calls: [{ function: { name: 'search_vault', arguments: { query: 'MCP' } } }] },
      done: false,
    }));
    expect(r.toolCalls).toHaveLength(1);
    expect(r.toolCalls[0].function.name).toBe('search_vault');
    expect(r.toolCalls[0].function.arguments).toEqual({ query: 'MCP' });
  });
  it('flags done:true terminal frame', async () => {
    const { parseOllamaChatChunk } = await import('../src/main/chat-engine.js');
    expect(parseOllamaChatChunk(JSON.stringify({ message: { content: '' }, done: true })).done).toBe(true);
  });
  it('coerces a dict/list content to a string, drops thinking, guards bad args', async () => {
    const { parseOllamaChatChunk } = await import('../src/main/chat-engine.js');
    const r = parseOllamaChatChunk(JSON.stringify({ message: { content: { a: 1 }, thinking: 'ignored', tool_calls: [{ function: { name: 'x', arguments: 'not-an-object' } }] }, done: false }));
    expect(r.deltas[0]).toContain('"a":1');
    expect(r.toolCalls[0].function.arguments).toEqual({}); // non-object args → {}
  });
  it('returns empty on blank/garbled lines (never throws — caller buffers whole lines)', async () => {
    const { parseOllamaChatChunk } = await import('../src/main/chat-engine.js');
    expect(parseOllamaChatChunk('').deltas).toEqual([]);
    expect(parseOllamaChatChunk('{"message":{"content":"par').deltas).toEqual([]); // truncated JSON
  });
  it('throws ChatStreamError on an error frame', async () => {
    const { parseOllamaChatChunk } = await import('../src/main/chat-engine.js');
    expect(() => parseOllamaChatChunk(JSON.stringify({ error: 'model not found' }))).toThrow();
  });
});

// ── runAgentLoop (agent SP-B) — loop logic via an injected streamStep ─────────
type Step = { text: string; toolCalls: any[]; aborted: boolean; refusal: boolean };
const tc = (name: string, args: any = {}) => ({ function: { name, arguments: args } });
const step = (over: Partial<Step> = {}): Step => ({ text: '', toolCalls: [], aborted: false, refusal: false, ...over });

async function runLoop(steps: Step[], opts: any = {}) {
  const { runAgentLoop } = await import('../src/main/chat-engine.js');
  const calls: any = { execute: [], toolCall: [], toolResult: [], confirm: [], succeed: [], fail: [], deltas: [], stepMsgs: [], stepFull: [], plan: [], skill: [] };
  let i = 0;
  const ctx = {
    turns: opts.turns ?? [{ id: 'u', role: 'user', text: 'q', ts: 1 }],
    toolset: {
      schemas: [],
      validNames: new Set<string>(opts.valid ?? ['search_vault', 'log_decision']),
      isWrite: opts.isWrite ?? ((n: string) => n === 'log_decision'),
      forceConfirm: opts.forceConfirm, // P2: core_memory_* always confirm / fail-closed
      loadSkill: opts.loadSkill,       // P3: invoke_skill body resolver
      extractCitations: opts.extractCitations,
    },
    executeTool: async (name: string, args: any) => {
      calls.execute.push({ name, args });
      opts.executeHook?.(calls.execute.length); // e.g. abort the signal mid-batch
      if (opts.toolThrows) throw new Error('boom');
      return opts.toolResult ?? { ok: true };
    },
    streamStep: async (msgs: any[]) => { calls.stepMsgs.push(msgs.length); calls.stepFull.push(msgs.map((m: any) => ({ role: m.role, content: m.content }))); return steps[i++] ?? step(); },
    signal: opts.signal ?? new AbortController().signal,
    onDelta: (d: string) => calls.deltas.push(d),
    onToolCall: (n: string) => calls.toolCall.push(n),
    onToolResult: (n: string, ok: boolean) => calls.toolResult.push({ n, ok }),
    onPlan: (steps: string[], done: number) => calls.plan.push({ steps, done }),
    onSkill: (n: string) => calls.skill.push(n), // P3
    onToolConfirm: opts.onToolConfirm, // undefined → auto-apply (writes don't pause)
    drainSteer: opts.drainSteer,       // P1-3: steer notes injected at the loop top
    succeed: (c: any, t: string) => calls.succeed.push({ c, t }),
    fail: (m: string, cat: string) => calls.fail.push({ m, cat }),
    preloopCitations: opts.preloop ?? [],
  };
  await runAgentLoop(ctx as any);
  return calls;
}

describe('runAgentLoop — agent loop invariants', () => {
  it('terminal: a no-tool-calls turn succeeds ONCE with the streamed text', async () => {
    const c = await runLoop([step({ text: 'final answer' })]);
    expect(c.succeed).toHaveLength(1);
    expect(c.fail).toHaveLength(0);
    expect(c.succeed[0].t).toBe('final answer');
    expect(c.execute).toHaveLength(0);
  });

  it('tool call → execute → next turn answers (one succeed, tool ran once)', async () => {
    const c = await runLoop([
      step({ text: '', toolCalls: [tc('search_vault', { query: 'x' })] }),
      step({ text: 'grounded answer' }),
    ]);
    expect(c.execute).toEqual([{ name: 'search_vault', args: { query: 'x' } }]);
    expect(c.toolCall).toEqual(['search_vault']);
    expect(c.toolResult[0].ok).toBe(true);
    expect(c.succeed).toHaveLength(1);
    expect(c.succeed[0].t).toBe('grounded answer');
  });

  it('MAX_STEPS guard: a model that always emits a tool_call stops at 12 (succeed once)', async () => {
    const always = Array.from({ length: 16 }, () => step({ toolCalls: [tc('search_vault')] }));
    const c = await runLoop(always, { toolResult: { ok: true, results: [{ x: 1 }] } });
    expect(c.execute).toHaveLength(12); // AGENT_MAX_STEPS
    expect(c.succeed).toHaveLength(1);
    expect(c.fail).toHaveLength(0);
    expect(c.deltas.join('')).toContain('최대 단계'); // the cap note
  });

  it('plan-act-reflect: repeated EMPTY read results force-conclude (succeed once, fail zero, no MAX_STEPS)', async () => {
    // Every step emits a read tool_call; every result is empty → DEAD_END_LIMIT(2) tripped after 3.
    const always = Array.from({ length: 16 }, () => step({ toolCalls: [tc('search_vault', { query: 'x' })] }));
    const c = await runLoop(always, { toolResult: { results: [] } });
    expect(c.execute.length).toBeLessThanOrEqual(4); // dead-ended well before MAX_STEPS(12)
    expect(c.execute.length).toBeGreaterThanOrEqual(3);
    expect(c.succeed).toHaveLength(1);
    expect(c.fail).toHaveLength(0);
  });

  it('set_plan: declares the plan (onPlan fired), acks as a tool turn, never settles', async () => {
    const c = await runLoop([
      step({ toolCalls: [tc('set_plan', { steps: ['a', 'b', 'c'], done: 0 })] }),
      step({ text: 'done answer' }),
    ]);
    expect(c.plan).toEqual([{ steps: ['a', 'b', 'c'], done: 0 }]);
    expect(c.execute).toHaveLength(0); // set_plan is a control tool — never dispatched
    expect(c.succeed).toHaveLength(1);
    expect(c.fail).toHaveLength(0);
  });

  it('set_plan: latch — a re-call updates `done` but cannot rewrite the steps', async () => {
    const c = await runLoop([
      step({ toolCalls: [tc('set_plan', { steps: ['x', 'y', 'z'], done: 0 })] }),
      step({ toolCalls: [tc('set_plan', { steps: ['HACKED'], done: 2 })] }),
      step({ text: 'ok' }),
    ]);
    expect(c.plan[0]).toEqual({ steps: ['x', 'y', 'z'], done: 0 });
    expect(c.plan[1]).toEqual({ steps: ['x', 'y', 'z'], done: 2 }); // steps frozen, done bumped
    expect(c.succeed).toHaveLength(1);
  });

  it('set_plan: a batch with set_plan + a real tool answers both (alternation preserved)', async () => {
    const c = await runLoop([
      step({ toolCalls: [tc('set_plan', { steps: ['s1', 's2'], done: 0 }), tc('search_vault', { query: 'q' })] }),
      step({ text: 'answer' }),
    ]);
    expect(c.plan).toHaveLength(1);
    expect(c.execute).toEqual([{ name: 'search_vault', args: { query: 'q' } }]); // the real tool ran
    expect(c.succeed).toHaveLength(1);
    expect(c.fail).toHaveLength(0);
  });

  it('plan-act-reflect: a non-empty result resets the dead-end counter (no premature stop)', async () => {
    const c = await runLoop(
      [step({ toolCalls: [tc('search_vault')] }), step({ toolCalls: [tc('search_vault')] }), step({ text: 'answer' })],
      { toolResult: { results: [{ x: 1 }] } },
    );
    expect(c.execute).toHaveLength(2);
    expect(c.succeed[0].t).toBe('answer');
    expect(c.fail).toHaveLength(0);
  });

  it('unknown tool: synthetic error, and >3 invalid → succeed (no execute)', async () => {
    const c = await runLoop(
      Array.from({ length: 6 }, () => step({ toolCalls: [tc('hallucinated_tool')] })),
      { valid: ['search_vault'] },
    );
    expect(c.execute).toHaveLength(0);
    expect(c.succeed).toHaveLength(1); // bailed after MAX_INVALID
  });

  it('write tool AUTO-APPLIES when no confirm callback is wired (default frictionless mode)', async () => {
    const c = await runLoop(
      [step({ toolCalls: [tc('log_decision', { title: 't' })] }), step({ text: 'wrote it' })],
      // no onToolConfirm → auto-apply
    );
    expect(c.execute).toEqual([{ name: 'log_decision', args: { title: 't' } }]);
    expect(c.succeed[0].t).toBe('wrote it');
  });

  it('write tool APPROVED → executes; DENIED → not executed (opt-in confirm mode)', async () => {
    const approved = await runLoop(
      [step({ toolCalls: [tc('log_decision', { title: 't' })] }), step({ text: 'done' })],
      { onToolConfirm: async () => true },
    );
    expect(approved.execute).toHaveLength(1);

    const denied = await runLoop(
      [step({ toolCalls: [tc('log_decision', { title: 't' })] }), step({ text: 'ok, skipped' })],
      { onToolConfirm: async () => false },
    );
    expect(denied.execute).toHaveLength(0);
    expect(denied.succeed[0].t).toBe('ok, skipped');
  });

  it('aborted streamStep → fail("aborted") exactly once, no succeed', async () => {
    const c = await runLoop([step({ aborted: true })]);
    expect(c.fail).toHaveLength(1);
    expect(c.fail[0].cat).toBe('aborted');
    expect(c.succeed).toHaveLength(0);
  });

  it('pre-aborted signal → fail before any model call', async () => {
    const ac = new AbortController();
    ac.abort();
    const c = await runLoop([step({ text: 'should not run' })], { signal: ac.signal });
    expect(c.stepMsgs).toHaveLength(0); // streamStep never called
    expect(c.fail[0].cat).toBe('aborted');
  });

  it('refusal → fail("refused")', async () => {
    const c = await runLoop([step({ refusal: true })]);
    expect(c.fail).toHaveLength(1);
    expect(c.fail[0].cat).toBe('refused');
  });

  it('tool that throws → error result fed back (loop survives), still succeeds', async () => {
    const c = await runLoop(
      [step({ toolCalls: [tc('search_vault')] }), step({ text: 'recovered' })],
      { toolThrows: true },
    );
    expect(c.toolResult[0].ok).toBe(false);
    expect(c.succeed).toHaveLength(1);
    expect(c.succeed[0].t).toBe('recovered');
  });

  it('abort DURING a tool execution stops the rest of the batch (review #1)', async () => {
    const ac = new AbortController();
    const c = await runLoop(
      [step({ toolCalls: [tc('search_vault', { q: 1 }), tc('search_vault', { q: 2 }), tc('search_vault', { q: 3 })] })],
      { signal: ac.signal, executeHook: (n: number) => { if (n === 1) ac.abort(); } },
    );
    expect(c.execute).toHaveLength(1);   // only the first tool ran before the abort re-check
    expect(c.fail).toHaveLength(1);
    expect(c.fail[0].cat).toBe('aborted');
    expect(c.succeed).toHaveLength(0);
  });

  it('citations: preloop seed + extractCitations merge, de-duped', async () => {
    const c = await runLoop(
      [step({ toolCalls: [tc('search_vault')] }), step({ text: 'a' })],
      {
        preloop: [{ title: 'A', filePath: 'a.md' }],
        extractCitations: () => [{ title: 'A', filePath: 'a.md' }, { title: 'B', filePath: 'b.md' }],
      },
    );
    expect(c.succeed[0].c).toHaveLength(2); // A (deduped) + B
  });
});

describe('streamOnceNative — native NDJSON stream (agent SP-B)', () => {
  function start(onDelta: (d: string) => void = () => {}) {
    const ac = new AbortController();
    return { ac, run: async () => {
      const { streamOnceNative } = await import('../src/main/chat-engine.js');
      const p = streamOnceNative('http://127.0.0.1:11434/api/chat', {}, ac.signal, onDelta);
      await tick();
      const req = lastReq();
      const res = new FakeResponse(200, {});
      req.emit('response', res);
      return { p, req, res };
    } };
  }

  it('resolves with deltas + tool_calls on done:true', async () => {
    const deltas: string[] = [];
    const { run } = start((d) => deltas.push(d));
    const { p, res } = await run();
    res.emit('data', Buffer.from('{"message":{"content":"안"},"done":false}\n{"message":{"content":"녕"},"done":false}\n'));
    res.emit('data', Buffer.from('{"message":{"content":"","tool_calls":[{"function":{"name":"search_vault","arguments":{"query":"x"}}}]},"done":true}\n'));
    const r = await p;
    expect(deltas.join('')).toBe('안녕');
    expect(r.toolCalls).toHaveLength(1);
    expect(r.toolCalls[0].function.name).toBe('search_vault');
    expect(r.aborted).toBe(false);
  });

  it('surfaces a newline-LESS trailing error frame as a rejection (review #2)', async () => {
    const { run } = start();
    const { p, req, res } = await run();
    res.emit('data', Buffer.from('{"error":"model gemma4 not found"}')); // no trailing newline
    res.emit('end');
    await expect(p).rejects.toThrow(/not found/);
    expect(req.aborted).toBe(true);
  });

  it('resolves {aborted:true} when the signal aborts mid-stream', async () => {
    const { ac, run } = start();
    const { p, req } = await run();
    ac.abort();
    const r = await p;
    expect(r.aborted).toBe(true);
    expect(req.aborted).toBe(true);
  });

  it('buffers a JSON object split across two data chunks', async () => {
    const deltas: string[] = [];
    const { run } = start((d) => deltas.push(d));
    const { p, res } = await run();
    res.emit('data', Buffer.from('{"message":{"content":"hel')); // split mid-object
    res.emit('data', Buffer.from('lo"},"done":false}\n{"message":{"content":""},"done":true}\n'));
    const r = await p;
    expect(deltas.join('')).toBe('hello');
    expect(r.aborted).toBe(false);
  });
});

// ── capToBudget ─────────────────────────────────────────────────────────────
describe('capToBudget', () => {
  it('drops lowest-score tail entries beyond budget', async () => {
    const { capToBudget } = await import('../src/main/chat-engine.js');
    const big = ['A'.repeat(5000), 'B'.repeat(5000), 'C'.repeat(5000)].join('\n\n');
    const out = capToBudget(big, 2000); // ~8000 char budget
    expect(out.length).toBeLessThanOrEqual(8000);
    expect(out.startsWith('A')).toBe(true);
    expect(out).not.toContain('C'.repeat(100));
  });
});

// ── chatStream over the net mock ────────────────────────────────────────────
describe('chatStream', () => {
  function drive(spec: { provider: any; cfg: any }) {
    const deltas: string[] = [];
    let doneText: string | null = null;
    let err: { msg: string; cat?: string } | null = null;
    const controller = new AbortController();
    return { deltas, controller,
      get doneText() { return doneText; },
      get err() { return err; },
      start: async (chatStream: any) => {
        const p = chatStream({
          cfg: spec.cfg, messages: userMsg('hi'), ragOn: false, signal: controller.signal,
          onDelta: (d: string) => deltas.push(d),
          onDone: (_c: any, full: string) => { doneText = full; },
          onError: (m: string, c?: string) => { err = { msg: m, cat: c }; },
        });
        await tick();
        return p;
      },
      finish: (full: string) => { doneText = full; },
      setErr: (e: any) => { err = e; },
    };
  }

  it('Track B: the openai-chatgpt streaming net.request is redirect:"error" + host-pinned (no Bearer to a redirect host)', async () => {
    const { chatStream } = await import('../src/main/chat-engine.js');
    const cfg = { provider: 'openai-chatgpt' as const, apiKey: '', model: 'gpt-5', baseURL: '', authHeaders: { Authorization: 'Bearer SECRET-TOK', 'ChatGPT-Account-ID': 'acct-1' } };
    let errored = false;
    const controller = new AbortController();
    const p = chatStream({
      cfg, messages: userMsg('hi'), ragOn: false, signal: controller.signal,
      onDelta: () => {}, onDone: () => {}, onError: () => { errored = true; },
    });
    await tick();
    const req = lastReq();
    // The token-bearing request hard-fails any redirect (no benign redirect on a Bearer request).
    expect(req.opts.redirect).toBe('error');
    // It targets chatgpt.com (the synchronous exact-host pin passed).
    expect(req.opts.hostname).toBe('chatgpt.com');
    // Simulate electron emitting 'error' for a refused redirect on a token-bearing request: only ONE
    // request was ever issued — the Bearer is never re-sent to a redirect host.
    req.emit('error', new Error('ERR_UNEXPECTED_REDIRECT'));
    await p;
    expect(errored).toBe(true);
    expect(reqs.length).toBe(1); // no second request carrying the Bearer
  });

  it('anthropic: accumulates text_delta then message_stop → done', async () => {
    const { chatStream } = await import('../src/main/chat-engine.js');
    const deltas: string[] = [];
    let full: string | null = null;
    const controller = new AbortController();
    const p = chatStream({
      cfg: ANTHROPIC_CFG, messages: userMsg('hi'), ragOn: false, signal: controller.signal,
      onDelta: (d: string) => deltas.push(d),
      onDone: (_c: any, f: string) => { full = f; },
      onError: () => {},
    });
    await tick();
    const req = lastReq();
    const res = new FakeResponse(200, { 'content-type': 'text/event-stream' });
    req.emit('response', res);
    res.emit('data', Buffer.from('event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hel"}}\n\n'));
    res.emit('data', Buffer.from('event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"lo"}}\n\n'));
    res.emit('data', Buffer.from('event: message_stop\ndata: {"type":"message_stop"}\n\n'));
    await p;
    expect(deltas).toEqual(['Hel', 'lo']);
    expect(full).toBe('Hello');
  });

  it('anthropic: ping resets idle, emits no delta', async () => {
    const { chatStream } = await import('../src/main/chat-engine.js');
    const deltas: string[] = [];
    let full: string | null = null;
    const controller = new AbortController();
    const p = chatStream({
      cfg: ANTHROPIC_CFG, messages: userMsg('hi'), ragOn: false, signal: controller.signal,
      onDelta: (d: string) => deltas.push(d),
      onDone: (_c: any, f: string) => { full = f; },
      onError: () => {},
    });
    await tick();
    const req = lastReq();
    const res = new FakeResponse(200, {});
    req.emit('response', res);
    res.emit('data', Buffer.from('event: ping\ndata: {"type":"ping"}\n\n'));
    expect(deltas).toEqual([]);
    res.emit('data', Buffer.from('event: message_stop\ndata: {"type":"message_stop"}\n\n'));
    await p;
    expect(full).toBe('');
  });

  it('anthropic: refusal message_delta → onError category refused', async () => {
    const { chatStream } = await import('../src/main/chat-engine.js');
    let err: any = null;
    const controller = new AbortController();
    const p = chatStream({
      cfg: ANTHROPIC_CFG, messages: userMsg('hi'), ragOn: false, signal: controller.signal,
      onDelta: () => {}, onDone: () => {},
      onError: (m: string, c?: string) => { err = { m, c }; },
    });
    await tick();
    const req = lastReq();
    const res = new FakeResponse(200, {});
    req.emit('response', res);
    res.emit('data', Buffer.from('event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"refusal"}}\n\n'));
    await p;
    expect(err.c).toBe('refused');
    expect(req.aborted).toBe(true);
  });

  it('openai: [DONE] terminates; null delta skipped', async () => {
    const { chatStream } = await import('../src/main/chat-engine.js');
    const deltas: string[] = [];
    let full: string | null = null;
    const controller = new AbortController();
    const p = chatStream({
      cfg: OPENAI_CFG, messages: userMsg('hi'), ragOn: false, signal: controller.signal,
      onDelta: (d: string) => deltas.push(d),
      onDone: (_c: any, f: string) => { full = f; },
      onError: () => {},
    });
    await tick();
    const req = lastReq();
    const res = new FakeResponse(200, {});
    req.emit('response', res);
    res.emit('data', Buffer.from('data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n'));
    res.emit('data', Buffer.from('data: {"choices":[{"delta":{"content":null}}]}\n\n'));
    res.emit('data', Buffer.from('data: [DONE]\n\n'));
    await p;
    expect(deltas).toEqual(['Hi']);
    expect(full).toBe('Hi');
  });

  it('gemini: ?alt=sse url; parts text; ends on socket end', async () => {
    const { chatStream } = await import('../src/main/chat-engine.js');
    const deltas: string[] = [];
    let full: string | null = null;
    const controller = new AbortController();
    const p = chatStream({
      cfg: GEMINI_CFG, messages: userMsg('hi'), ragOn: false, signal: controller.signal,
      onDelta: (d: string) => deltas.push(d),
      onDone: (_c: any, f: string) => { full = f; },
      onError: () => {},
    });
    await tick();
    const req = lastReq();
    expect(req.opts.path).toContain('alt=sse');
    const res = new FakeResponse(200, {});
    req.emit('response', res);
    res.emit('data', Buffer.from('data: {"candidates":[{"content":{"parts":[{"text":"Ge"}]}}]}\n\n'));
    res.emit('data', Buffer.from('data: {"candidates":[{"content":{"parts":[{"text":"m"}]}}]}\n\n'));
    res.emit('end');
    await p;
    expect(deltas).toEqual(['Ge', 'm']);
    expect(full).toBe('Gem');
  });

  it('partial chunk split across two data events buffered to \\n\\n', async () => {
    const { chatStream } = await import('../src/main/chat-engine.js');
    const deltas: string[] = [];
    const controller = new AbortController();
    const p = chatStream({
      cfg: OPENAI_CFG, messages: userMsg('hi'), ragOn: false, signal: controller.signal,
      onDelta: (d: string) => deltas.push(d),
      onDone: () => {}, onError: () => {},
    });
    await tick();
    const req = lastReq();
    const res = new FakeResponse(200, {});
    req.emit('response', res);
    // a complete frame split mid-JSON across two emits — must NOT parse until \n\n arrives.
    res.emit('data', Buffer.from('data: {"choices":[{"delta":{"con'));
    expect(deltas).toEqual([]);
    res.emit('data', Buffer.from('tent":"Yo"}}]}\n\n'));
    expect(deltas).toEqual(['Yo']);
    res.emit('data', Buffer.from('data: [DONE]\n\n'));
    await p;
  });

  it('malformed JSON frame skipped (no throw out of loop)', async () => {
    const { chatStream } = await import('../src/main/chat-engine.js');
    const deltas: string[] = [];
    let err: any = null;
    let full: string | null = null;
    const controller = new AbortController();
    const p = chatStream({
      cfg: OPENAI_CFG, messages: userMsg('hi'), ragOn: false, signal: controller.signal,
      onDelta: (d: string) => deltas.push(d),
      onDone: (_c: any, f: string) => { full = f; },
      onError: (m: string, c?: string) => { err = { m, c }; },
    });
    await tick();
    const req = lastReq();
    const res = new FakeResponse(200, {});
    req.emit('response', res);
    res.emit('data', Buffer.from('data: {bad json here\n\n'));
    res.emit('data', Buffer.from('data: {"choices":[{"delta":{"content":"ok"}}]}\n\n'));
    res.emit('data', Buffer.from('data: [DONE]\n\n'));
    await p;
    expect(err).toBeNull();
    expect(deltas).toEqual(['ok']);
  });

  it('abort via signal aborts the request and reports aborted', async () => {
    const { chatStream } = await import('../src/main/chat-engine.js');
    let err: any = null;
    const controller = new AbortController();
    const p = chatStream({
      cfg: OPENAI_CFG, messages: userMsg('hi'), ragOn: false, signal: controller.signal,
      onDelta: () => {}, onDone: () => {},
      onError: (m: string, c?: string) => { err = { m, c }; },
    });
    await tick();
    const req = lastReq();
    const res = new FakeResponse(200, {});
    req.emit('response', res);
    res.emit('data', Buffer.from('data: {"choices":[{"delta":{"content":"par"}}]}\n\n'));
    controller.abort();
    await p;
    expect(req.aborted).toBe(true);
    expect(err.c).toBe('aborted');
  });

  it('aborted-before-start issues no net.request', async () => {
    const { chatStream } = await import('../src/main/chat-engine.js');
    let err: any = null;
    const controller = new AbortController();
    controller.abort();
    await chatStream({
      cfg: OPENAI_CFG, messages: userMsg('hi'), ragOn: false, signal: controller.signal,
      onDelta: () => {}, onDone: () => {},
      onError: (m: string, c?: string) => { err = { m, c }; },
    });
    expect(mockRequest).not.toHaveBeenCalled();
    expect(err.c).toBe('aborted');
  });

  it('HTTP 429 → onError category rate-limited', async () => {
    const { chatStream } = await import('../src/main/chat-engine.js');
    let err: any = null;
    const controller = new AbortController();
    const p = chatStream({
      cfg: OPENAI_CFG, messages: userMsg('hi'), ragOn: false, signal: controller.signal,
      onDelta: () => {}, onDone: () => {},
      onError: (m: string, c?: string) => { err = { m, c }; },
    });
    await tick();
    const req = lastReq();
    const res = new FakeResponse(429, {});
    req.emit('response', res);
    res.emit('end');
    await p;
    expect(err.c).toBe('rate-limited');
  });

  it('HTTP 404 → onError category model-missing (e.g. local model not pulled)', async () => {
    const { chatStream } = await import('../src/main/chat-engine.js');
    let err: any = null;
    const controller = new AbortController();
    const p = chatStream({
      cfg: OPENAI_CFG, messages: userMsg('hi'), ragOn: false, signal: controller.signal,
      onDelta: () => {}, onDone: () => {},
      onError: (m: string, c?: string) => { err = { m, c }; },
    });
    await tick();
    const req = lastReq();
    const res = new FakeResponse(404, {});
    req.emit('response', res);
    res.emit('end');
    await p;
    expect(err.c).toBe('model-missing');
  });

  it('API key NEVER appears in any console-logged string (gemini error path)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { chatStream } = await import('../src/main/chat-engine.js');
    const controller = new AbortController();
    const p = chatStream({
      cfg: GEMINI_CFG, messages: userMsg('hi'), ragOn: false, signal: controller.signal,
      onDelta: () => {}, onDone: () => {}, onError: () => {},
    });
    await tick();
    const req = lastReq();
    const res = new FakeResponse(500, {});
    req.emit('response', res);
    res.emit('end');
    await p;
    // trigger a request-error log path too
    const c2 = new AbortController();
    const p2 = chatStream({
      cfg: GEMINI_CFG, messages: userMsg('hi'), ragOn: false, signal: c2.signal,
      onDelta: () => {}, onDone: () => {}, onError: () => {},
    });
    await tick();
    lastReq().emit('error', new Error(`socket fail ${GEMINI_CFG.apiKey}`));
    await p2;
    const logged = spy.mock.calls.flat().map(String).join('\n');
    expect(logged).not.toContain(GEMINI_CFG.apiKey);
    expect(logged).not.toContain('key=');
    spy.mockRestore();
  });

  it('redactForLog strips key query + header values', async () => {
    const { redactForLog } = await import('../src/main/chat-engine.js');
    expect(redactForLog('https://x/y?key=SECRET123&z=1')).not.toContain('SECRET123');
    expect(redactForLog('x-goog-api-key: AIzaSECRET')).not.toContain('AIzaSECRET');
    expect(redactForLog('authorization: Bearer sk-SECRET')).not.toContain('sk-SECRET');
  });

  it('anthropic: frame split between the event: and data: lines buffers until \\n\\n', async () => {
    const { chatStream } = await import('../src/main/chat-engine.js');
    const deltas: string[] = [];
    let full: string | null = null;
    const controller = new AbortController();
    const p = chatStream({
      cfg: ANTHROPIC_CFG, messages: userMsg('hi'), ragOn: false, signal: controller.signal,
      onDelta: (d: string) => deltas.push(d),
      onDone: (_c: any, f: string) => { full = f; },
      onError: () => {},
    });
    await tick();
    const req = lastReq();
    const res = new FakeResponse(200, {});
    req.emit('response', res);
    // Split mid-frame BETWEEN the 'event:' line and the 'data:' line — no \n\n yet.
    res.emit('data', Buffer.from('event: content_block_delta\n'));
    expect(deltas).toEqual([]);
    res.emit('data', Buffer.from('data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi"}}\n\n'));
    expect(deltas).toEqual(['Hi']);
    res.emit('data', Buffer.from('event: message_stop\ndata: {"type":"message_stop"}\n\n'));
    await p;
    expect(full).toBe('Hi');
  });
});

// ── timeouts (connect + idle) — §4/§9/§12 ────────────────────────────────────
describe('chatStream timeouts', () => {
  it('idle timeout: 60s with no data after first response → onError generic + abort', async () => {
    vi.useFakeTimers();
    const { chatStream, IDLE_TIMEOUT_MS } = await import('../src/main/chat-engine.js');
    let err: any = null;
    const controller = new AbortController();
    const p = chatStream({
      cfg: ANTHROPIC_CFG, messages: userMsg('hi'), ragOn: false, signal: controller.signal,
      onDelta: () => {}, onDone: () => {},
      onError: (m: string, c?: string) => { err = { m, c }; },
    });
    await vi.advanceTimersByTimeAsync(0); // let chatStream reach net.request
    const req = lastReq();
    const res = new FakeResponse(200, {});
    req.emit('response', res); // clears connectTimer, arms idleTimer
    // No data at all — idle timer must fire and tear the request down.
    await vi.advanceTimersByTimeAsync(IDLE_TIMEOUT_MS + 1);
    await p;
    expect(err.c).toBe('generic');
    expect(req.aborted).toBe(true);
    vi.useRealTimers();
  });

  it('connect timeout: 30s with no response event → onError generic + abort', async () => {
    vi.useFakeTimers();
    const { chatStream, CONNECT_TIMEOUT_MS } = await import('../src/main/chat-engine.js');
    let err: any = null;
    const controller = new AbortController();
    const p = chatStream({
      cfg: OPENAI_CFG, messages: userMsg('hi'), ragOn: false, signal: controller.signal,
      onDelta: () => {}, onDone: () => {},
      onError: (m: string, c?: string) => { err = { m, c }; },
    });
    await vi.advanceTimersByTimeAsync(0);
    const req = lastReq();
    // Never emit 'response' — connect timer must fire.
    await vi.advanceTimersByTimeAsync(CONNECT_TIMEOUT_MS + 1);
    await p;
    expect(err.c).toBe('generic');
    expect(req.aborted).toBe(true);
    vi.useRealTimers();
  });

  it('ping frames reset idle so a long-thinking stream does NOT time out', async () => {
    vi.useFakeTimers();
    const { chatStream, IDLE_TIMEOUT_MS } = await import('../src/main/chat-engine.js');
    let err: any = null;
    let full: string | null = null;
    const controller = new AbortController();
    const p = chatStream({
      cfg: ANTHROPIC_CFG, messages: userMsg('hi'), ragOn: false, signal: controller.signal,
      onDelta: () => {}, onDone: (_c: any, f: string) => { full = f; },
      onError: (m: string, c?: string) => { err = { m, c }; },
    });
    await vi.advanceTimersByTimeAsync(0);
    const req = lastReq();
    const res = new FakeResponse(200, {});
    req.emit('response', res);
    // Emit a non-text ping every (IDLE-1)ms across > 2*IDLE total. Each ping must
    // reset idle (proving idle resets on EVERY frame, not just text_delta).
    const step = IDLE_TIMEOUT_MS - 1_000;
    let elapsed = 0;
    while (elapsed < IDLE_TIMEOUT_MS * 3) {
      res.emit('data', Buffer.from('event: ping\ndata: {"type":"ping"}\n\n'));
      await vi.advanceTimersByTimeAsync(step);
      elapsed += step;
    }
    expect(err).toBeNull(); // never timed out despite > 3*idle elapsed
    res.emit('data', Buffer.from('event: message_stop\ndata: {"type":"message_stop"}\n\n'));
    await p;
    expect(full).toBe('');
    expect(err).toBeNull();
    vi.useRealTimers();
  });

  it('error-status body that never ends still times out (idle covers the drain)', async () => {
    vi.useFakeTimers();
    const { chatStream, IDLE_TIMEOUT_MS } = await import('../src/main/chat-engine.js');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    let err: any = null;
    const controller = new AbortController();
    const p = chatStream({
      cfg: OPENAI_CFG, messages: userMsg('hi'), ragOn: false, signal: controller.signal,
      onDelta: () => {}, onDone: () => {},
      onError: (m: string, c?: string) => { err = { m, c }; },
    });
    await vi.advanceTimersByTimeAsync(0);
    const req = lastReq();
    const res = new FakeResponse(500, {});
    req.emit('response', res); // error headers, but NEVER 'end' the body (half-open)
    await vi.advanceTimersByTimeAsync(IDLE_TIMEOUT_MS + 1);
    await p;
    // The promise resolved (no orphan slot) and an error surfaced.
    expect(err).not.toBeNull();
    expect(req.aborted).toBe(true);
    vi.useRealTimers();
  });
});

// ── abort during/after the RAG await (registry-before-await design) ──────────
describe('chatStream RAG-await abort', () => {
  it('signal aborted DURING the RAG search → no net.request issued, onError aborted', async () => {
    const { chatStream } = await import('../src/main/chat-engine.js');
    let err: any = null;
    const controller = new AbortController();
    // searchEngine.search() aborts the signal before resolving — exercises the
    // post-RAG-await signal.aborted guard (the abortable-in-flight-RAG case).
    const searchEngine = {
      search: async () => {
        controller.abort();
        return [{ document: { title: 'N', filePath: '/v/n.md' }, chunk: { content: 'x' }, score: 1 }];
      },
    };
    await chatStream({
      cfg: OPENAI_CFG, messages: userMsg('hi'), ragOn: true, signal: controller.signal, searchEngine,
      onDelta: () => {}, onDone: () => {},
      onError: (m: string, c?: string) => { err = { m, c }; },
    });
    expect(mockRequest).not.toHaveBeenCalled();
    expect(err.c).toBe('aborted');
  });
});

// ── RAG ─────────────────────────────────────────────────────────────────────
describe('buildChatRagBlock', () => {
  it('null searchEngine → empty block, no throw', async () => {
    const { buildChatRagBlock } = await import('../src/main/chat-engine.js');
    const out = await buildChatRagBlock('q', null);
    expect(out.block).toBe('');
    expect(out.citations).toEqual([]);
  });

  it('adapts search results to citations (title+filePath only)', async () => {
    const { buildChatRagBlock } = await import('../src/main/chat-engine.js');
    const fakeEngine = {
      search: async () => [
        { document: { title: 'Note A', filePath: '/v/a.md' }, chunk: { content: 'body a '.repeat(100) }, score: 0.9 },
        { document: { title: 'Note B', filePath: '/v/b.md' }, chunk: { content: 'body b' }, score: 0.5 },
      ],
    };
    const out = await buildChatRagBlock('q', fakeEngine);
    expect(out.citations).toEqual([
      { title: 'Note A', filePath: '/v/a.md' },
      { title: 'Note B', filePath: '/v/b.md' },
    ]);
    expect(out.block).toContain('Note A');
    // §9 'no full body': the 700-char source body must be sliced (snippet ≤ 200 → after
    // sourcesBlock's own 400-cap, still well under 700) and never emitted whole.
    expect(out.block).not.toContain('body a '.repeat(100));
    expect(out.block.length).toBeLessThan(700);
  });

  it('caps an oversized sources block under the RAG budget and keeps the system prompt bounded', async () => {
    const { buildChatRagBlock, buildSystemPrompt, RAG_TOKEN_BUDGET, capToBudget } =
      await import('../src/main/chat-engine.js');
    // Many high-then-low score sources whose rendered block blows past the ~8000-char budget.
    const many = Array.from({ length: 60 }, (_, i) => ({
      document: { title: `Note ${i}`, filePath: `/v/${i}.md` },
      chunk: { content: 'x'.repeat(200) },
      score: 1 - i / 100, // descending: drop the lowest-score tail
    }));
    const out = await buildChatRagBlock('q', { search: async () => many });
    const maxChars = Math.floor(RAG_TOKEN_BUDGET / 0.25);
    expect(out.block.length).toBeLessThanOrEqual(maxChars); // capped under budget
    expect(out.block).toContain('Note 0'); // highest-score kept
    expect(out.block).not.toContain('Note 59'); // lowest-score dropped
    // The assembled system prompt stays bounded (block + wrapper overhead only).
    const sys = buildSystemPrompt(out.block);
    expect(sys.length).toBeLessThanOrEqual(maxChars + 600);
    // capToBudget is idempotent on an already-capped block.
    expect(capToBudget(out.block, RAG_TOKEN_BUDGET)).toBe(out.block);
  });

  it('capToBudget drops the lowest-score tail when fed score-descending input', async () => {
    const { capToBudget } = await import('../src/main/chat-engine.js');
    const block = [
      '[1] High\n' + 'h'.repeat(5000),
      '[2] Mid\n' + 'm'.repeat(5000),
      '[3] Low\n' + 'l'.repeat(5000),
    ].join('\n\n');
    const out = capToBudget(block, 2000);
    expect(out).toContain('[1] High');
    expect(out).not.toContain('[3] Low'); // lowest-score tail dropped first
  });

  it('ragOn system prompt wraps block in <untrusted> with data-not-instructions guard', async () => {
    const { buildSystemPrompt } = await import('../src/main/chat-engine.js');
    const sys = buildSystemPrompt('SOME GROUNDING');
    expect(sys).toContain('<untrusted>');
    expect(sys).toContain('SOME GROUNDING');
    expect(sys).toContain('</untrusted>');
    expect(sys).toContain('not instructions');
  });

  it('coreMemory (P1 §3.2/§4.5) is spliced trusted, ABOVE the <untrusted> RAG block', async () => {
    const { buildSystemPrompt } = await import('../src/main/chat-engine.js');
    const mem = '=== Core Memory ===\n- Prefers gemma4';
    // With RAG: memory sits BEFORE the untrusted wrapper (trusted system context).
    const sys = buildSystemPrompt('GROUNDING', mem);
    expect(sys).toContain('Prefers gemma4');
    expect(sys.indexOf(mem)).toBeLessThan(sys.indexOf('<untrusted>'));
    expect(sys.indexOf(mem)).toBeGreaterThan(-1);
    // Without RAG (cloud/single-shot floor §4.5): memory still injected, no <untrusted>.
    const noRag = buildSystemPrompt('', mem);
    expect(noRag).toContain('Prefers gemma4');
    expect(noRag).not.toContain('<untrusted>');
    // Default empty coreMemory → behaviour unchanged (back-compat).
    expect(buildSystemPrompt('GROUNDING')).not.toContain('Core Memory');
  });

  it('combined injection ceiling (§6/LM-2): worst-case RAG + memory stays under SYSTEM_PROMPT_TOKEN_BUDGET', async () => {
    const { buildSystemPrompt, capToBudget, RAG_TOKEN_BUDGET, SYSTEM_PROMPT_TOKEN_BUDGET } =
      await import('../src/main/chat-engine.js');
    // Max-size RAG block (as buildChatRagBlock would cap it) + a generously-large memory block.
    // capToBudget keeps whole '\n\n'-separated entries, so feed it real multi-entry input.
    const ragEntries = Array.from({ length: 40 }, (_v, i) => `[${i}] Title\n${'R'.repeat(300)}`).join('\n\n');
    const maxRag = capToBudget(ragEntries, RAG_TOKEN_BUDGET);
    expect(maxRag).toContain('Title'); // sanity: the cap kept entries (not emptied)
    const bigMemory = `=== Core Memory ===\n${Array.from({ length: 40 }, (_v, i) => `- fact ${i} ${'m'.repeat(30)}`).join('\n')}`;
    const sys = buildSystemPrompt(maxRag, bigMemory);
    const estTokens = Math.ceil(sys.length * 0.25); // same ~4 chars/token estimate as capToBudget
    expect(estTokens).toBeLessThanOrEqual(SYSTEM_PROMPT_TOKEN_BUDGET);
    // The data-not-instructions guard is NEVER truncated away (no mid-prompt cap).
    expect(sys).toContain('not instructions');
  });
});

describe('runAgentLoop — P3 invoke_skill CONTROL (§4.3, set_plan twin)', () => {
  it('loads the skill body, fires onSkill, acks as a tool turn, never dispatches/settles', async () => {
    const loadSkill = vi.fn((n: string) => (n === 'weekly-review' ? 'STEPS: recap notes' : undefined));
    const c = await runLoop([
      step({ toolCalls: [tc('invoke_skill', { name: 'weekly-review' })] }),
      step({ text: 'done' }),
    ], { loadSkill });
    expect(loadSkill).toHaveBeenCalledWith('weekly-review');
    expect(c.skill).toEqual(['weekly-review']);
    expect(c.execute).toHaveLength(0);   // CONTROL tool — never dispatched
    expect(c.succeed).toHaveLength(1);
    expect(c.fail).toHaveLength(0);
  });

  it('a missing/unknown skill acks "(skill not found)" — still never settles', async () => {
    const c = await runLoop([
      step({ toolCalls: [tc('invoke_skill', { name: 'nope' })] }),
      step({ text: 'fallback answer' }),
    ], { loadSkill: () => undefined });
    expect(c.skill).toEqual(['nope']);
    expect(c.succeed).toHaveLength(1);
  });

  it('per-turn cap: at most 2 invoke_skill loads; the 3rd is rejected (§4.3 SEC-6b)', async () => {
    const loadSkill = vi.fn((n: string) => `body:${n}`);
    const c = await runLoop([
      step({ toolCalls: [tc('invoke_skill', { name: 'a' }), tc('invoke_skill', { name: 'b' }), tc('invoke_skill', { name: 'c' })] }),
      step({ text: 'ok' }),
    ], { loadSkill });
    expect(loadSkill).toHaveBeenCalledTimes(2); // 3rd over the cap → not loaded
    expect(c.succeed).toHaveLength(1);
  });

  it('same skill twice in a turn is rejected (no re-load churn)', async () => {
    const loadSkill = vi.fn((n: string) => `body:${n}`);
    const c = await runLoop([
      step({ toolCalls: [tc('invoke_skill', { name: 'a' }), tc('invoke_skill', { name: 'a' })] }),
      step({ text: 'ok' }),
    ], { loadSkill });
    expect(loadSkill).toHaveBeenCalledTimes(1); // second 'a' rejected
    expect(c.succeed).toHaveLength(1);
  });

  it('a blank skill name is a no-op: no load, no onSkill, cap not consumed (review #9)', async () => {
    const loadSkill = vi.fn((n: string) => `body:${n}`);
    const c = await runLoop([
      // blank name, then two real loads — all three should be honored (blank didn't burn the cap)
      step({ toolCalls: [tc('invoke_skill', { name: '' }), tc('invoke_skill', { name: 'a' }), tc('invoke_skill', { name: 'b' })] }),
      step({ text: 'ok' }),
    ], { loadSkill });
    expect(loadSkill).toHaveBeenCalledTimes(2);  // only 'a' and 'b' — blank skipped
    expect(c.skill).toEqual(['a', 'b']);          // no empty-name onSkill surfaced
    expect(c.succeed).toHaveLength(1);
  });
});

describe('runAgentLoop — P2 force-confirm WRITE gate (§3.3 / §6 INT-3)', () => {
  const memWrite = { isWrite: (n: string) => n === 'core_memory_append', forceConfirm: (n: string) => n === 'core_memory_append', valid: ['core_memory_append'] };

  it('force-confirm tool with NO approver is FAIL-CLOSED — never executed (e.g. distill loop)', async () => {
    const c = await runLoop([
      step({ toolCalls: [tc('core_memory_append', { text: 'remember me' })] }),
      step({ text: 'ok' }),
    ], { ...memWrite /* no onToolConfirm */ });
    expect(c.execute).toHaveLength(0); // the durable write NEVER auto-applied
    expect(c.succeed).toHaveLength(1);
    expect(c.fail).toHaveLength(0);
  });

  it('force-confirm tool with an APPROVER that approves → executes once', async () => {
    const c = await runLoop([
      step({ toolCalls: [tc('core_memory_append', { text: 'remember me' })] }),
      step({ text: 'ok' }),
    ], { ...memWrite, onToolConfirm: async () => true });
    expect(c.execute).toEqual([{ name: 'core_memory_append', args: { text: 'remember me' } }]);
    expect(c.succeed).toHaveLength(1);
  });

  it('force-confirm tool DENIED by the approver → not executed, loop continues', async () => {
    const c = await runLoop([
      step({ toolCalls: [tc('core_memory_append', { text: 'no' })] }),
      step({ text: 'ok' }),
    ], { ...memWrite, onToolConfirm: async () => false });
    expect(c.execute).toHaveLength(0);
    expect(c.succeed).toHaveLength(1);
  });

  it('a REGULAR write with no approver still AUTO-APPLIES (force-confirm did not regress it)', async () => {
    const c = await runLoop([
      step({ toolCalls: [tc('log_decision', { title: 't' })] }),
      step({ text: 'ok' }),
    ] /* default isWrite=log_decision, no forceConfirm, no onToolConfirm */);
    expect(c.execute).toHaveLength(1); // unchanged auto-apply behavior
    expect(c.succeed).toHaveLength(1);
  });
});

describe('runAgentLoop — recall_memory dead-end exemption (P1 §6 INT-7)', () => {
  it('empty {memories:[]} does NOT force-conclude (unlike an empty search)', async () => {
    // A model that keeps recalling empty memory must NOT be force-concluded toward DEAD_END_LIMIT
    // (empty memory is the common P1 case, not a failed search). The per-turn recall CAP (§4.3)
    // stops execution after AGENT_MAX_RECALL=4, then the empty-but-non-dead-end recalls run the
    // loop to the MAX_STEPS guard (succeed once, never fail).
    const always = Array.from({ length: 16 }, () => step({ toolCalls: [tc('recall_memory', { query: 'prefs' })] }));
    const c = await runLoop(always, { valid: ['recall_memory'], toolResult: { memories: [] } });
    expect(c.execute.length).toBe(4);   // AGENT_MAX_RECALL — capped, never re-executed past it
    expect(c.succeed).toHaveLength(1);
    expect(c.fail).toHaveLength(0);
  });

  it('recall cap (§4.3 / SEC-6b): at most AGENT_MAX_RECALL executions per turn', async () => {
    // One turn batches 6 recall calls; only the first 4 reach executeTool, the rest get a
    // synthetic "recall limit reached" ack. Then a final answer settles once.
    const c = await runLoop([
      step({ toolCalls: Array.from({ length: 6 }, () => tc('recall_memory', { query: 'x' })) }),
      step({ text: 'answer' }),
    ], { valid: ['recall_memory'], toolResult: { memories: [{ text: 'fact', provenance: 'user' }] } });
    expect(c.execute).toHaveLength(4); // AGENT_MAX_RECALL — over-limit calls skip execute
    expect(c.succeed).toHaveLength(1);
    expect(c.fail).toHaveLength(0);
  });
});

describe('runAgentLoop — P1-3 steer-after-tool injection', () => {
  it('injects a steer note as role:user at the loop top BEFORE the next model turn (alternation kept)', async () => {
    // drainSteer runs at EVERY loop top (incl. step 0, before turn 1). To simulate a steer that
    // arrives WHILE the first tool runs, return the note on the 2nd drain (step 1 top) — it must
    // then land as role:'user' in the 2nd streamStep's messages AFTER the prior assistant(tool_call)
    // + tool turns (so assistant→tool→user alternation is preserved), never mid tool-batch.
    let drainCount = 0;
    const c = await runLoop([
      step({ toolCalls: [tc('search_vault', { query: 'x' })] }),
      step({ text: 'answer informed by steer' }),
    ], {
      toolResult: { ok: true, results: [{ x: 1 }] },
      drainSteer: () => { drainCount++; return drainCount === 2 ? ['focus on auth notes'] : []; },
    });
    // 2nd streamStep's messages must contain the injected user note, and it must be the LAST turn.
    const second = c.stepFull[1];
    const steerTurn = second.find((m: any) => m.role === 'user' && m.content === 'focus on auth notes');
    expect(steerTurn).toBeTruthy();
    expect(second[second.length - 1]).toEqual({ role: 'user', content: 'focus on auth notes' });
    expect(c.succeed).toHaveLength(1);
    expect(c.fail).toHaveLength(0);
  });

  it('drainSteer returning [] injects nothing (no spurious user turns)', async () => {
    const c = await runLoop([
      step({ toolCalls: [tc('search_vault', { query: 'x' })] }),
      step({ text: 'answer' }),
    ], { toolResult: { ok: true, results: [{ x: 1 }] }, drainSteer: () => [] });
    // No turn beyond the seed user 'q' should be role:user-injected by steer.
    const injected = c.stepFull.flat().filter((m: any) => m.role === 'user' && m.content !== 'q');
    expect(injected).toHaveLength(0);
  });

  it('a steer note is purely additive — never aborts the stream', async () => {
    const ac = new AbortController();
    let drained = false;
    const c = await runLoop([
      step({ toolCalls: [tc('search_vault', { query: 'x' })] }),
      step({ text: 'done' }),
    ], {
      signal: ac.signal,
      toolResult: { ok: true, results: [{ x: 1 }] },
      drainSteer: () => (drained ? [] : (drained = true, ['steer'])),
    });
    expect(ac.signal.aborted).toBe(false);          // steer never touches the controller
    expect(c.fail).toHaveLength(0);                 // never fail('aborted')
    expect(c.succeed).toHaveLength(1);
  });
});

// ── Reflection follow-up (§A2) — pure candidate parser + READ-only prompt ─────
describe('parseReflectionCandidates (§A2 — append-only, fail-closed)', () => {
  it('parses a fenced JSON array, caps at 3, forces append, drops targetId', async () => {
    const { parseReflectionCandidates } = await import('../src/main/chat-engine.js');
    const out = parseReflectionCandidates('here are facts:\n```json\n' + JSON.stringify([
      { text: 'Prefers Postgres over MongoDB', rationale: 'stated twice', suggestedOp: 'replace', targetId: 'abc' },
      { text: 'Works on the Stellavault desktop app', rationale: 'ongoing' },
      { text: 'Uses an RTX 3080 Ti GPU', rationale: 'env' },
      { text: 'A fourth durable fact about the user', rationale: 'overflow' },
    ]) + '\n```');
    expect(out).toHaveLength(3); // cap
    expect(out.every((c) => c.suggestedOp === 'append')).toBe(true); // replace forced → append
    expect(out.every((c) => !('targetId' in c) || c.targetId === undefined)).toBe(true); // targetId dropped
    expect(out[0].text).toBe('Prefers Postgres over MongoDB');
  });

  it('drops empty / too-short text and de-dupes within the batch', async () => {
    const { parseReflectionCandidates } = await import('../src/main/chat-engine.js');
    const out = parseReflectionCandidates('```json\n' + JSON.stringify([
      { text: '   ', rationale: 'blank' },
      { text: 'short', rationale: 'under 8 chars' },
      { text: 'Prefers dark mode everywhere', rationale: 'a' },
      { text: 'prefers   DARK mode   everywhere', rationale: 'dup (normalized)' },
    ]) + '\n```');
    expect(out).toHaveLength(1);
    expect(out[0].text).toBe('Prefers dark mode everywhere');
  });

  it('malformed / missing JSON and the empty array → [] (fail-closed, no throw)', async () => {
    const { parseReflectionCandidates } = await import('../src/main/chat-engine.js');
    expect(parseReflectionCandidates('no json here at all')).toEqual([]);
    expect(parseReflectionCandidates('```json\n{ not valid ]\n```')).toEqual([]);
    expect(parseReflectionCandidates('```json\n[]\n```')).toEqual([]);
    expect(parseReflectionCandidates('')).toEqual([]);
    // bare array fallback (no fence)
    expect(parseReflectionCandidates('[{"text":"A durable fact here","rationale":"x"}]')).toHaveLength(1);
  });

  it('KARPATHY_REFLECT_PROMPT is read-only and carries no write/agent rules', async () => {
    const { KARPATHY_REFLECT_PROMPT } = await import('../src/main/chat-engine.js');
    expect(KARPATHY_REFLECT_PROMPT).toMatch(/READ-ONLY/i);
    expect(KARPATHY_REFLECT_PROMPT).not.toContain('create_note'); // no ingest write rule
    expect(KARPATHY_REFLECT_PROMPT).not.toContain('set_plan');     // no agent plan rule
  });
});
