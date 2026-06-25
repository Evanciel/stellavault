// G2 write-back unit tests — guardedWrite + helpers against a temp dir (no Notion).
// Run: node --test packages/sync/test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  hashBytes, hashFile, normRel, samePath, atomicWriteFile,
  loadSyncState, saveSyncState, guardedWrite, mergeConflictQueue, renderConflictNote,
  reconcileTombstones, ARTIFACT_SENTINEL,
} from '../lib/writeback.mjs';

let counter = 0;
function freshRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'g2-')); // unique per call
  counter++;
  return root;
}
const NOW = '2026-06-25T00:00:00.000Z';
function emptyState() { return { lastSync: null, pages: {}, children: {}, local: {}, tombstones: {} }; }
// run guardedWrite with sensible defaults
function gw(root, state, over) {
  const conflicts = over.conflicts ?? [];
  const r = guardedWrite({
    root, content: 'NOTION-CONTENT', rawMarkdown: 'body', leaf: true,
    state, conflicts, claimedPaths: over.claimedPaths ?? new Map(),
    priorConflictIds: over.priorConflictIds ?? new Set(), now: NOW,
    notionLastEdited: '2026-01-01T00:00:00Z',
    ...over,
  });
  return { r, conflicts };
}

test('hash + path helpers', () => {
  assert.equal(hashBytes(Buffer.from('x')), hashBytes(Buffer.from('x')));
  assert.notEqual(hashBytes(Buffer.from('x')), hashBytes(Buffer.from('y')));
  assert.equal(hashFile(path.join(os.tmpdir(), 'definitely-missing-xyz.md')), null);
  const root = freshRoot();
  assert.equal(normRel(root, path.join(root, 'a', 'b.md')), 'a/b.md');
  if (process.platform === 'win32') assert.ok(samePath('A/B.md', 'a/b.md'));
  assert.ok(samePath('a/b.md', 'a/b.md'));
});

test('first sync (no baseline, no file) → clean write + fingerprint, no conflict', () => {
  const root = freshRoot(); const state = emptyState();
  const target = path.join(root, 'Note.md');
  const { r, conflicts } = gw(root, state, { targetPath: target, id: 'p1', title: 'Note' });
  assert.equal(r.wrote, true); assert.equal(r.conflicted, false);
  assert.equal(fs.readFileSync(target, 'utf-8'), 'NOTION-CONTENT');
  assert.ok(state.local.p1 && state.local.p1.hash);
  assert.equal(conflicts.length, 0);
});

test('clean overwrite: untouched file (hash === baseline) is overwritten with no conflict', () => {
  const root = freshRoot(); const state = emptyState();
  const target = path.join(root, 'Note.md');
  gw(root, state, { targetPath: target, id: 'p1', title: 'Note', content: 'V1' });
  // Notion changed; local file untouched → clean overwrite to V2
  const { r, conflicts } = gw(root, state, { targetPath: target, id: 'p1', title: 'Note', content: 'V2' });
  assert.equal(r.conflicted, false); assert.equal(r.wrote, true);
  assert.equal(fs.readFileSync(target, 'utf-8'), 'V2');
  assert.equal(conflicts.length, 0);
});

test('EDIT-CONFLICT: a locally edited file is NEVER overwritten; sidecar + queue instead', () => {
  const root = freshRoot(); const state = emptyState();
  const target = path.join(root, 'Note.md');
  gw(root, state, { targetPath: target, id: 'p1', title: 'Note', content: 'V1' });
  fs.writeFileSync(target, 'USER-EDITED', 'utf-8'); // user edits locally
  const { r, conflicts } = gw(root, state, { targetPath: target, id: 'p1', title: 'Note', content: 'V2-from-notion' });
  assert.equal(r.conflicted, true); assert.equal(r.wrote, false);
  assert.equal(fs.readFileSync(target, 'utf-8'), 'USER-EDITED'); // preserved!
  const sidecar = path.join(root, 'Note.notion-conflict.md');
  assert.ok(fs.existsSync(sidecar));
  assert.ok(fs.readFileSync(sidecar, 'utf-8').includes(`${ARTIFACT_SENTINEL}: notion-conflict`));
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].reason, 'edit-conflict');
});

test('RESOLUTION-ADOPT: prior conflict + sidecar deleted → re-baseline, no conflict', () => {
  const root = freshRoot(); const state = emptyState();
  const target = path.join(root, 'Note.md');
  gw(root, state, { targetPath: target, id: 'p1', title: 'Note', content: 'V1' });
  fs.writeFileSync(target, 'MERGED-BY-USER', 'utf-8'); // user merged notion in
  // no sidecar on disk + this id was a prior conflict → adopt
  const { r, conflicts } = gw(root, state, {
    targetPath: target, id: 'p1', title: 'Note', content: 'V2',
    priorConflictIds: new Set(['p1']),
  });
  assert.equal(r.conflicted, false); assert.equal(r.wrote, false);
  assert.equal(fs.readFileSync(target, 'utf-8'), 'MERGED-BY-USER'); // not clobbered
  assert.equal(state.local.p1.hash, hashFile(target)); // re-baselined to current
  assert.equal(conflicts.length, 0);
});

