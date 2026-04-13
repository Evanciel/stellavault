// Knowledge management routes: duplicates, gaps, merge, bridge
// Extracted from server.ts for modular architecture.

import { Router } from 'express';
import type { VectorStore } from '../../store/types.js';
import type { SearchEngine } from '../../search/index.js';
import { detectDuplicates } from '../../intelligence/duplicate-detector.js';
import { detectKnowledgeGaps } from '../../intelligence/gap-detector.js';

interface KnowledgeRouterOptions {
  store: VectorStore;
  searchEngine: SearchEngine;
  vaultPath: string;
  requireAuth: (req: any, res: any, next: any) => void;
}

export function createKnowledgeRouter(opts: KnowledgeRouterOptions): Router {
  const { store, searchEngine, vaultPath, requireAuth } = opts;
  const router = Router();

  // GET /duplicates — 중복 노트 탐지
  router.get('/duplicates', async (req, res) => {
    try {
      const threshold = parseFloat(String(req.query.threshold ?? '0.88'));
      const pairs = await detectDuplicates(store, threshold, 20);
      res.json({ pairs, count: pairs.length, threshold });
    } catch (err) {
      console.error(err); res.status(500).json({ error: 'Internal server error' });
    }
  });

  // GET /gaps — 지식 갭 탐지
  router.get('/gaps', async (_req, res) => {
    try {
      const report = await detectKnowledgeGaps(store);
      res.json(report);
    } catch (err) {
      console.error(err); res.status(500).json({ error: 'Internal server error' });
    }
  });

  // POST /duplicates/merge — 중복 노트 자동 병합
  router.post('/duplicates/merge', requireAuth, async (req, res) => {
    try {
      const { docAId, docBId } = req.body;
      if (!docAId || !docBId) { res.status(400).json({ error: 'docAId, docBId required' }); return; }

      const docA = await store.getDocument(docAId);
      const docB = await store.getDocument(docBId);
      if (!docA || !docB) { res.status(404).json({ error: 'Document not found' }); return; }

      const { readFileSync, writeFileSync, unlinkSync } = await import('node:fs');
      const { join, resolve } = await import('node:path');

      const [keeper, removed] = docA.content.length >= docB.content.length
        ? [docA, docB] : [docB, docA];

      // HIGH-02: Path Traversal 방어
      const keeperPath = resolve(join(vaultPath, keeper.filePath));
      const removedPath = resolve(join(vaultPath, removed.filePath));
      const vaultRoot = resolve(vaultPath);
      if (!keeperPath.startsWith(vaultRoot) || !removedPath.startsWith(vaultRoot)) {
        res.status(400).json({ error: 'Invalid file path' }); return;
      }

      const keeperContent = readFileSync(keeperPath, 'utf-8');
      const appendix = `\n\n---\n\n> Merged from: ${removed.title} (${removed.filePath})\n\n${removed.content}`;
      writeFileSync(keeperPath, keeperContent + appendix, 'utf-8');

      try { unlinkSync(removedPath); } catch { /* 이미 없을 수 있음 */ }
      await store.deleteByDocumentId(removed.id);

      res.json({
        success: true,
        kept: { id: keeper.id, title: keeper.title },
        removed: { id: removed.id, title: removed.title },
      });
    } catch (err) {
      console.error(err); res.status(500).json({ error: 'Merge failed' });
    }
  });

  // POST /gaps/create-bridge — 갭 브릿지 노트 자동 생성
  router.post('/gaps/create-bridge', requireAuth, async (req, res) => {
    try {
      const { clusterA, clusterB } = req.body;
      if (!clusterA || !clusterB) { res.status(400).json({ error: 'clusterA, clusterB required' }); return; }

      const { writeFileSync, mkdirSync } = await import('node:fs');
      const { join, resolve } = await import('node:path');

      const nameA = clusterA.replace(/\s*\(\d+\)$/, '');
      const nameB = clusterB.replace(/\s*\(\d+\)$/, '');

      const resultsA = await searchEngine.search({ query: nameA, limit: 3 });
      const resultsB = await searchEngine.search({ query: nameB, limit: 3 });

      const refsA = resultsA.map(r => `- [[${r.document.title}]]: ${r.document.content.slice(0, 100).replace(/\n/g, ' ')}...`).join('\n');
      const refsB = resultsB.map(r => `- [[${r.document.title}]]: ${r.document.content.slice(0, 100).replace(/\n/g, ' ')}...`).join('\n');

      const title = `${nameA} × ${nameB}`;
      const date = new Date().toISOString().slice(0, 10);
      const content = [
        '---',
        `title: "${title}"`,
        `created: ${date}`,
        'tags: [bridge, auto-generated]',
        '---',
        '',
        `# ${title}`,
        '',
        `> 이 노트는 지식 갭 탐지기에 의해 자동 생성되었습니다.`,
        `> ${nameA}와 ${nameB} 사이의 연결 지식을 정리하세요.`,
        '',
        `## ${nameA} 핵심 노트`,
        '',
        refsA || '- (관련 노트 없음)',
        '',
        `## ${nameB} 핵심 노트`,
        '',
        refsB || '- (관련 노트 없음)',
        '',
        '## 연결 포인트',
        '',
        `${nameA}와 ${nameB}의 관계:`,
        '',
        '- ',
        '',
        '## 메모',
        '',
        '',
      ].join('\n');

      const safeTitle = title.replace(/[<>:"/\\|?*]/g, '').replace(/\s+/g, ' ');
      const dir = resolve(join(vaultPath, '01_Knowledge'));
      if (!dir.startsWith(resolve(vaultPath))) { res.status(400).json({ error: 'Invalid path' }); return; }
      mkdirSync(dir, { recursive: true });
      const filePath = join(dir, `${safeTitle}.md`);
      writeFileSync(filePath, content, 'utf-8');

      res.json({ success: true, title: safeTitle, path: filePath });
    } catch (err) {
      console.error(err); res.status(500).json({ error: 'Bridge creation failed' });
    }
  });

  return router;
}
