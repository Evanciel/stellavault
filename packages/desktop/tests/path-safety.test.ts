import { describe, it, expect } from 'vitest';
import { resolve, join, sep } from 'node:path';
import {
  assertInsideVault,
  assertInsideDir,
  sanitizeAssetName,
  assertAssetSize,
  ALLOWED_ASSET_EXT,
  ALLOWED_MEDIA_EXT,
  MAX_ASSET_BYTES,
  sniffMediaType,
  assertMediaMatches,
} from '../src/main/path-safety.js';

// T1-3: real unit tests for the security boundary. Imports the SAME pure helpers
// main/index.ts uses (no replication, no drift) — runnable without Electron.

const VAULT = resolve('/tmp/sv-vault');

describe('assertInsideVault', () => {
  it('allows the vault root itself', () => {
    expect(assertInsideVault(VAULT, VAULT)).toBe(VAULT);
  });

  it('allows a file directly inside the vault', () => {
    const inside = join(VAULT, 'note.md');
    expect(assertInsideVault(VAULT, inside)).toBe(resolve(inside));
  });

  it('allows a deeply nested file inside the vault', () => {
    const inside = join(VAULT, 'a', 'b', 'c', 'note.md');
    expect(assertInsideVault(VAULT, inside)).toBe(resolve(inside));
  });

  it('rejects an absolute path outside the vault', () => {
    expect(() => assertInsideVault(VAULT, resolve('/etc/passwd'))).toThrow(/Access denied/);
  });

  it('rejects a parent-directory file', () => {
    expect(() => assertInsideVault(VAULT, resolve('/tmp/secret.md'))).toThrow(/Access denied/);
  });

  it('rejects ../ traversal escaping the vault', () => {
    const evil = join(VAULT, '..', '..', 'etc', 'passwd');
    expect(() => assertInsideVault(VAULT, evil)).toThrow(/Access denied/);
  });

  it('rejects encoded-ish traversal that resolves outside', () => {
    const evil = join(VAULT, 'sub', '..', '..', 'outside.md');
    expect(() => assertInsideVault(VAULT, evil)).toThrow(/Access denied/);
  });

  it('rejects a sibling-prefix bypass (vault vs vault-evil)', () => {
    // The classic startsWith(vaultRoot) bug: VAULT + '-evil' shares the prefix
    // but is NOT inside the vault. The sep-suffixed check must catch this.
    const sibling = `${VAULT}-evil${sep}note.md`;
    expect(() => assertInsideVault(VAULT, sibling)).toThrow(/Access denied/);
  });

  it('traversal that climbs then re-enters the vault is allowed (resolves inside)', () => {
    const reentry = join(VAULT, 'sub', '..', 'note.md');
    expect(assertInsideVault(VAULT, reentry)).toBe(resolve(join(VAULT, 'note.md')));
  });
});

describe('sanitizeAssetName', () => {
  it('accepts every whitelisted extension', () => {
    for (const ext of ALLOWED_ASSET_EXT) {
      const r = sanitizeAssetName(`pic${ext}`);
      expect(r.ext).toBe(ext);
    }
  });

  it('lowercases the extension', () => {
    expect(sanitizeAssetName('PIC.PNG').ext).toBe('.png');
  });

  it('strips directory components from the filename', () => {
    const r = sanitizeAssetName('../../etc/evil.png');
    expect(r.base).toBe('evil');
    expect(r.ext).toBe('.png');
  });

  it('strips Windows-style directory components', () => {
    const r = sanitizeAssetName('C:\\Windows\\evil.png');
    // basename keeps the last segment; ":" and "\\" are sanitized to "_" if present.
    expect(r.base).not.toContain('\\');
    expect(r.ext).toBe('.png');
  });

  it('rejects an unsupported extension', () => {
    expect(() => sanitizeAssetName('malware.exe')).toThrow(/unsupported image type/);
  });

  it('rejects a missing extension', () => {
    expect(() => sanitizeAssetName('noext')).toThrow(/unsupported image type/);
  });

  it('sanitizes shell/path metacharacters in the base name', () => {
    const r = sanitizeAssetName('a/b;rm -rf$.png');
    expect(r.base).not.toMatch(/[;$/]/);
  });

  it('preserves CJK / accented characters in the base name', () => {
    const r = sanitizeAssetName('한글이미지.png');
    expect(r.base).toBe('한글이미지');
  });

  it('falls back to "image" for an empty / undefined name', () => {
    expect(sanitizeAssetName(undefined).base).toBe('image');
  });
});

