// Design Ref: §3.3 — SQLite-vec 스키마
// Design Ref: §3.2 — VectorStore 인터페이스 구현

import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { VectorStore } from './types.js';
import type { Chunk, ScoredChunk, Document, TopicInfo, StoreStats } from '../types/index.js';

export function createSqliteVecStore(dbPath: string, dimensions: number = 384): VectorStore {
  let db: Database.Database;

  return {
    async initialize() {
      mkdirSync(dirname(dbPath), { recursive: true });
      db = new Database(dbPath);
      sqliteVec.load(db);
      db.pragma('journal_mode = WAL');
      db.pragma('foreign_keys = ON');
      createTables(db, dimensions);
    },

    async upsertDocument(doc: Document) {
      db.prepare(`
        INSERT OR REPLACE INTO documents (id, file_path, title, content, frontmatter, tags, last_modified, content_hash, indexed_at, source, type)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        doc.id, doc.filePath, doc.title, doc.content,
        JSON.stringify(doc.frontmatter), JSON.stringify(doc.tags),
        doc.lastModified, doc.contentHash, new Date().toISOString(),
        doc.source ?? 'local', doc.type ?? 'note'
      );
    },

    async upsertChunks(chunks: Chunk[]) {
      if (chunks.length === 0) return;
      const docId = chunks[0].documentId;

      const tx = db.transaction(() => {
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

        for (const chunk of chunks) {
          insertChunk.run(
            chunk.id, chunk.documentId, chunk.content,
            chunk.heading, chunk.startLine, chunk.endLine, chunk.tokenCount
          );
          if (chunk.embedding) {
            insertEmbedding.run(chunk.id, float32Buffer(chunk.embedding));
          }
        }
      });
      tx();
    },

    async deleteByDocumentId(documentId: string) {
      const tx = db.transaction(() => {
        db.prepare('DELETE FROM chunk_embeddings WHERE chunk_id IN (SELECT id FROM chunks WHERE document_id = ?)').run(documentId);
        db.prepare('DELETE FROM chunks WHERE document_id = ?').run(documentId);
        db.prepare('DELETE FROM documents WHERE id = ?').run(documentId);
      });
      tx();
    },

    async searchSemantic(embedding: number[], limit: number): Promise<ScoredChunk[]> {
      // sqlite-vec KNN: `k = ?` 제약 필수 (LIMIT만으론 vec0가 거부)
      const rows = db.prepare(`
        SELECT chunk_id, distance
        FROM chunk_embeddings
        WHERE embedding MATCH ? AND k = ?
        ORDER BY distance
      `).all(float32Buffer(embedding), limit) as Array<{ chunk_id: string; distance: number }>;

      return rows.map(r => ({
        chunkId: r.chunk_id,
        score: 1 / (1 + r.distance),  // distance → similarity score
      }));
    },

    async searchKeyword(query: string, limit: number): Promise<ScoredChunk[]> {
      const rows = db.prepare(`
        SELECT c.id as chunk_id, rank
        FROM chunks_fts f
        JOIN chunks c ON c.rowid = f.rowid
        WHERE chunks_fts MATCH ?
        ORDER BY rank
        LIMIT ?
      `).all(query, limit) as Array<{ chunk_id: string; rank: number }>;

      return rows.map(r => ({
        chunkId: r.chunk_id,
        score: -r.rank,  // FTS5 rank is negative (lower = better)
      }));
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
      // 각 문서의 첫 청크 임베딩을 문서 대표 벡터로 사용
      // maxDocs로 메모리 상한 설정 (10K docs × 384 floats ≈ 15MB)
      const BATCH_SIZE = 500;
      const result = new Map<string, number[]>();
      const stmt = db.prepare(`
        SELECT c.document_id, ce.embedding
        FROM chunks c
        JOIN chunk_embeddings ce ON ce.chunk_id = c.id
        WHERE c.id IN (
          SELECT MIN(id) FROM chunks GROUP BY document_id
        )
        LIMIT ? OFFSET ?
      `);

      for (let offset = 0; offset < maxDocs; offset += BATCH_SIZE) {
        const rows = stmt.all(Math.min(BATCH_SIZE, maxDocs - offset), offset) as Array<{ document_id: string; embedding: Buffer }>;
        if (rows.length === 0) break;
        for (const row of rows) {
          result.set(row.document_id, bufferToFloat32(row.embedding));
        }
      }
      return result;
    },

    async findDocumentNeighbors(embedding: number[], limit: number): Promise<Array<{ documentId: string; similarity: number }>> {
      // sqlite-vec KNN (HNSW): `k = ?` 제약 필수. chunk 단위로 3배 뽑은 뒤 document로 dedupe
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

// Document 헬퍼: upsertDocument는 indexer에서 호출
export function upsertDocument(db: Database.Database, doc: Document) {
  db.prepare(`
    INSERT OR REPLACE INTO documents (id, file_path, title, content, frontmatter, tags, last_modified, content_hash, indexed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    doc.id, doc.filePath, doc.title, doc.content,
    JSON.stringify(doc.frontmatter), JSON.stringify(doc.tags),
    doc.lastModified, doc.contentHash, new Date().toISOString()
  );
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
