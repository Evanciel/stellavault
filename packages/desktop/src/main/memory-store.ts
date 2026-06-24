// Stellavault Desktop — Agent Memory Store (main process, P1)
// Design Ref: §2.1, §3.1, §3.2, §3.5, §10-a (LOCKED: off-vault blocks.json thin helper).
//
// Durable user MODEL (preferences / environment / project context) for the local agent.
// Stored OFF-VAULT at ~/.stellavault/memory/blocks.json — deliberately OUTSIDE the synced
// vault so a poisoned Notion↔Obsidian note can never RAG-launder itself into the permanent,
// every-turn-reinjected user model (§2.1 threat-model-driven split; §10-a rejects in-vault
// MEMORY.md). Clones chat-session-store.ts's atomic-write / 0o700 / quarantine primitives.
//
// P1 scope (§8):
//  - READ surface only on the model side: recall_memory (a READ tool) + always-injected pinned
//    facts. There is NO model-callable WRITE tool in P1 — appendBlock() is a THIN INTERNAL
//    helper (not advertised to the model), so "zero new WRITE tools" holds. The confirm-gated
//    core_memory_* WRITE tools are P2.
//  - pinned-only: every pinned user fact is injected each turn (small, capped). Non-pinned
//    semantic recall (embedding + FSRS fusion) is deferred (§3.2 / §10-e).
//
// Security invariants:
//  - Every fs touch runs assertInsideDir(MEM_DIR, …) (path-safety) + 0o700 dir perms.
//  - Bounds are FAIL-CLOSED (§3.1 / SEC-4): a write that would breach MAX_BLOCKS / MAX_PINNED
//    / MAX_FILE_BYTES is REJECTED (throws), never silently truncated.
//  - looksLikeSecret() (§3.1 / SEC-5): durable memory is permanent + reinjected every turn, so
//    a secret-shaped block is DROPPED at write time (store-then-redact is NOT enough here —
//    unlike the chat store's belt-and-braces redact()).
//  - Every fact's text is run through scanForInjection BEFORE it reaches a prompt / a tool
//    result (§3.5). The live blocks.json is never rewritten — only the snapshot copy.

import { app } from 'electron';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, renameSync } from 'node:fs';
import { assertInsideDir } from './path-safety.js';
import { scanForInjection } from './injection-scan.js';
import type { MemoryProvenance, MemoryBlockMeta } from '../shared/ipc-types.js';

export type { MemoryProvenance, MemoryBlockMeta };

const MEM_DIR = join(app.getPath('home'), '.stellavault', 'memory');
const BLOCKS_FILE = join(MEM_DIR, 'blocks.json');
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True for a block id we minted (randomUUID). The delete IPC validates with this so a
 *  renderer can only target an opaque UUID it received from memory:list (§6 INT-8). */
export function isMemoryId(id: unknown): id is string {
  return typeof id === 'string' && UUID_RE.test(id);
}

// ── Bounds (§3.1 SEC-4 — all FAIL-CLOSED) ─────────────────────────────────────
export const MEM_MAX_BLOCKS = 256;
export const MEM_MAX_PINNED = 32;
export const MEM_MAX_FILE_BYTES = 256 * 1024;
// Injection budget (~0.25 tok/char → ~1600 chars). The pinned block is small by design;
// over-budget pinned facts are dropped recency-first (newest kept) at render time.
export const MEMORY_TOKEN_BUDGET = 400;

export interface MemoryBlock {
  id: string;
  tag?: string;
  text: string;
  pinned: boolean;
  created: number;
  updated: number;
  provenance: MemoryProvenance;
}

interface MemoryRecord {
  blocks: MemoryBlock[];
  version: 1;
}

const EMPTY: MemoryRecord = { blocks: [], version: 1 };

