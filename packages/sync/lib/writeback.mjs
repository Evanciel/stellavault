// G2 — conflict-aware write-back (push) for the Notion → Obsidian sync.
//
// The sync is one-way (Notion → Obsidian) but the local vault is editable, so a naive
// "Notion changed → overwrite the local .md" silently destroys local edits. This module
// guards every write: it fingerprints what it wrote, and on a later Notion change it
// re-hashes the on-disk file. If the user edited it, the local file is NEVER touched —
// the incoming Notion version goes to a provenance-marked sidecar and the conflict is
// PUSHED (machine queue + a vault note + an end-of-run log line) instead of swallowed.
//
// Pure of Notion: everything here is filesystem + hashing, so it is unit-testable against
// a temp dir without any network. sync-to-obsidian.mjs wires the Notion fetch around it.
//
// Design Ref: G2 write-back conflict-push (ultracode design + 3-lens data-integrity critique).

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// Frontmatter sentinel so we never clobber a real user file that happens to share an
// artifact name, and so we can recognise OUR own sidecars/backups across runs.
export const ARTIFACT_SENTINEL = 'stellavault_artifact';

// ─── hashing / path helpers ──────────────────────────────────────────────────
export function hashBytes(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}
// Hash a file's CURRENT on-disk bytes; null if missing/unreadable (never throws).
export function hashFile(p) {
  try { return hashBytes(fs.readFileSync(p)); } catch { return null; }
}
// Vault-relative, forward-slash, NFC-normalised path (a Korean-heavy vault drifts
// NFC/NFD on disk; without normalising, the same note reads as a permanent relocation).
export function normRel(root, p) {
  return path.relative(root, p).split(path.sep).join('/').normalize('NFC');
}
// Path equality: NFC always; case-insensitive on Windows (NTFS is case-insensitive).
export function samePath(a, b) {
  if (a == null || b == null) return false;
  const na = a.normalize('NFC');
  const nb = b.normalize('NFC');
  return process.platform === 'win32' ? na.toLowerCase() === nb.toLowerCase() : na === nb;
}
const pathKey = (rel) => (process.platform === 'win32' ? rel.normalize('NFC').toLowerCase() : rel.normalize('NFC'));

// ─── atomic writes (a torn .md on the skip path is never re-checked = silent corruption) ──
export function atomicWriteFile(p, content) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, content, 'utf-8');
  fs.renameSync(tmp, p);
}

// Write one of OUR artifacts (sidecar/backup) with a provenance sentinel. If a same-named
// file exists WITHOUT our sentinel it is a real user file → never clobber it; fall back to
// `<base>.2.md`. Returns the relative path actually written (for the conflict record).
function writeArtifact(root, basePath, body, sentinelType, meta = {}) {
  const isOurs = (fp) => {
    try {
      const head = fs.readFileSync(fp, 'utf-8').slice(0, 400);
      return head.includes(`${ARTIFACT_SENTINEL}: ${sentinelType}`);
    } catch { return false; }
  };
  let target = basePath;
  if (fs.existsSync(target) && !isOurs(target)) {
    const dir = path.dirname(basePath);
    const ext = path.extname(basePath);
    const stem = path.basename(basePath, ext);
    target = path.join(dir, `${stem}.2${ext}`);
  }
  const fm = [
    '---',
    `${ARTIFACT_SENTINEL}: ${sentinelType}`,
    ...Object.entries(meta).map(([k, v]) => `${k}: ${JSON.stringify(v)}`),
    '---',
    '',
  ].join('\n');
  atomicWriteFile(target, fm + body);
  return normRel(root, target);
}

// ─── state IO: atomic + .bak fallback, never process.exit on a torn read ──────
export function loadSyncState(stateFile, log = console.warn) {
  const parse = (fp) => JSON.parse(fs.readFileSync(fp, 'utf-8'));
  let data = null;
  if (fs.existsSync(stateFile)) {
    try { data = parse(stateFile); }
    catch (e) {
      log(`⚠️ .sync-state.json parse failed (${e.message}); trying .bak`);
      try { data = parse(`${stateFile}.bak`); }
      catch { log('⚠️ .bak also unreadable; starting from empty state (no data lost — fingerprints rebuild)'); }
    }
  }
  if (!data || typeof data !== 'object') data = {};
  if (!data.pages) data.pages = {};
  if (!data.children) data.children = {};
  if (!data.local) data.local = {};        // G2: per-page on-disk fingerprint
  if (!data.tombstones) data.tombstones = {}; // G2: accepted local deletions
  if (!('lastSync' in data)) data.lastSync = null;
  return data;
}
export function saveSyncState(stateFile, state) {
  state.lastSync = new Date().toISOString();
  if (fs.existsSync(stateFile)) { try { fs.copyFileSync(stateFile, `${stateFile}.bak`); } catch { /* best effort */ } }
  atomicWriteFile(stateFile, JSON.stringify(state, null, 2));
}

