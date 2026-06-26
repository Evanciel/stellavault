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
  'chat:steer',        // P1-3: steer a running agent stream (owner-guarded + screened in main)
  'chat:list-sessions',
  'chat:load-session',
  'chat:rename-session',
  'chat:delete-session',
  'chat:tool-approve', // agent SP-D: renderer approves/denies a write tool
  'chat:distill',      // agent SP-I: auto-distill a finished conversation into the wiki
  'chat:reflect',      // §A: read-only reflection pass → propose memory candidates
  'chat:pick-images',  // SP2: pick image file(s) for a chat attachment
  'chat:pick-media',   // SP4: pick audio/video → cloud transcript attachment
  'chat:export-note',  // part5: save the conversation verbatim as a vault note
];
const CHAT_EVENTS = [
  'chat:chunk', 'chat:done', 'chat:error',
  'chat:tool-call', 'chat:tool-result', 'chat:tool-confirm', // agent SP-D transparency/confirm
  'chat:distill-done', // agent SP-I: distillation summary
  'chat:reflect-done', // §A: reflection pass finished (proposed memory candidates)
  'chat:plan',         // agent multi-step plan checklist
  'chat:skill-invoke', // P3: invoke_skill loaded a skill
  'chat:memory-written', // memory-relax: autonomous core_memory_append → undo toast
  'chat:vitals',       // P1-4: context-fill bar frame (pre-stream)
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

  it('chat:steer owner-guards + re-scans the steer text (injection + secret) before enqueue (P1-3)', () => {
    // A steer note is renderer-supplied free text that enters an AUTONOMOUS tool-calling loop and
    // can drive subsequent writes — so main MUST owner-guard (wcId) AND re-run BOTH detectors
    // before it touches model context, mirroring memory:apply-candidate. Lock the whole gate.
    const h = mainSrc.match(/ipcMain\.handle\('chat:steer'[\s\S]*?\n  \}\);/);
    expect(h).not.toBeNull();
    expect(h![0]).toContain('e.sender.id');                              // owner guard (per-stream authz)
    expect(h![0]).toMatch(/scanForInjection\([\s\S]*?\)\.blocked\.length > 0/); // injection screen
    expect(h![0]).toContain('looksLikeSecret(');                         // secret screen
    expect(h![0]).toContain('MAX_STEER_QUEUE');                          // queue-depth bound (DoS)
    // Steer must NEVER abort the stream — abort is the sole terminal signal.
    expect(h![0]).not.toContain('controller.abort(');
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
  const MEMORY_CHANNELS = ['memory:list', 'memory:get', 'memory:delete', 'memory:apply-candidate'];

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

  it('memory:apply-candidate RE-SCANS the queued text (injection + secret) before the write (§A3)', () => {
    // A reflection candidate is renderer-queued, so main must NEVER trust it: the apply handler
    // re-runs BOTH detectors (scanForInjection + looksLikeSecret) and routes through the
    // append-only coreMemoryAppend (provenance 'user'). Lock the whole gate inside the handler.
    const h = mainSrc.match(/ipcMain\.handle\('memory:apply-candidate'[\s\S]*?\n  \}\);/);
    expect(h).not.toBeNull();
    expect(h![0]).toMatch(/scanForInjection\([\s\S]*?\)\.blocked\.length > 0/); // injection re-scan
    expect(h![0]).toContain('looksLikeSecret(');  // secret re-scan
    expect(h![0]).toContain('coreMemoryAppend(');  // append-only write path
    // No core_memory_replace from this path (append-only this round, §A3).
    expect(h![0]).not.toContain('coreMemoryReplace(');
  });
});

