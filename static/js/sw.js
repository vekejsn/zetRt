self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open('pwa-cache').then((cache) => {
      return cache.addAll([
        '/',
        '/index.html',
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

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    })
  );
});