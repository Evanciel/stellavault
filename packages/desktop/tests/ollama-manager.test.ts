// "Start Ollama" affordance — pure-logic guards.
//
// Covers the two decisions that gate the whole feature:
//  1. isLocalProviderUrl — ONLY loopback baseURLs may offer a local start (so a remote
//     Groq/OpenRouter openai-compatible host never gets a bogus "Start Ollama" button).
//  2. isUnreachableErr — connection-level failures map to the 'unreachable' category
//     (which surfaces the start affordance); HTTP errors from a server that DID answer
//     must NOT (they are 'generic').
//
// chat-engine imports electron at module load, so electron is mocked (net is unused here).
import { describe, it, expect, vi } from 'vitest';

vi.mock('electron', () => ({ net: { request: vi.fn(), fetch: vi.fn() } }));

import { isLocalProviderUrl } from '../src/shared/ai-providers.js';
import { isUnreachableErr } from '../src/main/chat-engine.js';
import { compareVersions, isGitHubHost, MIN_OLLAMA_VERSION } from '../src/main/ollama-manager.js';

describe('isLocalProviderUrl — only loopback offers a local start', () => {
  it('treats blank baseURL as local (defaults to the Ollama loopback URL)', () => {
    expect(isLocalProviderUrl('')).toBe(true);
  });

  it.each([
    'http://localhost:11434/v1',
    'http://127.0.0.1:11434/v1',
    'http://0.0.0.0:1234/v1',
    'http://[::1]:11434/v1',
    'http://foo.localhost:11434/v1',
    'http://localhost:1234/v1', // LM Studio default port — still loopback
  ])('accepts loopback %s', (url) => {
    expect(isLocalProviderUrl(url)).toBe(true);
  });

  it.each([
    'https://api.groq.com/openai/v1',
    'https://openrouter.ai/api/v1',
    'https://api.openai.com/v1',
    'http://192.168.1.50:11434/v1', // LAN host is NOT loopback
    'not-a-url',
  ])('rejects non-loopback %s', (url) => {
    expect(isLocalProviderUrl(url)).toBe(false);
  });
});

describe("isUnreachableErr — connection failures map to 'unreachable'", () => {
  it.each([
    'net::ERR_CONNECTION_REFUSED',
    'connect ECONNREFUSED 127.0.0.1:11434',
    'getaddrinfo ENOTFOUND example.invalid',
    'net::ERR_NAME_NOT_RESOLVED',
    'net::ERR_CONNECTION_TIMED_OUT',
    'EHOSTUNREACH',
  ])('flags %s as unreachable', (msg) => {
    expect(isUnreachableErr(msg)).toBe(true);
  });

  it.each([
    'provider HTTP 429',
    'authentication_error',
    'stream idle timeout',
    'the model declined to answer',
    '',
  ])('does NOT flag %s', (msg) => {
    expect(isUnreachableErr(msg)).toBe(false);
  });
});

describe('compareVersions — the current-model compat floor', () => {
  it('orders versions numerically (not lexically): 0.30.10 > 0.30.9', () => {
    expect(compareVersions('0.30.10', '0.30.9')).toBeGreaterThan(0);
  });
  it('flags 0.20.x as below the floor (it 412s on gemma4/qwen3.5)', () => {
    expect(compareVersions('0.20.0', MIN_OLLAMA_VERSION)).toBeLessThan(0);
  });
  it('accepts the floor and newer', () => {
    expect(compareVersions(MIN_OLLAMA_VERSION, MIN_OLLAMA_VERSION)).toBe(0);
    expect(compareVersions('0.30.10', MIN_OLLAMA_VERSION)).toBeGreaterThanOrEqual(0);
  });
  it('extracts the semver from noisy version output', () => {
    expect(compareVersions('ollama version is 0.30.10', '0.30.9')).toBeGreaterThan(0);
  });
  it('treats an incomplete/unparseable version as oldest (safe → prompts update)', () => {
    // No full x.y.z → 0.0.0, which sorts below the floor, so the user is nudged to update
    // rather than silently assumed compatible.
    expect(compareVersions('0.30', '0.30.0')).toBeLessThan(0);
    expect(compareVersions('garbage', MIN_OLLAMA_VERSION)).toBeLessThan(0);
  });
});

describe('isGitHubHost — download URL must be GitHub-hosted (SSRF/redirect guard)', () => {
  it.each([
    'https://github.com/ollama/ollama/releases/download/v0.30.10/ollama-windows-amd64.zip',
    'https://objects.githubusercontent.com/abc',
    'https://release-assets.githubusercontent.com/x.zip',
  ])('accepts %s', (url) => {
    expect(isGitHubHost(url)).toBe(true);
  });
  it.each([
    'https://evil.com/ollama.zip',
    'https://github.com.evil.com/x.zip', // suffix-spoof must NOT pass
    'https://notgithub.com/x',
    'http://localhost:11434/x',
    'file:///etc/passwd',
    'not-a-url',
  ])('rejects %s', (url) => {
    expect(isGitHubHost(url)).toBe(false);
  });
});
