// Design Ref: §3.3 — SQLite-vec 스키마
// Design Ref: §3.2 — VectorStore 인터페이스 구현

import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { VectorStore, DocumentMeta, LinkRow, LinkPair } from './types.js';
import { collectDocumentLinks, toLinkRows } from '../links/wikilink.js';
import type { Chunk, ScoredChunk, Document, TopicInfo, StoreStats } from '../types/index.js';

// Electron asar: SQLite loads vec0 through the OS dynamic loader (LoadLibrary/dlopen),
// which cannot read files packed inside app.asar — only app.asar.unpacked on disk.
// Outside Electron the path never contains ".asar", so this is a no-op passthrough.
function loadVecExtension(db: Database.Database): void {
  const loadablePath = sqliteVec.getLoadablePath();
  if (/\.asar[\\/]/.test(loadablePath)) {
    db.loadExtension(loadablePath.replace(/\.asar([\\/])/, '.asar.unpacked$1'));
  } else {
    sqliteVec.load(db);
  }
}

// B4 — document-diversity cap for the *lexical* and *semantic* signals.
// B2.1 already capped the entity signal at 2 chunks/document ("prevents one large
// note flooding top-k"); the other two lists had no cap, so a folder of near-duplicate
// notes could fill an entire candidate pool before fusion. Measured 2026-08-20 on a
// 69k-chunk vault: 163 templated notes held 7,552 chunks (10.9% of all chunks) and
// took 30/30 of the final top-30, while the correct answer sat at BM25 rank 1 and
// never entered the fused pool. RRF ranks by position, so being crowded out of a
// candidate list costs that whole signal.
const DOC_DIVERSITY_CAP = 2;
// Rows pulled before the cap is applied. The cap can discard at most
// (OVERFETCH-1)/OVERFETCH of them, so this keeps `limit` reachable while staying
// bounded. 🔴 "300 rows" 는 <지금 호출부의 limit=30 일 때>의 값일 뿐, 상한이 아니다
// (코덱스 11차 P3). 실제 천장은 아래 KNN_MAX_K(4,096) · FTS_MAX_WINDOW(65,536) 다 —
// limit 을 키우면 300 을 훌쩍 넘는다. 이 줄을 "최대 300" 으로 읽지 마라.
const DIVERSITY_OVERFETCH = 10;

/** KNN 의 k 를 키울 때의 천장. 무한히 키우면 한 번의 검색이 전체 벡터를 훑는다. */
const KNN_MAX_K = 4096;

/**
 * BM25 안쪽 창의 천장.
 * 🔴 창을 아예 없애면 결과는 옳지만 흔한 낱말에서 느려진다 — 실측 2026-08-21,
 *    69,762 청크 볼트에서 "agent"(매치 5,581) 34ms → 222ms (6.5배).
 *    그래서 <창을 없애는 대신 필요할 때만 넓힌다>. 보통 질의는 첫 창에서 끝난다.
 */
const FTS_MAX_WINDOW = 65536;

/**
 * 결과가 limit 에 못 미치면 창을 넓혀 가며 다시 뽑는다.
 *
 * 🔴 멈추는 조건은 <결과가 안 늘었다>가 아니라 <창을 다 못 채웠다>여야 한다.
 *    전자로 하면 한 문서가 250청크를 독식할 때 창 50·200 이 똑같이 2건이라
 *    거기서 멈춘다 — 뒤에 있는 멀쩡한 문서를 영원히 못 본다
 *    (코덱스 2차 P1, 2026-08-21: limit 5 인데 2건). 그래서 안쪽 행 수를
 *    함께 받아, 창이 포화였는지로 판정한다. 포화가 아니면 후보가 정말 없다.
 */
export function grow<T extends { inner_n: number }>(
  first: number, ceiling: number, take: (n: number) => T[], limit: number,
  /**
   * 창 n 에서 <바깥 조인 전> 내부 후보가 몇 개였는지. 결과가 0행일 때만 불린다.
   * 없으면 0행을 "매치 없음" 으로 보고 멈춘다(예전 동작).
   */
  probeInner?: (n: number) => number,
): T[] {
  let window = Math.min(first, ceiling);      // 첫 창도 천장을 넘지 않는다
  let rows = take(window);
  while (rows.length < limit && window < ceiling) {
    // 🔴 rows 가 비었다고 "매치 없음" 이 아니다 (코덱스 9차 P2). 바깥 JOIN 이 전부
    //    걷어냈을 수도 있다 — 고아 임베딩이 상위 k 를 채우면 정확히 그 모양이다.
    //    그때는 inner_n 을 읽을 행이 없어 <포화 여부를 알 수 없다>.
    //    ★추측하지 말고 <물어본다>. probeInner 가 없으면 예전대로 한 번만 묻는다
    //    (창을 무작정 키우면 진짜 빈 색인에서 천장까지 헛돈다 — 그 비용을 지키는
    //     시험이 이미 있다: "매치가 아예 없으면 한 번만 묻는다").
    if (rows.length === 0) {
      if (!probeInner) break;
      if (probeInner(window) < window) break;   // 내부도 포화가 아니었다 = 정말 없다
    } else if (rows[0].inner_n < window) {
      break;                                    // 창이 포화가 아니었다 = 더 없다
    }
    window = Math.min(window * 4, ceiling);
    rows = take(window);
  }
  return rows;
}

