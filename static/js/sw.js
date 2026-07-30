const CACHE_NAME = 'pwa-cache-v2';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll([
        '/',
        '/index.html',
        '/js/route_visuals.js',
        '/js/zetko_map.js',
        '/js/zetko_route.js',
        '/js/zetko_router.js',
        '/js/zetko_stop.js',
        '/js/zetko_trip.js',
        '/images/bus.png',
        '/images/tram.png',
      ]);
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(
    keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
  )));
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    })
  );
});
