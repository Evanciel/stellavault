// Mobile PWA (P3-F27) — 서비스 워커 + PWA manifest 제공
// Express에 PWA 지원 추가

import type { Express } from 'express';

export function mountPWA(app: Express) {
  // PWA Manifest
  app.get('/manifest.json', (_req, res) => {
    res.json({
      name: 'Stellavault',
      short_name: 'SV',
      description: 'Your knowledge, alive.',
      start_url: '/dashboard',
      display: 'standalone',
      background_color: '#050510',
      theme_color: '#6366f1',
      icons: [
        { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      ],
    });
  });

  // Service Worker
  app.get('/sw.js', (_req, res) => {
    res.setHeader('Content-Type', 'application/javascript');
    res.send(getServiceWorkerJS());
  });

  // SVG icon fallback (no PNG needed for MVP)
  app.get('/icon-192.png', (_req, res) => { res.redirect('/api/profile-card'); });
  app.get('/icon-512.png', (_req, res) => { res.redirect('/api/profile-card'); });
}

function getServiceWorkerJS(): string {
  return `
const CACHE_NAME = 'stellavault-v1';
const STATIC_ASSETS = ['/dashboard', '/manifest.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // API 요청은 네트워크 우선
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request)
        .then(res => {
          // GET 요청만 캐시
          if (event.request.method === 'GET' && res.ok) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return res;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // 정적 자산: 캐시 우선
  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request))
  );
});
`.trim();
}