export function createSqliteVecStore(dbPath: string, dimensions: number = 384): VectorStore {
  let db: Database.Database;

  /**
   * documents 행과 그 문서의 links 를 쓴다. <반드시 트랜잭션 안에서> 부를 것.
   *
   * 🔴 INSERT OR REPLACE 는 행을 <지웠다 다시 넣으므로>, 그 순간 FK 의 ON DELETE CASCADE 가
   *    이 문서의 links <그리고 chunks>를 전부 날린다. links 는 여기서 함께 다시 쓰지만
   *    chunks 는 여기서 만들 수 없다(임베딩이 필요하다) — 그래서 문서만 따로 쓰면
   *    <청크 0 개인 문서>가 만들어진다. 그 상태는 행은 있는데 검색이 안 되는 유실이다.
   *    → 색인 경로는 upsertDocument 가 아니라 {@link replaceDocument} 를 쓴다.
   *    실측 2026-08-21: 청크 1개인 문서를 upsertDocument 로만 갱신하니 검색 1건 → 0건.
   */
  function writeDocumentRow(doc: Document): void {
    // 링크 재작성이 여기 안에 있는 이유(호출부에 맡기지 않는 이유):
    // INSERT OR REPLACE 는 documents 행을 지웠다 다시 넣으므로, 그 순간 links FK 의
    // ON DELETE CASCADE 가 이 문서의 링크를 전부 날린다. 호출부더러 뒤이어 upsertLinks 를
    // 부르라고 규약으로 정해두면, 그걸 안 부르는 경로가 하나만 생겨도 링크가 조용히 사라진다.
    // 실제로 그런 경로가 4개 있었다 — PUT /api/document/:id, ingest 2곳, pack/importer.
    // (`stellavault graph` 는 watcher 없이 API 서버만 띄우므로 재색인으로 복구되지도 않는다.)
    // links 는 content 의 순수 함수라 여기서 파생하면 규약이 아니라 구조로 보장된다.
    const links = toLinkRows(collectDocumentLinks(doc.content, doc.frontmatter));

    // 🔴 임베딩도 여기서 먼저 지운다 — <cascade 가 못 지우기 때문>이다.
    //    chunk_embeddings 는 vec0 가상 테이블이라 외래키에 참여하지 못한다. 아래
    //    INSERT OR REPLACE 가 documents 행을 지우면 cascade 가 chunks 를 날리는데,
    //    그 순간 임베딩은 <가리킬 청크를 잃은 채 남는다>. 그 뒤 writeChunkRows 가
    //    `chunk_id IN (SELECT id FROM chunks WHERE document_id = ?)` 로 지우려 해도
    //    청크가 이미 없어 서브쿼리가 빈 집합이다 — 한 줄도 안 지워진다.
    //    실측 2026-08-21: 실볼트에 고아 임베딩 317개(청크 39,125 / 임베딩 39,441).
    //    고아는 KNN 상위 창을 차지하고 조인에서 탈락해 <정상 결과를 밀어낸다>.
    //    ★그래서 청크가 아직 살아 있는 지금 지운다. 순서가 곧 정합성이다.
    db.prepare(
      'DELETE FROM chunk_embeddings WHERE chunk_id IN (SELECT id FROM chunks WHERE document_id = ?)'
    ).run(doc.id);

    // 🔴🔴 그리고 <다른 id 의 행>이 쫓겨나는 경우도 있다 (코덱스 10차 P1).
    //    UNIQUE(file_path) 때문에, 같은 경로를 가진 <다른 id> 의 행이 있으면
    //    INSERT OR REPLACE 가 그 행까지 지우고 cascade 로 그 청크를 날린다.
    //    위 한 줄은 doc.id 의 임베딩만 지우므로 그쪽은 고아가 된다.
    db.prepare(
      'DELETE FROM chunk_embeddings WHERE chunk_id IN ('
      + ' SELECT id FROM chunks WHERE document_id IN ('
      + ' SELECT id FROM documents WHERE file_path = ? AND id <> ?))'
    ).run(doc.filePath, doc.id);

    db.prepare(`
      INSERT OR REPLACE INTO documents (id, file_path, title, content, frontmatter, tags, last_modified, content_hash, indexed_at, source, type)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      doc.id, doc.filePath, doc.title, doc.content,
      JSON.stringify(doc.frontmatter), JSON.stringify(doc.tags),
      doc.lastModified, doc.contentHash, new Date().toISOString(),
      doc.source ?? 'local', doc.type ?? 'note'
    );
    writeLinks(db, doc.id, links);
  }

  /**
   * 한 문서의 청크·임베딩·엔티티를 통째로 교체한다. <반드시 트랜잭션 안에서> 부를 것.
   *
   * ⚠️ 대상 문서는 `chunks[0].documentId` 로 정한다 — 즉 <빈 배열이면 대상을 모른다>.
   *    그래서 `[]` 는 "청크를 전부 지운다" 가 아니라 <아무것도 하지 않는다> 이다
   *    (코덱스 11차 P2). 청크를 0 개로 만들려면 문서 행을 다시 쓰는 경로를 써라.
   */
  function writeChunkRows(chunks: Chunk[]): void {
    if (chunks.length === 0) return;
    // 🔴🔴 임베딩 없는 청크는 <검색에 영원히 안 잡힌다>. searchSemantic 이
    //    chunk_embeddings → chunks 방향 INNER JOIN 이라 청크만 있으면 도달 경로가 없다.
    //    예전에는 아래에서 `if (chunk.embedding)` 으로 <조용히 건너뛰었고>, 실볼트에
    //    실제로 그런 청크가 1개 있었다 (2026-08-21 실측: 08_Patterns/concepts/판단-보정.md
    //    — 그 문서는 semantic 검색 결과에 <존재하지 않았다>. 벡터를 채우니 1위로 떴다).
    //    ★프로덕션 호출부 셋(indexer ×2 · pack importer)은 전부 임베딩을 채운다.
    //     즉 그 분기에 정당한 용도가 없었다 — 결함을 숨기는 통로였을 뿐이다.
    const noVec = chunks.find(c => !c.embedding || c.embedding.length === 0);
    if (noVec) {
      throw new Error(
        `writeChunkRows: 임베딩 없는 청크는 검색되지 않는다 — 쓰지 않는다 (chunk=${noVec.id})`,
      );
    }
    const docId = chunks[0].documentId;

    // 기존 청크 삭제 (문서 단위 교체)
    // 새로 삽입할 chunk ID들도 미리 삭제 (다른 문서에서 온 중복 방지)
    const newChunkIds = chunks.map(c => c.id);
    db.prepare('DELETE FROM chunk_embeddings WHERE chunk_id IN (SELECT id FROM chunks WHERE document_id = ?)').run(docId);
    db.prepare('DELETE FROM chunks WHERE document_id = ?').run(docId);
    for (const cid of newChunkIds) {
      db.prepare('DELETE FROM chunk_embeddings WHERE chunk_id = ?').run(cid);
      db.prepare('DELETE FROM chunks WHERE id = ?').run(cid);
    }

    const insertChunk = db.prepare(`
      INSERT INTO chunks (id, document_id, content, heading, start_line, end_line, token_count)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const insertEmbedding = db.prepare(`
      INSERT INTO chunk_embeddings (chunk_id, embedding)
      VALUES (?, ?)
    `);
    // Stale chunk_entities are cleared via ON DELETE CASCADE when the old
    // chunks are deleted above; here we only insert the fresh set. (B2)
    const insertEntity = db.prepare(`
      INSERT INTO chunk_entities (chunk_id, entity)
      VALUES (?, ?)
    `);

    for (const chunk of chunks) {
      insertChunk.run(
        chunk.id, chunk.documentId, chunk.content,
        chunk.heading, chunk.startLine, chunk.endLine, chunk.tokenCount
      );
      // (임베딩 유무는 위에서 이미 걸렀다 — 여기서 다시 묻지 않는다)
      insertEmbedding.run(chunk.id, float32Buffer(chunk.embedding!));
      if (chunk.entities) {
        for (const entity of chunk.entities) insertEntity.run(chunk.id, entity);
      }
    }
  }

  return {
    async initialize() {
      mkdirSync(dirname(dbPath), { recursive: true });
      db = new Database(dbPath);
      loadVecExtension(db);
      db.pragma('journal_mode = WAL');
      db.pragma('foreign_keys = ON');
      createTables(db, dimensions);
      // 🔴 1회성 유지보수는 여기서 하지 않는다 (코덱스 12차 P1). 예전에는 여기서
      //    돌아서, <스토어를 여는 것만으로> "남의 DB 면 한 글자도 안 쓴다" 는 규약이
      //    이미 깨졌다 — 고아 임베딩을 지우고 완료 마커까지 썼다.
      //    소유가 확인된 뒤 색인기가 runMaintenanceOnce() 를 부른다.
    },

    runMaintenanceOnce() {
      backfillLinksOnce(db);
      purgeOrphanEmbeddingsOnce(db);
    },

    async upsertDocument(doc: Document) {
      db.transaction(() => writeDocumentRow(doc))();
    },

    /**
     * 문서와 그 청크를 <한 트랜잭션으로> 교체한다. 색인 경로는 이것을 쓴다.
     *
     * 🔴 upsertDocument → upsertChunks 를 <따로> 부르면, 그 사이에 실패했을 때
     *    문서 행은 새로 써졌는데 청크는 cascade 로 사라진 채 남는다(= 검색 불가).
     *    한 트랜잭션이면 청크 쓰기가 실패할 때 문서 교체도 함께 되돌아가,
     *    <옛 문서가 옛 청크와 함께> 그대로 검색된다 (코덱스 6a P1, 2026-08-21).
     */
    async replaceDocument(doc: Document, chunks: Chunk[]) {
      // 🔴 청크가 <이 문서의 것>인지 먼저 본다 (코덱스 11차 P1).
      //    writeChunkRows 는 대상 문서를 `chunks[0].documentId` 로 정하므로, doc 과
      //    다른 문서의 청크를 넘기면 <트랜잭션이 정상 커밋되면서> doc 은 청크 0 개가
      //    되고(문서 행 재작성의 cascade) 엉뚱한 문서 B 가 교체된다. 예외도 안 난다.
      //    ★"조용히 성공하는 파괴" 라 로그로도 안 보인다 — 쓰기 전에 거절한다.
      const alien = chunks.find(c => c.documentId !== doc.id);
      if (alien) {
        throw new Error(
          'replaceDocument: 청크가 다른 문서의 것이다'
          + ` (doc=${doc.id} · chunk=${alien.id} → ${alien.documentId})`,
        );
      }
      db.transaction(() => { writeDocumentRow(doc); writeChunkRows(chunks); })();
    },

    async upsertChunks(chunks: Chunk[]) {
      db.transaction(() => writeChunkRows(chunks))();
    },

    /**
     * 문서의 <내용만> 갱신하고 청크는 <건드리지 않는다>.
     *
     * INSERT OR REPLACE 가 아니라 UPDATE 다 — 행을 지우지 않으므로 FK cascade 가 안 돈다.
     * 임베더를 못 부르는 경로(에디터의 인라인 편집 등)에서 쓴다. 청크는 <낡은 채로>
     * 남지만, 문서가 검색에서 <사라지는 것>보다 낫다.
     *
     * 🔴 그래서 content_hash 를 빈 문자열로 덮는다 — 다음 색인이 반드시 다시 굽게 하려고.
     *    여기서 새 해시를 써 버리면 "변경 없음" 으로 건너뛰어 청크가 <영원히 낡는다>.
     */
    async upsertDocumentPreservingChunks(doc: Document) {
      const links = toLinkRows(collectDocumentLinks(doc.content, doc.frontmatter));
      db.transaction(() => {
        // 🔴 INSERT OR REPLACE 가 아니라 <ON CONFLICT DO UPDATE> 다. 이 차이가 전부다:
        //    전자는 행을 지웠다 다시 넣어 cascade 로 청크·링크를 날리고,
        //    후자는 <같은 행을 고쳐> cascade 를 아예 발생시키지 않는다.
        //    청크를 구울 수 없는 호출부(임베더가 없는 API·ingest 라우터)는 이것만 쓴다.
        //
        //    ★UPDATE 가 아니라 upsert 인 이유: ingest 는 <없는 문서>도 만든다.
        //    UPDATE 였다면 새 문서가 0행 갱신으로 조용히 사라졌을 것이다.
        //    content_hash 를 비워 두면 다음 색인이 같은 id 로 다시 구워 자가치유한다.
        db.prepare(`
          INSERT INTO documents (id, file_path, title, content, frontmatter, tags, last_modified, content_hash, indexed_at, source, type)
          VALUES (?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            file_path = excluded.file_path,
            title = excluded.title,
            content = excluded.content,
            frontmatter = excluded.frontmatter,
            tags = excluded.tags,
            last_modified = excluded.last_modified,
            content_hash = '',
            indexed_at = excluded.indexed_at
        `).run(
          doc.id, doc.filePath, doc.title, doc.content,
          JSON.stringify(doc.frontmatter), JSON.stringify(doc.tags),
          doc.lastModified, new Date().toISOString(),
          doc.source ?? 'local', doc.type ?? 'note',
        );
        writeLinks(db, doc.id, links);
      })();
    },

    async deleteByDocumentIds(documentIds: string[]) {
      if (documentIds.length === 0) return;
      const tx = db.transaction((ids: string[]) => {
        for (const id of ids) {
          db.prepare('DELETE FROM chunk_embeddings WHERE chunk_id IN (SELECT id FROM chunks WHERE document_id = ?)').run(id);
          db.prepare('DELETE FROM chunks WHERE document_id = ?').run(id);
          db.prepare('DELETE FROM links WHERE source_doc_id = ?').run(id);
          db.prepare('DELETE FROM documents WHERE id = ?').run(id);
        }
      });
      tx(documentIds);
    },

    async deleteByDocumentId(documentId: string) {
      const tx = db.transaction(() => {
        db.prepare('DELETE FROM chunk_embeddings WHERE chunk_id IN (SELECT id FROM chunks WHERE document_id = ?)').run(documentId);
        db.prepare('DELETE FROM chunks WHERE document_id = ?').run(documentId);
        // links 도 명시 삭제 — FK CASCADE 가 실제로 발화하긴 하지만, 정확성을
        // foreign_keys 프라그마가 켜져 있느냐에 묶어두지 않는다(chunks 와 동일한 방침).
        db.prepare('DELETE FROM links WHERE source_doc_id = ?').run(documentId);
        db.prepare('DELETE FROM documents WHERE id = ?').run(documentId);
      });
      tx();
    },

    async upsertLinks(sourceDocId: string, links: LinkRow[]) {
      const tx = db.transaction(() => { writeLinks(db, sourceDocId, links); });
      tx();
    },

    async getLinkPairs(): Promise<LinkPair[]> {
      return resolveLinkPairs(db);
    },

    async searchSemantic(embedding: number[], limit: number): Promise<ScoredChunk[]> {
      // sqlite-vec KNN: `k = ?` 제약 필수 (LIMIT만으론 vec0가 거부).
      // B4: k 를 과다인출한 뒤 문서당 DOC_DIVERSITY_CAP 개로 자른다. 자르기 전에
      // 뽑아야 하는 이유 — vec0 는 문서를 모르므로 상한을 KNN 안에 넣을 수 없다.
      // 🔴 고정 배수로는 결과 개수를 보장하지 못한다 — 상위 k 개가 <한 문서>에 몰리면
      //    상한을 적용한 뒤 2개만 남는다 (코덱스 P1, 2026-08-21: limit 5 인데 2개 반환).
      //    → 결과가 limit 을 채우거나 k 가 천장에 닿을 때까지 k 를 키운다.
      const stmt = db.prepare(`
        SELECT chunk_id, distance, inner_n FROM (
          SELECT e.chunk_id AS chunk_id, e.distance AS distance, e.inner_n AS inner_n,
                 ROW_NUMBER() OVER (PARTITION BY c.document_id ORDER BY e.distance, e.chunk_id) AS rn
          FROM (
            SELECT chunk_id, distance, COUNT(*) OVER () AS inner_n
            FROM chunk_embeddings
            WHERE embedding MATCH ? AND k = ?
            ORDER BY distance
          ) e
          JOIN chunks c ON c.id = e.chunk_id
        )
        WHERE rn <= ${DOC_DIVERSITY_CAP}
        ORDER BY distance, chunk_id
        LIMIT ?
      `);
      const buf = float32Buffer(embedding);
      // 0행일 때 <내부에는 몇 개 있었는지>를 따로 묻는다. 고아 임베딩이 상위 k 를
      // 채우면 바깥 조인이 전부 걷어내 0행이 되는데, 그것은 "없다" 가 아니다.
      const probe = db.prepare(
        'SELECT COUNT(*) AS n FROM (SELECT chunk_id FROM chunk_embeddings WHERE embedding MATCH ? AND k = ?)'
      );
      const rows = grow(
        Math.max(limit * DIVERSITY_OVERFETCH, limit), KNN_MAX_K,
        k => stmt.all(buf, k, limit) as Array<{ chunk_id: string; distance: number; inner_n: number }>,
        limit,
        k => (probe.get(buf, k) as { n: number }).n,
      );

      return rows.map(r => ({
        chunkId: r.chunk_id,
        score: 1 / (1 + r.distance),  // distance → similarity score
      }));
    },

    async searchKeyword(query: string, limit: number): Promise<ScoredChunk[]> {
      // B4: 문서당 DOC_DIVERSITY_CAP 개. FTS5 rank 는 음수라 ASC 가 좋은 순서다.
      // 🔴 안쪽 창을 <고정>하면, 한 문서가 그 창을 독식했을 때 상한 적용 후 남는 것이
      //    limit 에 못 미친다 (코덱스 P1, 2026-08-21: limit 5 인데 2건).
      //    창을 없애면 옳지만 느리다(위 FTS_MAX_WINDOW 주석의 실측) → 필요할 때만 넓힌다.
      const stmt = db.prepare(`
        SELECT chunk_id, rank, inner_n FROM (
          SELECT chunk_id, document_id, rank, inner_n,
                 ROW_NUMBER() OVER (PARTITION BY document_id ORDER BY rank, chunk_id) AS rn
          FROM (
            SELECT chunk_id, document_id, rank, COUNT(*) OVER () AS inner_n FROM (
            SELECT c.id AS chunk_id, c.document_id AS document_id, f.rank AS rank
            FROM chunks_fts f
            JOIN chunks c ON c.rowid = f.rowid
            WHERE chunks_fts MATCH ?
            ORDER BY rank
            LIMIT ?
          ))
        )
        WHERE rn <= ${DOC_DIVERSITY_CAP}
        ORDER BY rank, chunk_id
        LIMIT ?
      `);
      const rows = grow(
        Math.max(limit * DIVERSITY_OVERFETCH, limit), FTS_MAX_WINDOW,
        w => stmt.all(query, w, limit) as Array<{ chunk_id: string; rank: number; inner_n: number }>,
        limit,
      );

      return rows.map(r => ({
        chunkId: r.chunk_id,
        score: -r.rank,  // FTS5 rank is negative (lower = better)
      }));
    },

    async searchEntities(entities: string[], limit: number, exactExtra: string[] = []): Promise<ScoredChunk[]> {
      if ((!entities || entities.length === 0) && exactExtra.length === 0) return [];
      // B2.2 — alias/synonym terms (exactExtra, e.g. "jarvis" from a "자비스" query)
      // match EXACT only. They are precise synonyms, so they must NOT go through the
      // fuzzy substring path (which would broadly match "jarvis agent core", etc.).
      const allExact = [...entities, ...exactExtra];
      const exactPH = allExact.map(() => '?').join(',');

      // B2.1 — fuzzy substring matching for substantial *query* terms (multi-word,
      // non-Latin, or long single tokens), so a natural-language phrase still matches
      // a longer stored entity (e.g. "운명 프리즘" ⊂ "ai destiny (운명 프리즘)") without
      // a reindex. Short/common tokens (e.g. "ai", "db", "운명") and alias terms stay
      // exact-only to avoid noise + a costly LIKE scan.
      const fuzzy = entities
        .filter(t => t.length >= 4 && (/\s/.test(t) || /[^\x00-\x7f]/.test(t) || t.length >= 6))
        .slice(0, 16);

      // Inner "matched (chunk_id, score)". exact weighted 1.0, fuzzy-only 0.4; the
      // NOT IN guard avoids counting an exact hit again via its own substring.
      let matched: string;
      let matchedParams: unknown[];
      if (fuzzy.length === 0) {
        matched = `SELECT chunk_id, CAST(COUNT(*) AS REAL) AS score FROM chunk_entities WHERE entity IN (${exactPH}) GROUP BY chunk_id`;
        matchedParams = [...allExact];
      } else {
        const esc = (t: string) => t.replace(/[\\%_]/g, '\\$&');
        const likeClause = fuzzy.map(() => `entity LIKE ? ESCAPE '\\'`).join(' OR ');
        matched = `
          SELECT chunk_id, SUM(w) AS score FROM (
            SELECT chunk_id, 1.0 AS w FROM chunk_entities WHERE entity IN (${exactPH})
            UNION ALL
            SELECT chunk_id, 0.4 AS w FROM chunk_entities
              WHERE (${likeClause}) AND entity NOT IN (${exactPH})
          ) GROUP BY chunk_id`;
        matchedParams = [...allExact, ...fuzzy.map(t => `%${esc(t)}%`), ...allExact];
      }

      // B2.1 — document-diversity cap: keep at most 2 chunks per document so a single
      // large note can't monopolize the entity signal (the cause of top-k "flooding"
      // when the entity weight is raised). Then take the top `limit` overall. rrfFusionN
      // ranks by position, so higher-scoring (exact > fuzzy, more matches) chunks lead.
      const rows = db.prepare(`
        SELECT chunk_id, score FROM (
          SELECT m.chunk_id AS chunk_id, m.score AS score,
                 ROW_NUMBER() OVER (PARTITION BY c.document_id ORDER BY m.score DESC, m.chunk_id) AS rn
          FROM (${matched}) m
          JOIN chunks c ON c.id = m.chunk_id
        )
        WHERE rn <= 2
        ORDER BY score DESC, chunk_id
        LIMIT ?
      `).all(...matchedParams, limit) as Array<{ chunk_id: string; score: number }>;
      return rows.map(r => ({ chunkId: r.chunk_id, score: r.score }));
    },

    async getDocument(documentId: string): Promise<Document | null> {
      const row = db.prepare('SELECT * FROM documents WHERE id = ?').get(documentId) as DocumentRow | undefined;
      if (!row) return null;
      return rowToDocument(row);
    },

    async getChunk(chunkId: string): Promise<Chunk | null> {
      const row = db.prepare('SELECT * FROM chunks WHERE id = ?').get(chunkId) as ChunkRow | undefined;
      if (!row) return null;
      return rowToChunk(row);
    },

    async getAllDocuments(): Promise<Document[]> {
      const rows = db.prepare('SELECT * FROM documents ORDER BY last_modified DESC').all() as DocumentRow[];
      return rows.map(rowToDocument);
    },

    async getDocumentsMeta(maxDocs?: number): Promise<DocumentMeta[]> {
      // content/content_hash 컬럼 제외 — 본문을 힙에 올리지 않아 대규모 볼트 OOM 회피.
      const lim = typeof maxDocs === 'number' && Number.isFinite(maxDocs) && maxDocs > 0 ? Math.floor(maxDocs) : 0;
      const sql = 'SELECT id, file_path, title, frontmatter, tags, last_modified FROM documents ORDER BY last_modified DESC'
        + (lim > 0 ? ` LIMIT ${lim}` : '');
      const rows = db.prepare(sql).all() as Array<Pick<DocumentRow, 'id' | 'file_path' | 'title' | 'frontmatter' | 'tags' | 'last_modified'>>;
      return rows.map((r) => ({
        id: r.id,
        filePath: r.file_path,
        title: r.title,
        frontmatter: JSON.parse(r.frontmatter || '{}'),
        tags: JSON.parse(r.tags || '[]'),
        lastModified: r.last_modified,
      }));
    },

    async getTopics(): Promise<TopicInfo[]> {
      const rows = db.prepare(`
        SELECT je.value as tag, COUNT(DISTINCT d.id) as count
        FROM documents d, json_each(d.tags) je
        GROUP BY je.value
        ORDER BY count DESC
      `).all() as Array<{ tag: string; count: number }>;

      return rows.map(r => ({
        topic: r.tag,
        count: r.count,
        recentDocuments: [],
      }));
    },

    async getStats(): Promise<StoreStats> {
      const docCount = (db.prepare('SELECT COUNT(*) as c FROM documents').get() as CountRow).c;
      const chunkCount = (db.prepare('SELECT COUNT(*) as c FROM chunks').get() as CountRow).c;
      const lastRow = db.prepare('SELECT indexed_at FROM documents ORDER BY indexed_at DESC LIMIT 1').get() as IndexedAtRow | undefined;
      return {
        documentCount: docCount,
        chunkCount: chunkCount,
        dbSizeBytes: 0, // 나중에 파일 크기 조회
        lastIndexed: lastRow?.indexed_at ?? null,
      };
    },

    async getDocumentEmbeddings(maxDocs = 10000): Promise<Map<string, number[]>> {
      // 각 문서의 첫 청크 임베딩을 문서 대표 벡터로 사용.
      // ★PERF: 단일 쿼리로 로드. 이전엔 LIMIT/OFFSET 배치 루프가 매 배치마다
      // `SELECT MIN(id) ... GROUP BY document_id` 서브쿼리를 재실행 → 대형 볼트(수만 청크)에서
      // O(배치수 × 청크수) 전체 스캔 → 그래프 빌드가 메인 프로세스를 수 초간 블록(앱 "응답 없음").
      // 서브쿼리를 1회만 평가하도록 단일 SELECT + LIMIT 으로 교체(메모리: 10K docs×384f ≈ 15MB).
      const result = new Map<string, number[]>();
      const rows = db.prepare(`
        SELECT c.document_id AS document_id, ce.embedding AS embedding
        FROM chunks c
        JOIN chunk_embeddings ce ON ce.chunk_id = c.id
        WHERE c.id IN (SELECT MIN(id) FROM chunks GROUP BY document_id)
        LIMIT ?
      `).all(maxDocs) as Array<{ document_id: string; embedding: Buffer }>;
      for (const row of rows) {
        result.set(row.document_id, bufferToFloat32(row.embedding));
      }
      return result;
    },

    async getDocumentEmbeddingsByIds(documentIds: string[]): Promise<Map<string, number[]>> {
      const result = new Map<string, number[]>();
      if (documentIds.length === 0) return result;
      // ★PERF (measured 38×): only the requested docs. idx_chunks_document_id makes the
      // per-doc MIN(id) fast, then read each first-chunk embedding from chunk_embeddings
      // by its PK (chunk_id). Reading all 12k from the vec0 vtable ≈ 11s; the ~1.5k we
      // actually render ≈ 0.3s. Chunk the IN-lists to stay under SQLite's variable limit.
      const CHUNK = 800;
      for (let off = 0; off < documentIds.length; off += CHUNK) {
        const slice = documentIds.slice(off, off + CHUNK);
        const ph = slice.map(() => '?').join(',');
        const cidRows = db.prepare(
          `SELECT document_id AS d, MIN(id) AS cid FROM chunks WHERE document_id IN (${ph}) GROUP BY document_id`,
        ).all(...slice) as Array<{ d: string; cid: string }>;
        if (cidRows.length === 0) continue;
        const docByCid = new Map(cidRows.map((r) => [String(r.cid), r.d]));
        const cids = cidRows.map((r) => r.cid);
        const ph2 = cids.map(() => '?').join(',');
        const embRows = db.prepare(
          `SELECT chunk_id AS cid, embedding FROM chunk_embeddings WHERE chunk_id IN (${ph2})`,
        ).all(...cids) as Array<{ cid: string; embedding: Buffer }>;
        for (const row of embRows) {
          const docId = docByCid.get(String(row.cid));
          if (docId) result.set(docId, bufferToFloat32(row.embedding));
        }
      }
      return result;
    },

    async findDocumentNeighbors(embedding: number[], limit: number): Promise<Array<{ documentId: string; similarity: number }>> {
      // sqlite-vec KNN: `k = ?` 제약 필수. chunk 단위로 3배 뽑은 뒤 document로 dedupe.
      //
      // ⚠ 그래프 엣지 생성에 이걸 문서마다 호출하지 말 것. 2026-08-20 실볼트(17,303 문서) 실측:
      //
      //     문서당 220 ms  →  전량이면 약 63분
      //     같은 작업을 graph-data.ts 의 인메모리 전수 코사인으로 하면 101초 (약 37배 빠름)
      //
      // 이 함수의 예전 주석은 "HNSW, O(K log n)"이라고 적혀 있었지만 **사실이 아니다**.
      // sqlite-vec 의 `MATCH ... k=?` 는 근사 인덱스가 아니라 전 임베딩 전수 스캔이고,
      // 여기에 문서당 쿼리 오버헤드가 얹혀 O(n²)에 상수만 더 나쁜 형태가 된다.
      // 단건 조회(노트 하나의 이웃 찾기)에는 적합하지만 n번 반복하는 용도로는 부적합.
      const knnK = Math.max(limit * 3, 30);
      const rows = db.prepare(`
        SELECT c.document_id, MIN(ce.distance) as distance
        FROM chunk_embeddings ce
        JOIN chunks c ON c.id = ce.chunk_id
        WHERE ce.embedding MATCH ? AND k = ?
        GROUP BY c.document_id
        ORDER BY distance
        LIMIT ?
      `).all(float32Buffer(embedding), knnK, limit * 2) as Array<{ document_id: string; distance: number }>;

      return rows.slice(0, limit).map(r => ({
        documentId: r.document_id,
        similarity: 1 / (1 + r.distance),
      }));
    },

    getMeta(key: string): string | undefined {
      const row = db.prepare('SELECT value FROM stellavault_meta WHERE key = ?').get(key) as
        { value: string } | undefined;
      return row?.value;
    },

    setMeta(key: string, value: string): void {
      db.prepare('INSERT OR REPLACE INTO stellavault_meta (key, value) VALUES (?, ?)').run(key, value);
    },

    // key 가 PRIMARY KEY 라 DO NOTHING 이 <먼저 쓴 쪽>을 남긴다. 읽기까지 한
    // 트랜잭션에 넣어 그 사이에 다른 연결이 끼어들지 못하게 한다.
    claimMeta(key: string, value: string): string {
      const tx = db.transaction((k: string, v: string): string => {
        db.prepare(
          // 🔴 빈 문자열은 <미각인>이다 (checkVaultOwnership 이 그렇게 본다) — 그것까지
          //    DO NOTHING 으로 두면 각인이 영영 안 된다. 시험이 이것을 잡았다.
          'INSERT INTO stellavault_meta (key, value) VALUES (?, ?)'
          + ' ON CONFLICT(key) DO UPDATE SET value = excluded.value'
          + " WHERE stellavault_meta.value = ''",
        ).run(k, v);
        const row = db.prepare('SELECT value FROM stellavault_meta WHERE key = ?').get(k) as
          { value: string } | undefined;
        return row ? row.value : v;
      });
      return tx(key, value);
    },

    async close() {
      db.close();
    },

    getDb() {
      return db;
    },
  };
}

function bufferToFloat32(buf: Buffer): number[] {
  const float32 = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  return Array.from(float32);
}

function createTables(db: Database.Database, dimensions: number = 384) {
  // 기존 DB 마이그레이션: source/type 컬럼 추가
  try {
    db.exec(`ALTER TABLE documents ADD COLUMN source TEXT DEFAULT 'local'`);
  } catch { /* 이미 존재 */ }
  try {
    db.exec(`ALTER TABLE documents ADD COLUMN type TEXT DEFAULT 'note'`);
  } catch { /* 이미 존재 */ }

  db.exec(`
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      file_path TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      frontmatter TEXT,
      tags TEXT DEFAULT '[]',
      last_modified TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      indexed_at TEXT NOT NULL,
      source TEXT DEFAULT 'local',
      type TEXT DEFAULT 'note'
    );

    CREATE TABLE IF NOT EXISTS chunks (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      heading TEXT,
      start_line INTEGER,
      end_line INTEGER,
      token_count INTEGER
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS chunk_embeddings USING vec0(
      chunk_id TEXT PRIMARY KEY,
      embedding FLOAT[${dimensions}]
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
      content,
      heading,
      content='chunks',
      content_rowid='rowid'
    );

    CREATE INDEX IF NOT EXISTS idx_chunks_document_id ON chunks(document_id);
    CREATE INDEX IF NOT EXISTS idx_documents_content_hash ON documents(content_hash);

    CREATE TABLE IF NOT EXISTS chunk_entities (
      chunk_id TEXT NOT NULL REFERENCES chunks(id) ON DELETE CASCADE,
      entity TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_chunk_entities_entity ON chunk_entities(entity);
    CREATE INDEX IF NOT EXISTS idx_chunk_entities_chunk ON chunk_entities(chunk_id);

    -- 위키링크 원장. 마이그레이션 러너도 schema_version 테이블도 이 저장소엔 없다.
    -- 가산형 CREATE IF NOT EXISTS 가 확립된 패턴(chunk_entities 선례)이고 기존 사용자
    -- DB 에 무해하다.
    --
    -- target_doc_id 는 **의도적으로 없다**. 타깃 쪽에 FK 를 걸면(ON DELETE CASCADE)
    -- 타깃 파일이 지워질 때 소스의 행까지 사라진다 — 소스 본문엔 여전히 그 링크가
    -- 적혀 있는데 백링크만 조용히 증발한다. 해석은 질의 시점(resolveLinkPairs)에 한다.
    CREATE TABLE IF NOT EXISTS links (
      source_doc_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      target_raw    TEXT NOT NULL,
      target_norm   TEXT NOT NULL,
      section       TEXT,
      alias         TEXT,
      position      INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_links_source ON links(source_doc_id);
    -- target_norm 에는 일부러 인덱스를 걸지 않는다. 해석(resolveLinkPairs)은 target_norm 을
    -- WHERE 로 조회하지 않고 문서 인덱스를 메모리에 세운 뒤 전량 스캔하므로 읽는 쪽이 없고,
    -- 인덱스만 쓰기 증폭으로 남는다. 백링크 조회(WHERE target_norm = ?) 같은 실제 소비자가
    -- 생기면 그때 CREATE INDEX IF NOT EXISTS 로 추가하면 된다(기존 DB에도 무해하다).

    -- 1회성 작업(백필 등)의 영속 마커. PRAGMA user_version 은 정수 하나뿐이라
    -- 마이그레이션 러너 없이 여러 작업이 나눠 쓸 수 없다.
    CREATE TABLE IF NOT EXISTS stellavault_meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // FTS5 트리거: chunks INSERT/DELETE 시 자동 동기화
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN
      INSERT INTO chunks_fts(rowid, content, heading) VALUES (new.rowid, new.content, new.heading);
    END;
    CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
      INSERT INTO chunks_fts(chunks_fts, rowid, content, heading) VALUES('delete', old.rowid, old.content, old.heading);
    END;
  `);
}

// ─── links: 백필 + 해석 ────────────────────────────────────────────────────

const LINKS_BACKFILL_KEY = 'links_backfill_v1';
const ORPHAN_EMBEDDING_PURGE_KEY = 'orphan_embedding_purge_v1';
/** 배치 크기 — 본문을 한 번에 전부 힙에 올리지 않기 위한 값. */
const BACKFILL_BATCH = 200;

const INSERT_LINK_SQL = `
  INSERT INTO links (source_doc_id, target_raw, target_norm, section, alias, position)
  VALUES (?, ?, ?, ?, ?, ?)
`;

/**
 * 기존 DB 를 재인덱싱 없이 links 로 채운다. 1회성, 멱등.
 *
 * chunk_entities 는 백필 없이 출시되는 바람에 모든 기존 사용자에게서 사실상 빈 채로
 * 남아 있었다(10행 → 전체 재빌드 후에야 198,315행). links 는 그럴 필요가 없다 —
 * documents.content 가 이미 SQLite 안에 있다(실 DB 4,240/4,240 문서가 비어있지 않은
 * 본문 보유). 볼트 파일을 읽지 않고, 임베딩도 다시 만들지 않는다.
 *
 * 게이트는 COUNT(*)=0 이 아니라 영속 마커다. 링크가 정말 하나도 없는 볼트라면
 * COUNT(*)=0 이 영원히 참이라 앱을 켤 때마다 전 문서 본문을 다시 읽게 된다.
 */
/**
 * 한 문서의 링크 행을 통째로 교체한다. 명시 DELETE 후 INSERT — INSERT OR REPLACE 의 FK cascade 에
 * 기대지 않는다(그러면 correctness 가 foreign_keys 프라그마에 묶인다).
 * 호출자가 트랜잭션을 연 상태여야 한다.
 */
function writeLinks(db: Database.Database, sourceDocId: string, links: LinkRow[]): void {
  db.prepare('DELETE FROM links WHERE source_doc_id = ?').run(sourceDocId);
  if (links.length === 0) return;
  const insert = db.prepare(INSERT_LINK_SQL);
  for (const link of links) {
    insert.run(
      sourceDocId, link.targetRaw, link.targetNorm,
      link.section ?? null, link.alias ?? null, link.position ?? null,
    );
  }
}

/**
 * <이미 생겨 있던> 고아 임베딩을 한 번 치운다.
 *
 * 🔴 writeDocumentRow 의 선정리는 <앞으로> 고아가 생기는 것만 막는다. 그 패치 전에
 *    쌓인 것들은 가리킬 청크가 없어서 `chunk_id IN (SELECT id FROM chunks ...)` 로는
 *    <영원히 선택되지 않는다> — 전체 재색인을 해도 남는다 (코덱스 9차 P2).
 *    실볼트 실측 2026-08-21: 청크 39,125 / 임베딩 39,441 → 고아 317.
 *
 * 고아는 KNN 상위 창을 차지하고 바깥 JOIN 에서 탈락해 <정상 결과를 밀어낸다>.
 * 지워도 잃을 것이 없다 — 정의상 어떤 청크에도 이어지지 않는다.
 */
function purgeOrphanEmbeddingsOnce(db: Database.Database): void {
  if (db.prepare('SELECT value FROM stellavault_meta WHERE key = ?').get(ORPHAN_EMBEDDING_PURGE_KEY)) return;

  // vec0 가상 테이블은 DELETE ... WHERE NOT EXISTS 를 받지 않는 경우가 있어
  // id 를 먼저 모으고 한 건씩 지운다.
  // 🔴 조회와 삭제를 <한 트랜잭션>에 넣는다 (코덱스 10차 P1). 나눠 두면, 이 프로세스가
  //    고아 id 를 모은 뒤 <다른 색인 프로세스>가 같은 id 로 정상 청크·임베딩을 다시
  //    구웠을 때, 우리가 캐시한 목록으로 그 <정상> 임베딩을 지운다.
  //    이 볼트에는 실제로 색인 프로세스가 여럿 붙는다(잠금은 아직 없다).
  const purged = db.transaction((): number => {
    const orphans = db.prepare(
      'SELECT e.chunk_id AS id FROM chunk_embeddings e'
      + ' WHERE NOT EXISTS (SELECT 1 FROM chunks c WHERE c.id = e.chunk_id)',
    ).all() as Array<{ id: string }>;
    const del = db.prepare('DELETE FROM chunk_embeddings WHERE chunk_id = ?');
    for (const o of orphans) del.run(o.id);
    return orphans.length;
  })();

  if (purged > 0) {
    console.error(`[store] 고아 임베딩 ${purged}개를 정리했다 (1회성).`);
  }

  db.prepare('INSERT OR REPLACE INTO stellavault_meta (key, value) VALUES (?, ?)')
    .run(ORPHAN_EMBEDDING_PURGE_KEY, new Date().toISOString());
}

function backfillLinksOnce(db: Database.Database): void {
  const done = db.prepare('SELECT value FROM stellavault_meta WHERE key = ?').get(LINKS_BACKFILL_KEY);
  if (done) return;

  const page = db.prepare('SELECT id, frontmatter, content FROM documents ORDER BY id LIMIT ? OFFSET ?');
  const del = db.prepare('DELETE FROM links WHERE source_doc_id = ?');
  const insert = db.prepare(INSERT_LINK_SQL);

  let offset = 0;
  for (;;) {
    const rows = page.all(BACKFILL_BATCH, offset) as Array<{
      id: string; frontmatter: string | null; content: string | null;
    }>;
    if (rows.length === 0) break;

    const tx = db.transaction(() => {
      for (const row of rows) {
        let frontmatter: unknown;
        try {
          frontmatter = row.frontmatter ? JSON.parse(row.frontmatter) : undefined;
        } catch {
          frontmatter = undefined; // 손상된 JSON — 본문 링크만 담는다
        }
        const links = toLinkRows(collectDocumentLinks(row.content ?? '', frontmatter));
        del.run(row.id); // 멱등: 두 번 돌아도 행이 두 배가 되지 않는다
        for (const link of links) {
          insert.run(row.id, link.targetRaw, link.targetNorm, link.section, link.alias, link.position);
        }
      }
    });
    tx();

    offset += rows.length;
    if (rows.length < BACKFILL_BATCH) break;
  }

  db.prepare('INSERT OR REPLACE INTO stellavault_meta (key, value) VALUES (?, ?)')
    .run(LINKS_BACKFILL_KEY, new Date().toISOString());
}

function lastSegment(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return i >= 0 ? p.slice(i + 1) : p;
}

function stripMdExt(p: string): string {
  return p.replace(/\.md$/i, '');
}

function folderOf(p: string): string {
  const i = p.lastIndexOf('/');
  return i >= 0 ? p.slice(0, i) : '';
}

interface DocIndex {
  pathById: Map<string, string>;
  byPath: Map<string, string[]>;
  byBasename: Map<string, string[]>;
  byFmTitle: Map<string, string[]>;
  byTitle: Map<string, string[]>;
  ciPath: Map<string, string[]>;
  ciBasename: Map<string, string[]>;
  ciFmTitle: Map<string, string[]>;
  ciTitle: Map<string, string[]>;
}

/**
 * 후보 사다리 (앞에서부터, 첫 명중이 이긴다 — 실측 606개 타깃 기준):
 *   (a) vault 상대경로 + .md 정확일치      0.50%
 *   (b) basename 일치, 대소문자 구분      87.8%
 *   (c) frontmatter title 일치            +8.1%p (88.4% → 96.5%)
 *   (d) H1 일치
 *   (e) (a)~(d) 대소문자 무시 재시도
 *
 * (d)의 H1 은 본문을 다시 읽지 않는다: scanner.parseDocument 가 이미
 * `title = frontmatter.title ?? 첫 H1 ?? 경로` 로 채워두므로 documents.title 컬럼이
 * frontmatter title 이 없을 때의 H1 그 자체다. 17k 문서 본문 재스캔 대신 컬럼 하나.
 */
function lookupCandidates(target: string, ix: DocIndex): string[] | undefined {
  const base = stripMdExt(lastSegment(target));
  const lower = target.toLowerCase();
  const lowerBase = base.toLowerCase();
  return (
    ix.byPath.get(target)
    ?? ix.byPath.get(`${target}.md`)
    ?? ix.byBasename.get(base)
    ?? ix.byFmTitle.get(target)
    ?? ix.byTitle.get(target)
    ?? ix.ciPath.get(lower)
    ?? ix.ciPath.get(`${lower}.md`)
    ?? ix.ciBasename.get(lowerBase)
    ?? ix.ciFmTitle.get(lower)
    ?? ix.ciTitle.get(lower)
  );
}

/**
 * 동점 처리: 같은 폴더 > 짧은 경로 > _wiki 아래가 아닌 경로 > 경로 사전순.
 *
 * 실측상 이미 946개 파일이 378개의 basename 중복 그룹을 이루고 있다("index" 만 25개).
 * 지금의 링크들이 우연히 그걸 안 건드릴 뿐이라, 해석은 항상 후보 "배열" 위에서 돌아야 한다.
 * 특히 이 프로젝트의 compile 단계가 raw/<ts>-<slug>.md 와 같은 title 을 가진
 * _wiki/<slug>.md 를 만들어내서, title 사다리(c) 후보 48개 중 41개가 동점이다.
 * 마지막 사전순 비교는 총순서를 보장해 같은 DB 에서 항상 같은 답이 나오게 한다.
 */
function tieBreakCandidates(candidates: string[], sourcePath: string, pathById: Map<string, string>): string {
  if (candidates.length === 1) return candidates[0];
  const srcFolder = folderOf(sourcePath);
  const scored = candidates.map((id) => ({ id, path: pathById.get(id) ?? '' }));
  scored.sort((a, b) =>
    (folderOf(a.path) === srcFolder ? 0 : 1) - (folderOf(b.path) === srcFolder ? 0 : 1)
    || a.path.length - b.path.length
    || (a.path.startsWith('_wiki/') ? 1 : 0) - (b.path.startsWith('_wiki/') ? 1 : 0)
    || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0),
  );
  return scored[0].id;
}