// ─── conflict queue (push layer 1) ───────────────────────────────────────────
// Merge-forward: a one-shot reason (relocated / no-baseline-overwrite / path-collision) that
// fired on an earlier run but isn't re-detected this run must survive until the human acks it,
// or a daemon run 5 min later wipes the notice before they wake up. Edit/delete conflicts are
// re-detected each run, and a resolved id is explicitly dropped by the caller (resolvedIds).
const ONE_SHOT = new Set(['relocated', 'no-baseline-overwrite', 'path-collision']);
export function mergeConflictQueue(prior, fresh, resolvedIds, now) {
  const byId = new Map();
  for (const c of (prior?.conflicts ?? [])) {
    if (resolvedIds.has(c.notionId)) continue;          // user reconciled → drop
    if (ONE_SHOT.has(c.reason) && !c.acknowledged) byId.set(c.notionId, c); // carry forward
  }
  for (const c of fresh) byId.set(c.notionId, { ...c, detectedAt: c.detectedAt ?? now }); // fresh wins (last-write per id)
  const conflicts = [...byId.values()].filter((c) => !c.acknowledged);
  return { generatedAt: now, count: conflicts.length, conflicts };
}

const RESOLVE_HINT = {
  'edit-conflict': 'diff against the *.notion-conflict.md sidecar, then DELETE the sidecar to accept your local version',
  'edit-conflict-relocated': 'the Notion page was renamed AND your old-path file has edits — merge from the sidecar, then delete it',
  'local-deleted': 'you deleted this note locally — delete the sidecar to confirm the deletion (it stops re-appearing)',
  'no-baseline-overwrite': 'first guarded sync overwrote this; your prior version is in *.pre-sync-backup.md — delete it once reviewed',
  'relocated': 'the Notion page moved/renamed; a stale copy may remain at the old path — delete it once confirmed',
  'path-collision': 'two Notion pages map to the same filename — rename one in Notion to separate them',
};
export function renderConflictNote(queue) {
  const now = queue.generatedAt;
  if (!queue.conflicts.length) {
    return `---\n${ARTIFACT_SENTINEL}: sync-conflicts\ngenerated_at: ${JSON.stringify(now)}\n---\n\n# Sync conflicts\n\n✅ No sync conflicts as of ${now}.\n`;
  }
  const rows = queue.conflicts.map((c) =>
    `| ${c.title.replace(/\|/g, '\\|')} | \`${c.reason}\` | \`${c.relPath}\` | ${c.sidecarRelPath ? `\`${c.sidecarRelPath}\`` : c.backupRelPath ? `\`${c.backupRelPath}\`` : '—'} | ${c.detectedAt} |`,
  );
  const hints = [...new Set(queue.conflicts.map((c) => c.reason))]
    .map((r) => `- **${r}** — ${RESOLVE_HINT[r] ?? 'review manually'}`);
  return [
    `---`, `${ARTIFACT_SENTINEL}: sync-conflicts`, `generated_at: ${JSON.stringify(now)}`, `count: ${queue.count}`, `---`, ``,
    `# ⚠️ Sync conflicts (${queue.count})`, ``,
    `These local notes diverged from Notion. **Your local edits were preserved** — nothing was overwritten.`, ``,
    `| Note | Reason | Your file | Notion / backup | Detected |`,
    `| --- | --- | --- | --- | --- |`,
    ...rows, ``,
    `## How to resolve`, ``, ...hints, ``,
  ].join('\n');
}

