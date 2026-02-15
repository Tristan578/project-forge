/**
 * PWA (Progressive Web App) Generator
 * Creates manifest.json and service worker for installable games
 */

export interface PwaOptions {
  title: string;
  shortName?: string;
  description?: string;
  backgroundColor: string;
  themeColor: string;
  iconDataUrl?: string;
  orientation?: 'portrait' | 'landscape' | 'any';
}

/**
 * Generate PWA manifest.json
 */
export function generateManifest(options: PwaOptions): string {
  const {
    title,
    shortName = title.slice(0, 12),
    description = `${title} - Created with Project Forge`,
    backgroundColor,
    themeColor,
    orientation = 'any',
  } = options;

  const manifest = {
    name: title,
    short_name: shortName,
    description,
    start_url: '.',
    display: 'fullscreen',
    background_color: backgroundColor,
    theme_color: themeColor,
    orientation,
    scope: '.',
    icons: [
      {
        src: 'icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any maskable',
      },
      {
        src: 'icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any maskable',
      },
    ],
    categories: ['games', 'entertainment'],
  };

  return JSON.stringify(manifest, null, 2);
}

/**
 * Generate service worker for offline caching
 */
export function generateServiceWorker(): string {
  return `// Project Forge Game - Service Worker
const CACHE_NAME = 'forge-game-v1';
const urlsToCache = [
  '.',
  './index.html',
  './game.json',
  './scripts.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
];

// Install service worker and cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Caching app shell');
      return cache.addAll(urlsToCache);
    })
  );
  self.skipWaiting();
});

// Activate service worker and clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((cacheName) => cacheName !== CACHE_NAME)
          .map((cacheName) => {
            console.log('[SW] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          })
      );
    })
  );
  self.clients.claim();
});

// Fetch strategy: Cache-first for game assets, network-first for API calls
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((response) => {
      // Cache hit - return cached response
      if (response) {
        return response;
      }

      // Clone the request
      const fetchRequest = event.request.clone();

      return fetch(fetchRequest).then((response) => {
        // Check if valid response
        if (!response || response.status !== 200 || response.type !== 'basic') {
          return response;
        }

        // Clone the response
        const responseToCache = response.clone();

        // Cache the fetched resource for future use
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseToCache);
        });

        return response;
      }).catch(() => {
        // Return offline page or fallback if needed
        console.log('[SW] Fetch failed, returning offline fallback');
        return new Response('Offline - please check your connection', {
          status: 503,
          statusText: 'Service Unavailable',
          headers: new Headers({
            'Content-Type': 'text/plain',
          }),
        });
      });
    })
  );
});

// Background sync for future multiplayer features
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-game-state') {
    event.waitUntil(syncGameState());
  }
});

async function syncGameState() {
  console.log('[SW] Syncing game state...');
  // Future: sync save data or multiplayer state
}

// Push notifications for future features
self.addEventListener('push', (event) => {
  if (!event.data) return;

  const data = event.data.json();
  const options = {
    body: data.body || 'New update available!',
    icon: './icon-192.png',
    badge: './icon-192.png',
    vibrate: [200, 100, 200],
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'Game Update', options)
  );
});

// Notification click handler
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.openWindow('./')
  );
});
`;
}

/**
 * Generate PWA installation HTML snippet
 */
export function generateInstallPrompt(): string {
  return `
    <div id="pwa-install-prompt" style="display: none;">
      <button id="pwa-install-button">Install App</button>
    </div>
    <style>
      #pwa-install-prompt {
        position: fixed;
        bottom: 20px;
        right: 20px;
        background: rgba(0,0,0,0.9);
        padding: 16px 24px;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        z-index: 10000;
      }
      #pwa-install-button {
        background: #6366f1;
        color: white;
        border: none;
        padding: 10px 20px;
        border-radius: 6px;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
        transition: background 0.2s;
      }
      #pwa-install-button:hover {
        background: #4f46e5;
      }
    </style>
    <script>
      // PWA install prompt
      let deferredPrompt;

      window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredPrompt = e;
        document.getElementById('pwa-install-prompt').style.display = 'block';
      });

      document.getElementById('pwa-install-button').addEventListener('click', async () => {
        if (!deferredPrompt) return;

        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        console.log('[PWA] User choice:', outcome);

        deferredPrompt = null;
        document.getElementById('pwa-install-prompt').style.display = 'none';
      });

      // Register service worker
      if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
          navigator.serviceWorker.register('./sw.js')
            .then(reg => console.log('[PWA] Service worker registered:', reg.scope))
            .catch(err => console.error('[PWA] Service worker registration failed:', err));
        });
      }
    </script>
  `;
}

/**
 * Generate placeholder app icons
 * Returns data URLs for 192x192 and 512x512 icons
 */
export async function generatePlaceholderIcons(gameTitle: string): Promise<{
  icon192: string;
  icon512: string;
}> {
  // Create canvas and draw placeholder icon
  const canvas192 = document.createElement('canvas');
  canvas192.width = 192;
  canvas192.height = 192;
  const ctx192 = canvas192.getContext('2d');
  if (ctx192) {
    drawPlaceholderIcon(ctx192, 192, gameTitle);
  }

  const canvas512 = document.createElement('canvas');
  canvas512.width = 512;
  canvas512.height = 512;
  const ctx512 = canvas512.getContext('2d');
  if (ctx512) {
    drawPlaceholderIcon(ctx512, 512, gameTitle);
  }

  return {
    icon192: canvas192.toDataURL('image/png'),
    icon512: canvas512.toDataURL('image/png'),
  };
}

function drawPlaceholderIcon(ctx: CanvasRenderingContext2D, size: number, title: string) {
  // Background gradient
  const gradient = ctx.createLinearGradient(0, 0, size, size);
  gradient.addColorStop(0, '#6366f1');
  gradient.addColorStop(1, '#8b5cf6');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  // Title text
  ctx.fillStyle = 'white';
  ctx.font = `bold ${size / 6}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Split into initials if too long
  const text = title.length > 3 ? title.slice(0, 2).toUpperCase() : title.toUpperCase();
  ctx.fillText(text, size / 2, size / 2);
}