describe('assertAssetSize', () => {
  it('rejects an empty payload', () => {
    expect(() => assertAssetSize(0)).toThrow(/empty/);
  });

  it('accepts a normal-sized payload', () => {
    expect(() => assertAssetSize(1024)).not.toThrow();
  });

  it('accepts a payload exactly at the cap', () => {
    expect(() => assertAssetSize(MAX_ASSET_BYTES)).not.toThrow();
  });

  it('rejects a payload over the 50MB cap', () => {
    expect(() => assertAssetSize(MAX_ASSET_BYTES + 1)).toThrow(/too large/);
  });
});

// SP0 Task 3: general assertInsideDir extracted from assertInsideVault, plus the
// media extension whitelist + magic-byte sniffing for the SP2 multimedia I/O.

const ROOT = resolve('/tmp/sv-root');

describe('assertInsideDir', () => {
  it('allows the root itself', () => {
    expect(assertInsideDir(ROOT, ROOT)).toBe(ROOT);
  });

  it('allows a file directly inside the root', () => {
    const inside = join(ROOT, 'file.bin');
    expect(assertInsideDir(ROOT, inside)).toBe(resolve(inside));
  });

  it('allows a deeply nested file inside the root', () => {
    const inside = join(ROOT, 'a', 'b', 'c', 'file.bin');
    expect(assertInsideDir(ROOT, inside)).toBe(resolve(inside));
  });

  it('rejects an absolute path outside the root', () => {
    expect(() => assertInsideDir(ROOT, resolve('/etc/passwd'))).toThrow(/Access denied/);
  });

  it('rejects ../ traversal escaping the root', () => {
    const evil = join(ROOT, '..', '..', 'etc', 'passwd');
    expect(() => assertInsideDir(ROOT, evil)).toThrow(/Access denied/);
  });

  it('rejects a sibling-prefix bypass (root vs root-evil)', () => {
    const sibling = `${ROOT}-evil${sep}x`;
    expect(() => assertInsideDir(ROOT, sibling)).toThrow(/Access denied/);
  });
});

describe('ALLOWED_MEDIA_EXT', () => {
  it('contains each supported media extension', () => {
    for (const ext of ['.mp3', '.m4a', '.wav', '.ogg', '.webm', '.mp4', '.mov']) {
      expect(ALLOWED_MEDIA_EXT.has(ext)).toBe(true);
    }
  });

  it('does NOT contain .svg (SVG can embed scripts — media/direct-open forbidden)', () => {
    expect(ALLOWED_MEDIA_EXT.has('.svg')).toBe(false);
  });
});

// Magic-byte fixtures.
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
// ISO-BMFF: 4-byte box size, then 'ftyp' at offset 4.
const FTYP = new Uint8Array([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
const WEBM = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x00, 0x00, 0x00]);
// WAV: 'RIFF' …… 'WAVE' at offset 8.
const WAV = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45]);
const OGG = new Uint8Array([0x4f, 0x67, 0x67, 0x53, 0x00, 0x02, 0x00, 0x00]);
const MP3_ID3 = new Uint8Array([0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00]);
const MP3_SYNC = new Uint8Array([0xff, 0xfb, 0x90, 0x00]);

