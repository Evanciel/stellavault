import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Both-side trust-boundary assertion for the SP1 chat IPC surface (Plan §5, T5).
// A single-side omission (channel allowed but not handled, or handled but not
// allowed) MUST fail this test. We read the real source so the assertions track
// the actual security boundary, not a runtime-erased TypeScript type.

const preloadSrc = readFileSync(
  join(__dirname, '..', 'src', 'preload', 'index.ts'),
  'utf-8',
);
const mainSrc = readFileSync(
  join(__dirname, '..', 'src', 'main', 'index.ts'),
  'utf-8',
);
const ipcTypesSrc = readFileSync(
  join(__dirname, '..', 'src', 'shared', 'ipc-types.ts'),
  'utf-8',
);
const memoryStoreSrc = readFileSync(
  join(__dirname, '..', 'src', 'main', 'memory-store.ts'),
  'utf-8',
);

// Extract the literal body of a `const NAME = new Set<string>([ ... ]);` block.
// Unlike the legacy extractSetEntries regex, this captures the WHOLE bracketed
// literal (the chat entries are appended at the tail of each Set), so a missing
// tail entry is detectable.
function setBody(src: string, varName: string): string {
  const start = src.indexOf(`const ${varName}`);
  if (start === -1) return '';
  const open = src.indexOf('[', start);
  // The Set literal closes with `]);` — find THAT, not the first `]` (a comment such
  // as `// [editor-upgrade additive]` contains a stray `]` that would truncate early).
  const close = src.indexOf('])', open);
  if (open === -1 || close === -1) return '';
  return src.slice(open, close + 1);
}

const allowedChannelsBody = setBody(preloadSrc, 'ALLOWED_CHANNELS');
const allowedEventsBody = setBody(preloadSrc, 'ALLOWED_EVENTS');

const CHAT_INVOKE_CHANNELS = [
  'chat:send',
  'chat:abort',
  'chat:list-sessions',
  'chat:load-session',
  'chat:rename-session',
  'chat:delete-session',
  'chat:tool-approve', // agent SP-D: renderer approves/denies a write tool
  'chat:distill',      // agent SP-I: auto-distill a finished conversation into the wiki
  'chat:pick-images',  // SP2: pick image file(s) for a chat attachment
  'chat:pick-media',   // SP4: pick audio/video → cloud transcript attachment
  'chat:export-note',  // part5: save the conversation verbatim as a vault note
];
const CHAT_EVENTS = [
  'chat:chunk', 'chat:done', 'chat:error',
  'chat:tool-call', 'chat:tool-result', 'chat:tool-confirm', // agent SP-D transparency/confirm
  'chat:distill-done', // agent SP-I: distillation summary
  'chat:plan',         // agent multi-step plan checklist
];

describe('SP1 chat IPC — preload allowlist (renderer side)', () => {
  it('all 6 chat invoke channels are in ALLOWED_CHANNELS', () => {
    expect(allowedChannelsBody.length).toBeGreaterThan(0);
    for (const ch of CHAT_INVOKE_CHANNELS) {
      expect(allowedChannelsBody).toContain(`'${ch}'`);
    }
  });

  it('all 3 chat events are in ALLOWED_EVENTS', () => {
    expect(allowedEventsBody.length).toBeGreaterThan(0);
    for (const ev of CHAT_EVENTS) {
      expect(allowedEventsBody).toContain(`'${ev}'`);
    }
  });

  it('chat invoke channels are NOT mistakenly in the events set', () => {
    for (const ch of CHAT_INVOKE_CHANNELS) {
      expect(allowedEventsBody).not.toContain(`'${ch}'`);
    }
  });

  it('chat events are NOT mistakenly in the channels set', () => {
    for (const ev of CHAT_EVENTS) {
      expect(allowedChannelsBody).not.toContain(`'${ev}'`);
    }
  });
});

