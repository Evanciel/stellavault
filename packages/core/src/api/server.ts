// Design Ref: §4.1 — REST API (core/api/)
// Design Ref: §7 — Security: localhost only, CORS restricted

import express from 'express';
import cors from 'cors';
import { randomBytes } from 'node:crypto';
import type { VectorStore } from '../store/types.js';
import type { SearchEngine } from '../search/index.js';
import { buildGraphData, buildClusteredGraph, flattenClusterLevel, type BuildGraphOptions, type BuildClusteredOptions, type ClusteredGraph, type GraphBuildProgress } from './graph-data.js';
import type { GraphData } from '../types/graph.js';
import { createFederationRouter } from './routes/federation.js';
import { createKnowledgeRouter } from './routes/knowledge.js';
import { createIngestRouter } from './routes/ingest.js';
import { createProfileCardRouter } from './routes/profile-card.js';
import { createHealthRouter } from './routes/health.js';
import { createAnalyticsRouter } from './routes/analytics.js';
import { assertPublicUrl } from './ssrf-guard.js';
import { summarizeIndexRun } from '../indexer/report.js';
import { checkVaultOwnership, VAULT_OWNER_KEY } from '../store/vault-ownership.js';
import { resolve as resolvePath } from 'node:path';
import type { IndexResult } from '../indexer/index.js';
import type { DecayEngine } from '../intelligence/decay-engine.js';
// detectDuplicates + detectKnowledgeGaps: lazy imported in /api/health only

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

  // Auth middleware for mutating endpoints.
  // Tokens are accepted ONLY via the X-Stellavault-Token header — never via
  // query strings (which can leak through referer headers, browser history,
  // and server logs).
  function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
    const token = req.headers['x-stellavault-token'] as string | undefined;
    if (token === authToken) return next();
    res.status(403).json({ error: 'Invalid or missing auth token. Send X-Stellavault-Token header.' });
  }

  /**
   * 🔴🔴 <남의 DB 에는 쓰지 않는다> (코덱스 14차 P1).
   *
   * 색인기는 각인이 어긋나면 한 글자도 안 쓰기로 했는데, 이 서버의 쓰기 경로들
   * (`PUT /api/document/:id` · `DELETE` · ingest 라우터)은 그 판정을 <통째로 우회>해
   * `store` 에 직접 썼다. `stellavault graph` 는 감시자 없이 API 만 띄우므로
   * 설정의 `dbPath` 가 남의 볼트를 가리키면 그 DB 가 조용히 오염된다.
   *
   * ★라우트마다 붙이지 않고 <메서드로> 막는다. 라우트별로 붙이면 다음에 추가되는
   *  쓰기 라우트가 조용히 빠지는데, 그 침묵이 정확히 이 사고의 모양이다.
   *
   * ⚠️ 막는 것은 <확정된 어긋남>뿐이다. 각인이 없는 DB(옛 DB·새 DB)는 통과시킨다 —
   *    그러지 않으면 `POST /api/reindex` 가 막혀 <각인될 방법 자체가 사라진다>.
   *    소유를 확정하는 판정은 여전히 색인기 하나가 소유한다.
   * ⚠️ `vaultPath` 가 없으면 물을 수가 없으므로 통과시킨다(그 서버는 짝이 없다).
   */
  function dbBelongsToAnotherVault(): boolean {
    if (!vaultPath) return false;
    try {
      return checkVaultOwnership(store.getMeta(VAULT_OWNER_KEY), resolvePath(vaultPath)).kind === 'mismatch';
    } catch {
      // 🔴 <물어볼 수 없으면 막는다> (코덱스 15차 P2). 한때 여기서 false 를 돌려주며
      //    "막으면 읽기 전용 상황까지 죽는다" 고 적었는데 <두 군데가 틀렸다>:
      //    ① 읽기는 아래 허용목록에서 이미 빠져나가므로 이 함수에 오지도 않는다.
      //    ② 각인이 <실제로 없는> 정상 경우는 예외가 아니라 `undefined` 로 온다 —
      //       즉 예외를 막아도 `/api/reindex` 이관 경로는 안 막힌다.
      //    판정 불가를 통과로 바꾸면 그것은 가드가 아니라 <가드 모양의 통로>다.
      return true;
    }
  }

  /**
   * 🔴🔴 남의 DB 에서도 <도는 것이 안전하다고 증명된> 경로만 통과시킨다.
   *
   * 한때 이 가드가 `req.method !== 'GET'` 이었다. <틀렸다> (코덱스 15차 P1):
   * `GET /api/search` 와 `GET /api/document/:id` 는 `recordAccess` 로 DB 에 쓰고,
   * `GET /api/decay` · `GET /api/heatmap` 은 `computeAll` 로 `decay_state` 를 갱신하며,
   * `GET /api/ask?save=true` 는 <파일>까지 쓴다. HTTP 메서드는 부작용의 증거가 아니다.
   *
   * ★그래서 fail-closed 로 뒤집는다: 목록에 없으면 거부다. 새 라우트는 <기본이 거부>이고,
   *  통과시키려면 여기에 이름을 적으며 "이건 안 쓴다" 를 한 번 확인하게 된다.
   *  (옛 방식은 새 라우트가 <기본이 통과>였고, 그 침묵이 정확히 이 사고의 모양이다.)
   */
  // 🔴🔴 여기 적는 순간 <"이 경로는 DB 에 쓰지 않는다" 를 주장하는 것>이다.
  //    16차에 그 주장이 <거짓으로> 드러났다: `/api/health` 를 "프로세스 상태" 라고 적어
  //    넣었는데 그 핸들러는 `decayEngine.computeAll()` 을 부르고, 그것은 `decay_state` 에
  //    INSERT/UPDATE 한다. 즉 <남의 DB 에 GET /api/health 한 번이면 쓴다>.
  //
  //    ★이것은 15차에 고친 결함과 <같은 부류다>. 그때 "HTTP 메서드는 부작용의 증거가
  //     아니다" 라며 메서드 기반을 허용목록으로 뒤집었는데, 정작 그 목록을 채울 때
  //     <경로 이름을 보고> 안전을 판정했다. 이름도 부작용의 증거가 아니다.
  //
  // 🔴 새 경로를 여기 넣기 전에: 핸들러를 <끝까지 따라가> 아무것도 안 쓰는지 확인하라.
  //    `RouteWritesNothingGateTests` 가 목록의 <모든> 경로를 실제로 때려 보고
  //    DB 가 안 바뀌는지 잰다 — 이름만 보고 넣으면 그 게이트가 빨개진다.
  const SAFE_ON_FOREIGN_DB: ReadonlySet<string> = new Set([
    '/api/token',          // 토큰만 돌려준다 — store 를 안 만진다
    '/api/stats',          // getStats — SELECT 뿐
    '/api/reindex/status', // 메모리 상태
    '/api/graph/status',   // 메모리 상태
    // 🔴 `/api/health` 는 <여기 없다>. decayEngine.computeAll() 로 decay_state 를 쓴다.
  ]);

  app.use((req, res, next) => {
    if (SAFE_ON_FOREIGN_DB.has(req.path)) return next();
    // 🔴 매 요청마다 다시 묻는다. 캐시하면 `POST /api/reindex` 가 각인한 <뒤에도>
    //    옛 판정이 남아, 방금 자기 것이 된 DB 를 계속 거부한다.
    if (!dbBelongsToAnotherVault()) return next();
    res.status(409).json({
      error: '이 DB 는 다른 볼트의 것이다 — 이 경로를 거부한다.',
      hint: 'STELLAVAULT_DB_PATH 를 이 볼트 전용 경로로 지정하고 다시 띄워라.',
    });
  });

  // Token endpoint — only served to same-origin browser requests (origin in the
  // CORS allow-list). Local CLI/curl invocations have no Origin header and are
  // rejected, so a hostile process on the same machine cannot harvest the token
  // by simply hitting GET /api/token.
  app.get('/api/token', (req, res) => {
    const origin = req.headers.origin;
    if (!origin || !allowedOrigins.includes(origin)) {
      res.status(403).json({ error: 'Token endpoint requires a same-origin browser request.' });
      return;
    }
    res.json({ token: authToken });
  });

  // HIGH-01: Shared SSRF protection — resolve-then-check-IP guard.
  // See ./ssrf-guard.ts (assertPublicUrl): DNS rebinding/encoding/IPv6 우회 방어.

  // Serve bundled graph UI when present (installed-from-npm path).
  // In dev mode graphUiPath is undefined and CLI spawns Vite instead.
  if (graphUiPath) {
    app.use(express.static(graphUiPath, { index: 'index.html', extensions: ['html'] }));
  }

  // GET /api/graph?view=cluster|raw&mode=semantic|folder&cap=N — 전체 그래프 데이터.
  // `view` (default cluster) is ORTHOGONAL to `mode` (semantic|folder): mode decides how
  // clusters form, view decides whether the client sees folded super-nodes (cluster) or
  // individual notes (raw). The cluster view is cheap to RENDER (≤80 dots) but the FIRST
  // uncached build of EITHER view runs a scoped-embedding load + O(n²) all-pairs cosine +
  // k-means + force-settle — a multi-second single-threaded Express event-loop stall. The
  // client must show a loading state on the toggle so the tap isn't silently swallowed.
  const GRAPH_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
  type GraphView = 'cluster' | 'raw';
  // Store BOTH the flattened GraphData (returned to clients) AND, for cluster keys, the raw
  // ClusteredGraph (so /api/graph/cluster/:id can reuse its members Map without a rebuild
  // that would re-run k-means → DIFFERENT cluster assignments).
  interface GraphCacheEntry { data: GraphData; clustered?: ClusteredGraph; generatedAt: string; cachedAt: number }
  const graphCaches = new Map<string, GraphCacheEntry>();

  function parseView(q: unknown): GraphView { return q === 'raw' ? 'raw' : 'cluster'; }
  function parseMode(q: unknown): 'semantic' | 'folder' { return q === 'folder' ? 'folder' : 'semantic'; }

  // Clamp the requested cap to a small whitelist (round to nearest 1000) per view. This is
  // what bounds cache cardinality (~a handful of `view:mode:cap` keys, NOT the TTL — the Map
  // only overwrites/clears, it never evicts on expiry) AND prevents ?cap spam from minting
  // unbounded fresh O(n²) builds (project Threat Model "service denial"). raw is the
  // expensive direction (full-cap buildGraphData) so it is clamped tighter (≤4000); cluster
  // only feeds clusterCap (~3000) into buildGraphData so it tolerates a higher ceiling.
  // undefined cap → '' sentinel so the default build occupies a single cache slot.
  // 허용 캡은 명시 화이트리스트다. 예전엔 1000 단위 반올림 + 상한이었는데, 전량(17k) 을
  // 열어주려면 상한만 올릴 경우 슬롯이 20개까지 늘어난다 — 17k 노드/72k 엣지 페이로드 하나가
  // 수십 MB라 캐시가 그대로 메모리 폭탄이 된다. 상단으로 갈수록 간격을 벌려 슬롯 수를 7개로
  // 묶었다. 요청값은 가장 가까운 허용값으로 스냅한다(거부 대신 스냅 — ?cap=5000 이 에러가 아니라
  // 4000 이 되는 편이 호출자에게 낫다).
  const CAP_STEPS_RAW: readonly number[] = [1000, 2000, 3000, 4000, 8000, 12000, 20000];
  const CAP_STEPS_CLUSTER: readonly number[] = [1000, 2000, 3000, 4000, 8000, 12000, 20000];
  function clampCap(view: GraphView, raw: number): number | undefined {
    if (!Number.isFinite(raw) || raw <= 0) return undefined;
    const steps = view === 'raw' ? CAP_STEPS_RAW : CAP_STEPS_CLUSTER;
    let best = steps[0];
    for (const step of steps) {
      if (Math.abs(step - raw) < Math.abs(best - raw)) best = step;
    }
    return best;
  }

  // Latest coarse progress from whichever build reported last. Concurrent builds for
  // DIFFERENT keys interleave into this one object; in practice the viewer only ever has one
  // in flight (the toggle blocks on it), and the alternative — a per-key progress map — would
  // buy nothing the UI reads. `building` is derived from graphBuilds, never from here, so a
  // crashed build cannot leave the flag stuck on.
  let graphProgress: { phase: string; done: number; total: number } = { phase: 'idle', done: 0, total: 0 };

  async function buildGraphEntry(view: GraphView, mode: 'semantic' | 'folder', cap: number | undefined): Promise<GraphCacheEntry> {
    const now = new Date().toISOString();
    const onProgress = (p: GraphBuildProgress): void => { graphProgress = { phase: p.phase, done: p.done, total: p.total }; };
    if (view === 'cluster') {
      const g = await buildClusteredGraph(store, { mode, clusterCap: cap, onProgress });
      return { data: flattenClusterLevel(g.clusterLevel), clustered: g, generatedAt: now, cachedAt: Date.now() };
    }
    const data = await buildGraphData(store, { mode, nodeCap: cap, onProgress });
    return { data, generatedAt: now, cachedAt: Date.now() };
  }

  // In-flight builds, keyed the SAME `view:mode:cap` way as graphCaches.
  //
  // Before this, a slow cold build served concurrently — the viewer's own retry, a second
  // tab, the toggle tapped twice — started a SECOND full O(n²) pass for the same key. With
  // the edge pass now in worker threads the Express event loop stays free during a build, so
  // those concurrent requests actually arrive and get accepted instead of queueing behind a
  // blocked thread; deduping them is what keeps that from meaning N times the CPU.
  // Cardinality is bounded by clampCap's whitelist, same as the cache.
  const graphBuilds = new Map<string, Promise<GraphCacheEntry>>();

  // Bumped whenever the index changes under us (reindex). A build that started before the
  // bump is reading the OLD index, so it still answers its own callers but must not write
  // itself into the cache — graphCaches.clear() alone cannot stop it, the write happens after.
  let graphEpoch = 0;

  function buildGraphOnce(view: GraphView, mode: 'semantic' | 'folder', cap: number | undefined, cacheKey: string): Promise<GraphCacheEntry> {
    const inflight = graphBuilds.get(cacheKey);
    if (inflight) return inflight;
    const startedAt = graphEpoch;
    const pending = buildGraphEntry(view, mode, cap)
      .then((entry) => { if (startedAt === graphEpoch) graphCaches.set(cacheKey, entry); return entry; })
      .finally(() => {
        graphBuilds.delete(cacheKey);
        if (graphBuilds.size === 0) graphProgress = { phase: 'idle', done: 0, total: 0 };
      });
    graphBuilds.set(cacheKey, pending);
    return pending;
  }

  // GET /api/graph/status — is a build running, and how far in?
  // Cheap and synchronous on purpose: this is the endpoint the viewer polls DURING a cold
  // full-vault build, which is exactly when the handler must not touch the store.
  app.get('/api/graph/status', (_req, res) => {
    res.json({ building: graphBuilds.size > 0, phase: graphProgress.phase, done: graphProgress.done, total: graphProgress.total });
  });

  app.get('/api/graph', async (req, res) => {
    try {
      const view = parseView(req.query.view);
      const mode = parseMode(req.query.mode);
      const cap = clampCap(view, Number(req.query.cap));
      const cacheKey = `${view}:${mode}:${cap ?? ''}`;
      const cached = graphCaches.get(cacheKey);
      const entry = (cached && Date.now() - cached.cachedAt <= GRAPH_CACHE_TTL)
        ? cached
        : await buildGraphOnce(view, mode, cap, cacheKey);
      res.json({ data: entry.data, generatedAt: entry.generatedAt, mode, view });
    } catch (err) {
      console.error(err); res.status(500).json({ error: 'Internal server error' });
    }
  });

  // GET /api/graph/refresh?view=&mode=&cap= — 캐시 무효화 + 재생성.
  // MUST mirror the SAME composite key + parse + build branch as /api/graph, else refresh
  // writes one key and the GET reads another → silent no-op.
  // Ignores the cache but NOT the in-flight map: an already-running build for this key is
  // producing fresh data anyway, so joining it is what refresh asked for.
  app.get('/api/graph/refresh', async (req, res) => {
    try {
      const view = parseView(req.query.view);
      const mode = parseMode(req.query.mode);
      const cap = clampCap(view, Number(req.query.cap));
      const cacheKey = `${view}:${mode}:${cap ?? ''}`;
      const entry = await buildGraphOnce(view, mode, cap, cacheKey);
      res.json({ data: entry.data, generatedAt: entry.generatedAt, mode, view });
    } catch (err) {
      console.error(err); res.status(500).json({ error: 'Internal server error' });
    }
  });

  // GET /api/graph/cluster/:id?mode=&cap= — drill-down: one cluster's members + intra-edges.
  // Reuses the cached ClusteredGraph's members Map (NO scoped rebuild — that would re-run
  // k-means and yield DIFFERENT cluster ids). Rebuilds + re-caches only if the cluster cache
  // entry is missing/TTL-expired.
  app.get('/api/graph/cluster/:id', async (req, res) => {
    try {
      const mode = parseMode(req.query.mode);
      const cap = clampCap('cluster', Number(req.query.cap));
      const cacheKey = `cluster:${mode}:${cap ?? ''}`;
      let cached = graphCaches.get(cacheKey);
      if (!cached || !cached.clustered || Date.now() - cached.cachedAt > GRAPH_CACHE_TTL) {
        cached = await buildGraphOnce('cluster', mode, cap, cacheKey);
      }
      const members = cached.clustered!.members.get(Number(req.params.id));
      if (!members) { res.status(404).json({ error: 'Cluster not found' }); return; }
      res.json({ data: members });
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

      // 그래프 캐시 리셋 — epoch 도 함께 올려서, 재인덱스 전에 시작된 in-flight 빌드가
      // 끝나면서 stale 결과를 다시 캐시에 써 넣는 것을 막는다.
      graphEpoch++;
      graphCaches.clear();

      res.json(reindexResponse(result));
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

  // GET /api/profile-card — Extracted to routes/profile-card.ts
  app.use('/api', createProfileCardRouter({ store, graphCaches, GRAPH_CACHE_TTL }));

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
      // 🔴 upsertDocument 가 아니다. 그것은 INSERT OR REPLACE 라 FK cascade 로
      //    <이 문서의 청크를 전부 날리는데>, 이 경로에는 임베더가 없어 다시 굽지 못한다.
      //    결과는 "행은 있는데 검색이 안 되는" 문서다 (코덱스 7차 P1, 2026-08-21).
      //    ★이 서버에는 watcher 도 없어서(`stellavault graph`) 저절로 복구되지도 않는다.
      await store.upsertDocumentPreservingChunks({
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

  // ───── Ingest + Clip ─────────────────────────────────────
  // Design Ref: §3 — Extracted to routes/ingest.ts
  app.use('/api', createIngestRouter({ store, vaultPath, requireAuth, assertPublicUrl }));

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
  // GET /api/health — Extracted to routes/health.ts
  app.use('/api', createHealthRouter({ store, vaultName, decayEngine }));

  // GET /api/profile — Knowledge Profile summary (F-A09)
  // GET /api/profile + /api/embed — Extracted to routes/analytics.ts
  app.use('/api', createAnalyticsRouter({ store, vaultName, decayEngine, graphCaches, GRAPH_CACHE_TTL }));

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

  // clip route is now in routes/ingest.ts

  // ───── Federation ─────────────────────────────────────────
  // Design Ref: §4 — Extracted to routes/federation.ts
  app.use('/api/federate', createFederationRouter(store, requireAuth));

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

/**
 * POST /api/reindex 의 응답 본문.
 *
 * 🔴 함수로 뽑은 이유는 <시험 가능하게> 하기 위해서다. 라우트 안에 있을 때는
 *    실제 임베딩 모델을 내려받아야만 닿을 수 있어, 이 조립이 한 번도 측정되지
 *    않았다 — 그래서 `failed` 가 빠진 채로 오래 살았다 (코덱스 12차 P2).
 *
 * 🔴 `success` 는 `!foreignDb` 가 아니다. <소유 미확인>도 아무것도 안 한 실행이고,
 *    그것을 성공으로 주면 자동화가 다음 단계로 넘어간다.
 */
export function reindexResponse(result: IndexResult) {
  const s = summarizeIndexRun(result);
  return {
    success: s.ok,
    // 🔴 <왜 실패했는지>를 함께 보낸다 (코덱스 14차 P2). 안 보내면 UI 가 보여줄 것이
    //    없어 "Reindex failed" 같은 일반 문구로 떨어지고, 사용자는 <남의 DB 라서
    //    아무것도 안 했다>는 사실을 영영 못 본다. 그 침묵이 이 사고를 하루 늦췄다.
    note: s.note,
    indexed: result.indexed,
    skipped: result.skipped,
    deleted: result.deleted,
    deferredDeletes: result.deferredDeletes,
    // 🔴 실패 수를 담는다. 없으면 "1,000개 중 999개가 실패" 도 success 로 읽힌다.
    failed: result.failed,
    foreignDb: result.foreignDb === true,
    ownershipUnverified: result.ownershipUnverified === true,
    chunks: result.totalChunks,
  };
}
