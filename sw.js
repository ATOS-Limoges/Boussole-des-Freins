const CACHE_NAME = 'boussole-freins-emploi-v36';
// Polices Google : cache distinct, conservé d'une version à l'autre de l'application.
const FONT_CACHE = 'boussole-freins-emploi-polices-v1';
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];
// Au-delà de ce délai sans réponse du réseau, la page en cache est affichée.
const NAV_TIMEOUT_MS = 3000;

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
            console.warn('Ressource non mise en cache :', url, error);
          }
        })
      );
      return self.skipWaiting();
    })
  );
});

// Activation : suppression des anciens caches (sauf le cache des polices).
self.addEventListener('activate', (event) => {
  const garder = [CACHE_NAME, FONT_CACHE];
  event.waitUntil(
    caches.keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames
            .filter((name) =>
              name.startsWith('boussole-freins-emploi-') &&
              !garder.includes(name)
            )
            .map((name) => caches.delete(name))
        )
      )
      .then(() => self.clients.claim())
  );
});

// Page : réseau d'abord, mais avec un délai limite si une copie en cache existe.
function fetchPage(request) {
  return fetch(request).then((response) => {
    if (response && response.ok) {
      const copy = response.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put('./index.html', copy));
    }
    return response;
  });
}

async function answerPage(request, network) {
  const cache = await caches.open(CACHE_NAME);
  const cached = (await cache.match(request)) || (await cache.match('./index.html'));

  // Pas de copie en cache : on n'a pas le choix, on attend le réseau.
  if (!cached) return network.catch(() => Response.error());

  const timeout = new Promise((resolve) => setTimeout(() => resolve(null), NAV_TIMEOUT_MS));
  try {
    const response = await Promise.race([network, timeout]);
    // Réseau trop lent ou réponse en erreur : copie en cache.
    return response && response.ok ? response : cached;
  } catch (error) {
    return cached;
  }
}

// Polices Google : cache d'abord, mise à jour en arrière-plan.
async function answerFont(request) {
  const cache = await caches.open(FONT_CACHE);
  const cached = await cache.match(request);
  const update = fetch(request)
    .then((response) => {
      if (response && response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);
  if (cached) return cached;
  return (await update) || Response.error();
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== 'GET') return;

  // Polices Google : disponibles hors connexion après la première visite.
  if (FONT_HOSTS.includes(url.hostname)) {
    event.respondWith(answerFont(request));
    return;
  }

  // Ne pas intercepter les autres requêtes externes (API événements, etc.).
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    // La requête réseau part tout de suite et continue en arrière-plan
    // (mise à jour du cache) même si le délai limite est dépassé.
    const network = fetchPage(request);
    event.waitUntil(network.catch(() => {}));
    event.respondWith(answerPage(request, network));
    return;
  }

  // Autres ressources locales : cache d'abord.
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) return cachedResponse;

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