function resolveLinkPairs(db: Database.Database): LinkPair[] {
  const docs = db.prepare('SELECT id, file_path, title, frontmatter FROM documents').all() as Array<{
    id: string; file_path: string; title: string | null; frontmatter: string | null;
  }>;
  if (docs.length === 0) return [];

  const ix: DocIndex = {
    pathById: new Map(),
    byPath: new Map(), byBasename: new Map(), byFmTitle: new Map(), byTitle: new Map(),
    ciPath: new Map(), ciBasename: new Map(), ciFmTitle: new Map(), ciTitle: new Map(),
  };
  const push = (m: Map<string, string[]>, key: string, id: string) => {
    if (!key) return;
    const cur = m.get(key);
    if (cur) cur.push(id);
    else m.set(key, [id]);
  };

  for (const doc of docs) {
    const path = doc.file_path;
    ix.pathById.set(doc.id, path);
    push(ix.byPath, path, doc.id);
    push(ix.ciPath, path.toLowerCase(), doc.id);

    const base = stripMdExt(lastSegment(path));
    push(ix.byBasename, base, doc.id);
    push(ix.ciBasename, base.toLowerCase(), doc.id);

    let fmTitle = '';
    if (doc.frontmatter) {
      try {
        const fm = JSON.parse(doc.frontmatter) as Record<string, unknown>;
        if (typeof fm?.title === 'string') fmTitle = fm.title.trim();
      } catch {
        fmTitle = ''; // 손상된 frontmatter JSON — title 사다리만 건너뛴다
      }
    }
    push(ix.byFmTitle, fmTitle, doc.id);
    push(ix.ciFmTitle, fmTitle.toLowerCase(), doc.id);

    const title = (doc.title ?? '').trim();
    push(ix.byTitle, title, doc.id);
    push(ix.ciTitle, title.toLowerCase(), doc.id);
  }

  const rows = db.prepare('SELECT source_doc_id, target_raw FROM links ORDER BY source_doc_id, position').all() as Array<{
    source_doc_id: string; target_raw: string;
  }>;

  const pairs: LinkPair[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const sourcePath = ix.pathById.get(row.source_doc_id);
    if (sourcePath === undefined) continue; // 소스 문서가 사라진 잔여 행
    const target = row.target_raw.trim();
    if (!target) continue;

    const candidates = lookupCandidates(target, ix);
    if (!candidates || candidates.length === 0) continue; // broken — 실측 11.55%

    const targetDocId = tieBreakCandidates(candidates, sourcePath, ix.pathById);
    if (targetDocId === row.source_doc_id) continue; // 자기 참조는 그래프 자기루프가 된다
    const key = `${row.source_doc_id} -> ${targetDocId}`;
    if (seen.has(key)) continue; // 같은 문서를 세 번 링크해도 엣지는 하나
    seen.add(key);
    pairs.push({ sourceDocId: row.source_doc_id, targetDocId });
  }
  return pairs;
}

