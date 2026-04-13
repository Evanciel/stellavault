// Health dashboard route
// Extracted from server.ts for modular architecture.

import { Router } from 'express';
import type { VectorStore } from '../../store/types.js';
import type { DecayEngine } from '../../intelligence/decay-engine.js';

interface HealthRouterOptions {
  store: VectorStore;
  vaultName: string;
  decayEngine?: DecayEngine;
}

export function createHealthRouter(opts: HealthRouterOptions): Router {
  const { store, vaultName, decayEngine } = opts;
  const router = Router();

  router.get('/health', async (_req, res) => {
    try {
      const stats = await store.getStats();
      const docs = await store.getAllDocuments();

      // Decay 요약
      let decaySummary: {
        totalDocuments: number; criticalCount: number; decayingCount: number; averageR: number;
        topDecaying: Array<{ documentId: string; title: string; retrievability: number; daysSinceAccess: number }>;
      } = { totalDocuments: 0, criticalCount: 0, decayingCount: 0, averageR: 1.0, topDecaying: [] };

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
        const { detectKnowledgeGaps } = await import('../../intelligence/gap-detector.js');
        const gapReport = await detectKnowledgeGaps(store);
        gapSummary = {
          gapCount: gapReport.gaps?.length ?? 0,
          isolatedCount: gapReport.isolatedNodes?.length ?? 0,
        };
      } catch (e) { console.error('[health] Gap detection failed:', e instanceof Error ? e.message : e); }

      // Duplicates 요약
      let dupCount = 0;
      try {
        const { detectDuplicates } = await import('../../intelligence/duplicate-detector.js');
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

  return router;
}
