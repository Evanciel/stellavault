// Web Dashboard (P3-F26) — Express에 HTML 대시보드 추가
// http://localhost:3333/dashboard

import type { Express } from 'express';

export function mountDashboard(app: Express) {
  app.get('/dashboard', (_req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.send(getDashboardHTML());
  });
}

function getDashboardHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Stellavault Dashboard</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: system-ui, -apple-system, sans-serif; background: #050510; color: #c0c0f0; min-height: 100vh; }
    .header { padding: 16px 24px; border-bottom: 1px solid rgba(100,120,255,0.1); display: flex; align-items: center; gap: 12px; }
    .header h1 { font-size: 18px; font-weight: 600; }
    .header .subtitle { color: #556; font-size: 12px; }
    .container { max-width: 1200px; margin: 0 auto; padding: 24px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; margin-bottom: 24px; }
    .card { background: rgba(100,120,255,0.04); border: 1px solid rgba(100,120,255,0.1); border-radius: 12px; padding: 16px; }
    .card h3 { font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #556; margin-bottom: 8px; }
    .card .value { font-size: 28px; font-weight: 700; }
    .card .sub { font-size: 11px; color: #556; margin-top: 4px; }
    .search-box { width: 100%; padding: 10px 16px; background: rgba(100,120,255,0.06); border: 1px solid rgba(100,120,255,0.15); border-radius: 8px; color: #c0c0f0; font-size: 14px; outline: none; margin-bottom: 16px; }
    .search-box::placeholder { color: #445; }
    .results { display: flex; flex-direction: column; gap: 8px; }
    .result { padding: 12px; background: rgba(255,255,255,0.02); border-radius: 8px; cursor: pointer; }
    .result:hover { background: rgba(100,120,255,0.06); }
    .result .title { font-weight: 600; font-size: 13px; }
    .result .meta { font-size: 11px; color: #556; margin-top: 4px; }
    .section { margin-bottom: 24px; }
    .section h2 { font-size: 14px; margin-bottom: 12px; color: #88aaff; }
    .bar { height: 6px; background: rgba(100,120,255,0.1); border-radius: 3px; overflow: hidden; margin-top: 6px; }
    .bar-fill { height: 100%; border-radius: 3px; transition: width 0.3s; }
    .links { display: flex; gap: 12px; margin-top: 16px; }
    .links a { color: #88aaff; text-decoration: none; font-size: 12px; padding: 6px 12px; border: 1px solid rgba(100,120,255,0.15); border-radius: 6px; }
    .links a:hover { background: rgba(100,120,255,0.1); }
    #loading { color: #556; font-size: 12px; }
  </style>
</head>
<body>
  <div class="header">
    <h1>Stellavault</h1>
    <span class="subtitle">Dashboard</span>
    <div style="margin-left:auto" class="links">
      <a href="/api/stats" target="_blank">API Stats</a>
      <a href="http://localhost:5173" target="_blank">3D Graph</a>
    </div>
  </div>

  <div class="container">
    <!-- Stats -->
    <div class="grid" id="stats-grid">
      <div class="card"><h3>Documents</h3><div class="value" id="doc-count">-</div></div>
      <div class="card"><h3>Chunks</h3><div class="value" id="chunk-count">-</div></div>
      <div class="card"><h3>Health Score</h3><div class="value" id="health-score">-</div><div class="bar"><div class="bar-fill" id="health-bar" style="width:0%;background:#10b981"></div></div></div>
      <div class="card"><h3>Knowledge Gaps</h3><div class="value" id="gap-count">-</div></div>
    </div>

    <!-- Search -->
    <div class="section">
      <h2>Search</h2>
      <input class="search-box" id="search-input" placeholder="Search your knowledge..." />
      <div class="results" id="search-results"></div>
    </div>

    <!-- Decay -->
    <div class="section">
      <h2>Fading Knowledge</h2>
      <div id="decay-list"><span id="loading">Loading...</span></div>
    </div>
  </div>

  <script>
    const API = '/api';

    async function loadStats() {
      try {
        const [stats, health] = await Promise.all([
          fetch(API + '/stats').then(r => r.json()),
          fetch(API + '/health').then(r => r.json()).catch(() => null),
        ]);
        document.getElementById('doc-count').textContent = stats.documentCount ?? 0;
        document.getElementById('chunk-count').textContent = stats.chunkCount ?? 0;
        if (health) {
          const score = health.decay?.averageR ? Math.round(health.decay.averageR * 100) : 100;
          document.getElementById('health-score').textContent = score + '%';
          document.getElementById('health-bar').style.width = score + '%';
          document.getElementById('health-bar').style.background = score > 70 ? '#10b981' : score > 40 ? '#f59e0b' : '#ef4444';
          document.getElementById('gap-count').textContent = health.gaps?.gapCount ?? 0;

          // Decay list
          const decayEl = document.getElementById('decay-list');
          if (health.decay?.topDecaying?.length) {
            decayEl.innerHTML = health.decay.topDecaying.slice(0, 8).map(d => {
              const r = Math.round((d.retrievability ?? 0) * 100);
              const color = r > 50 ? '#10b981' : r > 30 ? '#f59e0b' : '#ef4444';
              return '<div class="result"><div class="title">' + d.title + '</div><div class="bar"><div class="bar-fill" style="width:' + r + '%;background:' + color + '"></div></div><div class="meta">' + r + '% retrievability</div></div>';
            }).join('');
          } else {
            decayEl.innerHTML = '<div style="color:#556;font-size:12px">All knowledge healthy!</div>';
          }
        }
      } catch (e) { console.error(e); }
    }

    let searchTimer;
    document.getElementById('search-input').addEventListener('input', (e) => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(async () => {
        const q = e.target.value.trim();
        const el = document.getElementById('search-results');
        if (!q) { el.innerHTML = ''; return; }
        try {
          const res = await fetch(API + '/search?q=' + encodeURIComponent(q) + '&limit=10').then(r => r.json());
          el.innerHTML = (res.results || []).map(r =>
            '<div class="result"><div class="title">' + r.title + ' <span style="color:#556;font-size:11px">(' + Math.round(r.score * 100) + '%)</span></div>' +
            '<div class="meta">' + (r.highlights?.[0] || '').slice(0, 100) + '</div></div>'
          ).join('') || '<div style="color:#556;font-size:12px">No results</div>';
        } catch { el.innerHTML = '<div style="color:#ef4444;font-size:12px">Search error</div>'; }
      }, 300);
    });

    loadStats();
  </script>
</body>
</html>`;
}
