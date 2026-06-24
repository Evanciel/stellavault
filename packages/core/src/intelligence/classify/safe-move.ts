// Non-destructive file move for the capture pipeline. Guarantees (Design §9, threat #5):
//  - both paths must resolve INSIDE vaultRoot (no traversal escape)
//  - never overwrites an existing file (collision → numeric suffix)
//  - dest dir auto-created
//  - same-volume rename (atomic); cross-device copy+unlink fallback
// The CALLER journals (prevPath) BEFORE calling safeMove so a crash mid-move is reversible.

import { renameSync, existsSync, mkdirSync, copyFileSync, unlinkSync } from 'node:fs';
import { resolve, dirname, join, basename, extname, sep } from 'node:path';

export interface SafeMoveResult {
  moved: boolean;
  finalPath: string; // absolute; equals `from` when not moved
  error?: 'outside-vault' | 'missing-source' | 'same-path' | 'io';
}

function insideVault(vaultRoot: string, p: string): boolean {
  const root = resolve(vaultRoot);
  const abs = resolve(p);
  return abs === root || abs.startsWith(root + sep);
}

/**
 * Move `from` → `to`, both required to be inside `vaultRoot`, never clobbering an
 * existing file. Returns the final (possibly suffixed) absolute path. On any guard
 * failure the source is left untouched and `moved:false` is returned (never throws).
 */
export function safeMove(vaultRoot: string, from: string, to: string): SafeMoveResult {
  const absFrom = resolve(from);
  const absTo = resolve(to);

  if (!insideVault(vaultRoot, absFrom) || !insideVault(vaultRoot, absTo)) {
    return { moved: false, finalPath: absFrom, error: 'outside-vault' };
  }
  if (!existsSync(absFrom)) return { moved: false, finalPath: absFrom, error: 'missing-source' };
  if (absFrom === absTo) return { moved: false, finalPath: absFrom, error: 'same-path' };

  const dir = dirname(absTo);
  mkdirSync(dir, { recursive: true });

  // Collision → numeric suffix: name.md → name-2.md → name-3.md …
  let target = absTo;
  if (existsSync(target)) {
    const ext = extname(absTo);
    const stem = basename(absTo, ext);
    let i = 2;
    do {
      target = join(dir, `${stem}-${i++}${ext}`);
    } while (existsSync(target));
  }

  try {
    renameSync(absFrom, target);
  } catch {
    // Cross-device (EXDEV) → copy + unlink.
    try {
      copyFileSync(absFrom, target);
      unlinkSync(absFrom);
    } catch {
      return { moved: false, finalPath: absFrom, error: 'io' };
    }
  }
  return { moved: true, finalPath: target };
}
