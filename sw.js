
const CACHE_NAME = 'boussole-freins-emploi-v21';

const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-512-maskable.png'
];

// Installation : mise en cache des ressources disponibles.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await Promise.all(
        APP_SHELL.map(async (url) => {
          try {
            await cache.add(url);
          } catch (error) {
            console.warn(
              'Ressource non mise en cache :',
              url,
              error
            );
          }
        })
      );
      return self.skipWaiting();
    })
  );
});

// Activation : suppression des anciens caches.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames
            .filter(
              (name) =>
                name.startsWith('boussole-freins-emploi-') &&
                name !== CACHE_NAME
            )
            .map((name) => caches.delete(name))
        )
      )
      .then(() => self.clients.claim())
  );
});

// Navigation et ressources locales : cache d'abord, puis réseau.
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Ne pas intercepter les requêtes externes, notamment France Travail.
  if (url.origin !== self.location.origin) {
    return;
  }

  // Les requêtes autres que GET ne sont pas mises en cache.
  if (request.method !== 'GET') {
    return;
  }

  // Pour les pages HTML : réseau d'abord, cache en secours.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME)
              .then((cache) => cache.put('./index.html', copy));
          }
          return response;
        })
        .catch(async () => {
          return (
            await caches.match(request) ||
            await caches.match('./index.html') ||
            Response.error()
          );
        })
    );
    return;
  }

  // Pour les autres ressources locales : cache d'abord, réseau ensuite.
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(request).then((response) => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME)
            .then((cache) => cache.put(request, copy));
        }
        return response;
      });
    })
  );
});