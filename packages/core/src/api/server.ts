// Design Ref: §4.1 — REST API (core/api/)
// Design Ref: §7 — Security: localhost only, CORS restricted

import express from 'express';
import cors from 'cors';
import { randomBytes } from 'node:crypto';
import type { VectorStore } from '../store/types.js';
import type { SearchEngine } from '../search/index.js';
import { buildGraphData, type BuildGraphOptions } from './graph-data.js';
import type { GraphData } from '../types/graph.js';
import { createFederationRouter } from './routes/federation.js';
import { createKnowledgeRouter } from './routes/knowledge.js';
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
  /** Absolute path to the pre-built graph UI (vite dist). If set, `/` serves index.html and /assets/* is static. */
  graphUiPath?: string;
}

export function createApiServer(options: ApiServerOptions) {
  const { store, searchEngine, port = 3333, vaultName = '', vaultPath = '', decayEngine, graphUiPath } = options;
  const app = express();

  // ─── CRIT-03: Per-session auth token for mutating endpoints ───
  // Generated at server start, passed to the UI via /api/token.
  // Any local process can get the token by calling GET /api/token once,
  // but this prevents blind CSRF from random browser tabs.
  const authToken = randomBytes(32).toString('hex');

  // MED-01: Security headers
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    next();
  });

  // CORS — restrict to localhost origins + same-origin graph UI
  const allowedOrigins = [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    `http://127.0.0.1:${port}`,
    `http://localhost:${port}`,
  ];
  app.use(cors({ origin: allowedOrigins }));
  app.use(express.json());

  // MED-02: O(1) sliding window rate limiter with automatic cleanup
  const rateLimiter = new Map<string, { count: number; windowStart: number }>();
  const RATE_LIMIT_CLEANUP_INTERVAL = 5 * 60 * 1000; // 5 min
  const RATE_LIMIT_MAX_KEYS = 10000;
  let lastRateLimitCleanup = Date.now();

  function rateLimit(key: string, windowMs = 60000, maxHits = 30): boolean {
    const now = Date.now();

    // Periodic cleanup: evict expired entries to prevent memory leak
    if (now - lastRateLimitCleanup > RATE_LIMIT_CLEANUP_INTERVAL || rateLimiter.size > RATE_LIMIT_MAX_KEYS) {
      for (const [k, v] of rateLimiter) {
        if (now - v.windowStart >= windowMs) rateLimiter.delete(k);
      }
      lastRateLimitCleanup = now;
    }

    const entry = rateLimiter.get(key);
    if (!entry || now - entry.windowStart >= windowMs) {
      rateLimiter.set(key, { count: 1, windowStart: now });
      return true;
    }
    if (entry.count >= maxHits) return false;
    entry.count++;
    return true;
  }

  // Auth middleware for mutating endpoints
  function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
    const token = req.headers['x-stellavault-token'] as string | undefined;
    if (token === authToken) return next();
    // Also accept token in query for simple browser usage
    if (req.query.token === authToken) return next();
    res.status(403).json({ error: 'Invalid or missing auth token. GET /api/token first.' });
  }

  // Token endpoint — any local process can retrieve the session token
  app.get('/api/token', (_req, res) => { res.json({ token: authToken }); });

  // HIGH-01: Shared SSRF protection — blocks private/internal IPs
  function assertNotPrivateUrl(url: string): void {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Only http/https URLs allowed');
    const host = parsed.hostname.toLowerCase();
    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '::1' ||
      host.endsWith('.local') ||
      host.startsWith('192.168.') ||
      host.startsWith('10.') ||
      // Fix: 172.16.0.0/12 covers 172.16.* through 172.31.*
      /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
      host.startsWith('169.254.') ||
      host === '0.0.0.0'
    ) {
      throw new Error('Internal URLs not allowed');
    }
  }

  // Serve bundled graph UI when present (installed-from-npm path).
  // In dev mode graphUiPath is undefined and CLI spawns Vite instead.
  if (graphUiPath) {
    app.use(express.static(graphUiPath, { index: 'index.html', extensions: ['html'] }));
  }

  // GET /api/graph?mode=semantic|folder — 전체 그래프 데이터
  const GRAPH_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
  interface GraphCacheEntry { data: GraphData; generatedAt: string; cachedAt: number }
  const graphCaches = new Map<string, GraphCacheEntry>();

  app.get('/api/graph', async (req, res) => {
    try {
      const mode = (req.query.mode as string) === 'folder' ? 'folder' : 'semantic';
      const cached = graphCaches.get(mode);
      if (!cached || Date.now() - cached.cachedAt > GRAPH_CACHE_TTL) {
        const data = await buildGraphData(store, { mode });
        const now = new Date().toISOString();
        graphCaches.set(mode, { data, generatedAt: now, cachedAt: Date.now() });
      }
      const entry = graphCaches.get(mode)!;
      res.json({ data: entry.data, generatedAt: entry.generatedAt, mode });
    } catch (err) {
      console.error(err); res.status(500).json({ error: 'Internal server error' });
    }
  });

  // GET /api/graph/refresh?mode= — 캐시 무효화 + 재생성
  app.get('/api/graph/refresh', async (req, res) => {
    try {
      const mode = (req.query.mode as string) === 'folder' ? 'folder' : 'semantic';
      const data = await buildGraphData(store, { mode });
      const now = new Date().toISOString();
      graphCaches.set(mode, { data, generatedAt: now, cachedAt: Date.now() });
      res.json({ data, generatedAt: now, mode });
    } catch (err) {
      console.error(err); res.status(500).json({ error: 'Internal server error' });
    }
  });

  // GET /api/reindex/status — 인덱싱 진행률 조회
  let reindexProgress = { active: false, current: 0, total: 0, phase: '' };
  app.get('/api/reindex/status', (_req, res) => {
    res.json(reindexProgress);
  });

  // POST /api/reindex — 웹에서 인덱싱 트리거
  let isReindexing = false;
  app.post('/api/reindex', requireAuth, async (_req, res) => {
    if (isReindexing) {
      res.json({ success: false, error: 'Reindexing already in progress', progress: reindexProgress });
      return;
    }
    isReindexing = true;
    reindexProgress = { active: true, current: 0, total: 0, phase: 'initializing' };
    try {
      const indexer = await import('../indexer/index.js');

      reindexProgress.phase = 'loading embedder';
      const embedder = indexer.createLocalEmbedder('all-MiniLM-L6-v2');
      await embedder.initialize();

      reindexProgress.phase = 'indexing';
      const result = await indexer.indexVault(vaultPath, {
        store,
        embedder,
        onProgress: (current: number, total: number) => {
          reindexProgress.current = current;
          reindexProgress.total = total;
          if (current % 50 === 0) console.error(`[reindex] ${current}/${total}`);
        },
      });

      // 그래프 캐시 리셋
      graphCaches.clear();

      res.json({
        success: true,
        indexed: result.indexed,
        skipped: result.skipped,
        chunks: result.totalChunks,
      });
    } catch (err: unknown) {
      console.error('[reindex]', err);
      res.status(500).json({ error: 'Reindex failed' });
    } finally {
      isReindexing = false;
      reindexProgress = { active: false, current: 0, total: 0, phase: 'done' };
    }
  });

  // GET /api/search?q=&limit=
  app.get('/api/search', async (req, res) => {
    try {
      const query = String(req.query.q || '').slice(0, 1000); // LOW-04: cap query length
      const limit = Math.min(parseInt(String(req.query.limit || '10'), 10), 100);
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
          filePath: r.document.filePath,
          score: Math.round(r.score * 1000) / 1000,
          snippet: r.chunk?.content?.substring(0, 200) ?? '',
          tags: r.document.tags ?? [],
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
      const doc = await store.getDocument(String(req.params.id));
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
      const cachedProfile = graphCaches.get(mode);
      if (!cachedProfile || Date.now() - cachedProfile.cachedAt > GRAPH_CACHE_TTL) {
        const data = await buildGraphData(store, { mode });
        graphCaches.set(mode, { data, generatedAt: new Date().toISOString(), cachedAt: Date.now() });
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
      // HIGH-07: SVG injection 방어 — 모든 특수문자 이스케이프
      const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

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

  // PUT /api/document/:id — 노트 편집 (vault 파일 직접 수정)
  app.put('/api/document/:id', requireAuth, async (req, res) => {
    try {
      const id = String(req.params.id);
      const { title, content, tags } = req.body;

      const doc = await store.getDocument(id);
      if (!doc) { res.status(404).json({ error: 'Document not found' }); return; }

      const { resolve, join } = await import('node:path');
      const { writeFileSync, readFileSync } = await import('node:fs');
      const fullPath = resolve(vaultPath, doc.filePath);

      // path traversal 방지
      if (!fullPath.startsWith(resolve(vaultPath))) {
        res.status(403).json({ error: 'Access denied' }); return;
      }

      // 기존 파일 읽기
      const existing = readFileSync(fullPath, 'utf-8');

      // frontmatter 업데이트
      let updated = existing;
      if (title && title !== doc.title) {
        updated = updated.replace(/^title:\s*.+$/m, `title: "${title.replace(/"/g, "''")}"`);
      }
      if (tags) {
        // MED-06: Sanitize tag values to prevent YAML frontmatter injection
        const safeTags = tags.map((t: string) => t.replace(/["\\\n\r\]]/g, '').trim()).filter(Boolean);
        const tagStr = `tags: [${safeTags.map((t: string) => `"${t}"`).join(', ')}]`;
        if (updated.match(/^tags:\s*.+$/m)) {
          updated = updated.replace(/^tags:\s*.+$/m, tagStr);
        }
      }
      if (content !== undefined) {
        // frontmatter 이후 본문 교체
        const fmEnd = updated.indexOf('---', 4);
        if (fmEnd > 0) {
          const fm = updated.substring(0, fmEnd + 3);
          updated = fm + '\n\n' + content;
        } else {
          updated = content;
        }
      }

      writeFileSync(fullPath, updated, 'utf-8');

      // DB 업데이트
      await store.upsertDocument({
        ...doc,
        title: title ?? doc.title,
        content: content ?? doc.content,
        tags: tags ?? doc.tags,
        lastModified: new Date().toISOString(),
      });

      res.json({ success: true, id, title: title ?? doc.title });
    } catch (err: unknown) {
      console.error('[edit]', err);
      res.status(500).json({ error: 'Edit failed' });
    }
  });

  // DELETE /api/document/:id — 노트 삭제 (vault 파일 + DB)
  app.delete('/api/document/:id', requireAuth, async (req, res) => {
    try {
      const id = String(req.params.id);
      const doc = await store.getDocument(id);
      if (!doc) { res.status(404).json({ error: 'Document not found' }); return; }

      const { resolve } = await import('node:path');
      const { unlinkSync, existsSync } = await import('node:fs');
      const fullPath = resolve(vaultPath, doc.filePath);

      // path traversal 방지
      if (!fullPath.startsWith(resolve(vaultPath))) {
        res.status(403).json({ error: 'Access denied' }); return;
      }

      // 파일 삭제
      if (existsSync(fullPath)) {
        unlinkSync(fullPath);
      }

      // DB에서 삭제
      await store.deleteByDocumentId(id);

      res.json({ success: true, id, deleted: doc.filePath });
    } catch (err: unknown) {
      console.error('[delete]', err);
      res.status(500).json({ error: 'Delete failed' });
    }
  });

  // GET /api/ask — 웹 UI Q&A
  app.get('/api/ask', async (req, res) => {
    try {
      const question = String(req.query.q || '');
      if (!question) { res.json({ question: '', answer: '', sources: [] }); return; }

      const { askVault } = await import('../intelligence/ask-engine.js');
      const result = await askVault(searchEngine, question, {
        limit: 10,
        save: req.query.save === 'true',
        vaultPath,
      });
      res.json(result);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Ask failed' });
    }
  });

  // POST /api/ingest — 웹 UI에서 URL/텍스트 인제스트
  app.post('/api/ingest', requireAuth, async (req, res) => {
    try {
      const { input, type, tags, title, stage, locale } = req.body;

      // 노트 언어 설정
      if (locale) {
        const { setNoteLocale } = await import('../i18n/note-strings.js');
        setNoteLocale(locale);
      }
      if (!input || typeof input !== 'string') {
        res.status(400).json({ error: 'input is required' });
        return;
      }

      // URL인 경우 제목+내용 가져오기
      let content = input;
      let autoTitle = title;
      let autoTags = tags ?? [];
      let autoStage = stage ?? 'fleeting';
      const isYouTube = /youtube\.com\/watch|youtu\.be\//.test(input);

      if (isYouTube) {
        // YouTube 전용: 자막 + 메타데이터 추출
        try {
          const { extractYouTubeContent, formatYouTubeNote } = await import('../intelligence/youtube-extractor.js');
          const ytContent = await extractYouTubeContent(input);
          autoTitle = ytContent.title;
          autoTags = [...new Set(['youtube', ...ytContent.tags, ...(tags ?? [])])];
          autoStage = 'literature';
          // formatYouTubeNote는 frontmatter 없이 본문만 생성 → pipeline이 frontmatter 담당
          content = formatYouTubeNote(ytContent);
        } catch (ytErr) {
          console.error('[ingest] YouTube extraction failed, falling back to basic:', ytErr instanceof Error ? ytErr.message : ytErr);
          // 폴백: 기본 HTML 추출
          try {
            const resp = await fetch(input, { signal: AbortSignal.timeout(8000) });
            const html = await resp.text();
            const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
            if (titleMatch && !autoTitle) autoTitle = titleMatch[1].trim();
            content = input + '\n\n' + html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 5000);
          } catch (e) { console.error('[ingest] YouTube HTML fallback failed:', e instanceof Error ? e.message : e); }
        }
      } else if (input.startsWith('http')) {
        // HIGH-01: SSRF protection for general URL ingest
        try { assertNotPrivateUrl(input); } catch (e: unknown) {
          res.status(400).json({ error: (e as Error).message }); return;
        }
        try {
          const resp = await fetch(input, { signal: AbortSignal.timeout(8000) });
          const html = await resp.text();
          const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
          if (titleMatch && !autoTitle) autoTitle = titleMatch[1].trim();
          const text = html
            .replace(/<script[\s\S]*?<\/script>/gi, '')
            .replace(/<style[\s\S]*?<\/style>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 5000);
          content = input + '\n\n' + text;
        } catch (e) { console.error('[ingest] URL fetch failed:', e instanceof Error ? e.message : e); }
      }

      const { ingest } = await import('../intelligence/ingest-pipeline.js');
      const result = ingest(vaultPath, {
        type: type ?? (isYouTube ? 'youtube' : input.startsWith('http') ? 'url' : 'text'),
        content,
        tags: autoTags,
        title: autoTitle,
        stage: autoStage as any,
        source: input.startsWith('http') ? input : undefined,
      });

      // 저장 후 자동 인덱싱 (그래프에 바로 반영)
      try {
        const fullPath = require('node:path').resolve(vaultPath, result.savedTo);
        const { chunkDocument } = await import('../indexer/index.js');
        const doc = {
          id: require('node:crypto').createHash('sha256').update(result.savedTo).digest('hex').slice(0, 16),
          filePath: result.savedTo,
          title: result.title,
          content: content,
          frontmatter: {},
          tags: result.tags,
          lastModified: new Date().toISOString(),
          contentHash: '',
          source: 'ingest',
          type: result.stage,
        };
        await store.upsertDocument(doc);
      } catch (indexErr) {
        console.error('[ingest] Auto-index failed:', indexErr instanceof Error ? indexErr.message : indexErr);
      }

      res.json({
        success: true,
        savedTo: result.savedTo,
        stage: result.stage,
        title: result.title,
        indexCode: result.indexCode,
        tags: result.tags,
        wordCount: result.wordCount,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Ingest failed' });
    }
  });

  // POST /api/ingest/file — 웹 UI에서 파일 드래그앤드롭 인제스트
  app.post('/api/ingest/file', requireAuth, async (req, res) => {
    try {
      const multer = (await import('multer')).default;
      const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

      upload.single('file')(req, res, async (uploadErr: any) => {
        if (uploadErr) {
          res.status(400).json({ error: uploadErr.message || 'Upload failed' });
          return;
        }
        const file = (req as any).file;
        if (!file) {
          res.status(400).json({ error: 'No file provided' });
          return;
        }

        // MIME 화이트리스트
        const allowedMimes = new Set([
          'application/pdf',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'application/vnd.ms-excel',
          'text/plain', 'text/markdown', 'text/csv',
          'application/json', 'text/json',
          'text/xml', 'application/xml',
          'text/html',
          'text/yaml', 'application/x-yaml',
          'application/rtf', 'text/rtf',
        ]);
        if (!allowedMimes.has(file.mimetype)) {
          res.status(400).json({ error: `Unsupported file type: ${file.mimetype}` });
          return;
        }

        try {
          const { writeFileSync, unlinkSync } = await import('node:fs');
          const { join } = await import('node:path');
          const { tmpdir } = await import('node:os');
          // LOW-02: Sanitize originalname to prevent path traversal in temp dir
          const safeName = (file.originalname ?? 'upload').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100);
          const tmpPath = join(tmpdir(), `sv-upload-${Date.now()}-${safeName}`);

          // 임시 파일 저장 → 파서가 파일 경로 필요
          writeFileSync(tmpPath, file.buffer);

          const { extractFileContent, isBinaryFormat } = await import('../intelligence/file-extractors.js');
          const ext = file.originalname.split('.').pop()?.toLowerCase() ?? '';
          const binaryExts = new Set(['pdf', 'docx', 'pptx', 'xlsx', 'xls']);

          let content: string;
          let extractedTitle: string | undefined;
          let formatTag: string = ext;

          if (binaryExts.has(ext)) {
            const extracted = await extractFileContent(tmpPath);
            content = extracted.text;
            extractedTitle = extracted.metadata.title;
            formatTag = extracted.sourceFormat;
          } else {
            content = file.buffer.toString('utf-8');
          }

          // 임시 파일 삭제
          try { unlinkSync(tmpPath); } catch { /* ok */ }

          // locale 설정
          const locale = req.body?.locale;
          if (locale) {
            const { setNoteLocale } = await import('../i18n/note-strings.js');
            setNoteLocale(locale);
          }

          const tags = req.body?.tags ? (Array.isArray(req.body.tags) ? req.body.tags : req.body.tags.split(',').map((t: string) => t.trim())) : [];
          const { ingest } = await import('../intelligence/ingest-pipeline.js');
          const result = ingest(vaultPath, {
            type: formatTag as any,
            content,
            tags: [...tags, formatTag],
            title: req.body?.title ?? extractedTitle,
            stage: 'fleeting',
            source: file.originalname,
          });

          // 자동 인덱싱
          try {
            const doc = {
              id: require('node:crypto').createHash('sha256').update(result.savedTo).digest('hex').slice(0, 16),
              filePath: result.savedTo,
              title: result.title,
              content,
              frontmatter: {},
              tags: result.tags,
              lastModified: new Date().toISOString(),
              contentHash: '',
              source: 'upload',
              type: result.stage,
            };
            await store.upsertDocument(doc);
          } catch (indexErr) {
            console.error('[ingest/file] Auto-index failed:', indexErr instanceof Error ? indexErr.message : indexErr);
          }

          res.json({
            success: true,
            savedTo: result.savedTo,
            stage: result.stage,
            title: result.title,
            indexCode: result.indexCode,
            tags: result.tags,
            wordCount: result.wordCount,
          });
        } catch (err) {
          console.error('[ingest/file] Processing failed:', err instanceof Error ? err.message : err);
          res.status(500).json({ error: 'Processing failed' });
        }
      });
    } catch (err) {
      console.error('[ingest/file] Upload init failed:', err instanceof Error ? err.message : err);
      res.status(500).json({ error: 'File upload initialization failed' });
    }
  });

  // GET /api/recent — 최근 저장된 노트 목록
  app.get('/api/recent', async (_req, res) => {
    try {
      const docs = await store.getAllDocuments();
      const recent = docs
        .filter(d => d.lastModified)
        .sort((a, b) => new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime())
        .slice(0, 20)
        .map(d => ({
          id: d.id,
          title: d.title,
          filePath: d.filePath,
          lastModified: d.lastModified,
          tags: d.tags.slice(0, 5),
          type: d.type ?? 'note',
        }));
      res.json({ recent });
    } catch (err) {
      console.error(err); res.status(500).json({ error: 'Failed' });
    }
  });

  // GET /api/heatmap — Design Ref: §2.2 — 지식 히트맵 활동 점수
  app.get('/api/heatmap', async (_req, res) => {
    try {
      const docs = await store.getAllDocuments();
      const now = Date.now();
      const scores: Record<string, number> = {};
      let hotCount = 0;
      let coldCount = 0;

      // Pre-fetch decay data if available
      let decayMap: Record<string, number> = {};
      if (decayEngine) {
        try {
          const report = await decayEngine.computeAll();
          // topDecaying has R values for worst-performing docs
          for (const item of report.topDecaying) {
            decayMap[item.documentId] = item.retrievability;
          }
        } catch (e) { console.error('[trending] Decay computation failed:', e instanceof Error ? e.message : e); }
      }

      for (const doc of docs) {
        // 최근 수정 기반 점수 (0~0.4)
        const modified = doc.lastModified ? new Date(doc.lastModified).getTime() : now - 86400000 * 60;
        const daysSinceModified = (now - modified) / 86400000;
        const recencyScore = Math.max(0, 1 - daysSinceModified / 90) * 0.4;

        // 감쇠 R값 기반 (0~0.3)
        const decayScore = (decayMap[doc.id] ?? 0.5) * 0.3;

        // 태그 수 기반 연결도 (0~0.3)
        const tagScore = Math.min((doc.tags?.length ?? 0) / 10, 1) * 0.3;

        const score = Math.min(1, recencyScore + decayScore + tagScore);
        scores[doc.id] = score;
        if (score > 0.6) hotCount++;
        if (score < 0.2) coldCount++;
      }

      res.json({ scores, stats: { total: docs.length, hotCount, coldCount } });
    } catch (err) {
      console.error(err); res.status(500).json({ error: 'Internal server error' });
    }
  });

  // GET /api/evolution — Design Ref: F02 — 시맨틱 진화 데이터
  app.get('/api/evolution', async (req, res) => {
    try {
      const topic = req.query.topic as string | undefined;
      const limit = parseInt(String(req.query.limit ?? '20'), 10);
      const docs = await store.getAllDocuments();

      let filtered = docs;
      if (topic) {
        const t = topic.toLowerCase();
        filtered = docs.filter(
          (d) => d.tags.some((tag) => tag.toLowerCase().includes(t)) || d.title.toLowerCase().includes(t)
        );
      }

      const evolved = filtered
        .filter((d) => d.lastModified)
        .sort((a, b) => new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime())
        .slice(0, limit)
        .map((d) => ({
          id: d.id,
          title: d.title,
          lastModified: d.lastModified,
          tags: d.tags.slice(0, 5),
        }));

      res.json({ topic: topic ?? 'all', total: filtered.length, recentlyEvolved: evolved });
    } catch (err) {
      console.error(err); res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ───── Knowledge Management (duplicates, gaps, merge, bridge) ─────
  // Design Ref: §5 — Extracted to routes/knowledge.ts
  app.use('/api', createKnowledgeRouter({ store, searchEngine, vaultPath, requireAuth }));

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
      } catch (e) { console.error('[health] Gap detection failed:', e instanceof Error ? e.message : e); }

      // Duplicates 요약
      let dupCount = 0;
      try {
        const pairs = await detectDuplicates(store, 0.88, 50);
        dupCount = pairs.length;
      } catch (e) { console.error('[health] Duplicate detection failed:', e instanceof Error ? e.message : e); }

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

  // GET /api/profile — Knowledge Profile summary (F-A09)
  app.get('/api/profile', async (_req, res) => {
    try {
      const stats = await store.getStats();
      const topics = await store.getTopics();
      const docs = await store.getAllDocuments();

      let decaySummary = { averageR: 1.0, criticalCount: 0, healthScore: 100 };
      if (decayEngine) {
        const report = await decayEngine.computeAll();
        const avgR = report.averageR ?? 1.0;
        decaySummary = {
          averageR: avgR,
          criticalCount: report.criticalCount ?? 0,
          healthScore: Math.round(avgR * 100),
        };
      }

      // Source/Type distribution
      const sourceDist: Record<string, number> = {};
      const typeDist: Record<string, number> = {};
      for (const doc of docs) {
        const s = doc.source ?? 'local';
        const t = doc.type ?? 'note';
        sourceDist[s] = (sourceDist[s] ?? 0) + 1;
        typeDist[t] = (typeDist[t] ?? 0) + 1;
      }

      // Activity: docs per month (last 12)
      const monthlyActivity: Record<string, number> = {};
      for (const doc of docs) {
        const month = doc.lastModified?.slice(0, 7);
        if (month) monthlyActivity[month] = (monthlyActivity[month] ?? 0) + 1;
      }

      // HIGH-05: Removed wildcard CORS override — use global CORS policy
      res.json({
        name: vaultName || 'Knowledge Vault',
        stats: {
          documents: stats.documentCount,
          chunks: stats.chunkCount,
          topics: topics.length,
        },
        healthScore: decaySummary.healthScore,
        topTopics: topics.slice(0, 15).map(t => ({ name: t.topic, count: t.count })),
        distribution: { source: sourceDist, type: typeDist },
        activity: Object.fromEntries(
          Object.entries(monthlyActivity).sort((a, b) => a[0].localeCompare(b[0])).slice(-12)
        ),
        generatedAt: new Date().toISOString(),
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

      const cachedConstellation = graphCaches.get(mode);
      if (!cachedConstellation || Date.now() - cachedConstellation.cachedAt > GRAPH_CACHE_TTL) {
        const data = await buildGraphData(store, { mode });
        graphCaches.set(mode, { data, generatedAt: new Date().toISOString(), cachedAt: Date.now() });
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

      // HIGH-05: Removed wildcard CORS override — use global CORS policy
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
  app.post('/api/sync', requireAuth, async (_req, res) => {
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
      const child = spawn('node', [syncScript], { cwd: syncDir, stdio: ['ignore', 'pipe', 'pipe'], shell: false });

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
  app.post('/api/clip', requireAuth, async (req, res) => {
    try {
      const { url } = req.body;
      if (!url) { res.status(400).json({ error: 'url required' }); return; }

      // HIGH-01: SSRF protection via shared assertNotPrivateUrl
      try { assertNotPrivateUrl(url); } catch (e: unknown) {
        res.status(400).json({ error: (e as Error).message }); return;
      }

      const isYT = /youtube\.com\/watch|youtu\.be\//.test(url);
      const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 stellavault-clipper/1.0' }, signal: AbortSignal.timeout(15000) });
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

  // ───── Federation ─────────────────────────────────────────
  // Design Ref: §4 — Extracted to routes/federation.ts
  app.use('/api/federate', createFederationRouter(store));

  // SPA fallback — any non-/api route without a file extension serves
  // the built index.html. URLs that look like static file requests
  // (e.g. /manifest.json, /sw.js, /favicon.ico) are 404'd by static
  // middleware above instead of being shadowed by index.html — otherwise
  // the browser warns about wrong MIME types and PWA installs break.
  if (graphUiPath) {
    app.get(/^(?!\/api\/)(?!.*\.[a-z0-9]+$).*$/i, (_req, res) => {
      res.sendFile(`${graphUiPath}/index.html`);
    });
  }

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