test('NO-BASELINE upgrade: existing unguarded file → backup once, then overwrite', () => {
  const root = freshRoot(); const state = emptyState();
  const target = path.join(root, 'Legacy.md');
  fs.writeFileSync(target, 'LEGACY-LOCAL', 'utf-8'); // pre-G2 file, no baseline in state
  const { r, conflicts } = gw(root, state, { targetPath: target, id: 'p1', title: 'Legacy', content: 'NOTION' });
  assert.equal(r.wrote, true); assert.equal(r.conflicted, false);
  const backup = path.join(root, 'Legacy.pre-sync-backup.md');
  assert.ok(fs.existsSync(backup));
  assert.ok(fs.readFileSync(backup, 'utf-8').includes('LEGACY-LOCAL'));
  assert.equal(fs.readFileSync(target, 'utf-8'), 'NOTION');
  assert.equal(conflicts[0].reason, 'no-baseline-overwrite');
});

test('LOCAL-DELETED: baseline + file gone → sidecar + local-deleted; tombstone settles it', () => {
  const root = freshRoot(); const state = emptyState();
  const target = path.join(root, 'Gone.md');
  gw(root, state, { targetPath: target, id: 'p1', title: 'Gone', content: 'V1' });
  fs.rmSync(target); // user deletes locally
  const a = gw(root, state, { targetPath: target, id: 'p1', title: 'Gone', content: 'V2' });
  assert.equal(a.r.conflicted, true);
  assert.equal(a.conflicts[0].reason, 'local-deleted');
  // user deletes the sidecar to confirm deletion → reconcileTombstones records it
  fs.rmSync(path.join(root, 'Gone.notion-conflict.md'));
  reconcileTombstones(root, state, NOW);
  assert.ok(state.tombstones.p1);
  // next run: file still gone, tombstone present → settle (no conflict, no sidecar)
  const b = gw(root, state, { targetPath: target, id: 'p1', title: 'Gone', content: 'V3' });
  assert.equal(b.r.conflicted, false);
  assert.equal(b.conflicts.length, 0);
  assert.ok(!fs.existsSync(path.join(root, 'Gone.notion-conflict.md')));
});

test('RELOCATION 6a: old path matches baseline → clean write at new path + relocated note', () => {
  const root = freshRoot(); const state = emptyState();
  const oldT = path.join(root, 'Old.md');
  gw(root, state, { targetPath: oldT, id: 'p1', title: 'Old', content: 'V1' });
  // page renamed in Notion → new path, old file untouched
  const newT = path.join(root, 'New.md');
  const { r, conflicts } = gw(root, state, { targetPath: newT, id: 'p1', title: 'New', content: 'V2' });
  assert.equal(r.conflicted, false); assert.equal(r.wrote, true);
  assert.equal(fs.readFileSync(newT, 'utf-8'), 'V2');
  assert.equal(state.local.p1.relPath, 'New.md'); // baseline moved
  assert.ok(conflicts.some((c) => c.reason === 'relocated' && c.oldRelPath === 'Old.md'));
});

test('RELOCATION 6b: old path has unmerged edits → edit-conflict-relocated, frozen', () => {
  const root = freshRoot(); const state = emptyState();
  const oldT = path.join(root, 'Old.md');
  gw(root, state, { targetPath: oldT, id: 'p1', title: 'Old', content: 'V1' });
  fs.writeFileSync(oldT, 'EDITED-AT-OLD', 'utf-8'); // user edited the old-path file
  const newT = path.join(root, 'New.md');
  const { r, conflicts } = gw(root, state, { targetPath: newT, id: 'p1', title: 'New', content: 'V2' });
  assert.equal(r.conflicted, true); assert.equal(r.wrote, false);
  assert.equal(fs.readFileSync(oldT, 'utf-8'), 'EDITED-AT-OLD'); // preserved
  assert.ok(fs.existsSync(path.join(root, 'Old.notion-conflict.md')));
  assert.equal(state.local.p1.relPath, 'Old.md'); // baseline frozen (not moved)
  assert.equal(conflicts[0].reason, 'edit-conflict-relocated');
});

test('PATH-COLLISION: two ids → same relPath is surfaced, second does not clobber', () => {
  const root = freshRoot(); const state = emptyState();
  const claimedPaths = new Map();
  const target = path.join(root, 'Dup.md');
  const a = gw(root, state, { targetPath: target, id: 'p1', title: 'Dup A', content: 'A', claimedPaths });
  assert.equal(a.r.conflicted, false);
  const b = gw(root, state, { targetPath: target, id: 'p2', title: 'Dup B', content: 'B', claimedPaths });
  assert.equal(b.r.conflicted, true);
  assert.equal(b.conflicts[0].reason, 'path-collision');
  assert.equal(fs.readFileSync(target, 'utf-8'), 'A'); // p1's content not clobbered
});

