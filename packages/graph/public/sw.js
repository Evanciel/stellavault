// Minimal service worker for Stellavault PWA install prompt support.
// We don't cache anything — every fetch goes straight to the network.
// The presence of this file is enough for browsers to consider the page
// installable as a PWA, while keeping local-first behavior intact.

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Pass-through fetch — no caching, no interception
self.addEventListener('fetch', (event) => {
  // Let the browser handle the request normally
});
