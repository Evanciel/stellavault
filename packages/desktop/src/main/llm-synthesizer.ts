// Stellavault Desktop — LLM Synthesizer (main process, T3-2 / T3-1)
//
// Implements core's pluggable `Synthesizer` interface (intelligence/ask-engine.ts) for
// Ask + Wiki Synthesis. Core never imports an LLM SDK or holds the key — the desktop
// main process owns the API key (desktop-settings.json) and injects this synthesizer
// when a provider is configured.
//
// Multi-provider, SDK-less: all calls go over Electron's `net.request` (system-proxy
// aware). One `postJson` helper serves Anthropic, OpenAI, any OpenAI-compatible server
// (Ollama / LM Studio / Groq / OpenRouter / DeepSeek …), and Google Gemini.
//
// Security: the key is read here and sent ONLY to the selected provider's endpoint over
// the URL's protocol. It is NEVER logged (status codes / generic failures only) and
// never returned to the renderer.

import { net } from 'electron';
import { randomUUID } from 'node:crypto';
import type { Synthesizer, SynthesisSource } from '@stellavault/core';
import {
  ANTHROPIC_VERSION, DEFAULT_ANTHROPIC_MODEL, DEFAULT_GEMINI_MODEL, DEFAULT_MODELS, DEFAULT_CHATGPT_MODEL, OPENAI_BASE_URL, type AiProvider,
} from '../shared/ai-providers.js';
import { assertExactHost } from './outbound-fetch.js';

// Re-export for back-compat (older imports referenced this from here).
export { DEFAULT_ANTHROPIC_MODEL };

export interface LlmConfig {
  provider: AiProvider;
  apiKey: string;
  model: string;
  baseURL?: string; // only used when provider === 'openai-compatible'
  // Track B (openai-chatgpt): pre-resolved OAuth auth headers (Authorization, ChatGPT-Account-ID)
  // injected by the handler. chat-engine/synthesizer never read the token store directly.
  authHeaders?: Record<string, string>;
}

const REQUEST_TIMEOUT_MS = 60_000;
const MAX_TOKENS = 2048;

/** Build the grounding block from retrieved sources (title + snippet only). */
export function sourcesBlock(sources: SynthesisSource[]): string {
  return sources
    .slice(0, 12)
    .map((s, i) => `[${i + 1}] ${s.title}\n${(s.snippet ?? '').replace(/\s+/g, ' ').trim().slice(0, 400)}`)
    .join('\n\n');
}

function askPrompt(question: string, sources: SynthesisSource[]): string {
  return [
    `Answer the question using ONLY the notes from the user's vault below. Ground every claim in the notes; do not invent facts not present in them. If the notes don't cover something, say so plainly.`,
    `Cite the notes you draw on inline as [[Note Title]] wikilinks (use the exact titles shown). Write a clear, direct answer in markdown — no preamble like "Based on the notes".`,
    ``,
    `Question: ${question}`,
    ``,
    `Vault notes:`,
    sourcesBlock(sources),
  ].join('\n');
}

function wikiPrompt(topic: string, sources: SynthesisSource[]): string {
  return [
    `Write a compiled wiki article on the topic below, synthesizing ONLY the user's own vault notes provided. The article should read as a coherent, structured explainer (use markdown headings), not a list of excerpts. Ground every statement in the notes; do not add outside facts.`,
    `Weave the source notes in as [[Note Title]] wikilinks (exact titles) wherever you draw on them, so each claim is traceable. Open with a one-paragraph synthesis, then sections as the material warrants. End with a "## Related notes" section listing the [[Note Title]] links used.`,
    ``,
    `Topic: ${topic}`,
    ``,
    `Vault notes:`,
    sourcesBlock(sources),
  ].join('\n');
}

/** Generic JSON POST over net.request (system-proxy aware). Parses protocol/host/port/
 *  path from `url`, so the SAME helper serves https://api.openai.com AND
 *  http://localhost:11434 (local loopback uses plain http via the URL's protocol).
 *  Resolves {status, body}; rejects on transport error / timeout. */
function postJson(url: string, headers: Record<string, string>, bodyObj: unknown): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      reject(new Error('Invalid AI endpoint URL'));
      return;
    }
    const protocol = u.protocol;
    if (protocol !== 'http:' && protocol !== 'https:') {
      reject(new Error('Unsupported AI endpoint protocol'));
      return;
    }
    const request = net.request({
      method: 'POST',
      protocol,
      hostname: u.hostname,
      port: u.port ? Number(u.port) : undefined,
      path: u.pathname + u.search,
    });
    request.setHeader('content-type', 'application/json');
    for (const [k, v] of Object.entries(headers)) request.setHeader(k, v);

    const timer = setTimeout(() => {
      try { request.abort(); } catch { /* already done */ }
      reject(new Error('LLM request timed out'));
    }, REQUEST_TIMEOUT_MS);

    request.on('response', (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (c) => chunks.push(Buffer.from(c)));
      response.on('end', () => {
        clearTimeout(timer);
        resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf-8') });
      });
    });
    request.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`LLM request failed: ${err.message}`));
    });

    request.write(JSON.stringify(bodyObj));
    request.end();
  });
}