describe('Agent SKILLS IPC (P3, §4.4) — both-side trust boundary', () => {
  const SKILL_CHANNELS = ['skill:list', 'skill:set-promoted'];

  it('skill channels are in ALLOWED_CHANNELS and main-handled; not in events', () => {
    for (const ch of SKILL_CHANNELS) {
      expect(allowedChannelsBody).toContain(`'${ch}'`);
      expect(mainSrc).toContain(`ipcMain.handle('${ch}'`);
      expect(allowedEventsBody).not.toContain(`'${ch}'`);
    }
  });

  it('chat:skill-invoke is an allowed EVENT (not a channel) and emitted by main', () => {
    expect(allowedEventsBody).toContain("'chat:skill-invoke'");
    expect(allowedChannelsBody).not.toContain("'chat:skill-invoke'");
    expect(mainSrc).toContain("'chat:skill-invoke'");
  });
});

describe('Memory-relax (Part 1 §4) — autonomous append + push undo toast', () => {
  it('chat:memory-written is wired ONLY in the interactive chat:send loop, not distill/reflect', () => {
    // Autonomous core_memory_append surfaces a push "remembered (undo)" toast — but ONLY in the
    // interactive agent (chat:send). distill/reflect have no memoryAppend dep (fail-closed), so they
    // must NOT wire onMemoryWrite (no autonomous memory writes there).
    const send = mainSrc.match(/ipcMain\.handle\('chat:send'[\s\S]*?\n  \}\);/);
    expect(send).not.toBeNull();
    expect(send![0]).toContain('onMemoryWrite:');
    expect(send![0]).toContain("'chat:memory-written'");
    const distill = mainSrc.match(/ipcMain\.handle\('chat:distill'[\s\S]*?\n  \}\);/);
    const reflect = mainSrc.match(/ipcMain\.handle\('chat:reflect'[\s\S]*?\n  \}\);/);
    expect(distill![0]).not.toContain('onMemoryWrite');
    expect(reflect![0]).not.toContain('onMemoryWrite');
  });
})

describe('Daemon headless distill (daemon-keepalive §3/§4) — safety floor', () => {
  it('chat:distill is a thin wrapper over runDistill (extraction, no behaviour fork)', () => {
    const h = mainSrc.match(/ipcMain\.handle\('chat:distill'[\s\S]*?\n  \}\);/);
    expect(h).not.toBeNull();
    expect(h![0]).toContain('runDistill(');
    expect(h![0]).toContain('headless: false');
  });

  it('runDistill enforces the headless safety floor: create-only deny + injection pre-scan + write cap + no memory write', () => {
    // Bound the capture to the next module function (the inline opts type has its own `\n}`).
    const fn = mainSrc.match(/async function runDistill\(opts[\s\S]*?\n\/\/ Headless emit/);
    expect(fn).not.toBeNull();
    const src = fn![0];
    // create-only: append_note/link_note/log_decision + core_memory_* denied in headless
    expect(mainSrc).toContain("const DAEMON_HEADLESS_DENY = new Set(['append_note', 'link_note', 'log_decision', 'core_memory_append', 'core_memory_replace'])");
    expect(src).toContain('DAEMON_HEADLESS_DENY.has(name)');
    // injection pre-scan gates ONLY the headless path
    expect(src).toMatch(/headless && scanForInjection\(transcript\)\.blocked\.length > 0/);
    // per-run write cap
    expect(src).toContain('DAEMON_WRITE_CAP');
    // NO memoryWrite dep wired (memory append/replace error via dispatcher) — only memoryRecall
    expect(src).toContain('memoryRecall:');
    expect(src).not.toContain('memoryAppend:');
    expect(src).not.toContain('memoryReplace:');
  });

  it('daemon:run-now is allowlisted (preload) + main-handled', () => {
    expect(allowedChannelsBody).toContain("'daemon:run-now'");
    expect(mainSrc).toContain("ipcMain.handle('daemon:run-now'");
  });
})

