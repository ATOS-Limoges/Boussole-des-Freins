
const CACHE_NAME = "boussole-freins-emploi-v19";

const FILES_TO_CACHE = [
  "./",
  "./index.html"
];

// Installation du Service Worker
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      for (const file of FILES_TO_CACHE) {
        try {
          await cache.add(file);
        } catch (error) {
          console.warn("Fichier non mis en cache :", file, error);
        }
      }

      return self.skipWaiting();
    })
  );
});

// Activation : suppression des anciens caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((cacheName) =>
              cacheName.startsWith("boussole-freins-emploi-") &&
              cacheName !== CACHE_NAME
            )
            .map((cacheName) => caches.delete(cacheName))
        );
      })
      .then(() => self.clients.claim())
  );
});

// Gestion des requêtes
self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Ne pas intercepter les requêtes externes
  if (url.origin !== self.location.origin) {
    return;
  }

  // Ne gérer que les requêtes GET
  if (request.method !== "GET") {
    return;
  }

  // Navigation : réseau d'abord, cache en secours
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const responseCopy = response.clone();

            caches.open(CACHE_NAME).then((cache) => {
              cache.put("./index.html", responseCopy);
            });
          }

          return response;
        })
        .catch(async () => {
          const cachedPage = await caches.match("./index.html");

          if (cachedPage) {
            return cachedPage;
          }

          return new Response(
            "La page est indisponible hors connexion. Connectez-vous à Internet puis réessayez.",
            {
              status: 503,
              headers: {
                "Content-Type": "text/plain; charset=utf-8"
              }
            }
          );
        })
    );

    return;
  }

  // Autres fichiers : cache d'abord, réseau ensuite
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(request).then((response) => {
        if (response && response.ok) {
          const responseCopy = response.clone();

          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseCopy);
          });
        }

        return response;
      });
    })
  );
});