// ── looksLikeSecret (§3.1 SEC-5 — fail-closed DROP, not redact) ───────────────
// Broader than the chat store's redact(): durable memory is permanent + reinjected, so any
// secret-SHAPED block is refused outright. Covers the chat store's 4 prefixes plus Bearer/JWT,
// AWS AKIA, GitHub ghp_/gho_, PEM blocks, and bare high-entropy hex/base64 runs.
const SECRET_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9_-]{16,}/,            // OpenAI / Anthropic
  /\bkey-[A-Za-z0-9_-]{16,}/,         // generic key- prefix
  /AIza[A-Za-z0-9_-]{20,}/,           // Google
  /xox[baprs]-[A-Za-z0-9-]{10,}/,     // Slack
  /\bBearer\s+[A-Za-z0-9._-]{16,}/i,  // bearer tokens
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}/, // JWT (eyJ… header.payload.sig)
  /\bAKIA[0-9A-Z]{16}\b/,             // AWS access key id
  /\bgh[pous]_[A-Za-z0-9]{20,}/,      // GitHub PAT/OAuth (ghp_/gho_/ghu_/ghs_)
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/, // PEM private key
  /\b[0-9a-fA-F]{40,}\b/,             // bare 40+ hex (sha1+/api hashes)
];

// A 64+ char base64 run, but ONLY when it has the entropy signature of a real credential blob
// (mixed case AND a digit). Plain prose, an all-lowercase Unix/URL path (which contains '/',
// a base64 char), or an all-digit id therefore do NOT trip the credential heuristic — fixes the
// long-path false positive while still catching key/cert blobs.
function hasHighEntropyBlob(text: string): boolean {
  const m = text.match(/[A-Za-z0-9+/]{64,}={0,2}/);
  if (!m) return false;
  const run = m[0];
  return /[a-z]/.test(run) && /[A-Z]/.test(run) && /[0-9]/.test(run);
}

/** True if `text` looks like it contains a secret. Enforced at WRITE time (DROP the block) AND
 *  re-checked on the read/inject path (defense in depth — a hand-edited / restored blocks.json
 *  must not reinject a secret into the every-turn system prompt). */
export function looksLikeSecret(text: string): boolean {
  return SECRET_PATTERNS.some((re) => re.test(text)) || hasHighEntropyBlob(text);
}

// ── path / io primitives (cloned from chat-session-store.ts) ──────────────────
function ensureDir(): void {
  mkdirSync(MEM_DIR, { recursive: true, mode: 0o700 });
}

function quarantine(target: string): void {
  try { renameSync(target, `${target}.broken`); } catch { /* best-effort */ }
}

/** Read + parse blocks.json. Corrupt file → quarantine to '.broken' + return EMPTY (never
 *  throws, never deletes). Missing file → EMPTY. */
export function readStore(): MemoryRecord {
  const target = assertInsideDir(MEM_DIR, BLOCKS_FILE);
  let raw: string;
  try {
    raw = readFileSync(target, 'utf-8');
  } catch {
    return { blocks: [], version: 1 };
  }
  try {
    const parsed = JSON.parse(raw) as MemoryRecord;
    if (!parsed || !Array.isArray(parsed.blocks)) {
      quarantine(target);
      return { blocks: [], version: 1 };
    }
    // Coerce each row defensively (a hand-edited file must not push junk downstream).
    const blocks: MemoryBlock[] = parsed.blocks
      .filter((b): b is MemoryBlock => !!b && typeof (b as MemoryBlock).text === 'string')
      .map((b) => ({
        id: typeof b.id === 'string' ? b.id : randomUUID(),
        tag: typeof b.tag === 'string' ? b.tag : undefined,
        text: String(b.text),
        pinned: b.pinned === true,
        created: Number(b.created) || 0,
        updated: Number(b.updated) || 0,
        provenance: (b.provenance as MemoryProvenance) || 'user',
      }));
    return { blocks, version: 1 };
  } catch (err) {
    console.error('[memory-store] corrupt blocks.json, quarantining', err);
    quarantine(target);
    return { blocks: [], version: 1 };
  }
}

