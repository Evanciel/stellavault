// Stellavault Desktop — Path safety (pure, testable helpers)
// Extracted from main/index.ts so the security boundary can be unit-tested
// without an Electron runtime (T1-3). Main imports these; tests import these.

import { resolve, sep, basename, extname } from 'node:path';

// CRIT-01: Every IPC handler that touches the filesystem MUST validate that the
// resolved path is inside an allowed root. Without this, a compromised renderer
// can read/write/delete ANY file on disk.
//
// resolve() collapses '..' traversal and normalizes separators; the
// sep-suffixed prefix check defeats the sibling-prefix bypass (e.g. a root at
// /v must not match /v-evil). The exact-equal case allows the root itself.
//
// assertInsideDir is the general containment guard; assertInsideVault is the
// vault-specialized alias (SP2 reuses assertInsideDir for the attachment dir).
export function assertInsideDir(root: string, p: string): string {
  const resolved = resolve(p);
  const rootResolved = resolve(root);
  if (resolved !== rootResolved && !resolved.startsWith(rootResolved + sep)) {
    throw new Error(`Access denied: path outside directory — ${resolved}`);
  }
  return resolved;
}

export function assertInsideVault(vaultPath: string, filePath: string): string {
  return assertInsideDir(vaultPath, filePath);
}

// ─── import-asset filename validation ────────────────
// Pure logic behind vault:import-asset's filename whitelist + size cap so the
// sanitizer can be tested directly. The handler in index.ts composes these.

export const ALLOWED_ASSET_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.avif',
]);

export const MAX_ASSET_BYTES = 50 * 1024 * 1024; // 50MB

// ─── SP2 multimedia I/O — media extension whitelist + magic-byte sniff ────────
// Audio/video extensions accepted by the multimedia chat attachment pipeline.
// NOTE: this is intentionally DIFFERENT from ALLOWED_ASSET_EXT (image import).
// '.svg' is deliberately EXCLUDED here — SVG is XML that can embed <script>, so
// it must never be treated as a directly-openable/embeddable media file. Images
// still go through ALLOWED_ASSET_EXT (which keeps .svg for import), where they
// are referenced — not script-executed.
export const ALLOWED_MEDIA_EXT = new Set([
  '.mp3', '.m4a', '.wav', '.ogg', '.webm', '.mp4', '.mov',
]);

// ─── SP2 image attachment (local vision) — image whitelist + magic-byte sniff ──
// Images that may be attached to a chat turn and passed to a vision model
// (Ollama gemma4:e4b native /api/chat `images:[base64]`). SVG is EXCLUDED (XML +
// <script> risk) — only raster formats the magic-byte sniffer can verify.
export const ALLOWED_IMAGE_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp',
]);

// Per-image cap (raw decoded bytes) for a chat attachment. Smaller than the 50MB
// asset cap — these are inlined as base64 into a model request, so keep them tight.
export const MAX_CHAT_IMAGE_BYTES = 10 * 1024 * 1024; // 10MB
// SP4 audio/video cap. Audio rides Whisper (25MB API limit); video is inlined as base64 to
// Gemini (request must stay well under ~20MB). 20MB covers short clips / voice notes.
export const MAX_CHAT_MEDIA_BYTES = 20 * 1024 * 1024; // 20MB

// Expected family for each whitelisted image extension.
const IMAGE_EXT_FAMILY: Record<string, MediaFamily> = {
  '.png': 'png',
  '.jpg': 'jpeg',
  '.jpeg': 'jpeg',
  '.gif': 'gif',
  '.webp': 'webp',
};

/** Throw unless `bytes` look like the image family implied by `ext`. Fail-closed:
 *  an unsupported ext or unrecognized/mismatched bytes both throw. The ext↔content
 *  integrity gate for SP2 image attachments. */
export function assertImageMatches(ext: string, bytes: Uint8Array | Buffer): void {
  const e = ext.toLowerCase();
  const expected = IMAGE_EXT_FAMILY[e];
  if (!expected) throw new Error(`unsupported image type "${e}"`);
  const actual = sniffMediaType(bytes);
  if (actual === null || actual !== expected) {
    throw new Error(`image content does not match extension "${e}"`);
  }
}

/** Canonical magic-byte family of the supplied bytes, or null if unrecognized.
 *  Pure & synchronous so it can be unit-tested and reused by SP2 handlers.
 *  Recognizes the media families plus PNG/JPEG (so the same sniffer can later
 *  guard image assets too). Length is checked before every index access. */
export function sniffMediaType(bytes: Uint8Array | Buffer): MediaFamily | null {
  const b = bytes;
  const len = b.length;
  // 4-byte signatures.
  if (len >= 4) {
    // PNG: 89 50 4E 47
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
    // WebM / Matroska EBML: 1A 45 DF A3
    if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'webm';
    // OGG: 4F 67 67 53 ('OggS')
    if (b[0] === 0x4f && b[1] === 0x67 && b[2] === 0x67 && b[3] === 0x53) return 'ogg';
    // GIF: 47 49 46 38 ('GIF8' — covers GIF87a/GIF89a)
    if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'gif';
  }
  // WebP: 'RIFF' at 0 AND 'WEBP' at offset 8 (RIFF alone could be WAV/AVI).
  if (
    len >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  ) {
    return 'webp';
  }
  // JPEG: FF D8 FF
  if (len >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  // MP3: ID3 tag ('ID3') …
  if (len >= 3 && b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) return 'mp3';
  // ISO-BMFF / MP4 family: 'ftyp' (66 74 79 70) at offset 4.
  if (len >= 8 && b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) return 'isobmff';
  // WAV: 'RIFF' at 0 AND 'WAVE' at offset 8 (RIFF alone could be AVI/WEBP).
  if (
    len >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x41 && b[10] === 0x56 && b[11] === 0x45
  ) {
    return 'wav';
  }
  // … MP3 frame-sync (FF followed by 0xE0-masked sync bits). Checked last so the
  // more specific FF-D8-FF (JPEG) and RIFF/ftyp cases win first.
  if (len >= 2 && b[0] === 0xff && (b[1] & 0xe0) === 0xe0) return 'mp3';
  return null;
}

/** Throw unless `bytes` actually look like the media family implied by `ext`.
 *  Fail-closed: an unsupported ext (incl. '.svg') or unrecognized / mismatched
 *  bytes both throw. This is the ext↔content integrity gate for SP2 uploads. */
export function assertMediaMatches(ext: string, bytes: Uint8Array | Buffer): void {
  const e = ext.toLowerCase();
  if (!ALLOWED_MEDIA_EXT.has(e)) {
    throw new Error(`unsupported media type "${e}"`);
  }
  const expected = MEDIA_EXT_FAMILY[e];
  const actual = sniffMediaType(bytes);
  if (actual === null || actual !== expected) {
    throw new Error(`media content does not match extension "${e}"`);
  }
}

/** Canonical magic-byte families recognized by sniffMediaType. */
export type MediaFamily = 'png' | 'jpeg' | 'gif' | 'webp' | 'isobmff' | 'webm' | 'wav' | 'ogg' | 'mp3';

// Expected family for each whitelisted media extension. .mp4/.m4a/.mov all ride
// the ISO base media file format ('ftyp' box), so they map to 'isobmff'.
const MEDIA_EXT_FAMILY: Record<string, MediaFamily> = {
  '.mp4': 'isobmff',
  '.m4a': 'isobmff',
  '.mov': 'isobmff',
  '.webm': 'webm',
  '.wav': 'wav',
  '.ogg': 'ogg',
  '.mp3': 'mp3',
};

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