function callAnthropic(cfg: LlmConfig, prompt: string): Promise<string> {
  return postJson(
    'https://api.anthropic.com/v1/messages',
    { 'anthropic-version': ANTHROPIC_VERSION, 'x-api-key': cfg.apiKey },
    { model: cfg.model || DEFAULT_ANTHROPIC_MODEL, max_tokens: MAX_TOKENS, messages: [{ role: 'user', content: prompt }] },
  ).then(({ status, body }) => {
    if (status < 200 || status >= 300) throw new Error(`Anthropic API error ${status}`);
    const parsed = JSON.parse(body);
    if (parsed?.stop_reason === 'refusal') throw new Error('LLM declined to answer');
    const text = Array.isArray(parsed?.content)
      ? parsed.content.filter((b: any) => b?.type === 'text' && typeof b.text === 'string').map((b: any) => b.text).join('').trim()
      : '';
    if (!text) throw new Error('Empty LLM response');
    return text;
  });
}

// Covers provider 'openai' (fixed baseURL) AND 'openai-compatible' (Ollama / LM Studio /
// Groq / OpenRouter / DeepSeek / …). Authorization header set only when a key is present
// (local servers need none).
function callOpenAiCompatible(cfg: LlmConfig, prompt: string, baseURL: string): Promise<string> {
  const headers: Record<string, string> = {};
  const key = (cfg.apiKey ?? '').trim();
  if (key) headers['authorization'] = `Bearer ${key}`;
  const url = `${baseURL.replace(/\/+$/, '')}/chat/completions`;
  return postJson(url, headers, {
    model: cfg.model,
    max_tokens: MAX_TOKENS,
    messages: [{ role: 'user', content: prompt }],
    stream: false,
  }).then(({ status, body }) => {
    if (status < 200 || status >= 300) throw new Error(`OpenAI-compatible API error ${status}`);
    const parsed = JSON.parse(body);
    const text = (parsed?.choices?.[0]?.message?.content ?? '').trim();
    if (!text) throw new Error('Empty LLM response');
    return text;
  });
}

