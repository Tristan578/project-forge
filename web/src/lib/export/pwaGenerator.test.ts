// @vitest-environment jsdom
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

      expect(parsed.description).toBe('My Game - Created with SpawnForge');
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

    it('uses full uppercase title for 3-character titles (boundary: length <= 3)', async () => {
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

      await generatePlaceholderIcons('Ace');
      expect(mockCtx.fillText).toHaveBeenCalledWith('ACE', 96, 96);
    });

    it('uses 2-char initials for 4-character titles (boundary: length > 3)', async () => {
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

      await generatePlaceholderIcons('Edge');
      expect(mockCtx.fillText).toHaveBeenCalledWith('ED', 96, 96);
    });

    it('still returns icon data URLs when ctx192 is null (getContext returns null)', async () => {
      let callCount = 0;
      global.document = {
        createElement: vi.fn(() => {
          callCount++;
          return {
            width: 0,
            height: 0,
            // First canvas returns null context, second returns a valid one
            getContext: vi.fn(() => (callCount === 1 ? null : {
              fillRect: vi.fn(),
              fillText: vi.fn(),
              createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
              fillStyle: '',
              font: '',
              textAlign: '',
              textBaseline: '',
            })),
            toDataURL: vi.fn(() => 'data:image/png;base64,test'),
          };
        }),
      } as unknown as Document;

      const icons = await generatePlaceholderIcons('My Game');
      expect(icons.icon192).toContain('data:image/png;base64');
      expect(icons.icon512).toContain('data:image/png;base64');
    });

    it('still returns icon data URLs when ctx512 is null (getContext returns null)', async () => {
      let callCount = 0;
      global.document = {
        createElement: vi.fn(() => {
          callCount++;
          return {
            width: 0,
            height: 0,
            // First canvas (192) returns a valid context, second (512) returns null
            getContext: vi.fn(() => (callCount === 2 ? null : {
              fillRect: vi.fn(),
              fillText: vi.fn(),
              createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
              fillStyle: '',
              font: '',
              textAlign: '',
              textBaseline: '',
            })),
            toDataURL: vi.fn(() => 'data:image/png;base64,test'),
          };
        }),
      } as unknown as Document;

      const icons = await generatePlaceholderIcons('My Game');
      expect(icons.icon192).toContain('data:image/png;base64');
      expect(icons.icon512).toContain('data:image/png;base64');
    });

    it('still returns icon data URLs when both contexts are null', async () => {
      global.document = {
        createElement: vi.fn(() => ({
          width: 0,
          height: 0,
          getContext: vi.fn(() => null),
          toDataURL: vi.fn(() => 'data:image/png;base64,empty'),
        })),
      } as unknown as Document;

      const icons = await generatePlaceholderIcons('My Game');
      expect(icons.icon192).toContain('data:image/png;base64');
      expect(icons.icon512).toContain('data:image/png;base64');
    });

    it('draws icons at the correct sizes (192 and 512)', async () => {
      const canvasSizes: number[] = [];
      global.document = {
        createElement: vi.fn(() => {
          const canvas = {
            width: 0 as number,
            height: 0 as number,
            getContext: vi.fn(() => ({
              fillRect: vi.fn(),
              fillText: vi.fn(),
              createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
              fillStyle: '',
              font: '',
              textAlign: '',
              textBaseline: '',
            })),
            toDataURL: vi.fn(() => 'data:image/png;base64,test'),
          };
          // Track the size assignment via a setter
          Object.defineProperty(canvas, 'width', {
            get() { return this._width ?? 0; },
            set(v: number) {
              this._width = v;
              canvasSizes.push(v);
            },
          });
          return canvas;
        }),
      } as unknown as Document;

      await generatePlaceholderIcons('Game');
      expect(canvasSizes).toContain(192);
      expect(canvasSizes).toContain(512);
    });
  });

  describe('generateManifest edge cases', () => {
    it('includes scope field set to "."', () => {
      const parsed = JSON.parse(generateManifest({
        title: 'My Game',
        backgroundColor: '#000000',
        themeColor: '#ffffff',
      }));
      expect(parsed.scope).toBe('.');
    });

    it('sets start_url to "."', () => {
      const parsed = JSON.parse(generateManifest({
        title: 'My Game',
        backgroundColor: '#000000',
        themeColor: '#ffffff',
      }));
      expect(parsed.start_url).toBe('.');
    });

    it('sets icon purpose to "any maskable" for both icons', () => {
      const parsed = JSON.parse(generateManifest({
        title: 'My Game',
        backgroundColor: '#000000',
        themeColor: '#ffffff',
      }));
      expect(parsed.icons[0].purpose).toBe('any maskable');
      expect(parsed.icons[1].purpose).toBe('any maskable');
    });

    it('sets icon MIME types to image/png', () => {
      const parsed = JSON.parse(generateManifest({
        title: 'My Game',
        backgroundColor: '#000000',
        themeColor: '#ffffff',
      }));
      expect(parsed.icons[0].type).toBe('image/png');
      expect(parsed.icons[1].type).toBe('image/png');
    });

    it('produces valid JSON output', () => {
      const manifest = generateManifest({
        title: 'My Game',
        backgroundColor: '#000000',
        themeColor: '#ffffff',
      });
      expect(() => JSON.parse(manifest)).not.toThrow();
    });

    it('truncates short_name at exactly 12 characters when title is exactly 12 characters', () => {
      const parsed = JSON.parse(generateManifest({
        title: '123456789012', // exactly 12 chars
        backgroundColor: '#000000',
        themeColor: '#ffffff',
      }));
      expect(parsed.short_name).toBe('123456789012');
      expect(parsed.short_name.length).toBe(12);
    });

    it('truncates short_name when title is longer than 12 characters', () => {
      const parsed = JSON.parse(generateManifest({
        title: '1234567890123', // 13 chars
        backgroundColor: '#000000',
        themeColor: '#ffffff',
      }));
      expect(parsed.short_name).toBe('123456789012');
      expect(parsed.short_name.length).toBe(12);
    });

    it('preserves explicit shortName even if longer than 12 characters', () => {
      const parsed = JSON.parse(generateManifest({
        title: 'My Game',
        shortName: 'This Is A Long Short Name',
        backgroundColor: '#000000',
        themeColor: '#ffffff',
      }));
      expect(parsed.short_name).toBe('This Is A Long Short Name');
    });

    it('handles title with special characters in description default', () => {
      const parsed = JSON.parse(generateManifest({
        title: 'Foo & Bar <Game>',
        backgroundColor: '#000000',
        themeColor: '#ffffff',
      }));
      expect(parsed.description).toBe('Foo & Bar <Game> - Created with SpawnForge');
    });

    it('sets display to fullscreen', () => {
      const parsed = JSON.parse(generateManifest({
        title: 'My Game',
        backgroundColor: '#000000',
        themeColor: '#ffffff',
      }));
      expect(parsed.display).toBe('fullscreen');
    });
  });

  describe('generateServiceWorker structural integrity', () => {
    it('returns a non-empty string', () => {
      const sw = generateServiceWorker();
      expect(typeof sw).toBe('string');
      expect(sw.length).toBeGreaterThan(0);
    });

    it('includes icon files in the cache list', () => {
      const sw = generateServiceWorker();
      expect(sw).toContain('icon-192.png');
      expect(sw).toContain('icon-512.png');
    });

    it('cache name is forge-game-v1', () => {
      const sw = generateServiceWorker();
      expect(sw).toContain("'forge-game-v1'");
    });

    it('includes offline fallback response with 503 status', () => {
      const sw = generateServiceWorker();
      expect(sw).toContain('503');
      expect(sw).toContain('Service Unavailable');
    });

    it('includes fetch request clone step', () => {
      const sw = generateServiceWorker();
      expect(sw).toContain('event.request.clone()');
    });

    it('includes cache-first strategy comment', () => {
      const sw = generateServiceWorker();
      expect(sw).toContain('Cache-first');
    });
  });

  describe('generateInstallPrompt structural integrity', () => {
    it('returns a non-empty string', () => {
      const html = generateInstallPrompt();
      expect(typeof html).toBe('string');
      expect(html.length).toBeGreaterThan(0);
    });

    it('includes hover style for install button', () => {
      const html = generateInstallPrompt();
      expect(html).toContain('#pwa-install-button:hover');
    });

    it('includes indigo brand color for install button', () => {
      const html = generateInstallPrompt();
      expect(html).toContain('#6366f1');
    });

    it('includes script tag for install logic', () => {
      const html = generateInstallPrompt();
      expect(html).toContain('<script>');
      expect(html).toContain('</script>');
    });

    it('includes userChoice outcome check', () => {
      const html = generateInstallPrompt();
      expect(html).toContain('userChoice');
      expect(html).toContain('outcome');
    });

    it('clears deferred prompt after use', () => {
      const html = generateInstallPrompt();
      expect(html).toContain('deferredPrompt = null');
    });
  });
});