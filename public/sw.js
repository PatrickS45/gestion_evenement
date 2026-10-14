// Service worker d'Event Control : l'application s'ouvre et fonctionne sans réseau (mode hors ligne, F-60 à F-64).
// - tous les fichiers de l'application (liste asset-manifest.json produite par la construction) sont gardés
//   dès l'installation, et de nouveau à chaque démarrage de l'application : les modules chargés à la demande
//   (caméra, écrans d'administration) sont disponibles hors ligne, y compris après une mise à jour ;
// - pages : réseau d'abord, sinon la dernière version enregistrée ;
// - fichiers de l'application (/assets, noms avec empreinte) : depuis le cache, sinon le réseau ;
// - données (/api) : jamais mises en cache ici ; la copie des participants est chiffrée par l'application.
const CACHE = 'event-control-v2';

/** Garde la page et tous les fichiers listés qui ne le sont pas déjà ; sans effet hors ligne. */
async function precache() {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch('/asset-manifest.json', { cache: 'no-store' });
    if (!response.ok) return;
    const manifest = await response.json();
    const files = new Set(['/']);
    for (const entry of Object.values(manifest)) {
      for (const f of [entry.file, ...(entry.css ?? []), ...(entry.assets ?? [])]) if (f && f !== 'index.html') files.add(`/${f}`);
    }
    await Promise.all([...files].map(async (url) => {
      if (url !== '/' && await cache.match(url)) return;
      try { await cache.add(url); } catch { /* nouvel essai au prochain démarrage */ }
    }));
  } catch { /* hors ligne : la liste sera relue au prochain démarrage */ }
}

self.addEventListener('install', (event) => {
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Au démarrage de l'application : fichiers d'une nouvelle version
self.addEventListener('message', (event) => {
  if (event.data === 'precache') event.waitUntil(precache());
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
