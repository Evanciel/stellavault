// Profile card SVG renderer
// Extracted from server.ts for modular architecture.

import { Router } from 'express';
import type { VectorStore } from '../../store/types.js';
import type { GraphData } from '../../types/graph.js';
import { buildGraphData } from '../graph-data.js';

interface ProfileCardOptions {
  store: VectorStore;
  graphCaches: Map<string, { data: GraphData; generatedAt: string; cachedAt: number }>;
  GRAPH_CACHE_TTL: number;
}

export function createProfileCardRouter(opts: ProfileCardOptions): Router {
  const { store, graphCaches, GRAPH_CACHE_TTL } = opts;
  const router = Router();

  router.get('/profile-card', async (_req, res) => {
    try {
      const mode = (String(_req.query.mode ?? '')) === 'folder' ? 'folder' : 'semantic';
      const cached = graphCaches.get(mode);
      if (!cached || Date.now() - cached.cachedAt > GRAPH_CACHE_TTL) {
        const data = await buildGraphData(store, { mode });
        graphCaches.set(mode, { data, generatedAt: new Date().toISOString(), cachedAt: Date.now() });
      }
      const graphData = graphCaches.get(mode)!.data;
      const topics = await store.getTopics();
      const stats = await store.getStats();

      const top6 = [...graphData.clusters]
        .sort((a, b) => b.nodeCount - a.nodeCount)
        .slice(0, 6);
      const maxCount = Math.max(1, ...top6.map(c => c.nodeCount));
      const W = 800, H = 420;
      const radarCx = 200, radarCy = 220, radarR = 100;

      const radarPoints = top6.map((c, i) => {
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

      const radarPath = radarPoints.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ') + 'Z';
      const gridPaths = [0.33, 0.66, 1].map((s) =>
        top6.map((_, i) => {
          const a = (Math.PI * 2 * i) / top6.length - Math.PI / 2;
          return `${i === 0 ? 'M' : 'L'}${radarCx + radarR * s * Math.cos(a)},${radarCy + radarR * s * Math.sin(a)}`;
        }).join(' ') + 'Z'
      );

      const tags20 = topics.slice(0, 20);
      const maxTag = Math.max(1, ...tags20.map(t => t.count));
      const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

      const tagEls = tags20.map((t, i) => {
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
  ${radarPoints.map(p => `<line x1="${radarCx}" y1="${radarCy}" x2="${p.lx}" y2="${p.ly}" stroke="#6366f110" stroke-width="0.5"/>`).join('\n  ')}
  <path d="${radarPath}" fill="url(#rf)" stroke="#818cf8" stroke-width="1.5"/>
  ${radarPoints.map(p => `<circle cx="${p.x}" cy="${p.y}" r="3" fill="${p.color}"/><text x="${p.lx}" y="${p.ly+4}" font-size="9" fill="#889" text-anchor="middle" font-family="monospace">${esc(p.label)}</text>`).join('\n  ')}
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

  return router;
}
