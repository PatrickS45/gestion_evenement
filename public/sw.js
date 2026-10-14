// Service worker d'Event Control : l'application s'ouvre même sans réseau (mode hors ligne, F-60 à F-64).
// - pages : réseau d'abord, sinon la dernière version enregistrée ;
// - fichiers de l'application (/assets, noms avec empreinte) : enregistrés à la première lecture ;
// - données (/api) : jamais mises en cache ici ; la copie des participants est chiffrée par l'application.
const CACHE = 'event-control-v1';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.add('/')).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) { const copy = response.clone(); caches.open(CACHE).then((c) => c.put('/', copy)); }
          return response;
        })
        .catch(() => caches.match('/').then((cached) => cached ?? Response.error())),
    );
    return;
  }

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(request).then((cached) => cached ?? fetch(request).then((response) => {
        if (response.ok) { const copy = response.clone(); caches.open(CACHE).then((c) => c.put(request, copy)); }
        return response;
      })),
    );
  }
});
