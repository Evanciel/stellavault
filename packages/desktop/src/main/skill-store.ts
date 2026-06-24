// Stellavault Desktop — Skill Store (main process, P3)
// Design Ref: §4 (authoring/disclosure/invoke), §4.4 (provenance gate, LOCKED), §3.5 (scan).
//
// SKILLs are user-authored reusable recipes living as `<vault>/Skills/<name>.md` (Claude-Skills
// SKILL.md convention — YAML frontmatter {name, description} + markdown body). They are
// DELIBERATELY in the vault (portable, git-versioned, user-editable). The threat that buys: a
// synced Notion↔Obsidian note or a `git pull` can drop an ATTACKER-authored Skills/*.md whose
// `description` (≤1024 chars) would otherwise reach the system prompt every turn (injection +
// context-DoS). Defenses:
//  - PROVENANCE GATE (§4.4, hard lock): a skill is catalogued / loadable ONLY after the user
//    EXPLICITLY promotes it. The promoted set lives OFF-VAULT (~/.stellavault/skills/promoted.json)
//    so an attacker who controls the synced .md (incl. its frontmatter) can never self-promote.
//  - INJECTION SCAN (§3.5): every catalogued description AND every loaded body is scanForInjection'd
//    before it reaches a prompt snapshot.
//  - TOKEN CAPS: catalogue + body are char-capped (progressive disclosure protects gemma4:e4b).
//  - PATH SAFETY: a skill is resolved by matching the requested name against REAL directory
//    entries (never by building a path from the model-supplied name), then assertInsideVault'd.
//  - declarative-never-eval: a loaded body is inert TEXT pushed as a tool ack; the recipe's writes
//    must re-fire through the real confirm-gated WRITE tools. Nothing is ever eval'd.

import { app } from 'electron';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, renameSync, readdirSync } from 'node:fs';
import { assertInsideDir, assertInsideVault } from './path-safety.js';
import { scanForInjection } from './injection-scan.js';
import type { SkillMeta } from '../shared/ipc-types.js';

export type { SkillMeta };

const SKILL_REG_DIR = join(app.getPath('home'), '.stellavault', 'skills');
const PROMOTED_FILE = join(SKILL_REG_DIR, 'promoted.json');

// Token budgets (~0.25 tok/char). Catalogue is the always-injected Level-1; body is loaded on
// invoke (Level-2). Both deterministically truncated so a hostile/huge skill can't blow the window.
export const SKILL_CATALOGUE_BUDGET = 300; // tokens, ~1200 chars
export const SKILL_BODY_BUDGET = 800;      // tokens, ~3200 chars
export const SKILL_MAX_CATALOGUE = 12;     // hard cap on advertised skills (recency on disk order)
const DESC_MAX = 1024;                     // per-skill description clamp (matches SKILL.md convention)

// ── promoted registry (off-vault, the provenance gate) ────────────────────────
// CONTENT-BOUND (review #1): a promotion stores {name, hash} where hash = sha256 of the file's
// content AT PROMOTION TIME. The user consents to specific CONTENT, not a label. So a synced /
// git-pulled attacker file that SHADOWS a promoted name (same frontmatter `name`, different body)
// fails the hash check and is NOT catalogued / loadable; and OVERWRITING a promoted file changes
// its hash → un-consented until the user re-promotes. This closes the §4.4 name-collision bypass.
interface PromotedEntry { name: string; hash: string }
interface PromotedRecord { promoted: PromotedEntry[]; version: 1 }

function hashContent(s: string): string {
  return createHash('sha256').update(s, 'utf-8').digest('hex');
}

function ensureDir(): void {
  mkdirSync(SKILL_REG_DIR, { recursive: true, mode: 0o700 });
}

function readPromoted(): PromotedEntry[] {
  const target = assertInsideDir(SKILL_REG_DIR, PROMOTED_FILE);
  let raw: string;
  try { raw = readFileSync(target, 'utf-8'); } catch { return []; }
  try {
    const parsed = JSON.parse(raw) as PromotedRecord;
    if (!parsed || !Array.isArray(parsed.promoted)) return [];
    return parsed.promoted.filter(
      (e): e is PromotedEntry => !!e && typeof e.name === 'string' && typeof e.hash === 'string',
    );
  } catch {
    return []; // corrupt → nothing promoted (fail-closed: no skill catalogued)
  }
}