describe('SP1 chat IPC — main handlers (main side)', () => {
  it('main registers ipcMain.handle for all 6 chat invoke channels', () => {
    for (const ch of CHAT_INVOKE_CHANNELS) {
      expect(mainSrc).toContain(`ipcMain.handle('${ch}'`);
    }
  });

  it('main emits all 3 chat events via e.sender / safeSend', () => {
    for (const ev of CHAT_EVENTS) {
      expect(mainSrc).toContain(`'${ev}'`);
    }
  });

  it('main does NOT broadcast chat events to all windows', () => {
    // Chat streaming must target the originating webContents only. The chat:send
    // handler uses a safeSend(...) helper bound to e.sender — never getAllWindows.
    const sendHandler = mainSrc.match(/ipcMain\.handle\('chat:send'[\s\S]*?\n  \}\);/);
    expect(sendHandler).not.toBeNull();
    expect(sendHandler![0]).not.toContain('getAllWindows');
    expect(sendHandler![0]).toContain('safeSend');
  });

  it('chat:abort validates the owning webContents (wcId) before aborting', () => {
    // Anchor on the handler's own column-2 close brace (same discipline as chat:send),
    // not the first arbitrary `});` — robust against future inline callbacks.
    const abortHandler = mainSrc.match(/ipcMain\.handle\('chat:abort'[\s\S]*?\n  \}\);/);
    expect(abortHandler).not.toBeNull();
    expect(abortHandler![0]).toContain('e.sender.id');
    expect(abortHandler![0]).toContain('abort');
  });
});

describe('SP1 chat IPC — security invariants (regression locks, Plan §9/§10)', () => {
  it('the concurrency cap is enforced PER-wcId, not globally', () => {
    // A regression to a global cap (dropping the `ent.wcId === wcId` accumulator)
    // would let one window starve another. Lock the per-owner accounting + the cap.
    expect(mainSrc).toMatch(/ent\.wcId === wcId/);
    expect(mainSrc).toMatch(/owned >= MAX_CONCURRENT/);
  });

  it('validateChatReq drops any non-user/assistant role (renderer cannot inject system)', () => {
    // The single most security-load-bearing line: a renderer must never be able to
    // smuggle a 'system' turn into the prompt. The whitelist rejects everything else.
    expect(mainSrc).toMatch(/m\.role !== 'user' && m\.role !== 'assistant'/);
    // And no 'system' role is ever pushed onto the cleaned turn list.
    const validate = mainSrc.match(/function validateChatReq[\s\S]*?\n\}/);
    expect(validate).not.toBeNull();
    expect(validate![0]).not.toMatch(/role:\s*'system'/);
  });

  it('SP2: the chat:send attachment path CONTENT-verifies images (magic-byte), not just the data-URL regex', () => {
    // The forge path (renderer-controlled chat:send, unlike the trusted dialog) must decode +
    // sniff the bytes and reject a declared image/* whose magic bytes don't match — a lexical
    // regex alone would let a compromised renderer smuggle non-image bytes. Lock the content gate.
    const validate = mainSrc.match(/function validateChatReq[\s\S]*?\n\}/);
    expect(validate).not.toBeNull();
    expect(validate![0]).toContain('sniffMediaType');          // decodes + magic-byte sniffs
    expect(validate![0]).toContain('Buffer.from(');            // actually decodes the payload
    expect(validate![0]).toContain("'base64'");                // …as base64
    expect(validate![0]).toContain('attachment type mismatch'); // declared mime must match sniff
    expect(validate![0]).toContain('CHAT_MAX_TOTAL_ATTACHMENT_CHARS'); // aggregate DoS bound
  });

  it('agent: chat:tool-approve is owner-checked (wcId) so another window cannot approve a write', () => {
    const h = mainSrc.match(/ipcMain\.handle\('chat:tool-approve'[\s\S]*?\n  \}\);/);
    expect(h).not.toBeNull();
    expect(h![0]).toContain('e.sender.id');
    expect(h![0]).toMatch(/wcId/);
  });

  it('agent: an opt-in review-before-apply broker exists (confirmWrites → pause on pendingApprovals)', () => {
    // Writes auto-apply by default (frictionless), but the human-approval broker must remain
    // wired behind req.confirmWrites so a safety-conscious user can require approval. The
    // renderer can only approve/deny — never name a tool.
    expect(mainSrc).toContain('pendingApprovals');
    expect(mainSrc).toContain("'chat:tool-confirm'");
    expect(mainSrc).toContain('onToolConfirm');
    expect(mainSrc).toContain('req.confirmWrites');
  });

  it('a SEPARATE before-quit listener aborts in-flight chat streams (existing ones untouched)', () => {
    // Electron fires every before-quit listener; the chat one must be additive — there
    // must be >= 3 listeners (memTimer clear, MCP stop, chat abort) and the chat one
    // iterates the registry calling controller.abort().
    const beforeQuit = [...mainSrc.matchAll(/app\.on\('before-quit'/g)];
    expect(beforeQuit.length).toBeGreaterThanOrEqual(3);
    const chatQuit = mainSrc.match(
      /app\.on\('before-quit'[\s\S]*?chatStreamRegistry[\s\S]*?controller\.abort\(\)/,
    );
    expect(chatQuit).not.toBeNull();
  });
});