test('GATE 0: a "변환 실패" body has zero side effects and does not advance', () => {
  const root = freshRoot(); const state = emptyState();
  const target = path.join(root, 'Bad.md');
  fs.writeFileSync(target, 'GOOD-LOCAL', 'utf-8');
  state.local.p1 = { hash: hashFile(target), relPath: 'Bad.md', leaf: true, syncedAt: NOW };
  const { r, conflicts } = gw(root, state, { targetPath: target, id: 'p1', title: 'Bad', rawMarkdown: '> 변환 실패: 5xx', content: '---\nx\n---\nbad' });
  assert.equal(r.conflicted, true); assert.equal(r.wrote, false);
  assert.equal(fs.readFileSync(target, 'utf-8'), 'GOOD-LOCAL'); // untouched
  assert.equal(conflicts.length, 0); // no queue pollution
});

test('provenance: a user file named *.notion-conflict.md (no sentinel) is not clobbered', () => {
  const root = freshRoot(); const state = emptyState();
  const target = path.join(root, 'Note.md');
  gw(root, state, { targetPath: target, id: 'p1', title: 'Note', content: 'V1' });
  fs.writeFileSync(target, 'EDITED', 'utf-8');
  const userSidecar = path.join(root, 'Note.notion-conflict.md');
  fs.writeFileSync(userSidecar, 'MY OWN FILE, not stellavault', 'utf-8'); // real user file
  gw(root, state, { targetPath: target, id: 'p1', title: 'Note', content: 'V2' });
  assert.equal(fs.readFileSync(userSidecar, 'utf-8'), 'MY OWN FILE, not stellavault'); // intact
  assert.ok(fs.existsSync(path.join(root, 'Note.notion-conflict.2.md'))); // ours went to .2
});

test('state IO: atomic save + .bak recovery on a torn .sync-state.json', () => {
  const root = freshRoot();
  const sf = path.join(root, '.sync-state.json');
  const s = emptyState(); s.pages.p1 = 'edit1';
  saveSyncState(sf, s);                 // writes sf
  s.pages.p2 = 'edit2';
  saveSyncState(sf, s);                 // writes sf, copies prev → sf.bak
  fs.writeFileSync(sf, '{ this is corrupt'); // simulate a torn write
  const loaded = loadSyncState(sf, () => {});
  assert.ok(loaded.pages.p1);          // recovered from .bak (has p1; p2 was the in-flight one)
  assert.deepEqual(Object.keys(loaded).sort(), ['children', 'lastSync', 'local', 'pages', 'tombstones']);
});

test('backward-compat: a legacy state (no local/tombstones) loads + populates the new maps', () => {
  const root = freshRoot();
  const sf = path.join(root, '.sync-state.json');
  fs.writeFileSync(sf, JSON.stringify({ lastSync: 'x', pages: { p1: 'e1' }, children: { p1: true } }));
  const loaded = loadSyncState(sf, () => {});
  assert.deepEqual(loaded.pages, { p1: 'e1' });
  assert.deepEqual(loaded.children, { p1: true });
  assert.deepEqual(loaded.local, {});
  assert.deepEqual(loaded.tombstones, {});
});

test('mergeConflictQueue: dedupe by id, carry-forward one-shots, drop resolved', () => {
  const prior = { conflicts: [
    { notionId: 'a', reason: 'relocated', acknowledged: false, title: 'A', relPath: 'A.md' },
    { notionId: 'b', reason: 'edit-conflict', acknowledged: false, title: 'B', relPath: 'B.md' },
    { notionId: 'c', reason: 'no-baseline-overwrite', acknowledged: false, title: 'C', relPath: 'C.md' },
  ] };
  const fresh = [{ notionId: 'b', reason: 'edit-conflict', title: 'B', relPath: 'B.md' }]; // b re-detected
  const resolvedIds = new Set(['c']); // c's backup was deleted → resolved
  const q = mergeConflictQueue(prior, fresh, resolvedIds, NOW);
  const ids = q.conflicts.map((c) => c.notionId).sort();
  assert.deepEqual(ids, ['a', 'b']); // a carried forward (one-shot), b refreshed, c dropped
  assert.equal(q.count, 2);
});

test('renderConflictNote: empty → ✅; non-empty → table + sentinel', () => {
  assert.ok(renderConflictNote({ generatedAt: NOW, count: 0, conflicts: [] }).includes('✅'));
  const note = renderConflictNote({ generatedAt: NOW, count: 1, conflicts: [
    { notionId: 'a', reason: 'edit-conflict', title: 'A', relPath: 'A.md', sidecarRelPath: 'A.notion-conflict.md', detectedAt: NOW },
  ] });
  assert.ok(note.includes(`${ARTIFACT_SENTINEL}: sync-conflicts`));
  assert.ok(note.includes('| A |'));
  assert.ok(note.includes('edit-conflict'));
});
