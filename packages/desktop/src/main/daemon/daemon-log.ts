// Always-on daemon — headless emit sink (Design Ref: §3 — daemon-keepalive).
// When distill runs with NO window (the daemon's whole point), the agent's UI events
// (tool-call/tool-result/done) have nowhere to go. We route them to a JSONL log instead, so a
// headless compile is verifiable (the §6 acceptance test greps this file for a create_note line)
// AND auditable (the §4 safety test asserts NO core_memory_* / append_note / link_note lines).
//
// Pure-ish: only node:fs + node:os/electron home. No renderer, no network. Best-effort (a log
// write must never break a distill); a failed write is swallowed after one console.error.

import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export interface DistillEvent {
  event: 'tool-call' | 'tool-result' | 'done' | 'error' | 'start' | 'skipped';
  streamId: string;
  name?: string;       // tool name (tool-call/tool-result)
  ok?: boolean;        // tool-result outcome
  filePath?: string;   // the note a write tool touched (tool-result)
  summary?: string;    // done summary / skip reason
}

// ~/.stellavault/daemon.log — same off-vault root as memory-store's blocks.json.
const LOG_DIR = join(homedir(), '.stellavault');
const LOG_FILE = join(LOG_DIR, 'daemon.log');

/** Append one JSONL line. ts is stamped here (daemon runs out of band, so the caller has no clock
 *  to thread). Never throws — a logging failure must not abort a headless distill. */
export function daemonLogEmit(ev: DistillEvent): void {
  try {
    mkdirSync(LOG_DIR, { recursive: true, mode: 0o700 });
    appendFileSync(LOG_FILE, JSON.stringify({ ts: Date.now(), ...ev }) + '\n', 'utf-8');
  } catch (err) {
    console.error('[daemon-log] write failed', err);
  }
}

export function daemonLogPath(): string {
  return LOG_FILE;
}