function writePromoted(entries: PromotedEntry[]): void {
  ensureDir();
  const target = assertInsideDir(SKILL_REG_DIR, PROMOTED_FILE);
  const tmp = `${target}.${randomUUID()}.tmp`;
  writeFileSync(tmp, JSON.stringify({ promoted: entries, version: 1 }, null, 2), 'utf-8');
  renameSync(tmp, target);
}

/** True if a (name, content) pair was explicitly promoted — name AND hash must match. */
function isPromoted(entries: PromotedEntry[], name: string, content: string): boolean {
  const h = hashContent(content);
  return entries.some((e) => e.name === name && e.hash === h);
}

/** Promote / un-promote a skill by name (the user's explicit consent — §4.4). Promotion binds to
 *  the file's CURRENT content hash; it is REJECTED when the name resolves to zero or MORE THAN ONE
 *  Skills/*.md (ambiguous → no consent — review #2). Returns the new promoted state. */
export function setSkillPromoted(vaultPath: string, name: string, promoted: boolean): boolean {
  const n = String(name ?? '').trim();
  if (!n) return false;
  let entries = readPromoted();
  if (!promoted) {
    // un-promote drops EVERY entry for that name (defensive — there is normally one).
    writePromoted(entries.filter((e) => e.name !== n));
    return false;
  }
  // promote: resolve the name to EXACTLY ONE current file, then bind its content hash.
  const matches = readSkillFiles(vaultPath).filter((f) => f.fm.name === n);
  if (matches.length !== 1) return false; // 0 = no such skill; 2+ = ambiguous → refuse to consent
  const hash = hashContent(matches[0].content);
  entries = entries.filter((e) => e.name !== n); // replace any prior binding for this name
  entries.push({ name: n, hash });
  writePromoted(entries);
  return true;
}

// ── vault Skills/ parsing ─────────────────────────────────────────────────────
const SKILLS_SUBDIR = 'Skills';

/** Take the scalar value of a frontmatter line: honor "double" / 'single' quotes (content kept
 *  verbatim), else strip a trailing YAML inline ` #comment` (review #6). */
