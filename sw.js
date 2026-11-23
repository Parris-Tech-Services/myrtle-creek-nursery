// Cache-first service worker. Bump VERSION whenever any app file changes.
const VERSION = 'mcn-v18';
const FILES = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/style.css',
  'js/app.js', 'js/bestsellers.js', 'js/cash.js', 'js/changecalc.js', 'js/checklist.js', 'js/db.js', 'js/gsync.js', 'js/insights.js', 'js/market.js', 'js/nursery.js', 'js/orders.js', 'js/ordersview.js', 'js/packing.js', 'js/post.js', 'js/postview.js', 'js/pricing.js', 'js/products.js', 'js/reports.js', 'js/sell.js', 'js/settings.js', 'js/staff.js', 'js/sync.js', 'js/syncing.js', 'js/ui.js', 'js/util.js', 'js/version.js',
  'vendor/dexie.min.js', 'vendor/dexie-export-import.js', 'vendor/papaparse.min.js', 'vendor/bagel-fat-one.woff2', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
];
// No automatic skipWaiting: a new version waits until the page says it is safe (no market day open).
self.addEventListener('install', e => e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' }))))));
self.addEventListener('message', e => { if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting(); });
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(hit => hit || fetch(e.request).catch(() => e.request.mode === 'navigate' ? caches.match('index.html') : Response.error())));
});