// Google Gemini — generativelanguage REST. The key goes in the URL query (?key=),
// which is the documented scheme; never log the URL.
function callGemini(cfg: LlmConfig, prompt: string): Promise<string> {
  const model = cfg.model || DEFAULT_GEMINI_MODEL;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(cfg.apiKey)}`;
  return postJson(url, {}, {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { maxOutputTokens: MAX_TOKENS },
  }).then(({ status, body }) => {
    if (status < 200 || status >= 300) throw new Error(`Gemini API error ${status}`);
    const parsed = JSON.parse(body);
    const cand = parsed?.candidates?.[0];
    if (cand?.finishReason === 'SAFETY') throw new Error('LLM declined to answer');
    const text = (cand?.content?.parts ?? []).filter((p: any) => typeof p?.text === 'string').map((p: any) => p.text).join('').trim();
    if (!text) throw new Error('Empty LLM response');
    return text;
  });
}

// Track B — buffered Ask/Wiki against the Responses API. stream:true is HARDCODED (the backend
// ignores stream:false), so a postJson().json() would HANG. We OPEN the SSE stream, accumulate
// response.output_text.delta until response.completed, and return the assembled text. Hardened the
// SAME way as chat-engine's streaming path: redirect:'error' + synchronous exact-host pin
// (chatgpt.com) BEFORE any token header. `authHeaders` (Authorization + ChatGPT-Account-ID) are
// pre-resolved by the handler — this function never reads the token store.
const CHATGPT_RESPONSES_URL = 'https://chatgpt.com/backend-api/codex/responses';
function callOpenAiChatGpt(cfg: LlmConfig, prompt: string, authHeaders: Record<string, string>): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let u: URL;
    try { u = new URL(CHATGPT_RESPONSES_URL); } catch { reject(new Error('Invalid Responses endpoint URL')); return; }
    try { assertExactHost(u.hostname, 'chatgpt.com'); } catch { reject(new Error('Responses host not allowed')); return; }

    const body = {
      model: cfg.model || DEFAULT_CHATGPT_MODEL,
      input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: prompt }] }],
      store: false,
      stream: true,
      include: [],
    };
    const request = net.request({
      method: 'POST', protocol: u.protocol as 'https:', hostname: u.hostname,
      path: u.pathname + u.search, redirect: 'error',
    });
    request.setHeader('content-type', 'application/json');
    request.setHeader('accept', 'text/event-stream');
    for (const [k, v] of Object.entries(authHeaders)) request.setHeader(k, v);
    request.setHeader('originator', 'codex_cli_rs');
    request.setHeader('User-Agent', `codex_cli_rs/0.0.0 (${process.platform})`);
    request.setHeader('OpenAI-Beta', 'responses=experimental');
    request.setHeader('session_id', randomUUID());

    let settled = false;
    let acc = '';
    let buffer = '';
    const timer = setTimeout(() => fail(new Error('Responses request timed out')), REQUEST_TIMEOUT_MS);
    function fail(err: Error) { if (settled) return; settled = true; clearTimeout(timer); try { request.abort(); } catch { /* */ } reject(err); }
    function done() { if (settled) return; settled = true; clearTimeout(timer); if (!acc.trim()) { reject(new Error('Empty LLM response')); return; } resolve(acc.trim()); }

    request.on('redirect', () => fail(new Error('Responses redirect refused')));
    request.on('response', (response) => {
      const status = response.statusCode ?? 0;
      if (status < 200 || status >= 300) {
        response.on('data', () => { /* drain — never logged */ });
        response.on('end', () => fail(new Error(`ChatGPT Responses API error ${status}`)));
        response.on('error', () => fail(new Error(`ChatGPT Responses API error ${status}`)));
        return;
      }
      response.on('data', (chunk: Buffer) => {
        if (settled) return;
        buffer += chunk.toString('utf-8');
        let sep = buffer.indexOf('\n\n');
        while (sep !== -1) {
          const frame = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          for (const line of frame.split('\n')) {
            const l = line.replace(/\r$/, '');
            if (!l.startsWith('data:')) continue;
            const raw = l.slice('data:'.length).trim();
            if (!raw || raw === '[DONE]') continue;
            let obj: any;
            try { obj = JSON.parse(raw); } catch { continue; }
            const type = String(obj?.type ?? '');
            if (type === 'response.output_text.delta' && typeof obj?.delta === 'string') acc += obj.delta;
            else if (type === 'response.refusal.delta' || type === 'response.refusal.done') { fail(new Error('LLM declined to answer')); return; }
            else if (type === 'response.failed' || type === 'error') { fail(new Error('ChatGPT Responses stream error')); return; }
            else if (type === 'response.completed') { done(); return; }
          }
          sep = buffer.indexOf('\n\n');
        }
      });
      response.on('end', () => done());
      response.on('error', (err: Error) => fail(err instanceof Error ? err : new Error('Responses stream error')));
    });
    request.on('error', (err: Error) => fail(err instanceof Error ? err : new Error('Responses request failed')));
    request.write(JSON.stringify(body));
    request.end();
  });
}

/** Build a core Synthesizer from the desktop AI settings, or null when no usable
 *  provider is configured (caller then uses the extractive fallback). `authHeaders` carries the
 *  pre-resolved auth map: existing providers pass their sync-built headers byte-identically; Track B
 *  (openai-chatgpt) passes the resolved OAuth headers. Ask + Wiki handlers await getAuthHeaders. */
export function makeSynthesizer(
  ai: LlmConfig | undefined | null,
  authHeaders?: Record<string, string>,
): Synthesizer | null {
  if (!ai || ai.provider === 'none') return null;
  const provider = ai.provider;
  const apiKey = (ai.apiKey ?? '').trim();
  const baseURL = (ai.baseURL ?? '').trim();

  // Local openai-compatible servers may run keyless; openai-chatgpt uses OAuth (no key, gated on the
  // resolved authHeaders); everything else needs a key.
  if (provider === 'openai-chatgpt') {
    if (!authHeaders || !authHeaders.Authorization) return null;
  } else {
    if (!apiKey && provider !== 'openai-compatible') return null;
    if (provider === 'openai-compatible' && !baseURL) return null;
  }

  const model = (ai.model || DEFAULT_MODELS[provider] || '').trim();
  const cfg: LlmConfig = { provider, apiKey, model, baseURL, authHeaders };

  return {
    async synthesize({ question, sources, mode }) {
      const prompt = mode === 'wiki' ? wikiPrompt(question, sources) : askPrompt(question, sources);
      switch (provider) {
        case 'anthropic':         return callAnthropic(cfg, prompt);
        case 'openai':            return callOpenAiCompatible(cfg, prompt, OPENAI_BASE_URL);
        case 'openai-compatible': return callOpenAiCompatible(cfg, prompt, baseURL);
        case 'google':            return callGemini(cfg, prompt);
        case 'openai-chatgpt':    return callOpenAiChatGpt(cfg, prompt, authHeaders ?? {});
        default:                  throw new Error(`Unknown AI provider: ${String(provider)}`);
      }
    },
  };
}