describe('Track B: Sign in with ChatGPT OAuth IPC — both-side trust boundary + invariants', () => {
  const OAUTH_CHANNELS = ['oauth:start-device', 'oauth:status', 'oauth:logout'];

  it('all 3 oauth channels are allowlisted (preload) + main-handled; not in events', () => {
    for (const ch of OAUTH_CHANNELS) {
      expect(allowedChannelsBody).toContain(`'${ch}'`);
      expect(mainSrc).toContain(`ipcMain.handle('${ch}'`);
      expect(allowedEventsBody).not.toContain(`'${ch}'`);
    }
  });

  it('oauth:progress is an allowed EVENT (not a channel) and emitted by main', () => {
    expect(allowedEventsBody).toContain("'oauth:progress'");
    expect(allowedChannelsBody).not.toContain("'oauth:progress'");
    expect(mainSrc).toContain("'oauth:progress'");
  });

  it('every oauth handler is DOUBLE-GATED: OAUTH_EXPERIMENTAL env + main-only consent (start-device)', () => {
    // The env flag is read ONCE at startup (not per-call from a renderer-controllable source).
    expect(mainSrc).toContain("const OAUTH_EXPERIMENTAL = process.env.STELLAVAULT_OAUTH_EXPERIMENTAL === '1'");
    const start = mainSrc.match(/ipcMain\.handle\('oauth:start-device'[\s\S]*?\n  \}\);/);
    expect(start).not.toBeNull();
    expect(start![0]).toContain('OAUTH_EXPERIMENTAL');         // gate 1: env
    expect(start![0]).toContain('oauthConsentGranted()');      // gate 2: main-only consent re-check
    // status + logout also env-gate.
    const status = mainSrc.match(/ipcMain\.handle\('oauth:status'[\s\S]*?\n  \}\);/);
    expect(status![0]).toContain('OAUTH_EXPERIMENTAL');
    const logout = mainSrc.match(/ipcMain\.handle\('oauth:logout'[\s\S]*?\n  \}\);/);
    expect(logout![0]).toContain('OAUTH_EXPERIMENTAL');
  });

  it('consent is MAIN-ONLY: settings:set does NOT accept a consent field (cannot be spoofed)', () => {
    // The settings:set safeAi whitelist accepts only non-secret oauth scalars — NEVER a consent flag.
    const set = mainSrc.match(/ipcMain\.handle\('settings:set'[\s\S]*?\n  \}\);/);
    expect(set).not.toBeNull();
    // No consent field is ever ASSIGNED into the safeAi whitelist (a comment mentioning the word
    // "consent" is fine — what matters is that `safeAi.<...>consent...` is never written).
    expect(set![0]).not.toMatch(/safeAi\.\w*[Cc]onsent/);
    expect(set![0]).not.toMatch(/consentAccepted/);
    // and the whitelist carries ONLY the non-secret display scalars (no token fields).
    expect(set![0]).toContain('oauthAccountId');
    expect(set![0]).not.toMatch(/safeAi\.(refresh_token|access_token|id_token)/);
  });

  it('oauth:start-device records consent ONLY from the intentful dialog-driven arg', () => {
    const start = mainSrc.match(/ipcMain\.handle\('oauth:start-device'[\s\S]*?\n  \}\);/);
    expect(start![0]).toMatch(/consentAccepted === true/);
    expect(start![0]).toContain('recordOauthConsent()');
  });

  it('the oauth:progress projection carries NO device_auth_id / tokens (allowlisted shape in ipc-types)', () => {
    const idx = ipcTypesSrc.indexOf("'oauth:progress'");
    expect(idx).toBeGreaterThan(-1);
    const decl = ipcTypesSrc.slice(idx, idx + 240);
    expect(decl).toContain('user_code');
    expect(decl).toContain('verification_url');
    expect(decl).not.toContain('device_auth_id');
    expect(decl).not.toMatch(/access_token|refresh_token|id_token/);
  });

  it('a SEPARATE before-quit listener aborts in-flight oauth device flows (cancelAll)', () => {
    const chatQuit = mainSrc.match(/app\.on\('before-quit'[\s\S]*?chatStreamRegistry[\s\S]*?cancelAll\(\)/);
    expect(chatQuit).not.toBeNull();
  });

  it('closing a window aborts that wcId\'s in-flight device-flow poll (close + destroyed)', () => {
    // Security invariant: a closed Settings window must not leave the device-flow poll
    // POSTing to auth.openai.com every ~2s for up to 900s. The window-close path captures
    // the wcId up-front (unreadable post-destroy) and cancels on both 'close' and the
    // terminal 'destroyed', optional-chained against an uninitialised `oauth`.
    expect(mainSrc).toMatch(/const wcId = win\.webContents\.id;/);
    expect(mainSrc).toMatch(/win\.webContents\.on\('destroyed'[\s\S]*?oauth\?\.cancel\(wcId\)/);
    const closeHandler = mainSrc.match(/win\.on\('close'[\s\S]*?\n  \}\);/);
    expect(closeHandler).not.toBeNull();
    expect(closeHandler![0]).toContain('oauth?.cancel(wcId)');
  });

  it('the buffered Ask/Wiki synthesizer retries once on a ChatGPT 401 (refresh + re-resolve headers)', () => {
    // Spec step 8/9: a token expiring mid-Ask must trigger a single oauth.refresh() + fresh
    // headers, scoped to openai-chatgpt. The wrapper lives in withChatGptRefresh and BOTH the
    // Ask (core:ask) and Wiki (core:synthesize) handlers route their synthesizer through it.
    expect(mainSrc).toContain('function withChatGptRefresh');
    const wrap = mainSrc.match(/function withChatGptRefresh[\s\S]*?\n\}/);
    expect(wrap).not.toBeNull();
    expect(wrap![0]).toContain("cfg?.provider !== 'openai-chatgpt'"); // scoped to Track B only
    expect(wrap![0]).toContain('getOauth().refresh()');               // single-flight refresh
    expect(wrap![0]).toMatch(/getAuthHeaders\('openai-chatgpt'/);     // re-resolve fresh headers
    // Both synthesizer sites go through the wrapper.
    const ask = mainSrc.match(/ipcMain\.handle\('core:ask'[\s\S]*?\n  \}\);/);
    const wiki = mainSrc.match(/ipcMain\.handle\('core:synthesize'[\s\S]*?\n  \}\);/);
    expect(ask![0]).toContain('withChatGptRefresh(');
    expect(wiki![0]).toContain('withChatGptRefresh(');
  });
});

