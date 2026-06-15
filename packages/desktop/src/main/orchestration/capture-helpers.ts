// Pure helpers for the capture funnel — unit-testable (no fs / store / electron).
import { createHash } from 'node:crypto';
import type { IngestInput } from '@stellavault/core';
import type { CaptureKind, CaptureSource } from './types.js';

/** Stable dedup hash. Whitespace-normalized + lowercased so trivial reformatting dedupes. */
export function contentHash(text: string): string {
  const norm = text.replace(/\s+/g, ' ').trim().toLowerCase();
  return createHash('sha256').update(norm).digest('hex').slice(0, 32);
}

/** Map a capture kind + extractor sourceFormat to core's IngestInput.type union. */
export function ingestTypeFor(kind: CaptureKind, sourceFormat?: string): IngestInput['type'] {
  if (kind === 'url') return 'url';
  if (kind === 'text') return 'text';
  switch (sourceFormat) {
    case 'pdf': return 'pdf';
    case 'docx': return 'docx';
    case 'pptx': return 'pptx';
    case 'xlsx': return 'xlsx';
    case 'xls': return 'xls';
    default: return 'text';
  }
}

/** Human-readable `source` for the note frontmatter / journal. */
export function sourceLabel(item: { source: CaptureSource; sourceMeta?: { fileName?: string; client?: string } }): string {
  if (item.source === 'mcp') return `mcp:${item.sourceMeta?.client ?? 'agent'}`;
  if (item.source === 'drop') return item.sourceMeta?.fileName ? `drop:${item.sourceMeta.fileName}` : 'drop';
  return item.source;
}

/** Incremental mean centroid update. Cosine is magnitude-invariant → no re-normalize needed. */
export function incrementalCentroid(old: number[], v: number[], count: number): number[] {
  if (old.length === 0) return v.slice();
  const n = count + 1;
  const out = old.slice();
  const len = Math.min(out.length, v.length);
  for (let i = 0; i < len; i++) out[i] += (v[i] - out[i]) / n;
  return out;
}
