// Increment this version string every time you deploy a new build.
// The activate event deletes all caches whose name doesn't match,
// so users immediately receive the new version on their next visit.
const CACHE_VERSION = 'reps-tracker-v3';
const OFFLINE_CACHE = ['/manifest.json', '/icon-192.png', '/icon-512.png'];

// ── Install ──────────────────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  // Pre-cache only the bare minimum (icons/manifest) needed for offline shell.
  // JS/CSS bundles are NOT pre-cached — they are fetched fresh on every load.
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(OFFLINE_CACHE))
  );
  // Activate this SW immediately instead of waiting for old tabs to close.
  self.skipWaiting();
});

// ── Activate ─────────────────────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_VERSION)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// ── Fetch ─────────────────────────────────────────────────────────────────────
// Strategy: Network-first for all requests.
// • Always try the network so users get the latest code.
// • Fall back to cache only when the network is unavailable (offline).
// • Static icons/manifest are the only things served from cache when offline.
self.addEventListener('fetch', (event) => {
  // Skip non-GET and cross-origin requests (API calls, etc.)
  if (
    event.request.method !== 'GET' ||
    !event.request.url.startsWith(self.location.origin)
  ) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        // Successful network response — return it directly (no caching of JS/HTML).
        return networkResponse;
      })
      .catch(() => {
        // Network failed (offline) — try the cache as a fallback.
        return caches.match(event.request).then(
          (cached) => cached ?? caches.match('/manifest.json')
        );
      })
  );
});

// ── Messages ─────────────────────────────────────────────────────────────────
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
