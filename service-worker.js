const APP_VERSION = '1.4.3';
const CACHE_NAME = `cantiere-media-shell-${APP_VERSION}`;
const NAVIGATION_TIMEOUT_MS = 4000;
const APP_SHELL = [
  './',
  './index.html',
  './repair.html',
  './manifest.json?v=1.4.3',
  './css/style.css?v=1.4.3',
  './js/bootstrap-1.4.3.js',
  './js/app.js?v=1.4.3',
  './js/auth.js?v=1.4.3',
  './js/config.js?v=1.4.3',
  './js/db.js?v=1.4.3',
  './js/exif.js?v=1.4.3',
  './js/file-hash.js?v=1.4.3',
  './js/filters.js?v=1.4.3',
  './js/gallery.js?v=1.4.3',
  './js/media.js?v=1.4.3',
  './js/permissions.js?v=1.4.3',
  './js/site-favorites.js?v=1.4.3',
  './js/site-picker.js?v=1.4.3',
  './js/sites.js?v=1.4.3',
  './js/ui.js?v=1.4.3',
  './js/upload.js?v=1.4.3',
  './js/users.js?v=1.4.3',
  './js/utils.js?v=1.4.3',
  './js/viewer.js?v=1.4.3',
  './images/logo-spini.png',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    const requests = APP_SHELL.map((url) => new Request(url, { cache: 'reload' }));
    await cache.addAll(requests);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith('cantiere-media-shell-') && key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

async function fetchWithTimeout(request, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(request, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function networkFirstNavigation(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetchWithTimeout(request, NAVIGATION_TIMEOUT_MS);
    if (!response.ok) throw new Error(`Navigation failed with status ${response.status}.`);
    await cache.put('./index.html', response.clone());
    return response;
  } catch {
    return (await cache.match('./index.html'))
      ?? new Response('Applicazione non disponibile offline.', {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
  }
}

async function cacheFirstStatic(request, event) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  const update = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);

  if (cached) {
    event.waitUntil(update);
    return cached;
  }
  return (await update) ?? new Response('Offline', { status: 503 });
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(request));
    return;
  }
  event.respondWith(cacheFirstStatic(request, event));
});