function writeStoreAtomic(record: MemoryRecord): void {
  ensureDir();
  const target = assertInsideDir(MEM_DIR, BLOCKS_FILE);
  const serialized = JSON.stringify(record, null, 2);
  // FAIL-CLOSED file-size bound: refuse a write that would breach the cap (§3.1 SEC-4).
  if (Buffer.byteLength(serialized, 'utf-8') > MEM_MAX_FILE_BYTES) {
    throw new Error('memory store full (file size cap)');
  }
  const tmp = `${target}.${randomUUID()}.tmp`;
  writeFileSync(tmp, serialized, 'utf-8');
  renameSync(tmp, target);
}

// ── thin write helper (P1: INTERNAL only — not a model tool) ──────────────────
export interface AppendBlockInput {
  text: string;
  tag?: string;
  pinned?: boolean;
  provenance?: MemoryProvenance;
}

/** Append a durable memory block. FAIL-CLOSED on every bound + secret check. Returns the
 *  stored block. NOT advertised to the model in P1 (zero new WRITE tools) — exercised by the
 *  UI/IPC + core_memory_* tools in P2. Throws on a bound breach / secret-shaped text. */
export function appendBlock(input: AppendBlockInput): MemoryBlock {
  const text = String(input.text ?? '').trim();
  if (!text) throw new Error('memory block text is required');
  if (looksLikeSecret(text)) throw new Error('memory block looks like a secret — not stored');

  const record = readStore();
  if (record.blocks.length >= MEM_MAX_BLOCKS) throw new Error('memory store full (block count cap)');
  const pinned = input.pinned !== false; // P1 facts default to pinned (always-injected)
  if (pinned && record.blocks.filter((b) => b.pinned).length >= MEM_MAX_PINNED) {
    throw new Error('pinned memory full (pin cap)');
  }
  const now = Date.now();
  const block: MemoryBlock = {
    id: randomUUID(),
    tag: input.tag ? String(input.tag).slice(0, 120) : undefined,
    text,
    pinned,
    created: now,
    updated: now,
    provenance: input.provenance ?? 'user',
  };
  writeStoreAtomic({ blocks: [...record.blocks, block], version: 1 });
  return block;
}

// ── read / inject surfaces ────────────────────────────────────────────────────
/** Pinned, provenance==='user' blocks, newest-first. Only user-provenance facts may reach the
 *  trusted system role (§3.2 / INT-6); reflection/skill provenance is excluded here. A
 *  secret-shaped block is also dropped HERE (not just at write time) so a hand-edited /
 *  restored blocks.json can never reinject a secret into the every-turn prompt (SEC-5). */
function pinnedUserBlocks(): MemoryBlock[] {
  return readStore()
    .blocks.filter((b) => b.pinned && b.provenance === 'user' && !looksLikeSecret(b.text))
    .sort((a, b) => b.updated - a.updated);
}

/** Run a block's text through the injection scanner (§3.5). Snapshot-only — the live store is
 *  never rewritten. */
function sanitize(text: string): string {
  return scanForInjection(text).clean;
}

/** Render the always-injected Core Memory block for the system prompt (§3.2 / §3.4). Pinned
 *  user facts, injection-scanned, recency-first, capped to MEMORY_TOKEN_BUDGET (newest kept).
 *  Returns '' when there is nothing to inject. Caller splices the result into buildSystemPrompt
 *  (covers BOTH the agent loop and the cloud/single-shot path — §4.5). */
export function buildCoreMemoryBlock(): string {
  const blocks = pinnedUserBlocks();
  if (blocks.length === 0) return '';
  const maxChars = Math.floor(MEMORY_TOKEN_BUDGET / 0.25); // ~4 chars/token
  const header = '=== Core Memory (durable facts the user told you) ===';
  const lines: string[] = [];
  let used = header.length;
  for (const b of blocks) {
    const line = `- ${sanitize(b.text)}`;
    if (used + line.length + 1 > maxChars) break; // recency-first: drop the oldest tail
    lines.push(line);
    used += line.length + 1;
  }
  if (lines.length === 0) return '';
  return [header, ...lines].join('\n');
}

