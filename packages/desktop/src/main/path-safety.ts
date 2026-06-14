// Stellavault Desktop — Path safety (pure, testable helpers)
// Extracted from main/index.ts so the security boundary can be unit-tested
// without an Electron runtime (T1-3). Main imports these; tests import these.

import { resolve, sep, basename, extname } from 'node:path';

// CRIT-01: Every IPC handler that touches the filesystem MUST validate that the
// resolved path is inside the vault root. Without this, a compromised renderer
// can read/write/delete ANY file on disk.
//
// resolve() collapses '..' traversal and normalizes separators; the
// sep-suffixed prefix check defeats the sibling-prefix bypass (e.g. a vault at
// /v must not match /v-evil). The exact-equal case allows the vault root itself.
export function assertInsideVault(vaultPath: string, filePath: string): string {
  const resolved = resolve(filePath);
  const vaultRoot = resolve(vaultPath);
  if (resolved !== vaultRoot && !resolved.startsWith(vaultRoot + sep)) {
    throw new Error(`Access denied: path outside vault — ${resolved}`);
  }
  return resolved;
}

// ─── import-asset filename validation ────────────────
// Pure logic behind vault:import-asset's filename whitelist + size cap so the
// sanitizer can be tested directly. The handler in index.ts composes these.

export const ALLOWED_ASSET_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.avif',
]);

export const MAX_ASSET_BYTES = 50 * 1024 * 1024; // 50MB

export interface SanitizedAssetName {
  /** Lowercased, validated extension including the leading dot. */
  ext: string;
  /** Sanitized base name (no extension, no path components). */
  base: string;
}

/** Strip path components, whitelist the extension, sanitize the base name.
 *  Throws on an unsupported / missing extension (mirrors handler behavior). */
export function sanitizeAssetName(fileName: unknown): SanitizedAssetName {
  const rawName = basename(String(fileName || 'image.png'));
  const ext = extname(rawName).toLowerCase();
  if (!ALLOWED_ASSET_EXT.has(ext)) {
    throw new Error(`vault:import-asset: unsupported image type "${ext}"`);
  }
  // Allow word chars, dot, dash, space, parens, and the Unicode "letters" range
  // (covers CJK/accented filenames); collapse everything else to '_'.
  const base = basename(rawName, extname(rawName)).replace(/[^\w.\- ()À-￿]/g, '_') || 'image';
  return { ext, base };
}

/** Validate decoded asset bytes against the empty / size-cap rules.
 *  Throws on violation (mirrors handler behavior). */
export function assertAssetSize(byteLength: number): void {
  if (byteLength === 0) throw new Error('vault:import-asset: empty payload');
  if (byteLength > MAX_ASSET_BYTES) {
    throw new Error('vault:import-asset: asset too large (max 50MB)');
  }
}
