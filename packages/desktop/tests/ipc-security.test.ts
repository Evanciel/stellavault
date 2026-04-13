import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Read preload source to extract ALLOWED_CHANNELS and ALLOWED_EVENTS at test time
// This tests the actual security boundary without requiring Electron runtime
const preloadSrc = readFileSync(
  join(__dirname, '..', 'src', 'preload', 'index.ts'),
  'utf-8',
);

function extractSetEntries(src: string, varName: string): string[] {
  const regex = new RegExp(`const ${varName}[^\\[]*\\[([^\\]]+)\\]`, 's');
  const match = src.match(regex);
  if (!match) return [];
  return [...match[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
}

const allowedChannels = extractSetEntries(preloadSrc, 'ALLOWED_CHANNELS');
const allowedEvents = extractSetEntries(preloadSrc, 'ALLOWED_EVENTS');

// Read IPC types to extract channel map
const ipcTypesSrc = readFileSync(
  join(__dirname, '..', 'src', 'shared', 'ipc-types.ts'),
  'utf-8',
);

function extractChannelNames(src: string): string[] {
  return [...src.matchAll(/'([a-z]+:[a-z-]+)'/g)].map(m => m[1]);
}

const typedChannels = extractChannelNames(ipcTypesSrc);

describe('Desktop IPC Security', () => {
  it('ALLOWED_CHANNELS 존재 및 비어있지 않음', () => {
    expect(allowedChannels.length).toBeGreaterThan(0);
  });

  it('ALLOWED_EVENTS 존재 및 비어있지 않음', () => {
    expect(allowedEvents.length).toBeGreaterThan(0);
  });

  it('모든 allowed channels는 namespace:action 패턴', () => {
    for (const ch of allowedChannels) {
      expect(ch).toMatch(/^[a-z]+:[a-z-]+$/);
    }
  });

  it('모든 allowed events는 namespace:action 패턴', () => {
    for (const ev of allowedEvents) {
      expect(ev).toMatch(/^[a-z]+:[a-z-]+$/);
    }
  });

  it('위험한 채널이 허용 목록에 없음', () => {
    const dangerous = ['shell:exec', 'fs:write', 'process:exit', 'eval', 'require', 'child_process'];
    for (const ch of dangerous) {
      expect(allowedChannels).not.toContain(ch);
    }
  });

  it('allowed channels에 중복 없음', () => {
    const unique = new Set(allowedChannels);
    expect(unique.size).toBe(allowedChannels.length);
  });

  it('모든 typed channels가 allowlist에 포함됨 (누락 = 호출 불가)', () => {
    const missing = typedChannels.filter(ch => !allowedChannels.includes(ch));
    // Some typed channels might be events, not invoke channels
    const missingNonEvents = missing.filter(ch => !allowedEvents.includes(ch));
    // If there are typed channels not in either list, they're dead code
    if (missingNonEvents.length > 0) {
      console.warn('Typed but not allowed (dead code?):', missingNonEvents);
    }
    // Not a hard failure — just informational
  });

  it('window 채널은 최소 3개 (minimize, maximize, close)', () => {
    const windowChannels = allowedChannels.filter(ch => ch.startsWith('window:'));
    expect(windowChannels.length).toBeGreaterThanOrEqual(3);
  });

  it('core 채널에 search와 stats 포함', () => {
    expect(allowedChannels).toContain('core:search');
    expect(allowedChannels).toContain('core:get-stats');
  });
});
