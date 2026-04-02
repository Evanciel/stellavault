// Design Ref: Phase 3 FR-05 — .sv-pack 파일 내보내기

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { KnowledgePack } from './types.js';

export function exportPack(pack: KnowledgePack, outputPath: string): void {
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, JSON.stringify(pack, null, 2), 'utf-8');
}

export function packToSummary(pack: KnowledgePack): string {
  return [
    `Name: ${pack.name} v${pack.version}`,
    `Author: ${pack.author} (${pack.license})`,
    `Chunks: ${pack.chunks.length}`,
    `Model: ${pack.embeddingModel} (${pack.embeddingDimensions}d)`,
    `Tags: ${pack.tags.join(', ')}`,
    `Created: ${pack.createdAt}`,
  ].join('\n');
}