describe('sniffMediaType', () => {
  it('recognizes PNG', () => {
    expect(sniffMediaType(PNG)).toBe('png');
  });

  it('recognizes JPEG', () => {
    expect(sniffMediaType(JPEG)).toBe('jpeg');
  });

  it('recognizes ISO-BMFF (ftyp at offset 4)', () => {
    expect(sniffMediaType(FTYP)).toBe('isobmff');
  });

  it('recognizes WebM / Matroska EBML', () => {
    expect(sniffMediaType(WEBM)).toBe('webm');
  });

  it('recognizes WAV (RIFF + WAVE)', () => {
    expect(sniffMediaType(WAV)).toBe('wav');
  });

  it('recognizes OGG', () => {
    expect(sniffMediaType(OGG)).toBe('ogg');
  });

  it('recognizes MP3 via ID3 tag', () => {
    expect(sniffMediaType(MP3_ID3)).toBe('mp3');
  });

  it('recognizes MP3 via frame-sync', () => {
    expect(sniffMediaType(MP3_SYNC)).toBe('mp3');
  });

  it('accepts a Buffer as well as a Uint8Array', () => {
    expect(sniffMediaType(Buffer.from(PNG))).toBe('png');
  });

  it('returns null for unrecognized bytes', () => {
    expect(sniffMediaType(new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05]))).toBeNull();
  });

  it('returns null for a too-short buffer', () => {
    expect(sniffMediaType(new Uint8Array([0x89, 0x50]))).toBeNull();
  });

  it('does not misfire RIFF without WAVE as wav', () => {
    // RIFF container that is not WAVE (e.g. AVI/WEBP) — must not be sniffed as wav.
    const riffOther = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x41, 0x56, 0x49, 0x20]);
    expect(sniffMediaType(riffOther)).toBeNull();
  });
});

describe('assertMediaMatches', () => {
  it('passes for .mp4 + ftyp bytes', () => {
    expect(() => assertMediaMatches('.mp4', FTYP)).not.toThrow();
  });

  it('passes for .m4a + ftyp bytes (audio in ISO-BMFF)', () => {
    expect(() => assertMediaMatches('.m4a', FTYP)).not.toThrow();
  });

  it('passes for .mov + ftyp bytes', () => {
    expect(() => assertMediaMatches('.mov', FTYP)).not.toThrow();
  });

  it('passes for .webm + EBML bytes', () => {
    expect(() => assertMediaMatches('.webm', WEBM)).not.toThrow();
  });

  it('passes for .wav + RIFF/WAVE bytes', () => {
    expect(() => assertMediaMatches('.wav', WAV)).not.toThrow();
  });

  it('passes for .ogg + OggS bytes', () => {
    expect(() => assertMediaMatches('.ogg', OGG)).not.toThrow();
  });

  it('passes for .mp3 + ID3 bytes', () => {
    expect(() => assertMediaMatches('.mp3', MP3_ID3)).not.toThrow();
  });

  it('is case-insensitive on the extension', () => {
    expect(() => assertMediaMatches('.MP4', FTYP)).not.toThrow();
  });

  it('rejects ext/content mismatch (.mp4 with PNG bytes)', () => {
    expect(() => assertMediaMatches('.mp4', PNG)).toThrow(/does not match extension/);
  });

  it('rejects ext/content mismatch (.webm with ftyp bytes)', () => {
    expect(() => assertMediaMatches('.webm', FTYP)).toThrow(/does not match extension/);
  });

  it('rejects .svg as an unsupported media type', () => {
    expect(() => assertMediaMatches('.svg', PNG)).toThrow(/unsupported media type/);
  });

  it('rejects a non-media extension (.png) as unsupported media', () => {
    expect(() => assertMediaMatches('.png', PNG)).toThrow(/unsupported media type/);
  });

  it('rejects unknown bytes for a media extension (fail-closed)', () => {
    expect(() => assertMediaMatches('.mp4', new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05]))).toThrow(
      /does not match extension/,
    );
  });
});
