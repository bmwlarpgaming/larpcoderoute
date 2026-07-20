/* ============================================================
   Service Worker — Code de la Route PWA
   Strategy: cache-first shell, network-first quiz media
   ============================================================ */

const CACHE_PREFIX = 'coderoute-';
const CACHE_NAME = `${CACHE_PREFIX}v7`;

// Core shell files to pre-cache on install.
const SHELL_ASSETS = [
  './',
  './index.html',
  './methode.html',
  './app.webmanifest',
  './manifest.json',
  './css/style.css',
  './css/methode.css',
  './css/quiz.css',
  './js/app.js',
  './js/database.js',
  './js/mainmenu.js',
  './js/quiz.js',
  './js/review.js',
  './assets/larpmonstericon.png'
];

// Resolve paths against the registration scope so matching also works when the
// app is hosted below an origin subpath, as it is on GitHub Pages.
const APP_SCOPE = new URL(self.registration.scope);
const ASSETS_PATH = new URL('./assets/', APP_SCOPE).pathname;
const SHELL_PATHS = new Set(
  SHELL_ASSETS.map((asset) => new URL(asset, APP_SCOPE).pathname)
);

self.addEventListener('install', (event) => {
  const shellRequests = SHELL_ASSETS.map(
    (asset) => new Request(new URL(asset, APP_SCOPE), { cache: 'reload' })
  );

  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(shellRequests))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  const deleteOldAppCaches = caches.keys().then((keys) =>
    Promise.all(
      keys
        .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
        .map((key) => caches.delete(key))
    )
  );

  event.waitUntil(Promise.all([deleteOldAppCaches, self.clients.claim()]));
});

async function cacheFirst(cache, request) {
  const cached = await cache.match(request);
  if (cached) return { response: cached, cacheWrite: Promise.resolve() };

  const response = await fetch(request);
  return {
    response,
    cacheWrite: cacheResponse(cache, request, response)
  };
}

async function networkFirst(cache, request) {
  const cached = await cache.match(request);

  try {
    const response = await fetch(request);
    return {
      response,
      cacheWrite: cacheResponse(cache, request, response)
    };
  } catch {
    return {
      response: cached || new Response('Offline', { status: 503 }),
      cacheWrite: Promise.resolve()
    };
  }
}

function cacheResponse(cache, request, response) {
  // Partial (206) media responses cannot be stored in CacheStorage.
  if (!response.ok || response.status !== 200) return Promise.resolve();
  return cache.put(request, response.clone());
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  const isShellAsset = SHELL_PATHS.has(url.pathname);
  const isQuizMedia =
    url.pathname.startsWith(ASSETS_PATH) && !isShellAsset;

  const resultPromise = caches.open(CACHE_NAME).then((cache) =>
    isQuizMedia
      ? networkFirst(cache, request)
      : cacheFirst(cache, request)
  );

  event.respondWith(resultPromise.then(({ response }) => response));

  // Keep asynchronous CacheStorage writes alive without delaying the response.
  event.waitUntil(
    resultPromise
      .then(({ cacheWrite }) => cacheWrite)
      .catch((error) => console.warn('Runtime cache update failed:', error))
  );
});
