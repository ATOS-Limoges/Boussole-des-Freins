const CACHE_NAME = 'boussole-freins-emploi-v42';
const FONT_CACHE = 'boussole-freins-emploi-polices-v1';
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];
const NAV_TIMEOUT_MS = 3000;

const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-512-maskable.png'
];

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
  if (!cached) return network.catch(() => Response.error());

  const timeout = new Promise((resolve) => setTimeout(() => resolve(null), NAV_TIMEOUT_MS));
  try {
    const response = await Promise.race([network, timeout]);
    return response && response.ok ? response : cached;
  } catch (error) {
    return cached;
  }
}

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

  if (FONT_HOSTS.includes(url.hostname)) {
    event.respondWith(answerFont(request));
    return;
  }

  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    const network = fetchPage(request);
    event.waitUntil(network.catch(() => {}));
    event.respondWith(answerPage(request, network));
    return;
  }

  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) return cachedResponse;

      return fetch(request).then((response) => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    })
  );
});
