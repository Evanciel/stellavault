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

const MEM_DIR = join(app.getPath('home'), '.stellavault', 'memory');
const BLOCKS_FILE = join(MEM_DIR, 'blocks.json');

// ── Bounds (§3.1 SEC-4 — all FAIL-CLOSED) ─────────────────────────────────────
export const MEM_MAX_BLOCKS = 256;
export const MEM_MAX_PINNED = 32;
export const MEM_MAX_FILE_BYTES = 256 * 1024;
// Injection budget (~0.25 tok/char → ~1600 chars). The pinned block is small by design;
// over-budget pinned facts are dropped recency-first (newest kept) at render time.
export const MEMORY_TOKEN_BUDGET = 400;

export type MemoryProvenance = 'user' | 'reflection' | `skill:${string}`;

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
  tag?: string;
  text: string;
  provenance: MemoryProvenance;
}

/** recall_memory tool backend. P1 = pinned-only: returns the pinned user facts (injection-
 *  scanned, title/text/provenance only), capped to `k`. The query is accepted for forward
 *  compatibility but does NOT drive selection in P1 (non-pinned semantic recall is §10-e). */
export function recallMemory(_query: string, k?: number): { memories: RecalledMemory[] } {
  const limit = Number.isFinite(k) && (k as number) > 0 ? Math.floor(k as number) : 8;
  const memories = pinnedUserBlocks()
    .slice(0, limit)
    .map((b) => ({ tag: b.tag, text: sanitize(b.text), provenance: b.provenance }));
  return { memories };
}

/** Test-only: the resolved memory dir (so the suite can assert the off-vault location). */
export function __getMemDir(): string {
  return MEM_DIR;
}