describe('Daemon Phase 0b lifecycle (daemon-keepalive §2) — quit/lock correctness', () => {
  it('window-all-closed is conditional (keep-alive only when daemon ON and not an intentional quit)', () => {
    const h = mainSrc.match(/app\.on\('window-all-closed'[\s\S]*?\n\}\);/);
    expect(h).not.toBeNull();
    expect(h![0]).toMatch(/if \(isQuitting \|\| !daemonEnabled\(\)\)\s*\{\s*app\.quit\(\)/);
  });

  it('isQuitting latch is RESET on a cancelled close so a stuck latch cannot silently kill the daemon', () => {
    // before-quit pre-latches isQuitting=true; the confirm-close veto branch must un-latch it.
    const h = mainSrc.match(/ipcMain\.handle\('window:confirm-close'[\s\S]*?\n  \}\);/);
    expect(h).not.toBeNull();
    const vetoBranch = h![0].match(/if \(!proceed\)\s*\{[\s\S]*?\n    \}/);
    expect(vetoBranch).not.toBeNull();
    expect(vetoBranch![0]).toContain('isQuitting = false');
  });

  it('the single-instance lock is acquired via the idempotent helper at startup AND on runtime enable', () => {
    expect(mainSrc).toContain('function ensureSingleInstanceLock()');
    // whenReady startup gate
    expect(mainSrc).toMatch(/daemonEnabled\(\) && !ensureSingleInstanceLock\(\)/);
    // runtime toggle acquires it before persisting enabled
    const h = mainSrc.match(/ipcMain\.handle\('daemon:set-enabled'[\s\S]*?\n  \}\);/);
    expect(h).not.toBeNull();
    expect(h![0]).toContain('ensureSingleInstanceLock()');
  });
})
