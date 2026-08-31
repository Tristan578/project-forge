// SpawnForge Service Worker
// Cache strategy:
//   - App shell (HTML, CSS, JS): cache-first
//   - API routes (/api/*): network-first
//   - WASM files: skip (too large, served with immutable Cache-Control)

// v2: bumped so clients holding v1 drop it on activate. v1 may contain
// pre-authentication copies of "/" and "/dashboard"; without this bump those
// entries would survive the fix and keep serving signed-out HTML.
const CACHE_NAME = "spawnforge-v2";

// Static assets to pre-cache on install
// Deliberately EMPTY. This used to precache "/" and "/dashboard" — real routes,
// fetched at install time, i.e. before the user had signed in. Combined with the
// cache-first document path above, that served signed-out HTML to signed-in
// users. Navigations are no longer intercepted at all, so precaching documents
// would cache bytes nothing reads.
const PRECACHE_URLS = [];

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

  // NEVER intercept a navigation. Two reasons, both observed in production:
  //
  //  1. A navigation can redirect off-origin. An unauthenticated /dashboard
  //     307s to Clerk's account portal, and re-fetching that from here makes
  //     the request subject to `connect-src` — which blocked it outright and
  //     surfaced as an opaque "Failed to fetch" instead of a redirect. Letting
  //     the browser own navigations keeps them under the navigation directives
  //     where they belong.
  //  2. Cache-first on an HTML document serves a stale, possibly pre-auth page
  //     to a signed-in user. A document is not a static asset.
  //
  // Static sub-resources below are still cached; only the document is exempt.
  if (request.mode === "navigate" || request.destination === "document") {
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
        // .catch() is required, not defensive. Without it a failed background
        // revalidation is an unhandled rejection — which is exactly how the
        // CSP block above reached the console as
        // "Uncaught (in promise) TypeError: Failed to fetch at sw.js:94",
        // pointing at the service worker rather than at the real cause.
        const networkFetch = fetch(request).then((response) => {
          if (response.ok) {
            caches
              .open(CACHE_NAME)
              .then((cache) => cache.put(request, response.clone()));
          }
          return response;
        });
        // Don't wait for revalidation — return cached immediately
        event.waitUntil(
          networkFetch.catch(() => {
            // Offline, blocked, or 5xx: the cached copy was already returned,
            // so there is nothing to recover and nothing to report.
          })
        );
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
