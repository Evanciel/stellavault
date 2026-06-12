// File operation orchestration (W1-3 + W1-9 renderer side — Stage D).
// Flow per plan §3/W1-3: action → IPC → vault:read-tree refresh → open-tab
// path/title sync → (rename only) wikilink update via vault:update-links.
//
// UI dependencies (confirm dialogs) are injected as a `Confirm` callback so
// this module stays component-free; FileTree provides a promise-based
// ConfirmModal bridge.

import { useAppStore } from '../../stores/app-store.js';
import { useSettingsStore } from '../../stores/settings-store.js';
import {
  ipc,
  vaultTrash,
  vaultDuplicate,
  vaultExists,
  vaultUpdateLinks,
} from '../../lib/ipc-client.js';

/** Injected confirm dialog — resolves true on confirm, false on cancel/close. */
export type Confirm = (title: string, message: string, opts?: { danger?: boolean; confirmLabel?: string }) => Promise<boolean>;

export interface OpResult {
  ok: boolean;
  error?: string;
  /** New absolute path for create/rename/duplicate. */
  path?: string;
}

// ─── Path helpers (renderer has no node:path; vault paths may use \ or /) ───

function sepOf(p: string): '/' | '\\' {
  return p.includes('\\') ? '\\' : '/';
}

function dirOf(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return i === -1 ? p : p.slice(0, i);
}

function nameOf(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return i === -1 ? p : p.slice(i + 1);
}

