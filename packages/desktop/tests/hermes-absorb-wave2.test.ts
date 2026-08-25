// Hermes absorb wave 2 — thinking display (C) + guaranteed-tail trim (E) + quick capture (D).
// Parser/builder behaviour is unit-tested; window/hotkey/IPC wiring is source-asserted
// (same convention as ollama-model-ref.test.ts — the packaged app is the integration gate).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf-8');

describe('C — thinking deltas (parsers + body builders)', () => {
  it('parseOllamaChatChunk surfaces message.thinking as thinkingDeltas (and omits when absent)', async () => {
    const { parseOllamaChatChunk } = await import('../src/main/chat-engine.js');
    const withThinking = parseOllamaChatChunk(JSON.stringify({ message: { thinking: 'step 1: recall…', content: '' }, done: false }));
    expect(withThinking.thinkingDeltas).toEqual(['step 1: recall…']);
    expect(withThinking.deltas).toEqual([]);
    const without = parseOllamaChatChunk(JSON.stringify({ message: { content: 'hi' }, done: false }));
    expect(without.thinkingDeltas).toBeUndefined();
    expect(without.deltas).toEqual(['hi']);
  });

  it('parseOpenAiSse surfaces delta.reasoning AND delta.reasoning_content', async () => {
    const { parseOpenAiSse } = await import('../src/main/chat-engine.js');
    const frame = [
      `data: ${JSON.stringify({ choices: [{ delta: { reasoning: 'hmm, ' } }] })}`,
      `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: 'let me check' } }] })}`,
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'Answer.' } }] })}`,
    ].join('\n');
    const r = parseOpenAiSse(frame);
    expect(r.thinkingDeltas).toEqual(['hmm, ', 'let me check']);
    expect(r.deltas).toEqual(['Answer.']);
  });

  it('buildChatBody: local suppression (reasoning_effort none) LIFTS when showThinking is on', async () => {
    const { buildChatBody } = await import('../src/main/chat-engine.js');
    const cfg: any = { provider: 'openai-compatible', model: 'deepseek-r1', apiKey: '', baseURL: 'http://localhost:11434/v1' };
    const msgs: any = [{ id: 'u', role: 'user', text: 'q', ts: 1 }];
    const off = buildChatBody(cfg, 'sys', msgs) as any;
    expect(off.body.reasoning_effort).toBe('none'); // default: gemma4 fast-path preserved
    const on = buildChatBody(cfg, 'sys', msgs, { showThinking: true }) as any;
    expect(on.body.reasoning_effort).toBeUndefined(); // opt-in: the model may think
  });

  it('agent native path honors showThinking (think flag + onThinking pass-through)', () => {
    const src = read('src/main/chat-engine.ts');
    expect(src).toContain('toolset.schemas, !!opts.showThinking), signal, onDelta, opts.onThinking');
  });

  it('thinking rides its own allowlisted event and is NEVER persisted with the session', () => {
    const preload = read('src/preload/index.ts');
    expect(preload).toContain("'chat:thinking'");
    const view = read('src/renderer/components/chat/ChatView.tsx');
    // accumulated in a renderer-only map — never merged into the message objects that persist
    expect(view).toContain('setThinkingMap');
    expect(view).not.toContain('thinking: thinkingMap'); // no merge into ChatMessage
  });
});

describe('E — guaranteed-tail trim (over-cap conversations degrade, not die)', () => {
  it('drops OLDEST turns first, keeps the guaranteed tail, and reports trimmedCount', () => {
    const src = read('src/main/index.ts');
    expect(src).toContain('GUARANTEED_TAIL');
    expect(src).toContain('clean.shift()');           // oldest first
    expect(src).toContain('trimmedCount');
    // the reject remains for a tail that alone exceeds the cap (single over-cap message)
    expect(src).toContain("'conversation too long'");
    // vitals carries the honesty signal
    expect(src).toContain('trimmedCount: v.trimmedCount');
  });
});

describe('D — quick capture (window + hotkey + funnel reuse)', () => {
  it('registers the global hotkey behind the setting, and unregisters on will-quit', () => {
    const src = read('src/main/index.ts');
    expect(src).toContain('globalShortcut.register(QUICK_CAPTURE_ACCEL');
    expect(src).toContain(".quickCapture !== false");
    expect(src).toContain('globalShortcut.unregisterAll()');
  });

  it('capture window is sandboxed like the main window and never navigates off-app', () => {
    const src = read('src/main/index.ts');
    const block = src.slice(src.indexOf('function createCaptureWindow'), src.indexOf('function toggleCaptureWindow'));
    expect(block).toContain('contextIsolation: true');
    expect(block).toContain('nodeIntegration: false');
    expect(block).toContain('sandbox: true');
    expect(block).toContain("setWindowOpenHandler(() => ({ action: 'deny' }))");
    expect(block).toContain('will-navigate');
  });

  it('files through the EXISTING audited capture funnel (vault:capture text), no new write path', () => {
    const qc = read('src/renderer/components/QuickCapture.tsx');
    expect(qc).toContain("ipc('vault:capture'");
    expect(qc).toContain("kind: 'text'");
    expect(qc).toContain("source: 'quick'");
    // the ONLY other IPC the window uses is hide — no vault reads, no settings, no chat
    const ipcCalls = [...qc.matchAll(/ipc\('([^']+)'/g)].map((m) => m[1]);
    expect(new Set(ipcCalls)).toEqual(new Set(['vault:capture', 'capture:hide']));
  });

  it('capture:hide is allowlisted; the renderer entry routes #capture to the minimal UI', () => {
    expect(read('src/preload/index.ts')).toContain("'capture:hide'");
    const entry = read('src/renderer/main.tsx');
    expect(entry).toContain("window.location.hash === '#capture'");
    expect(entry).toContain('<QuickCapture />');
  });
});