export interface RecalledMemory {
  /** Opaque block UUID — the handle the model passes to core_memory_replace (P2). Off-vault
   *  store id, NOT a vault path, so exposing it leaks nothing sensitive. */
  id: string;
  tag?: string;
  text: string;
  provenance: MemoryProvenance;
}

/** recall_memory tool backend. P1 = pinned-only: returns the pinned user facts (injection-
 *  scanned; id/tag/text/provenance), capped to `k`. The `id` lets the model target a fact with
 *  core_memory_replace (P2). The query is accepted for forward compatibility but does NOT drive
 *  selection in P1 (non-pinned semantic recall is §10-e). */
export function recallMemory(_query: string, k?: number): { memories: RecalledMemory[] } {
  const limit = Number.isFinite(k) && (k as number) > 0 ? Math.floor(k as number) : 8;
  const memories = pinnedUserBlocks()
    .slice(0, limit)
    .map((b) => ({ id: b.id, tag: b.tag, text: sanitize(b.text), provenance: b.provenance }));
  return { memories };
}

// ── P2 model-driven WRITE backends (core_memory_* tools, force-confirm gated) ──
// These ARE reached from the agent loop, but ONLY after the force-confirm gate approved the
// write (chat-engine.ts) — they never run unattended (distill has no approver → fail-closed).

/** core_memory_append({text}) backend. Appends a NEW pinned user fact. Reuses appendBlock's
 *  fail-closed bounds + looksLikeSecret drop. Returns a thin ack (id only — never echoes a
 *  secret). Throws on a bound breach / secret-shaped text (surfaced to the model as an error). */
export function coreMemoryAppend(text: string): { ok: true; id: string } {
  const block = appendBlock({ text, pinned: true, provenance: 'user' });
  return { ok: true, id: block.id };
}

/** Apply a SINGLE literal replacement by index — NOT String.replace, which would interpret
 *  `$&`/`$1`/`$\``/`$'` patterns in `newStr` and persist text DIFFERENT from what the user
 *  approved (a silent fact-flip into the every-turn system prompt). Returns the result plus the
 *  literal-match count so the caller rejects an ambiguous (0 / 2+) match. Pure. */
function computeReplacement(text: string, oldStr: string, newStr: string): { after: string; count: number } {
  let count = 0;
  for (let i = text.indexOf(oldStr); i !== -1; i = text.indexOf(oldStr, i + oldStr.length)) count++;
  const idx = text.indexOf(oldStr);
  const after = idx === -1 ? text : text.slice(0, idx) + newStr + text.slice(idx + oldStr.length);
  return { after, count };
}

/** core_memory_replace({id,old,new}) backend (§3.3 SEC-7). The model MUST name the block `id`.
 *  `old` must match EXACTLY ONCE in that block (0 or 2+ → reject — no ambiguous fact-flip).
 *  A user-provenance block is NEVER edited in place: this APPENDS a corrected block and
 *  SUPERSEDES (removes) the old one atomically (append+supersede), so the confirm UI shows a
 *  clean before/after and the change is logged. Throws on every guard failure. */
