// Stellavault Desktop — LLM Synthesizer (main process, T3-2 / T3-1)
//
// Implements core's pluggable `Synthesizer` interface (intelligence/ask-engine.ts)
// using the Anthropic Messages API. Core never imports an LLM SDK or holds the key
// — the desktop main process owns the API key (desktop-settings.json) and injects
// this synthesizer into askVault / the synthesis handler when a key is configured.
//
// No SDK dependency: we call the Messages API over Electron's `net.request`
// (system-proxy aware). The answer is grounded in the retrieved vault sources and
// cites them as [[Title]] wikilinks so the desktop renders clickable backlinks.
//
// Security: the API key is read here and sent ONLY to api.anthropic.com over
// https. It is NEVER logged (we log status codes / generic failures only) and
// never returned to the renderer.

import { net } from 'electron';
import type { Synthesizer, SynthesisSource } from '@stellavault/core';

export interface LlmConfig {
  provider: 'anthropic' | 'none';
  apiKey: string;
  model: string;
}

// Latest Claude model id (claude-api skill): default when provider=anthropic.
// Fable 5 — thinking is always on, so the `thinking` param is OMITTED entirely
// (an explicit {type:"disabled"} 400s; an explicit budget also 400s). No
// temperature/top_p (removed on Fable 5 / Opus 4.7+). No assistant prefill.
export const DEFAULT_ANTHROPIC_MODEL = 'claude-fable-5';

const ANTHROPIC_HOST = 'api.anthropic.com';
const ANTHROPIC_PATH = '/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const REQUEST_TIMEOUT_MS = 60_000;
const MAX_TOKENS = 2048;

/** Build the grounding block from retrieved sources (title + snippet only). */
function sourcesBlock(sources: SynthesisSource[]): string {
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

/** Single Messages API call over net.request. Resolves the assistant text, or
 *  rejects on transport / non-2xx / refusal so the caller can fall back. */
function callAnthropic(cfg: LlmConfig, prompt: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const body = JSON.stringify({
      model: cfg.model || DEFAULT_ANTHROPIC_MODEL,
      max_tokens: MAX_TOKENS,
      // Fable 5: thinking is always on — omit the `thinking` field. No sampling params.
      messages: [{ role: 'user', content: prompt }],
    });

    const request = net.request({
      method: 'POST',
      protocol: 'https:',
      hostname: ANTHROPIC_HOST,
      path: ANTHROPIC_PATH,
    });
    request.setHeader('content-type', 'application/json');
    request.setHeader('anthropic-version', ANTHROPIC_VERSION);
    request.setHeader('x-api-key', cfg.apiKey);

    const timer = setTimeout(() => {
      try { request.abort(); } catch { /* already done */ }
      reject(new Error('LLM request timed out'));
    }, REQUEST_TIMEOUT_MS);

    request.on('response', (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (c) => chunks.push(Buffer.from(c)));
      response.on('end', () => {
        clearTimeout(timer);
        const status = response.statusCode ?? 0;
        const raw = Buffer.concat(chunks).toString('utf-8');
        if (status < 200 || status >= 300) {
          // Do NOT log the key or full request — status + generic message only.
          reject(new Error(`Anthropic API error ${status}`));
          return;
        }
        try {
          const parsed = JSON.parse(raw);
          // Fable 5 may return stop_reason "refusal" (HTTP 200, empty/partial content).
          if (parsed?.stop_reason === 'refusal') {
            reject(new Error('LLM declined to answer'));
            return;
          }
          const text = Array.isArray(parsed?.content)
            ? parsed.content
                .filter((b: any) => b?.type === 'text' && typeof b.text === 'string')
                .map((b: any) => b.text)
                .join('')
                .trim()
            : '';
          if (!text) {
            reject(new Error('Empty LLM response'));
            return;
          }
          resolve(text);
        } catch {
          reject(new Error('Failed to parse LLM response'));
        }
      });
    });
    request.on('error', (err) => {
      clearTimeout(timer);
      // err.message can include host but never the key; keep it generic anyway.
      reject(new Error(`LLM request failed: ${err.message}`));
    });

    request.write(body);
    request.end();
  });
}

/** Build a core Synthesizer from the desktop AI settings, or null when no key is
 *  configured (caller then uses the extractive fallback). */
export function makeSynthesizer(ai: LlmConfig | undefined | null): Synthesizer | null {
  if (!ai || ai.provider !== 'anthropic') return null;
  const apiKey = (ai.apiKey ?? '').trim();
  if (!apiKey) return null;
  const cfg: LlmConfig = { provider: 'anthropic', apiKey, model: (ai.model || DEFAULT_ANTHROPIC_MODEL).trim() };
  return {
    async synthesize({ question, sources, mode }) {
      const prompt = mode === 'wiki' ? wikiPrompt(question, sources) : askPrompt(question, sources);
      return callAnthropic(cfg, prompt);
    },
  };
}