// ─── the guarded write — the heart of G2 ─────────────────────────────────────
// opts: { root, targetPath, content, rawMarkdown, id, title, leaf, state, conflicts,
//         claimedPaths (Map relKey→id), priorConflictIds (Set), now }
// Returns { wrote, conflicted }. The caller advances state.pages/children ONLY when !conflicted.
export function guardedWrite(opts) {
  const { root, targetPath, content, rawMarkdown, id, title, leaf, state, conflicts, claimedPaths, priorConflictIds, now } = opts;
  const relPath = normRel(root, targetPath);
  const enqueue = (rec) => conflicts.push({ notionId: id, title, relPath, detectedAt: now, acknowledged: false, ...rec });

  // GATE 0 — conversion failure: zero side effects, do NOT advance (retry next run).
  if (typeof rawMarkdown === 'string' && rawMarkdown.startsWith('> 변환 실패')) {
    return { wrote: false, conflicted: true };
  }

  // PATH-COLLISION — two Notion pages sanitise to one file. Don't let them clobber each
  // other into an endless edit-conflict; surface it. (intra-run + cross-run check)
  const key = pathKey(relPath);
  const claimedBy = claimedPaths.get(key);
  if (claimedBy && claimedBy !== id) {
    enqueue({ reason: 'path-collision', collidesWith: claimedBy });
    return { wrote: false, conflicted: true };
  }
  for (const [otherId, loc] of Object.entries(state.local)) {
    if (otherId !== id && loc && samePath(loc.relPath, relPath)) {
      enqueue({ reason: 'path-collision', collidesWith: otherId });
      return { wrote: false, conflicted: true };
    }
  }

  const writeClean = () => {
    atomicWriteFile(targetPath, content);
    state.local[id] = { hash: hashFile(targetPath), relPath, leaf, syncedAt: now };
    claimedPaths.set(key, id);
  };

  const baseline = state.local[id];

  // RELOCATION / RENAME — the path or leaf-ness changed since the last fingerprint.
  if (baseline && (baseline.leaf !== leaf || !samePath(baseline.relPath, relPath))) {
    const oldPath = path.join(root, baseline.relPath);
    const oldHash = hashFile(oldPath);
    if (oldHash === null || oldHash === baseline.hash) {
      // 6a — no unmerged edits at the old path: safe to relocate. Clean-write at the new path
      // and re-fingerprint there (do NOT run evaluateAtPath — its baseline is the OLD path, so a
      // missing new-path file would be misread as a local deletion). PERSISTENTLY note the stale
      // old copy so the user can remove it. The old file is left in place (never auto-deleted).
      writeClean();
      enqueue({ reason: 'relocated', oldRelPath: baseline.relPath });
      return { wrote: true, conflicted: false };
    }
    // 6b — old file has divergent local edits: a REAL conflict. Sidecar at the OLD path,
    // freeze. Never tell the user to delete their own edited orphan.
    const sidecarRelPath = writeArtifact(root, oldPath.replace(/\.md$/i, '.notion-conflict.md'), content, 'notion-conflict', { notion_id: id, notion_last_edited: opts.notionLastEdited ?? null });
    enqueue({ reason: 'edit-conflict-relocated', oldRelPath: baseline.relPath, sidecarRelPath });
    return { wrote: false, conflicted: true };
  }

  return evaluateAtPath();

  // The clean/conflict decision AT the current targetPath (shared by the normal path and 6a).
  function evaluateAtPath() {
    const fileExists = fs.existsSync(targetPath);

    // NO-BASELINE — we have no fingerprint to prove the user didn't edit.
    if (!baseline) {
      if (!fileExists) { writeClean(); return { wrote: true, conflicted: false }; } // true first sync
      // File exists but unguarded: back it up ONCE, then overwrite + fingerprint. Low severity.
      const backupRelPath = writeArtifact(root, targetPath.replace(/\.md$/i, '.pre-sync-backup.md'), fs.readFileSync(targetPath, 'utf-8'), 'pre-sync-backup', { notion_id: id });
      writeClean();
      enqueue({ reason: 'no-baseline-overwrite', backupRelPath });
      return { wrote: true, conflicted: false };
    }

    // LOCAL-DELETED — fingerprint exists, file gone.
    if (!fileExists) {
      const tomb = state.tombstones[id];
      if (tomb && samePath(tomb.relPath, baseline.relPath)) return { wrote: false, conflicted: false }; // accepted deletion → settle
      const sidecarRelPath = writeArtifact(root, targetPath.replace(/\.md$/i, '.notion-conflict.md'), content, 'notion-conflict', { notion_id: id, notion_last_edited: opts.notionLastEdited ?? null });
      enqueue({ reason: 'local-deleted', sidecarRelPath });
      return { wrote: false, conflicted: true };
    }

    const curHash = hashFile(targetPath);
    if (curHash === baseline.hash) { writeClean(); return { wrote: true, conflicted: false }; } // CLEAN

    // EDIT-CONFLICT — local file diverged from our last write.
    const sidecarPath = targetPath.replace(/\.md$/i, '.notion-conflict.md');
    const sidecarExists = fs.existsSync(sidecarPath);
    // RESOLUTION-ADOPT — we recorded a conflict for this id before AND the sidecar is now gone:
    // the user merged Notion into their file and deleted the sidecar → re-baseline + advance.
    if (priorConflictIds.has(id) && !sidecarExists) {
      state.local[id] = { hash: curHash, relPath, leaf, syncedAt: now };
      claimedPaths.set(key, id);
      return { wrote: false, conflicted: false };
    }
    const sidecarRelPath = writeArtifact(root, sidecarPath, content, 'notion-conflict', { notion_id: id, notion_last_edited: opts.notionLastEdited ?? null });
    enqueue({ reason: 'edit-conflict', sidecarRelPath });
    return { wrote: false, conflicted: true };
  }
}

// Record tombstones for deletions the user has accepted (sidecar deleted while file still gone),
// so an intentional local delete settles instead of resurrecting a sidecar every run.
export function reconcileTombstones(root, state, now) {
  for (const [id, loc] of Object.entries(state.local)) {
    if (!loc) continue;
    const filePath = path.join(root, loc.relPath);
    const sidecarPath = filePath.replace(/\.md$/i, '.notion-conflict.md');
    if (!fs.existsSync(filePath) && !fs.existsSync(sidecarPath) && !state.tombstones[id]) {
      state.tombstones[id] = { relPath: loc.relPath, ackAt: now };
    }
  }
}