/**
 * 저수준 헬퍼(store/index.ts 에서 재export). 저장소 내 호출자는 현재 없다 — "indexer에서 호출"
 * 이라는 예전 주석은 사실이 아니었다. 그래도 남겨두는 이상 링크를 같이 써야 한다: 이 함수도
 * INSERT OR REPLACE 라서, 링크 재기록 없이 부르면 그 문서의 links 행이 cascade 로 사라진다.
 * (store.upsertDocument 가 구조적으로 막아둔 바로 그 구멍을 이 경로로 되살리게 된다.)
 */
export function upsertDocument(db: Database.Database, doc: Document) {
  const links = toLinkRows(collectDocumentLinks(doc.content, doc.frontmatter));
  const tx = db.transaction(() => {
    // cascade 가 chunks 는 지우지만 chunk_embeddings 는 못 지운다(vec0 가상 테이블은
    // 외래키에 참여하지 못한다). 청크가 살아 있는 <지금> 지워야 고아가 안 남는다.
    // 근거·실측은 writeDocumentRow 의 같은 줄 주석에 있다.
    db.prepare(
      'DELETE FROM chunk_embeddings WHERE chunk_id IN (SELECT id FROM chunks WHERE document_id = ?)'
    ).run(doc.id);
    // 🔴 UNIQUE(file_path) 충돌로 <다른 id 의 행>이 쫓겨나는 경우도 같다 (코덱스 10차 P1).
    db.prepare(
      'DELETE FROM chunk_embeddings WHERE chunk_id IN ('
      + ' SELECT id FROM chunks WHERE document_id IN ('
      + ' SELECT id FROM documents WHERE file_path = ? AND id <> ?))'
    ).run(doc.filePath, doc.id);
    db.prepare(`
      INSERT OR REPLACE INTO documents (id, file_path, title, content, frontmatter, tags, last_modified, content_hash, indexed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      doc.id, doc.filePath, doc.title, doc.content,
      JSON.stringify(doc.frontmatter), JSON.stringify(doc.tags),
      doc.lastModified, doc.contentHash, new Date().toISOString()
    );
    writeLinks(db, doc.id, links);
  });
  tx();
}

interface DocumentRow {
  id: string; file_path: string; title: string; content: string;
  frontmatter: string; tags: string; last_modified: string; content_hash: string;
  indexed_at?: string;
}

interface ChunkRow {
  id: string; document_id: string; content: string; heading?: string;
  start_line: number; end_line: number; token_count: number;
}

interface CountRow { c: number }
interface IndexedAtRow { indexed_at?: string }

function rowToDocument(row: DocumentRow): Document {
  return {
    id: row.id,
    filePath: row.file_path,
    title: row.title,
    content: row.content,
    frontmatter: JSON.parse(row.frontmatter || '{}'),
    tags: JSON.parse(row.tags || '[]'),
    lastModified: row.last_modified,
    contentHash: row.content_hash,
  };
}

function rowToChunk(row: ChunkRow): Chunk {
  return {
    id: row.id,
    documentId: row.document_id,
    content: row.content,
    heading: row.heading ?? '',
    startLine: row.start_line,
    endLine: row.end_line,
    tokenCount: row.token_count,
  };
}

function float32Buffer(arr: number[]): Buffer {
  return Buffer.from(new Float32Array(arr).buffer);
}
