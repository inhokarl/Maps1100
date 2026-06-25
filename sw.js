/* Maps1100 – Service Worker v4 */
const CACHE = 'maps1100-v4';

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll([
      '/Maps1100/index.html',
      '/Maps1100/manifest.json',
      '/Maps1100/icons/icon-192.png',
      '/Maps1100/icons/icon-512.png',
    ]))
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(ks => Promise.all(
      ks.filter(k => k !== CACHE).map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const u = e.request.url;
  // Não cachear tiles de mapa nem CDNs externos
  if (u.includes('openstreetmap') || u.includes('arcgisonline') ||
      u.includes('opentopomap') || u.includes('cartocdn') ||
      u.includes('unpkg.com')) {
    e.respondWith(fetch(e.request).catch(() => new Response('', {status:503})));
    return;
  }
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
      if (res.ok) caches.open(CACHE).then(c => c.put(e.request, res.clone()));
      return res;
    }).catch(() => caches.match('/Maps1100/index.html')))
  );
});
