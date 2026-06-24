// Stellavault Desktop — Chat Session Store (main process, SP1 / T3)
//
// Plaintext-at-rest JSON session store under ~/.stellavault/chat/ (0o700).
// Design Ref: multimedia-chat-sp1-plan.md §5 + Locked Decisions 1 & 2.
//
// SECURITY / PRIVACY (Locked Decision 1 — ACCEPTED RISK, documented):
//  - Session content is persisted in PLAINTEXT. safeStorage encryption is deferred
//    to a later SP. Mitigations are mandatory, not optional:
//      * 0o700 perms on the chat dir (mkdir mode).
//      * RAG citation SNIPPET BODIES are NEVER persisted — title + filePath only
//        (Decision 2): keeps private vault excerpts out of the plaintext store.
//      * redact() runs before every write as DEFENSE-IN-DEPTH only. It is NOT the
//        privacy control and does NOT constitute a privacy guarantee.
//
// PATH SAFETY invariants (§5):
//  - Filenames are ALWAYS randomUUID() (node:crypto). They are NEVER derived from
//    renderer input or the session title. The title lives in a FIELD inside the JSON;
//    rename edits that field, the filename stays the UUID forever.
//  - isUuid(id) rejects non-UUID ids on EVERY op (load/delete/rename) so the
//    UUID-only invariant holds on reads, not just writes.
//  - pathFor(id) runs assertInsideDir(CHAT_DIR, …) on EVERY read/write/delete/rename.
//  - Atomic write = mkdir(recursive, 0o700) + writeFile(tmp w/ unique suffix) + rename.
//  - Corrupt file on load is QUARANTINED to '<file>.broken' (renameSync) and returns
//    null — NEVER throws, NEVER deletes (kept for inspection).
//  - Per-session ~800ms debounce (matches renderer session-persist.ts) so a save
//    fires once per turn, not per keystroke.

import { app } from 'electron';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, renameSync, unlinkSync, readdirSync } from 'node:fs';
import { assertInsideDir } from './path-safety.js';
import type { ChatMessage, ChatCitation, ChatSessionMeta } from '../shared/ipc-types.js';

// Same base-dir resolver as secret-store.ts:18 (app.getPath('home')).
const CHAT_DIR = join(app.getPath('home'), '.stellavault', 'chat');
const DEBOUNCE_MS = 800; // matches renderer session-persist.ts:110
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Persisted shape on disk. `title` is a metadata field (rename writes this, NEVER
// the filename). `messages` are redacted at rest; citations are stripped to
// title+filePath only (Decision 2).
interface PersistedSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  updated: number;
}

const pending = new Map<string, ReturnType<typeof setTimeout>>();
// Per-session custom title set by renameSession. Lets a rename survive (a) a save
// already in flight (a later-firing debounce reads this instead of re-deriving a
// title and clobbering it) and (b) a brand-new session whose first save has not yet
// flushed to disk (rename can't read a file that doesn't exist yet). Cleared when the
// session is deleted.
const titleOverride = new Map<string, string>();

// ─── Path helpers ────────────────────────────────────

export function isUuid(id: unknown): id is string {
  return typeof id === 'string' && UUID_RE.test(id);
}

// Read+write+delete+rename guard: reject non-UUID ids, then containment-check the
// resolved path against CHAT_DIR (defeats '../' traversal + sibling-prefix bypass).
function pathFor(id: string): string {
  if (!isUuid(id)) throw new Error('chat-session: id must be a UUID');
  return assertInsideDir(CHAT_DIR, join(CHAT_DIR, `${id}.json`));
}

function ensureDir(): void {
  mkdirSync(CHAT_DIR, { recursive: true, mode: 0o700 }); // restrict perms (plaintext-at-rest)
}

// Move a corrupt file aside for inspection — NEVER delete, NEVER throw.
function quarantine(target: string): void {
  try {
    renameSync(target, `${target}.broken`);
  } catch {
    /* best-effort: if even the rename fails, swallow — caller already returns null */
  }
}

