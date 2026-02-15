import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateManifest, generateServiceWorker, generateInstallPrompt, generatePlaceholderIcons } from './pwaGenerator';

describe('pwaGenerator', () => {
  describe('generateManifest', () => {
    it('generates manifest with required fields', () => {
      const options = {
        title: 'My Game',
        backgroundColor: '#000000',
        themeColor: '#6366f1',
      };
      const manifest = generateManifest(options);
      const parsed = JSON.parse(manifest);

      expect(parsed.name).toBe('My Game');
      expect(parsed.background_color).toBe('#000000');
      expect(parsed.theme_color).toBe('#6366f1');
      expect(parsed.display).toBe('fullscreen');
      expect(parsed.start_url).toBe('.');
    });

    it('generates shortName from title when not provided', () => {
      const options = {
        title: 'Super Long Game Title',
        backgroundColor: '#000000',
        themeColor: '#ffffff',
      };
      const manifest = generateManifest(options);
      const parsed = JSON.parse(manifest);

      expect(parsed.short_name).toBe('Super Long G');
      expect(parsed.short_name.length).toBeLessThanOrEqual(12);
    });

    it('uses provided shortName when available', () => {
      const options = {
        title: 'My Game',
        shortName: 'Game',
        backgroundColor: '#000000',
        themeColor: '#ffffff',
      };
      const manifest = generateManifest(options);
      const parsed = JSON.parse(manifest);

      expect(parsed.short_name).toBe('Game');
    });

    it('generates default description when not provided', () => {
      const options = {
        title: 'My Game',
        backgroundColor: '#000000',
        themeColor: '#ffffff',
      };
      const manifest = generateManifest(options);
      const parsed = JSON.parse(manifest);

      expect(parsed.description).toBe('My Game - Created with Project Forge');
    });

    it('uses provided description', () => {
      const options = {
        title: 'My Game',
        description: 'A fun platformer game',
        backgroundColor: '#000000',
        themeColor: '#ffffff',
      };
      const manifest = generateManifest(options);
      const parsed = JSON.parse(manifest);

      expect(parsed.description).toBe('A fun platformer game');
    });

    it('includes icon definitions', () => {
      const options = {
        title: 'My Game',
        backgroundColor: '#000000',
        themeColor: '#ffffff',
      };
      const manifest = generateManifest(options);
      const parsed = JSON.parse(manifest);

      expect(parsed.icons).toHaveLength(2);
      expect(parsed.icons[0].src).toBe('icon-192.png');
      expect(parsed.icons[0].sizes).toBe('192x192');
      expect(parsed.icons[1].src).toBe('icon-512.png');
      expect(parsed.icons[1].sizes).toBe('512x512');
    });

    it('includes game categories', () => {
      const options = {
        title: 'My Game',
        backgroundColor: '#000000',
        themeColor: '#ffffff',
      };
      const manifest = generateManifest(options);
      const parsed = JSON.parse(manifest);

      expect(parsed.categories).toContain('games');
      expect(parsed.categories).toContain('entertainment');
    });

    it('supports portrait orientation', () => {
      const options = {
        title: 'My Game',
        backgroundColor: '#000000',
        themeColor: '#ffffff',
        orientation: 'portrait' as const,
      };
      const manifest = generateManifest(options);
      const parsed = JSON.parse(manifest);

      expect(parsed.orientation).toBe('portrait');
    });

    it('supports landscape orientation', () => {
      const options = {
        title: 'My Game',
        backgroundColor: '#000000',
        themeColor: '#ffffff',
        orientation: 'landscape' as const,
      };
      const manifest = generateManifest(options);
      const parsed = JSON.parse(manifest);

      expect(parsed.orientation).toBe('landscape');
    });

    it('defaults to any orientation', () => {
      const options = {
        title: 'My Game',
        backgroundColor: '#000000',
        themeColor: '#ffffff',
      };
      const manifest = generateManifest(options);
      const parsed = JSON.parse(manifest);

      expect(parsed.orientation).toBe('any');
    });
  });

  describe('generateServiceWorker', () => {
    it('generates valid service worker code', () => {
      const sw = generateServiceWorker();
      expect(sw).toContain('CACHE_NAME');
      expect(sw).toContain('urlsToCache');
      expect(sw).toContain('self.addEventListener');
    });

    it('includes install event handler', () => {
      const sw = generateServiceWorker();
      expect(sw).toContain('addEventListener(\'install\'');
      expect(sw).toContain('caches.open');
      expect(sw).toContain('cache.addAll');
      expect(sw).toContain('self.skipWaiting()');
    });

    it('includes activate event handler', () => {
      const sw = generateServiceWorker();
      expect(sw).toContain('addEventListener(\'activate\'');
      expect(sw).toContain('caches.keys()');
      expect(sw).toContain('caches.delete');
      expect(sw).toContain('self.clients.claim()');
    });

    it('includes fetch event handler', () => {
      const sw = generateServiceWorker();
      expect(sw).toContain('addEventListener(\'fetch\'');
      expect(sw).toContain('caches.match');
      expect(sw).toContain('event.respondWith');
    });

    it('caches critical game files', () => {
      const sw = generateServiceWorker();
      expect(sw).toContain('index.html');
      expect(sw).toContain('game.json');
      expect(sw).toContain('scripts.js');
      expect(sw).toContain('manifest.json');
    });

    it('includes sync event handler for future features', () => {
      const sw = generateServiceWorker();
      expect(sw).toContain('addEventListener(\'sync\'');
      expect(sw).toContain('sync-game-state');
    });

    it('includes push notification handler', () => {
      const sw = generateServiceWorker();
      expect(sw).toContain('addEventListener(\'push\'');
      expect(sw).toContain('showNotification');
    });

    it('includes notification click handler', () => {
      const sw = generateServiceWorker();
      expect(sw).toContain('addEventListener(\'notificationclick\'');
      expect(sw).toContain('clients.openWindow');
    });
  });

  describe('generateInstallPrompt', () => {
    it('generates install prompt HTML', () => {
      const html = generateInstallPrompt();
      expect(html).toContain('id="pwa-install-prompt"');
      expect(html).toContain('id="pwa-install-button"');
      expect(html).toContain('Install App');
    });

    it('includes CSS styling', () => {
      const html = generateInstallPrompt();
      expect(html).toContain('<style>');
      expect(html).toContain('#pwa-install-prompt');
      expect(html).toContain('position: fixed');
      expect(html).toContain('z-index: 10000');
    });

    it('includes beforeinstallprompt event listener', () => {
      const html = generateInstallPrompt();
      expect(html).toContain('beforeinstallprompt');
      expect(html).toContain('deferredPrompt');
      expect(html).toContain('preventDefault()');
    });

    it('includes service worker registration', () => {
      const html = generateInstallPrompt();
      expect(html).toContain('serviceWorker');
      expect(html).toContain('navigator.serviceWorker.register');
      expect(html).toContain('./sw.js');
    });

    it('includes install button click handler', () => {
      const html = generateInstallPrompt();
      expect(html).toContain('pwa-install-button');
      expect(html).toContain('addEventListener(\'click\'');
      expect(html).toContain('deferredPrompt.prompt()');
    });

    it('hides prompt by default', () => {
      const html = generateInstallPrompt();
      expect(html).toContain('display: none');
    });
  });

  describe('generatePlaceholderIcons', () => {
    beforeEach(() => {
      global.document = {
        createElement: vi.fn(() => {
          const canvas = {
            width: 0,
            height: 0,
            getContext: vi.fn(() => ({
              fillRect: vi.fn(),
              fillText: vi.fn(),
              createLinearGradient: vi.fn(() => ({
                addColorStop: vi.fn(),
              })),
              fillStyle: '',
              font: '',
              textAlign: '',
              textBaseline: '',
            })),
            toDataURL: vi.fn(() => 'data:image/png;base64,test'),
          };
          return canvas;
        }),
      } as unknown as Document;
    });

    it('generates 192x192 and 512x512 icons', async () => {
      const icons = await generatePlaceholderIcons('Test Game');
      expect(icons.icon192).toContain('data:image/png;base64');
      expect(icons.icon512).toContain('data:image/png;base64');
    });

    it('creates canvas elements with correct sizes', async () => {
      const createElement = vi.spyOn(document, 'createElement');
      await generatePlaceholderIcons('Test Game');

      expect(createElement).toHaveBeenCalledWith('canvas');
      expect(createElement).toHaveBeenCalledTimes(2);
    });

    it('truncates long titles to initials', async () => {
      const mockCtx = {
        fillRect: vi.fn(),
        fillText: vi.fn(),
        createLinearGradient: vi.fn(() => ({
          addColorStop: vi.fn(),
        })),
        fillStyle: '',
        font: '',
        textAlign: '',
        textBaseline: '',
      };

      global.document = {
        createElement: vi.fn(() => ({
          width: 192,
          height: 192,
          getContext: vi.fn(() => mockCtx),
          toDataURL: vi.fn(() => 'data:image/png;base64,test'),
        })),
      } as unknown as Document;

      await generatePlaceholderIcons('Very Long Game Title');
      expect(mockCtx.fillText).toHaveBeenCalledWith('VE', 96, 96);
    });

    it('uses full title for short names', async () => {
      const mockCtx = {
        fillRect: vi.fn(),
        fillText: vi.fn(),
        createLinearGradient: vi.fn(() => ({
          addColorStop: vi.fn(),
        })),
        fillStyle: '',
        font: '',
        textAlign: '',
        textBaseline: '',
      };

      global.document = {
        createElement: vi.fn(() => ({
          width: 192,
          height: 192,
          getContext: vi.fn(() => mockCtx),
          toDataURL: vi.fn(() => 'data:image/png;base64,test'),
        })),
      } as unknown as Document;

      await generatePlaceholderIcons('Go');
      expect(mockCtx.fillText).toHaveBeenCalledWith('GO', 96, 96);
    });
  });
});