describe('SP1 chat IPC — both-side coverage (single-side omission FAILS)', () => {
  // Every /^chat:/ key in IpcChannelMap must be an allowed invoke channel; every
  // /^chat:/ key in IpcEventMap must be an allowed event. This catches a type added
  // on one side but not wired into the runtime allowlist (and vice-versa).
  function chatKeysInSection(src: string, marker: string): string[] {
    const idx = src.indexOf(marker);
    if (idx === -1) return [];
    // Capture from the marker to the end of the interface block (first lone `}`
    // at column 0 after the marker).
    const rest = src.slice(idx);
    const end = rest.search(/\n\}/);
    const body = end === -1 ? rest : rest.slice(0, end);
    // Match only real MAP-KEY declarations: `'chat:xxx':` (quoted key followed by a
    // colon). This skips `'chat:chunk'` mentioned inside a comment, where the quoted
    // string is NOT immediately followed by `:`.
    return [...body.matchAll(/'(chat:[a-z-]+)'\s*:/g)].map((m) => m[1]);
  }

  it('every chat: key in IpcChannelMap is an allowed invoke channel', () => {
    const keys = chatKeysInSection(ipcTypesSrc, 'export interface IpcChannelMap');
    expect(keys.length).toBe(CHAT_INVOKE_CHANNELS.length);
    for (const k of keys) {
      expect(allowedChannelsBody).toContain(`'${k}'`);
      expect(mainSrc).toContain(`ipcMain.handle('${k}'`);
    }
  });

  it('every chat: key in IpcEventMap is an allowed event', () => {
    const keys = chatKeysInSection(ipcTypesSrc, 'export interface IpcEventMap');
    expect(keys.length).toBe(CHAT_EVENTS.length);
    for (const k of keys) {
      expect(allowedEventsBody).toContain(`'${k}'`);
    }
  });
});

describe('Agent MEMORY IPC (P2, §6 INT-8) — both-side trust boundary', () => {
  const MEMORY_CHANNELS = ['memory:list', 'memory:get', 'memory:delete'];

  it('all memory channels are in ALLOWED_CHANNELS and main-handled', () => {
    for (const ch of MEMORY_CHANNELS) {
      expect(allowedChannelsBody).toContain(`'${ch}'`);
      expect(mainSrc).toContain(`ipcMain.handle('${ch}'`);
    }
  });

  it('memory channels are NOT in the events set (invoke-only)', () => {
    for (const ch of MEMORY_CHANNELS) {
      expect(allowedEventsBody).not.toContain(`'${ch}'`);
    }
  });

  it('memory:delete id-validates in main (isMemoryId — no arbitrary deletion)', () => {
    // The renderer carries an opaque UUID only; the store backend rejects a non-UUID / absent id.
    // Lock that the delete path runs through deleteBlock (which isMemoryId-validates).
    expect(mainSrc).toContain("ipcMain.handle('memory:delete'");
    expect(mainSrc).toContain('deleteBlock(');
    expect(memoryStoreSrc).toContain('export function deleteBlock');
    expect(memoryStoreSrc).toMatch(/isMemoryId\(id\)/);
  });
});