function scalarValue(raw: string): string {
  const t = raw.trim();
  if (t.startsWith('"') && t.indexOf('"', 1) !== -1) return t.slice(1, t.indexOf('"', 1));
  if (t.startsWith("'") && t.indexOf("'", 1) !== -1) return t.slice(1, t.indexOf("'", 1));
  return t.replace(/\s+#.*$/, '').trim();
}

/** Parse the YAML frontmatter `name` + `description` (no YAML dep). Line-based so it handles
 *  quoted values, inline comments, and `>` / `|` block scalars whose text spans indented
 *  continuation lines (review #5/#6). Returns null if there is no usable name. */
function parseSkillFrontmatter(src: string): { name: string; description: string } | null {
  const m = src.match(/^﻿?---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  const lines = m[1].split(/\r?\n/);
  const fields: Record<string, string> = {};
  for (let i = 0; i < lines.length; i++) {
    const kv = lines[i].match(/^(name|description)\s*:\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1];
    const rawVal = kv[2];
    if (/^[>|][+-]?\s*$/.test(rawVal.trim())) {
      // block scalar — gather the following indented / blank continuation lines.
      const collected: string[] = [];
      for (let j = i + 1; j < lines.length; j++) {
        if (/^\s+\S/.test(lines[j])) collected.push(lines[j].trim());
        else if (lines[j].trim() === '') collected.push('');
        else break;
      }
      fields[key] = collected.join(' ').replace(/\s+/g, ' ').trim();
    } else {
      fields[key] = scalarValue(rawVal);
    }
  }
  const name = fields.name ?? '';
  if (!name) return null;
  return { name, description: (fields.description ?? '').slice(0, DESC_MAX) };
}

interface SkillFile { file: string; content: string; fm: { name: string; description: string } }

/** Read + parse every valid Skills/*.md once (shared by list/catalogue/load/promote). Never
 *  throws (missing dir → []). Names come from frontmatter, never the filename. */
function readSkillFiles(vaultPath: string): SkillFile[] {
  const dir = join(vaultPath, SKILLS_SUBDIR);
  let names: string[];
  try { names = readdirSync(dir); } catch { return []; }
  const out: SkillFile[] = [];
  for (const file of names) {
    if (!file.toLowerCase().endsWith('.md')) continue;
    let safe: string;
    try { safe = assertInsideVault(vaultPath, join(dir, file)); } catch { continue; }
    let content: string;
    try { content = readFileSync(safe, 'utf-8'); } catch { continue; }
    const fm = parseSkillFrontmatter(content);
    if (!fm) continue;
    out.push({ file, content, fm });
  }
  return out;
}

/** All Skills/*.md with their promoted state (content-bound — review #1) for the management UI. */
export function listAllSkills(vaultPath: string): SkillMeta[] {
  const entries = readPromoted();
  return readSkillFiles(vaultPath).map((s) => ({
    name: s.fm.name,
    description: s.fm.description,
    promoted: isPromoted(entries, s.fm.name, s.content),
  }));
}

/** The always-injected Level-1 catalogue (§4.2). PROMOTED skills ONLY (§4.4 gate). Each
 *  description is injection-scanned (§3.5) and the whole block is capped to SKILL_CATALOGUE_BUDGET
 *  + SKILL_MAX_CATALOGUE entries (deterministic truncation). Returns '' when nothing is eligible. */
export function buildSkillCatalogue(vaultPath: string): string {
  const eligible = listAllSkills(vaultPath).filter((s) => s.promoted).slice(0, SKILL_MAX_CATALOGUE);
  if (eligible.length === 0) return '';
  const header = '=== Available Skills (call invoke_skill with a name to load its steps) ===';
  const maxChars = Math.floor(SKILL_CATALOGUE_BUDGET / 0.25);
  const lines: string[] = [];
  let used = header.length;
  for (const s of eligible) {
    const desc = scanForInjection(s.description).clean;
    const line = `- ${scanForInjection(s.name).clean}: ${desc}`;
    if (used + line.length + 1 > maxChars) break;
    lines.push(line);
    used += line.length + 1;
  }
  if (lines.length === 0) return '';
  return [header, ...lines].join('\n');
}

/** Extract just the `## Steps` section (§10-c LOCKED — Steps only). When there is NO `## Steps`
 *  heading, return only the LEAD content before the first `## ` subheading (so Pitfalls / Examples
 *  / Notes, which always live under their own `## ` heading, are excluded — review #7). */
function extractSteps(body: string): string {
  const m = body.match(/^##\s+Steps\b[^\n]*\n/im);
  if (!m || m.index === undefined) {
    const firstH2 = body.search(/^##\s/m);
    return (firstH2 === -1 ? body : body.slice(0, firstH2)).trim();
  }
  const rest = body.slice(m.index + m[0].length);
  const next = rest.search(/\n##\s/); // up to the next h2 heading (or EOF)
  return (next === -1 ? rest : rest.slice(0, next)).trim();
}

/** Load a PROMOTED skill's body for invoke_skill (§4.3). CONTENT-BOUND (review #1): among files
 *  whose frontmatter name matches, ONLY the one whose content hash was promoted is loadable — so a
 *  same-named synced/attacker shadow file is never picked (no readdir-order hijack). Path-safe
 *  (name matched against real dir entries, never used to build a path; assertInsideVault). The
 *  body is `## Steps`-only, injection-scanned (allowToolNames), and char-capped. */
export function loadSkillBody(vaultPath: string, name: string): string | undefined {
  const want = String(name ?? '').trim();
  if (!want) return undefined;
  const entries = readPromoted();
  for (const s of readSkillFiles(vaultPath)) {
    if (s.fm.name !== want) continue;
    if (!isPromoted(entries, want, s.content)) continue; // §4.4: only the consented content loads
    const body = s.content.replace(/^﻿?---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
    const steps = extractSteps(body);
    // A PROMOTED, user-authored recipe legitimately names tools ("call search_vault"); strip only
    // role-spoof/override (BASE rules), not tool-name mentions. The body is inert (never eval'd).
    const clean = scanForInjection(steps, { allowToolNames: true }).clean;
    const maxChars = Math.floor(SKILL_BODY_BUDGET / 0.25);
    return clean.length > maxChars ? `${clean.slice(0, maxChars)}\n…(truncated)` : clean;
  }
  return undefined;
}

/** Test-only: the resolved off-vault registry dir. */
export function __getSkillRegDir(): string {
  return SKILL_REG_DIR;
}