export function coreMemoryReplace(id: string, oldStr: string, newStr: string): { ok: true; supersededId: string; newId: string } {
  if (!isMemoryId(id)) throw new Error('core_memory_replace: a valid block id is required');
  const o = String(oldStr ?? '');
  if (!o) throw new Error('core_memory_replace: "old" text is required');
  const record = readStore();
  const target = record.blocks.find((b) => b.id === id);
  if (!target) throw new Error('core_memory_replace: no block with that id');
  const { after, count } = computeReplacement(target.text, o, String(newStr ?? ''));
  if (count === 0) throw new Error('core_memory_replace: "old" not found in that block');
  if (count > 1) throw new Error('core_memory_replace: "old" matches multiple times — be more specific');
  const newText = after.trim();
  if (!newText) throw new Error('core_memory_replace: result would be empty');
  if (looksLikeSecret(newText)) throw new Error('core_memory_replace: result looks like a secret — not stored');
  const now = Date.now();
  const fresh: MemoryBlock = {
    id: randomUUID(),
    tag: target.tag,
    text: newText,
    pinned: target.pinned,
    created: now,
    updated: now,
    // Inherit the source block's provenance — a faithful append+supersede correction must NOT
    // relabel (e.g. a 'reflection' fact silently escalating into the trusted 'user' tier, §3.2).
    provenance: target.provenance,
  };
  // append + supersede: drop the old block, add the corrected one (one atomic write).
  const blocks = record.blocks.filter((b) => b.id !== id);
  blocks.push(fresh);
  writeStoreAtomic({ blocks, version: 1 });
  console.log(`[memory-store] core_memory_replace supersede ${id} → ${fresh.id}`);
  return { ok: true, supersededId: id, newId: fresh.id };
}

/** Human-readable confirm-preview for a force-confirm memory write (§3.3 SEC-7). The confirm UI
 *  must show the FULL before/after fact + provenance (not just the raw {id,old,new} diff args) so
 *  a fact-flip is visible. Uses the SAME computeReplacement transform as the write, so the
 *  approved preview and the persisted text can never drift. Returns '' for a non-memory tool. */
export function describeMemoryWrite(name: string, args: Record<string, unknown>): string {
  if (name === 'core_memory_append') {
    return `Save a NEW durable memory fact:\n"${String(args.text ?? '').slice(0, 500)}"`;
  }
  if (name === 'core_memory_replace') {
    const id = String(args.id ?? '');
    const block = getBlock(id);
    if (!block) return `Update memory — but no block with id "${id}" exists.`;
    const { after, count } = computeReplacement(block.text, String(args.old ?? ''), String(args.new ?? ''));
    if (count !== 1) return `Update memory — "old" must match exactly once (matched ${count}×).`;
    return `Update durable memory (provenance: ${block.provenance}):\nBEFORE: "${block.text}"\nAFTER:  "${after.trim()}"`;
  }
  return '';
}

// ── P2 management surface (memory:list / get / delete IPC backends) ────────────
function toMeta(b: MemoryBlock): MemoryBlockMeta {
  return { id: b.id, tag: b.tag, text: b.text, pinned: b.pinned, provenance: b.provenance, updated: b.updated };
}

/** All blocks for the management UI (newest-first). Raw text — the renderer DISPLAYS this (not a
 *  prompt), so it is not injection-scanned here; it lets the user see + delete even a hand-planted
 *  / secret-shaped block (which is otherwise dropped from injection). */
export function listBlocks(): MemoryBlockMeta[] {
  return readStore().blocks.map(toMeta).sort((a, b) => b.updated - a.updated);
}

/** One block by id, or null. Rejects a non-UUID id (no arbitrary lookup). */
export function getBlock(id: unknown): MemoryBlockMeta | null {
  if (!isMemoryId(id)) return null;
  const b = readStore().blocks.find((x) => x.id === id);
  return b ? toMeta(b) : null;
}

/** Delete a block by id. id-validated (§6 INT-8): the renderer can only delete an opaque UUID it
 *  got from memory:list, and only one that ACTUALLY EXISTS — never an arbitrary string. Returns
 *  false (no-op) on a bad/unknown id. Atomic write; never throws. */
export function deleteBlock(id: unknown): boolean {
  if (!isMemoryId(id)) return false;
  const record = readStore();
  const next = record.blocks.filter((b) => b.id !== id);
  if (next.length === record.blocks.length) return false; // id not present — nothing deleted
  try {
    writeStoreAtomic({ blocks: next, version: 1 });
    return true;
  } catch (err) {
    console.error('[memory-store] delete failed', err);
    return false;
  }
}

/** Test-only: the resolved memory dir (so the suite can assert the off-vault location). */
export function __getMemDir(): string {
  return MEM_DIR;
}
