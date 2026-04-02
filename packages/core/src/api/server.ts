// Design Ref: §4.1 — REST API (core/api/)
// Design Ref: §7 — Security: localhost only, CORS restricted

import express from 'express';
import cors from 'cors';
import type { VectorStore } from '../store/types.js';
import type { SearchEngine } from '../search/index.js';
import { buildGraphData, type BuildGraphOptions } from './graph-data.js';
import type { DecayEngine } from '../intelligence/decay-engine.js';
import { detectDuplicates } from '../intelligence/duplicate-detector.js';
import { detectKnowledgeGaps } from '../intelligence/gap-detector.js';

export interface ApiServerOptions {
  store: VectorStore;
  searchEngine: SearchEngine;
  port?: number;
  vaultName?: string;
  vaultPath?: string;
  decayEngine?: DecayEngine;
}

export function createApiServer(options: ApiServerOptions) {
  const { store, searchEngine, port = 3333, vaultName = '', vaultPath = '', decayEngine } = options;
  const app = express();

  app.use(cors({ origin: ['http://localhost:5173', 'http://127.0.0.1:5173'] }));
  app.use(express.json());

  // GET /api/graph?mode=semantic|folder — 전체 그래프 데이터
  const graphCaches = new Map<string, { data: any; generatedAt: string }>();

  app.get('/api/graph', async (req, res) => {
    try {
      const mode = (req.query.mode as string) === 'folder' ? 'folder' : 'semantic';
      if (!graphCaches.has(mode)) {
        const data = await buildGraphData(store, { mode });
        graphCaches.set(mode, { data, generatedAt: new Date().toISOString() });
      }
      const cached = graphCaches.get(mode)!;
      res.json({ data: cached.data, generatedAt: cached.generatedAt, mode });
    } catch (err) {
      console.error(err); res.status(500).json({ error: 'Internal server error' });
    }
  });

  // GET /api/graph/refresh?mode= — 캐시 무효화 + 재생성
  app.get('/api/graph/refresh', async (req, res) => {
    try {
      const mode = (req.query.mode as string) === 'folder' ? 'folder' : 'semantic';
      const data = await buildGraphData(store, { mode });
      graphCaches.set(mode, { data, generatedAt: new Date().toISOString() });
      const cached = graphCaches.get(mode)!;
      res.json({ data: cached.data, generatedAt: cached.generatedAt, mode });
    } catch (err) {
      console.error(err); res.status(500).json({ error: 'Internal server error' });
    }
  });

  // GET /api/search?q=&limit=
  app.get('/api/search', async (req, res) => {
    try {
      const query = String(req.query.q || '');
      const limit = parseInt(String(req.query.limit || '10'), 10);
      if (!query) { res.json({ results: [], query: '' }); return; }

      const results = await searchEngine.search({ query, limit });

      // 검색 결과 문서에 대해 접근 이벤트 기록 (감쇠 리셋)
      if (decayEngine) {
        const now = new Date().toISOString();
        for (const r of results) {
          decayEngine.recordAccess({ documentId: r.document.id, type: 'search', timestamp: now }).catch(() => {});
        }
      }

      res.json({
        results: results.map(r => ({
          documentId: r.document.id,
          title: r.document.title,
          score: Math.round(r.score * 1000) / 1000,
          highlights: r.highlights,
        })),
        query,
      });
    } catch (err) {
      console.error(err); res.status(500).json({ error: 'Internal server error' });
    }
  });

  // GET /api/document/:id
  app.get('/api/document/:id', async (req, res) => {
    try {
      const doc = await store.getDocument(req.params.id);
      if (!doc) { res.status(404).json({ error: 'Not found' }); return; }

      // 접근 이벤트 기록 (감쇠 리셋)
      if (decayEngine) {
        decayEngine.recordAccess({ documentId: doc.id, type: 'view', timestamp: new Date().toISOString() }).catch(() => {});
      }

      // 관련 문서 (제목 기반 검색)
      const related = await searchEngine.search({
        query: doc.title,
        limit: 6,
      });

      res.json({
        id: doc.id,
        title: doc.title,
        filePath: doc.filePath,
        content: doc.content,
        tags: doc.tags,
        lastModified: doc.lastModified,
        related: related
          .filter(r => r.document.id !== doc.id)
          .slice(0, 5)
          .map(r => ({ id: r.document.id, title: r.document.title, score: r.score })),
      });
    } catch (err) {
      console.error(err); res.status(500).json({ error: 'Internal server error' });
    }
  });

  // GET /api/profile-card → SVG
  app.get('/api/profile-card', async (_req, res) => {
    try {
      const mode = ((_req as any).query.mode as string) === 'folder' ? 'folder' : 'semantic';
      if (!graphCaches.has(mode)) {
        const data = await buildGraphData(store, { mode });
        graphCaches.set(mode, { data, generatedAt: new Date().toISOString() });
      }
      const graphData = graphCaches.get(mode)!.data;
      const topics = await store.getTopics();

      // 동적 import (graph 패키지의 profile-card)
      // 여기서는 간단히 SVG를 직접 생성
      const stats = await store.getStats();
      const top6 = graphData.clusters
        .sort((a: any, b: any) => b.nodeCount - a.nodeCount)
        .slice(0, 6);
      const maxCount = Math.max(1, ...top6.map((c: any) => c.nodeCount));
      const W = 800, H = 420;
      const radarCx = 200, radarCy = 220, radarR = 100;

      const radarPoints = top6.map((c: any, i: number) => {
        const angle = (Math.PI * 2 * i) / top6.length - Math.PI / 2;
        const r = radarR * (c.nodeCount / maxCount);
        return {
          x: radarCx + r * Math.cos(angle),
          y: radarCy + r * Math.sin(angle),
          lx: radarCx + (radarR + 20) * Math.cos(angle),
          ly: radarCy + (radarR + 20) * Math.sin(angle),
          label: c.label.split(',')[0].trim().slice(0, 12),
          color: c.color,
        };
      });

      const radarPath = radarPoints.map((p: any, i: number) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ') + 'Z';
      const gridPaths = [0.33, 0.66, 1].map((s) =>
        top6.map((_: any, i: number) => {
          const a = (Math.PI * 2 * i) / top6.length - Math.PI / 2;
          return `${i === 0 ? 'M' : 'L'}${radarCx + radarR * s * Math.cos(a)},${radarCy + radarR * s * Math.sin(a)}`;
        }).join(' ') + 'Z'
      );

      const tags20 = topics.slice(0, 20);
      const maxTag = Math.max(1, ...tags20.map((t: any) => t.count));
      const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

      const tagEls = tags20.map((t: any, i: number) => {
        const sz = 10 + 14 * (t.count / maxTag);
        const x = 480 + (Math.floor(i / 2) % 5) * 60;
        const y = 140 + (i % 2) * 30 + Math.floor(i / 10) * 70;
        const op = 0.5 + 0.5 * (t.count / maxTag);
        return `<text x="${x}" y="${y}" font-size="${sz}" fill="#88aaff" opacity="${op}" font-family="monospace">#${esc(t.topic)}</text>`;
      }).join('\n    ');

      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0d1028"/><stop offset="100%" stop-color="#050510"/>
    </linearGradient>
    <linearGradient id="rf" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#6366f1" stop-opacity="0.3"/><stop offset="100%" stop-color="#06b6d4" stop-opacity="0.15"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" rx="16" fill="url(#bg)"/>
  <rect width="${W}" height="${H}" rx="16" fill="none" stroke="#6366f140"/>
  <text x="30" y="40" font-size="20" font-weight="700" fill="#c0c0f0" font-family="system-ui">🧠 Knowledge Universe</text>
  <text x="30" y="65" font-size="13" fill="#556" font-family="monospace">${stats.documentCount} docs · ${graphData.clusters.length} clusters · ${graphData.edges.length} connections</text>
  <line x1="30" y1="80" x2="${W-30}" y2="80" stroke="#6366f120"/>
  <text x="${radarCx}" y="105" font-size="11" fill="#667" text-anchor="middle" font-family="system-ui">KNOWLEDGE DISTRIBUTION</text>
  ${gridPaths.map((p: string) => `<path d="${p}" fill="none" stroke="#6366f115" stroke-width="0.5"/>`).join('\n  ')}
  ${radarPoints.map((p: any) => `<line x1="${radarCx}" y1="${radarCy}" x2="${p.lx}" y2="${p.ly}" stroke="#6366f110" stroke-width="0.5"/>`).join('\n  ')}
  <path d="${radarPath}" fill="url(#rf)" stroke="#818cf8" stroke-width="1.5"/>
  ${radarPoints.map((p: any) => `<circle cx="${p.x}" cy="${p.y}" r="3" fill="${p.color}"/><text x="${p.lx}" y="${p.ly+4}" font-size="9" fill="#889" text-anchor="middle" font-family="monospace">${esc(p.label)}</text>`).join('\n  ')}
  <text x="580" y="105" font-size="11" fill="#667" text-anchor="middle" font-family="system-ui">TOP TOPICS</text>
  <rect x="440" y="115" width="320" height="240" rx="8" fill="#6366f108"/>
    ${tagEls}
  <text x="${W/2}" y="${H-15}" font-size="10" fill="#334" text-anchor="middle" font-family="monospace">Generated by Stellavault</text>
</svg>`;

      res.setHeader('Content-Type', 'image/svg+xml');
      res.send(svg);
    } catch (err) {
      console.error(err); res.status(500).json({ error: 'Internal server error' });
    }
  });

  // GET /api/stats
  app.get('/api/stats', async (_req, res) => {
    try {
      const stats = await store.getStats();
      res.json({ ...stats, vaultName });
    } catch (err) {
      console.error(err); res.status(500).json({ error: 'Internal server error' });
    }
  });

  // GET /api/decay — 감쇠 상태 리포트
  app.get('/api/decay', async (_req, res) => {
    if (!decayEngine) { res.json({ error: 'Decay engine not initialized' }); return; }
    try {
      const report = await decayEngine.computeAll();
      res.json(report);
    } catch (err) {
      console.error(err); res.status(500).json({ error: 'Internal server error' });
    }
  });

  // GET /api/duplicates — 중복 노트 탐지
  app.get('/api/duplicates', async (req, res) => {
    try {
      const threshold = parseFloat(String(req.query.threshold ?? '0.88'));
      const pairs = await detectDuplicates(store, threshold, 20);
      res.json({ pairs, count: pairs.length, threshold });
    } catch (err) {
      console.error(err); res.status(500).json({ error: 'Internal server error' });
    }
  });

  // GET /api/gaps — 지식 갭 탐지
  app.get('/api/gaps', async (_req, res) => {
    try {
      const report = await detectKnowledgeGaps(store);
      res.json(report);
    } catch (err) {
      console.error(err); res.status(500).json({ error: 'Internal server error' });
    }
  });

  // POST /api/duplicates/merge — 중복 노트 자동 병합
  app.post('/api/duplicates/merge', async (req, res) => {
    try {
      const { docAId, docBId } = req.body;
      if (!docAId || !docBId) { res.status(400).json({ error: 'docAId, docBId required' }); return; }

      const docA = await store.getDocument(docAId);
      const docB = await store.getDocument(docBId);
      if (!docA || !docB) { res.status(404).json({ error: 'Document not found' }); return; }

      const { readFileSync, writeFileSync, unlinkSync } = await import('node:fs');
      const { join } = await import('node:path');

      // 긴 노트를 기준으로 유지, 짧은 노트의 고유 내용을 추가
      const [keeper, removed] = docA.content.length >= docB.content.length
        ? [docA, docB] : [docB, docA];

      const keeperPath = join(vaultPath, keeper.filePath);
      const removedPath = join(vaultPath, removed.filePath);

      // 병합: keeper 끝에 removed 고유 내용 추가
      const keeperContent = readFileSync(keeperPath, 'utf-8');
      const appendix = `\n\n---\n\n> Merged from: ${removed.title} (${removed.filePath})\n\n${removed.content}`;
      writeFileSync(keeperPath, keeperContent + appendix, 'utf-8');

      // 삭제
      try { unlinkSync(removedPath); } catch { /* 이미 없을 수 있음 */ }

      // DB에서도 삭제
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

  // POST /api/gaps/create-bridge — 갭 브릿지 노트 자동 생성
  app.post('/api/gaps/create-bridge', async (req, res) => {
    try {
      const { clusterA, clusterB } = req.body;
      if (!clusterA || !clusterB) { res.status(400).json({ error: 'clusterA, clusterB required' }); return; }

      const { writeFileSync, mkdirSync } = await import('node:fs');
      const { join } = await import('node:path');

      const nameA = clusterA.replace(/\s*\(\d+\)$/, '');
      const nameB = clusterB.replace(/\s*\(\d+\)$/, '');

      // 양쪽 클러스터의 대표 노트 검색
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
      const dir = join(vaultPath, '01_Knowledge');
      mkdirSync(dir, { recursive: true });
      const filePath = join(dir, `${safeTitle}.md`);
      writeFileSync(filePath, content, 'utf-8');

      res.json({ success: true, title: safeTitle, path: filePath });
    } catch (err) {
      console.error(err); res.status(500).json({ error: 'Bridge creation failed' });
    }
  });

  // GET /api/health — 종합 건강도 대시보드
  app.get('/api/health', async (_req, res) => {
    try {
      const stats = await store.getStats();
      const docs = await store.getAllDocuments();

      // Decay 요약
      let decaySummary = { totalDocuments: 0, criticalCount: 0, decayingCount: 0, averageR: 1.0, topDecaying: [] as any[] };
      if (decayEngine) {
        const report = await decayEngine.computeAll();
        decaySummary = {
          totalDocuments: report.totalDocuments ?? docs.length,
          criticalCount: report.criticalCount ?? 0,
          decayingCount: report.decayingCount ?? 0,
          averageR: report.averageR ?? 1.0,
          topDecaying: (report.topDecaying ?? []).slice(0, 5),
        };
      }

      // Gaps 요약
      let gapSummary = { gapCount: 0, isolatedCount: 0 };
      try {
        const gapReport = await detectKnowledgeGaps(store);
        gapSummary = {
          gapCount: gapReport.gaps?.length ?? 0,
          isolatedCount: gapReport.isolatedNodes?.length ?? 0,
        };
      } catch { /* gaps may fail if no embeddings */ }

      // Duplicates 요약
      let dupCount = 0;
      try {
        const pairs = await detectDuplicates(store, 0.88, 50);
        dupCount = pairs.length;
      } catch { /* duplicates may fail */ }

      // Source/Type 분포
      const sourceDist = new Map<string, number>();
      const typeDist = new Map<string, number>();
      for (const doc of docs) {
        const s = doc.source ?? 'local';
        const t = doc.type ?? 'note';
        sourceDist.set(s, (sourceDist.get(s) ?? 0) + 1);
        typeDist.set(t, (typeDist.get(t) ?? 0) + 1);
      }

      // 시간별 문서 증가 (월별)
      const monthlyGrowth = new Map<string, number>();
      for (const doc of docs) {
        const month = doc.lastModified?.slice(0, 7) ?? 'unknown';
        monthlyGrowth.set(month, (monthlyGrowth.get(month) ?? 0) + 1);
      }

      res.json({
        stats: { ...stats, vaultName },
        decay: decaySummary,
        gaps: gapSummary,
        duplicates: { count: dupCount },
        distribution: {
          source: Object.fromEntries(sourceDist),
          type: Object.fromEntries(typeDist),
        },
        growth: Object.fromEntries(
          [...monthlyGrowth.entries()].sort((a, b) => a[0].localeCompare(b[0]))
        ),
      });
    } catch (err) {
      console.error(err); res.status(500).json({ error: 'Internal server error' });
    }
  });

  // GET /api/embed — 임베드용 경량 그래프 데이터 (F-A08)
  app.get('/api/embed', async (req, res) => {
    try {
      const mode = (req.query.mode as string) === 'folder' ? 'folder' : 'semantic';
      const maxNodes = Math.min(parseInt(String(req.query.max ?? '200'), 10), 500);

      if (!graphCaches.has(mode)) {
        const data = await buildGraphData(store, { mode });
        graphCaches.set(mode, { data, generatedAt: new Date().toISOString() });
      }
      const cached = graphCaches.get(mode)!;
      const { nodes, edges, clusters } = cached.data;

      const connCount = new Map<string, number>();
      for (const e of edges) {
        connCount.set(e.source, (connCount.get(e.source) ?? 0) + 1);
        connCount.set(e.target, (connCount.get(e.target) ?? 0) + 1);
      }
      const sortedNodes = [...nodes].sort((a, b) => (connCount.get(b.id) ?? 0) - (connCount.get(a.id) ?? 0));
      const selectedNodes = sortedNodes.slice(0, maxNodes);
      const selectedIds = new Set(selectedNodes.map(n => n.id));
      const selectedEdges = edges.filter((e: any) => selectedIds.has(e.source) && selectedIds.has(e.target));

      const embedNodes = selectedNodes.map((n, i) => {
        const angle = (i / selectedNodes.length) * Math.PI * 2;
        const r = 100 + n.clusterId * 15;
        return {
          id: n.id, label: n.label, clusterId: n.clusterId, size: n.size,
          position: [
            r * Math.cos(angle) + (Math.random() - 0.5) * 60,
            (Math.random() - 0.5) * 200,
            r * Math.sin(angle) + (Math.random() - 0.5) * 60,
          ],
        };
      });

      res.setHeader('Access-Control-Allow-Origin', '*');
      res.json({
        nodes: embedNodes, edges: selectedEdges,
        stats: { nodeCount: embedNodes.length, edgeCount: selectedEdges.length, clusterCount: clusters.length, totalNodes: nodes.length },
        title: vaultName || 'Knowledge Graph',
      });
    } catch (err) {
      console.error(err); res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Sync 상태 추적
  let syncState: { running: boolean; startedAt: string; completedAt: string; result: string; output: string } = {
    running: false, startedAt: '', completedAt: '', result: '', output: '',
  };

  // POST /api/sync — Notion → Obsidian 동기화 트리거
  app.post('/api/sync', async (_req, res) => {
    if (syncState.running) {
      res.json({ success: false, error: 'Sync already running', state: syncState }); return;
    }
    try {
      const { spawn } = await import('node:child_process');
      const { resolve } = await import('node:path');
      const syncScript = resolve(process.cwd(), 'packages/sync/sync-to-obsidian.mjs');
      const syncDir = resolve(process.cwd(), 'packages/sync');

      const { existsSync } = await import('node:fs');
      if (!existsSync(syncScript)) { res.json({ success: false, error: 'sync script not found' }); return; }
      if (!existsSync(resolve(syncDir, '.env'))) { res.json({ success: false, error: '.env not found' }); return; }

      syncState = { running: true, startedAt: new Date().toISOString(), completedAt: '', result: '', output: '' };
      const child = spawn('node', [syncScript], { cwd: syncDir, stdio: ['ignore', 'pipe', 'pipe'], shell: true });

      let output = '';
      child.stdout.on('data', (d: Buffer) => { output += d.toString(); });
      child.stderr.on('data', (d: Buffer) => { output += d.toString(); });
      child.on('close', (code) => {
        syncState.running = false;
        syncState.completedAt = new Date().toISOString();
        syncState.result = code === 0 ? 'success' : 'failed';
        syncState.output = output.slice(-500); // 마지막 500자만
      });

      res.json({ success: true, message: 'Sync started' });
    } catch (err) {
      syncState.running = false;
      console.error(err); res.status(500).json({ error: 'Sync failed' });
    }
  });

  // GET /api/sync/status — 동기화 상태 조회
  app.get('/api/sync/status', (_req, res) => {
    res.json(syncState);
  });

  // POST /api/clip — 웹 페이지 클리핑
  app.post('/api/clip', async (req, res) => {
    try {
      const { url } = req.body;
      if (!url) { res.status(400).json({ error: 'url required' }); return; }

      const isYT = /youtube\.com\/watch|youtu\.be\//.test(url);
      const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 stellavault-clipper/1.0' } });
      const html = await response.text();

      // 제목 추출
      const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      let title = (titleMatch ? titleMatch[1] : new URL(url).hostname).replace(/ - YouTube$/, '').trim();
      const safeTitle = title.replace(/[<>:"/\\|?*]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80);

      let content: string;
      if (isYT) {
        const videoId = url.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]+)/)?.[1] ?? '';
        const descMatch = html.match(/"shortDescription":"([\s\S]*?)"/);
        const desc = descMatch ? descMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').slice(0, 3000) : '';
        content = `![thumbnail](https://img.youtube.com/vi/${videoId}/maxresdefault.jpg)\n\n## 설명\n\n${desc}\n\n[YouTube](${url})`;
      } else {
        content = html
          .replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '')
          .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '\n# $1\n').replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '\n## $1\n')
          .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '\n### $1\n')
          .replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '\n$1\n').replace(/<br\s*\/?>/gi, '\n')
          .replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)')
          .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '- $1\n')
          .replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, '**$2**')
          .replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, '*$2*')
          .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`')
          .replace(/<[^>]+>/g, '')
          .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
          .replace(/\n{3,}/g, '\n\n').trim();
        if (content.length > 10000) content = content.slice(0, 10000) + '\n\n...(truncated)';
      }

      // vault에 저장
      const { writeFileSync, mkdirSync } = await import('node:fs');
      const { join } = await import('node:path');
      const date = new Date().toISOString().slice(0, 10);
      const clipDir = join(vaultPath || '.', '06_Research', 'clips');
      mkdirSync(clipDir, { recursive: true });

      const fileName = `${date} ${safeTitle}.md`;
      const md = `---\ntitle: "${safeTitle}"\nsource: "${url}"\nclipped: ${date}\ntags: [clip${isYT ? ', youtube' : ''}]\n---\n\n# ${safeTitle}\n\n> Source: ${url}\n\n${content}`;
      writeFileSync(join(clipDir, fileName), md, 'utf-8');

      res.json({ success: true, fileName, path: join(clipDir, fileName) });
    } catch (err) {
      console.error(err); res.status(500).json({ error: 'Clip failed' });
    }
  });

  return {
    async start() {
      return new Promise<void>((resolve) => {
        app.listen(port, '127.0.0.1', () => {
          console.error(`🌐 API server running at http://127.0.0.1:${port}`);
          resolve();
        });
      });
    },
    app,
  };
}
