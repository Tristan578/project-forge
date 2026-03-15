// SpawnForge Service Worker
// Cache strategy:
//   - App shell (HTML, CSS, JS): cache-first
//   - API routes (/api/*): network-first
//   - WASM files: skip (too large, served with immutable Cache-Control)

const CACHE_NAME = "spawnforge-v1";

// Static assets to pre-cache on install
const PRECACHE_URLS = [
  "/",
  "/dashboard",
];

// Patterns that should never be cached
const SKIP_PATTERNS = [
  /\.wasm$/,
  /engine-pkg-/,
  /\/api\//,
  /\/_next\/webpack-hmr/,
];

// Patterns that should use network-first strategy
const NETWORK_FIRST_PATTERNS = [
  /\/api\//,
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle same-origin GET requests
  if (request.method !== "GET" || url.origin !== self.location.origin) {
    return;
  }

  // Skip WASM and other non-cacheable assets
  const shouldSkip = SKIP_PATTERNS.some((pattern) =>
    pattern.test(url.pathname)
  );
  if (shouldSkip) {
    return;
  }

  // Network-first for API routes
  const isNetworkFirst = NETWORK_FIRST_PATTERNS.some((pattern) =>
    pattern.test(url.pathname)
  );

  if (isNetworkFirst) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // Cache-first for static assets (HTML, CSS, JS)
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) {
        // Revalidate in background
        const networkFetch = fetch(request).then((response) => {
          if (response.ok) {
            caches
              .open(CACHE_NAME)
              .then((cache) => cache.put(request, response.clone()));
          }
          return response;
        });
        // Don't wait for revalidation — return cached immediately
        event.waitUntil(networkFetch);
        return cached;
      }

      return fetch(request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      });
    })
  );
});
