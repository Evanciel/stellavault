// Design Ref: §5 — FederatedSearch (피어 검색 + 결과 병합)
// Plan SC: SC2 (연합 검색), SC3 (원문 비노출), SC4 (3초 이내)

import { randomUUID } from 'node:crypto';
import type { FederationNode } from './node.js';
import type { VectorStore } from '../store/types.js';
import type { Embedder } from '../indexer/embedder.js';
import type { FederatedSearchResult } from './types.js';
import { maskSnippet } from './privacy.js';
import { isDocumentShareable, sanitizeSnippet } from './sharing.js';

export interface FederatedSearchOptions {
  limit?: number;
  timeout?: number; // ms, default 5000
}

export class FederatedSearch {
  private additionalStores: VectorStore[] = [];

  constructor(
    private node: FederationNode,
    private store: VectorStore,
    private embedder: Embedder,
  ) {}

  // Multi-vault: 추가 store 등록 (Federation 검색 응답 시 전체 vault 검색)
  addStore(store: VectorStore): void {
    this.additionalStores.push(store);
  }

  // Design Ref: §5 — search() 요청 측
  async search(query: string, options: FederatedSearchOptions = {}): Promise<FederatedSearchResult[]> {
    const { limit = 5, timeout = 5000 } = options;
    const peers = this.node.getPeers();

    if (peers.length === 0) {
      return [];
    }

    // 1. 쿼리 임베딩 생성
    const embedding = await this.embedder.embed(query);
    const queryId = randomUUID().slice(0, 8);

    // 2. 모든 피어에 병렬 전송 + 응답 대기
    const results: FederatedSearchResult[] = [];
    const peerMap = new Map(peers.map(p => [p.peerId, p.displayName]));

    const responsePromises = peers.map((peer) => {
      return new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, timeout);

        const handler = (data: { queryId: string; results: Array<{ title: string; similarity: number; snippet: string }>; peerId: string }) => {
          if (data.queryId !== queryId) return;

          for (const r of data.results) {
            results.push({
              title: r.title,
              similarity: r.similarity,
              snippet: r.snippet,
              peerId: peer.peerId,
              peerName: peer.displayName,
            });
          }

          clearTimeout(timer);
          this.node.removeListener('search_response', handler);
          resolve();
        };

        this.node.on('search_response', handler);

        // 쿼리 전송
        this.node.sendSearchQuery(peer.peerId, queryId, Array.from(embedding), limit);
      });
    });

    await Promise.allSettled(responsePromises);

    // 3. 결과 병합 — similarity 내림차순
    return results
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);
  }

  // Design Ref: §5 — startResponder() 피어 요청 수신 측
  startResponder(): void {
    this.node.on('search_request', async (req: {
      queryId: string;
      embedding: number[];
      limit: number;
      respondTo: string | null;
    }) => {
      if (!req.respondTo) return;

      try {
        // 받은 임베딩으로 모든 로컬 vault DB 검색 (multi-vault)
        const allStores = [this.store, ...this.additionalStores];
        const allScored = await Promise.all(
          allStores.map(s => s.searchSemantic(req.embedding, req.limit).catch(() => []))
        );
        const scored = allScored.flat().sort((a, b) => b.score - a.score).slice(0, req.limit);

        // Plan SC: SC3 — 원문 비노출. 제목+유사도+50자만.
        const safe: Array<{ title: string; similarity: number; snippet: string }> = [];
        for (const s of scored) {
          const chunk = await this.store.getChunk(s.chunkId);
          if (!chunk) continue;
          // 청크의 documentId에서 문서 제목 가져오기
          const doc = await this.store.getDocument(chunk.documentId);
          if (!doc) continue;

          // Sharing filter: 비공개 문서는 검색 결과에서 제외
          if (!isDocumentShareable({ tags: doc.tags, filePath: doc.filePath, id: doc.id, content: doc.content })) continue;

          safe.push({
            title: doc.title ?? chunk.heading ?? 'Untitled',
            similarity: Math.round(s.score * 1000) / 1000,
            snippet: sanitizeSnippet(maskSnippet(chunk.content.slice(0, 50), 0.2)),
          });
        }

        this.node.sendSearchResult(req.respondTo, req.queryId, safe);
      } catch (err) {
        // 검색 실패 시 빈 결과 반환
        this.node.sendSearchResult(req.respondTo, req.queryId, []);
      }
    });
  }
}
