// Network-first service worker. A finance app must never get pinned to a stale build:
// every navigation and asset is fetched fresh from the network, and the cache is only an
// offline fallback. Bumping CACHE_NAME on deploy purges the previous (possibly stale) cache
// on activate, which self-heals browsers stuck on an old "cache-first" version.
const CACHE_NAME = "rindomes-shell-v2";
const OFFLINE_ASSETS = ["/manifest.webmanifest", "/icon.svg", "/maskable-icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(OFFLINE_ASSETS)).catch(() => {}),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  // Let cross-origin requests (Convex realtime/API, Google Fonts) pass straight through —
  // never cache or intercept them, or live sync and auth would break.
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Network-first: always serve the freshest build; fall back to cache only when offline.
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && response.status === 200 && response.type === "basic") {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)).catch(() => {});
        }
        return response;
      })
      .catch(() =>
        caches.match(request).then((cached) => cached || caches.match("/manifest.webmanifest")),
      ),
  );
});
