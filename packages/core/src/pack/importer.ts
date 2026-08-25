// Design Ref: Phase 3 FR-06~07 — .sv-pack 가져오기 + 벡터 DB 병합

import { readFileSync } from 'node:fs';
import type { VectorStore } from '../store/types.js';
import type { Embedder } from '../indexer/embedder.js';
import type { KnowledgePack } from './types.js';

export interface ImportResult {
  imported: number;
  skipped: number;
  reEmbedded: number;
  modelMismatch: boolean;
}

/**
 * 팩 가져오기 1회분이 <성공인가>.
 *
 * 🔴 함수로 뽑은 이유는 <시험 가능하게> 하기 위해서다. `packImportCommand` 안에
 *    조건문으로 두었더니 실제 임베딩 모델을 내려받아야만 닿을 수 있어, 변이를 심어도
 *    <살아남았다>(코덱스 13차 후속 변이 R7). 소스 순서를 재는 시험은 조건이 뒤집히는
 *    회귀를 못 잡는다 — 그것이 그 부류 시험의 알려진 한계다.
 *
 * 🔴 `imported === 0` 은 importer 가 <아무것도 쓰지 않았다>는 뜻이다. 그 경우 초록
 *    "✅ Imported: 0 chunks" 로 끝나면 자동화가 "가져왔다" 로 읽고 다음으로 간다.
 */
export function packImportSucceeded(r: Pick<ImportResult, 'imported'>): boolean {
  return r.imported > 0;
}

export async function importPack(
  store: VectorStore,
  embedder: Embedder,
  filePath: string,
): Promise<ImportResult> {
  const raw = readFileSync(filePath, 'utf-8');
  const pack: KnowledgePack = JSON.parse(raw);

  // 임베딩 모델 불일치 감지
  const modelMismatch = pack.embeddingModel !== embedder.modelName ||
    pack.embeddingDimensions !== embedder.dimensions;

  let imported = 0;
  let skipped = 0;
  let reEmbedded = 0;

  // 팩 문서를 pack_{name} prefix로 저장
  const packDocId = `pack_${pack.name}`;

  const chunks = [];
  for (let i = 0; i < pack.chunks.length; i++) {
    const pc = pack.chunks[i];

    let embedding = pc.embedding;

    // 모델 불일치 시 재임베딩
    if (modelMismatch) {
      embedding = await embedder.embed(pc.content);
      reEmbedded++;
    }

    // 차원 검증
    if (embedding.length !== embedder.dimensions) {
      skipped++;
      continue;
    }

    chunks.push({
      id: `${packDocId}#${i}`,
      documentId: packDocId,
      content: pc.content,
      heading: pc.heading || pack.name,
      startLine: 0,
      endLine: 0,
      tokenCount: Math.ceil(pc.content.length / 4),
      embedding,
    });

    imported++;
  }

  // 🔴 문서 행을 <청크가 다 준비된 뒤에> 쓴다. 그리고 둘을 한 트랜잭션으로.
  //    먼저 쓰면 INSERT OR REPLACE 의 FK cascade 가 <기존 팩의 청크를 먼저 날리고>,
  //    그 뒤 재임베딩이나 청크 저장이 실패하면 팩이 <문서 행만 남은 껍데기>가 된다
  //    (코덱스 7차 P1, 2026-08-21 — indexer 에서 고친 것과 같은 결함이 여기 남아 있었다).
  // 🔴 청크가 <하나도> 안 만들어졌으면 기존 팩을 건드리지 않는다 (코덱스 8차 P2).
  //    replaceDocument 는 문서 행을 다시 쓰므로 cascade 로 기존 청크를 날리는데,
  //    이 실행은 그것을 대신할 청크를 하나도 못 만들었다. 같은 이름의 정상 팩을
  //    <차원이 어긋난 팩>으로 다시 가져오면 성공 반환과 함께 원본이 사라진다.
  //    ★"실패를 조용히 성공으로 보고" 하지 않으려면 여기서 멈추고 수치로 알려야 한다.
  if (chunks.length === 0) {
    // 🔴 <정상적으로 비어 있는 팩>과 <전부 거절된 팩>은 다른 사건이다 (코덱스 10차 P2).
    //    예전에는 둘을 합쳐, 애초에 청크가 0개인 팩에도 "0개가 전부 차원 불일치" 라고
    //    찍었다 — 원인을 잘못 짚게 만드는 로그다.
    console.error(
      skipped > 0
        ? `[pack] "${pack.name}": 청크 ${skipped}개가 전부 차원 불일치로 걸렸다 — `
          + `기존 팩을 보존하고 아무것도 쓰지 않는다.`
        : `[pack] "${pack.name}": 가져올 청크가 하나도 없다 — 아무것도 쓰지 않는다.`,
    );
    return { imported, skipped, reEmbedded, modelMismatch };
  }

  await store.replaceDocument({

    id: packDocId,
    filePath: `[pack] ${pack.name}`,
    title: `${pack.name} (Knowledge Pack)`,
    content: `Imported pack: ${pack.description}\nChunks: ${pack.chunks.length}\nAuthor: ${pack.author}`,
    frontmatter: { pack: pack.name, license: pack.license },
    tags: pack.tags,
    lastModified: pack.createdAt,
    contentHash: `pack_${pack.name}_${pack.version}`,
  }, chunks);

  return { imported, skipped, reEmbedded, modelMismatch };
}