/** Strip characters invalid in Windows filenames (same rule as Sidebar new-note). */
export function sanitizeName(name: string): string {
  return name.replace(/[<>:"/\\|?*]/g, '').trim();
}

export function titleOf(filePath: string): string {
  return nameOf(filePath).replace(/\.md$/, '');
}

async function refreshTree(): Promise<void> {
  const tree = await ipc('vault:read-tree');
  useAppStore.getState().setFileTree(tree);
}

/** Force-save a dirty tab before destructive path operations (plan W1-3 risk). */
async function flushDirtyTab(filePath: string): Promise<void> {
  const s = useAppStore.getState();
  const tab = s.tabs.find((t) => t.filePath === filePath);
  if (tab?.isDirty) {
    await ipc('vault:write-file', tab.filePath, tab.content);
    s.markTabClean(tab.id);
  }
}

/** Reload every open, non-dirty tab from disk (after vault-wide link rewrite). */
async function reloadCleanTabs(except?: string): Promise<void> {
  const s = useAppStore.getState();
  for (const tab of s.tabs) {
    if (tab.filePath === except || tab.isDirty) continue;
    try {
      const content = await ipc('vault:read-file', tab.filePath);
      s.reloadTab(tab.id, content);
    } catch { /* file may be mid-move — tolerate */ }
  }
}

// ─── Operations ───

/** Create a note inside `dirPath`. If a note with that name exists, opens it
 *  instead (exists-guard lives in main — vault:create-file now throws). */
export async function createNote(dirPath: string, rawName: string): Promise<OpResult> {
  const name = sanitizeName(rawName);
  if (!name) return { ok: false, error: 'Invalid name' };
  const path = `${dirPath}${sepOf(dirPath)}${name}.md`;
  try {
    if (await vaultExists(path)) {
      const content = await ipc('vault:read-file', path);
      useAppStore.getState().openFile(path, name, content);
      return { ok: true, path };
    }
    await ipc('vault:create-file', path, `# ${name}\n\n`);
    const content = await ipc('vault:read-file', path);
    useAppStore.getState().openFile(path, name, content);
    await refreshTree();
    return { ok: true, path };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function createFolder(parentPath: string, rawName: string): Promise<OpResult> {
  const name = sanitizeName(rawName);
  if (!name) return { ok: false, error: 'Invalid name' };
  const path = `${parentPath}${sepOf(parentPath)}${name}`;
  try {
    await ipc('vault:create-folder', path);
    await refreshTree();
    // Expand the parent so the new folder is visible.
    const s = useAppStore.getState();
    if (!s.expandedFolders.has(parentPath)) s.toggleFolder(parentPath);
    return { ok: true, path };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Rename a note. After the FS rename, asks (yes/no — count unknown upfront,
 *  per assignment) whether to rewrite [[wikilinks]] vault-wide, then reloads
 *  affected open tabs. */
export async function renameNote(oldPath: string, rawNewName: string, confirm: Confirm): Promise<OpResult> {
  const newName = sanitizeName(rawNewName);
  const oldTitle = titleOf(oldPath);
  if (!newName || newName === oldTitle) return { ok: true, path: oldPath };
  const newPath = `${dirOf(oldPath)}${sepOf(oldPath)}${newName}.md`;
  try {
    if (await vaultExists(newPath)) {
      return { ok: false, error: `A note named "${newName}" already exists here.` };
    }
    await flushDirtyTab(oldPath); // don't lose unsaved edits across the rename
    await ipc('vault:rename', oldPath, newPath);
    useAppStore.getState().renameTabPath(oldPath, newPath, newName);
    await refreshTree();

    // W1-9: link update flow — ask first, then run (count is the result).
    const doLinks = await confirm(
      'Update links?',
      `Update [[${oldTitle}]] links in other notes to [[${newName}]]?`,
      { confirmLabel: 'Update links' },
    );
    if (doLinks) {
      const changed = await vaultUpdateLinks(oldTitle, newName);
      if (changed > 0) await reloadCleanTabs(newPath);
      console.info(`[file-ops] updated wikilinks in ${changed} file(s)`);
    }
    return { ok: true, path: newPath };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Rename a folder — no link rewrite (wikilinks are title-based, not path-based).
 *  Open tabs under the folder get their paths remapped. */
export async function renameFolder(oldPath: string, rawNewName: string): Promise<OpResult> {
  const newName = sanitizeName(rawNewName);
  if (!newName || newName === nameOf(oldPath)) return { ok: true, path: oldPath };
  const sep = sepOf(oldPath);
  const newPath = `${dirOf(oldPath)}${sep}${newName}`;
  try {
    if (await vaultExists(newPath)) {
      return { ok: false, error: `A folder named "${newName}" already exists here.` };
    }
    // Flush dirty tabs under the folder before the path changes underneath them.
    const s = useAppStore.getState();
    const prefix = oldPath + sep;
    for (const tab of s.tabs) {
      if (tab.filePath.startsWith(prefix)) await flushDirtyTab(tab.filePath);
    }
    await ipc('vault:rename', oldPath, newPath);
    // Remap open tabs under the renamed folder.
    for (const tab of useAppStore.getState().tabs) {
      if (tab.filePath.startsWith(prefix)) {
        useAppStore.getState().renameTabPath(tab.filePath, newPath + sep + tab.filePath.slice(prefix.length));
      }
    }
    await refreshTree();
    return { ok: true, path: newPath };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Move a file or folder to the OS trash (§4-G) after confirmation; closes
 *  any open tabs whose files lived under it. */
export async function deleteEntry(path: string, isDir: boolean, confirm: Confirm): Promise<OpResult> {
  const name = isDir ? nameOf(path) : titleOf(path);
  const ok = await confirm(
    `Delete ${isDir ? 'folder' : 'note'}`,
    `Move "${name}" to the system trash? You can restore it from there.`,
    { danger: true, confirmLabel: 'Move to trash' },
  );
  if (!ok) return { ok: false };
  try {
    await vaultTrash(path);
    const s = useAppStore.getState();
    const prefix = path + sepOf(path);
    for (const tab of [...s.tabs]) {
      if (tab.filePath === path || (isDir && tab.filePath.startsWith(prefix))) {
        useAppStore.getState().closeTab(tab.id);
      }
    }
    await refreshTree();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Duplicate a note (or folder) as "name (copy)" and open it if it's a note. */
export async function duplicateEntry(path: string, isDir: boolean): Promise<OpResult> {
  try {
    const newPath = await vaultDuplicate(path);
    await refreshTree();
    if (!isDir) {
      const content = await ipc('vault:read-file', newPath);
      useAppStore.getState().openFile(newPath, titleOf(newPath), content);
    }
    return { ok: true, path: newPath };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Bookmark a note — persisted in settings.bookmarks (W1-11 storage, no IPC). */
export function bookmarkNote(filePath: string): void {
  const store = useSettingsStore.getState();
  const bookmarks = store.settings.bookmarks;
  if (bookmarks.some((b) => b.type === 'note' && b.target === filePath)) return; // dedupe
  void store.update({
    bookmarks: [...bookmarks, { type: 'note', target: filePath, label: titleOf(filePath) }],
  });
}