// ─── redact (defense-in-depth, NOT the privacy control) ──
// Replaces a few common provider-key-shaped tokens and large single-line base64 blobs
// with '[redacted]'. This is belt-and-braces hygiene against an accidentally-pasted
// secret; it is explicitly NOT a privacy guarantee and does NOT make the plaintext
// store private (Locked Decision 1 — the real controls are 0o700 + snippet-strip).
// Coverage is intentionally PARTIAL and shape-based: it catches sk-…/key-…/AIza…/xox…
// PREFIXED tokens and a >1KB single-line base64 run. It does NOT catch opaque
// header-value tokens (a bare 'x-api-key: <hex>' body, Bearer/JWT, AWS AKIA…,
// GitHub ghp_…) nor newline-wrapped PEM blocks — do not rely on it for those.
const KEY_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9_-]{16,}/g,        // OpenAI / Anthropic style (sk-…, sk-ant-…)
  /key-[A-Za-z0-9_-]{16,}/g,       // generic key- prefixed tokens
  /AIza[A-Za-z0-9_-]{20,}/g,       // Google API keys
  /xox[baprs]-[A-Za-z0-9-]{10,}/g, // Slack-style x-api-key-like tokens
];
// base64 blob > 1KB (≈1366 base64 chars). Long opaque blobs are likely embedded
// binary/credentials, not prose.
const BASE64_BLOB = /[A-Za-z0-9+/]{1366,}={0,2}/g;

function redactText(text: string): string {
  let out = text;
  for (const re of KEY_PATTERNS) out = out.replace(re, '[redacted]');
  out = out.replace(BASE64_BLOB, '[redacted]');
  return out;
}

// Returns a fresh array — never mutates the caller's messages. Citations are
// reduced to title+filePath only (Decision 2: snippet bodies never hit disk).
function redact(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((m) => {
    const clean: ChatMessage = {
      id: m.id,
      role: m.role,
      text: redactText(m.text ?? ''),
      ts: m.ts,
    };
    if (m.incomplete) clean.incomplete = true;
    if (Array.isArray(m.citations) && m.citations.length > 0) {
      // Strip snippet — persist title + filePath ONLY.
      clean.citations = m.citations.map((c): ChatCitation => ({ title: c.title, filePath: c.filePath }));
    }
    return clean;
  });
}

// ─── title (DISPLAY only) ────────────────────────────
// Derived from the first user message; never used for the filename.
function deriveTitle(messages: ChatMessage[]): string {
  const firstUser = messages.find((m) => m.role === 'user');
  const raw = (firstUser?.text ?? '').trim().replace(/\s+/g, ' ');
  if (!raw) return 'New chat';
  return raw.length > 60 ? `${raw.slice(0, 60)}…` : raw;
}

// ─── atomic write ────────────────────────────────────
function writeSessionAtomic(id: string, payload: PersistedSession): void {
  ensureDir();
  const target = pathFor(id);
  const tmp = `${target}.${randomUUID()}.tmp`; // unique suffix: no concurrent-write clobber
  writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf-8');
  renameSync(tmp, target);
}

// ─── public API ──────────────────────────────────────

/** Debounced save (~800ms). Coalesces a turn's worth of writes into one atomic
 *  write. redact() + snippet-strip run inside the debounced callback. */
export function saveSession(id: string, messages: ChatMessage[]): void {
  // Validate id eagerly so a bad id surfaces synchronously (mirrors pathFor guard);
  // pathFor would throw inside the timer anyway, but the caller deserves the error now.
  if (!isUuid(id)) throw new Error('chat-session: id must be a UUID');

  // Snapshot + redact at CALL time, not at flush time. The caller (renderer) commonly
  // owns and mutates the `messages` array in place during streaming; deferring redact()
  // into the timer would persist whatever the array looks like ~800ms later (a torn or
  // future snapshot). redact() already returns a fresh array, so the closure below
  // closes over an immutable copy taken now.
  const clean = redact(messages);

  const existing = pending.get(id);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(() => {
    pending.delete(id);
    try {
      // Title: a user rename (titleOverride) wins; otherwise derive from the redacted
      // messages so a pasted key never leaks into the persisted title field.
      const payload: PersistedSession = {
        id,
        title: titleOverride.get(id) ?? deriveTitle(clean),
        messages: clean,
        updated: Date.now(),
      };
      writeSessionAtomic(id, payload);
    } catch (err) {
      console.error('[chat-session-store] save failed', err);
    }
  }, DEBOUNCE_MS);

  pending.set(id, timer);
}

/** Load a session's messages, or null if missing/corrupt. Corrupt files are
 *  quarantined to '<file>.broken'. NEVER throws (except on a non-UUID id, which is
 *  a programming/abuse error surfaced by pathFor). */
