// Analytics routes: knowledge profile + embeddable graph data
// Extracted from server.ts for modular architecture.

import { Router } from 'express';
import type { VectorStore } from '../../store/types.js';
import type { GraphData } from '../../types/graph.js';
import type { DecayEngine } from '../../intelligence/decay-engine.js';
import { buildGraphData } from '../graph-data.js';

interface AnalyticsRouterOptions {
  store: VectorStore;
  vaultName: string;
  decayEngine?: DecayEngine;
  graphCaches: Map<string, { data: GraphData; generatedAt: string; cachedAt: number }>;
  GRAPH_CACHE_TTL: number;
}

export function createAnalyticsRouter(opts: AnalyticsRouterOptions): Router {
  const { store, vaultName, decayEngine, graphCaches, GRAPH_CACHE_TTL } = opts;
  const router = Router();

  // GET /profile — Knowledge Profile summary
  router.get('/profile', async (_req, res) => {
    try {
      const stats = await store.getStats();
      const topics = await store.getTopics();
      const docs = await store.getAllDocuments();

      let decaySummary = { averageR: 1.0, criticalCount: 0, healthScore: 100 };
      if (decayEngine) {
        const report = await decayEngine.computeAll();
        const avgR = report.averageR ?? 1.0;
        decaySummary = { averageR: avgR, criticalCount: report.criticalCount ?? 0, healthScore: Math.round(avgR * 100) };
      }

      const sourceDist: Record<string, number> = {};
      const typeDist: Record<string, number> = {};
      for (const doc of docs) {
        sourceDist[doc.source ?? 'local'] = (sourceDist[doc.source ?? 'local'] ?? 0) + 1;
        typeDist[doc.type ?? 'note'] = (typeDist[doc.type ?? 'note'] ?? 0) + 1;
      }

      const monthlyActivity: Record<string, number> = {};
      for (const doc of docs) {
        const month = doc.lastModified?.slice(0, 7);
        if (month) monthlyActivity[month] = (monthlyActivity[month] ?? 0) + 1;
      }

      res.json({
        name: vaultName || 'Knowledge Vault',
        stats: { documents: stats.documentCount, chunks: stats.chunkCount, topics: topics.length },
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

  // GET /embed — 임베드용 경량 그래프 데이터
  router.get('/embed', async (req, res) => {
    try {
      const mode = (req.query.mode as string) === 'folder' ? 'folder' : 'semantic';
      const maxNodes = Math.min(parseInt(String(req.query.max ?? '200'), 10), 500);

      const cached = graphCaches.get(mode);
      if (!cached || Date.now() - cached.cachedAt > GRAPH_CACHE_TTL) {
        const data = await buildGraphData(store, { mode });
        graphCaches.set(mode, { data, generatedAt: new Date().toISOString(), cachedAt: Date.now() });
      }
      const { nodes, edges, clusters } = graphCaches.get(mode)!.data;

      const connCount = new Map<string, number>();
      for (const e of edges) {
        connCount.set(e.source, (connCount.get(e.source) ?? 0) + 1);
        connCount.set(e.target, (connCount.get(e.target) ?? 0) + 1);
      }
      const sortedNodes = [...nodes].sort((a, b) => (connCount.get(b.id) ?? 0) - (connCount.get(a.id) ?? 0));
      const selectedNodes = sortedNodes.slice(0, maxNodes);
      const selectedIds = new Set(selectedNodes.map(n => n.id));
      const selectedEdges = edges.filter(e => selectedIds.has(e.source) && selectedIds.has(e.target));

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

      res.json({
        nodes: embedNodes, edges: selectedEdges,
        stats: { nodeCount: embedNodes.length, edgeCount: selectedEdges.length, clusterCount: clusters.length, totalNodes: nodes.length },
        title: vaultName || 'Knowledge Graph',
      });
    } catch (err) {
      console.error(err); res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}