export function loadSession(id: string): ChatMessage[] | null {
  const target = pathFor(id); // isUuid + assertInsideDir
  let raw: string;
  try {
    raw = readFileSync(target, 'utf-8');
  } catch {
    return null; // missing file → null
  }
  try {
    const parsed = JSON.parse(raw) as PersistedSession;
    if (!parsed || !Array.isArray(parsed.messages)) {
      quarantine(target);
      return null;
    }
    return parsed.messages;
  } catch (err) {
    console.error('[chat-session-store] corrupt session, quarantining', target, err);
    quarantine(target);
    return null;
  }
}

/** List all sessions as display rows. Parses each file; corrupt ones are
 *  quarantined and skipped. `title` is for DISPLAY only. Sorted newest-first. */
export function listSessions(): ChatSessionMeta[] {
  let names: string[];
  try {
    names = readdirSync(CHAT_DIR);
  } catch {
    return []; // dir doesn't exist yet → no sessions
  }
  const out: ChatSessionMeta[] = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue; // skip .tmp / .broken
    const id = name.slice(0, -'.json'.length);
    if (!isUuid(id)) continue; // only UUID-named files are sessions
    const target = pathFor(id);
    let raw: string;
    try {
      raw = readFileSync(target, 'utf-8');
    } catch {
      continue;
    }
    try {
      const parsed = JSON.parse(raw) as PersistedSession;
      if (!parsed || !Array.isArray(parsed.messages)) {
        quarantine(target);
        continue;
      }
      // Clamp the on-disk title on READ too (not just on rename-write): a hand-edited
      // or corrupt file must not push an oversized / control-char title into the UI.
      const rawTitle = typeof parsed.title === 'string' && parsed.title
        ? parsed.title
        : deriveTitle(parsed.messages);
      out.push({
        id,
        title: rawTitle.replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 200),
        updated: Number(parsed.updated) || 0,
      });
    } catch (err) {
      console.error('[chat-session-store] corrupt session in list, quarantining', target, err);
      quarantine(target);
    }
  }
  out.sort((a, b) => b.updated - a.updated);
  return out;
}

/** Rename a session: writes a `title` FIELD inside the JSON. The filename stays the
 *  UUID. Coordinates with the debounce so it never loses to (or against) an in-flight
 *  save: the custom title is recorded in titleOverride immediately, so a pending save
 *  persists it instead of re-deriving, and a brand-new (not-yet-flushed) session can be
 *  renamed before its file exists. */
export function renameSession(id: string, newTitle: string): void {
  pathFor(id); // isUuid + assertInsideDir (throws on a non-UUID id, like load)
  const title = String(newTitle ?? '').trim().replace(/\s+/g, ' ').slice(0, 200) || 'Untitled chat';

  // Record the override FIRST so any pending/future debounced save uses it (defeats the
  // lost-update race where a save fired after a rename would clobber the title).
  titleOverride.set(id, title);

  // If a save is already pending, the override is enough — that flush will apply the
  // title. Don't read-modify-write the (possibly not-yet-written) file underneath it.
  if (pending.has(id)) return;

  const target = pathFor(id);
  let parsed: PersistedSession;
  try {
    parsed = JSON.parse(readFileSync(target, 'utf-8')) as PersistedSession;
  } catch (err) {
    // File not on disk yet (brand-new session) or unreadable: the override is retained
    // and the next save will apply it. Nothing more to do.
    console.error('[chat-session-store] rename: load failed (title override retained)', err);
    return;
  }
  if (!parsed || !Array.isArray(parsed.messages)) {
    console.error('[chat-session-store] rename: corrupt session, skipping', target);
    return;
  }
  try {
    writeSessionAtomic(id, { ...parsed, title, updated: Date.now() });
  } catch (err) {
    console.error('[chat-session-store] rename: write failed', err);
  }
}

/** Delete a session file. isUuid + assertInsideDir guard the path. Also cancels any
 *  pending debounced save so a delete isn't immediately re-created. Never throws. */
export function deleteSession(id: string): void {
  const pendingTimer = pending.get(id);
  if (pendingTimer) {
    clearTimeout(pendingTimer);
    pending.delete(id);
  }
  titleOverride.delete(id); // drop any rename override so a reused UUID starts clean
  let target: string;
  try {
    target = pathFor(id); // isUuid + assertInsideDir
  } catch (err) {
    console.error('[chat-session-store] delete: bad id', err);
    return;
  }
  try {
    unlinkSync(target);
  } catch (err) {
    console.error('[chat-session-store] delete failed', err);
  }
}

// Test-only escape hatch: lets the test suite flush a pending debounced save
// without waiting the full window (vitest fake timers cover the timing test
// separately). Kept tiny + side-effect-free for production.
export function __getChatDir(): string {
  return CHAT_DIR;
}
