import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { exportAsZip, supportsCompression } from './zipExporter';
import type { ScriptData } from '@/stores/editorStore';

// Mock dependencies
vi.mock('./assetExtractor', () => ({
  extractAssets: vi.fn(async (sceneData) => ({
    modifiedScene: { ...sceneData, assetsExtracted: true },
    assets: [
      { relativePath: 'assets/image1.png', blob: new Blob(['test-image-1']) },
      { relativePath: 'assets/audio1.mp3', blob: new Blob(['test-audio-1']) },
    ],
  })),
}));

vi.mock('./scriptBundler', () => ({
  bundleScripts: vi.fn(() => ({
    code: '// Bundled scripts\nfunction onStart() { console.log("start"); }',
  })),
}));

vi.mock('./loadingScreen', () => ({
  generateLoadingHtml: vi.fn(() => '<div id="loading">Loading...</div>'),
  generateLoadingScript: vi.fn(() => 'console.log("Loading script");'),
}));

describe('zipExporter', () => {
  const mockSceneData = {
    entities: [
      { id: 1, name: 'Cube', type: 'cube' },
      { id: 2, name: 'Light', type: 'directional_light' },
    ],
  };

  const mockScripts: Record<string, ScriptData> = {
    script1: {
      source: 'function onUpdate(dt) { forge.translate(entityId, 1, 0, 0); }',
      enabled: true,
    },
  };

  const defaultOptions = {
    format: 'zip' as const,
    includeSourceMaps: false,
    compressTextures: false,
    title: 'Test Game',
    resolution: '1280x720' as const,
    bgColor: '#000000',
    includeDebug: false,
  };

  describe('exportAsZip', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      // Mock window global for Node environment
      global.window = { CompressionStream: undefined } as unknown as Window & typeof globalThis;
    });

    afterEach(() => {
      delete (global as { window?: unknown }).window;
    });

    it('creates a ZIP blob with game files', async () => {
      const blob = await exportAsZip(mockSceneData, mockScripts, defaultOptions);
      expect(blob).toBeInstanceOf(Blob);
      expect(blob.type).toBe('application/zip');
    });

    it('includes game.json in the archive', async () => {
      const blob = await exportAsZip(mockSceneData, mockScripts, defaultOptions);
      const text = await blob.text();
      expect(text).toContain('game.json');
    });

    it('includes scripts.js in the archive', async () => {
      const blob = await exportAsZip(mockSceneData, mockScripts, defaultOptions);
      const text = await blob.text();
      expect(text).toContain('scripts.js');
    });

    it('includes index.html in the archive', async () => {
      const blob = await exportAsZip(mockSceneData, mockScripts, defaultOptions);
      const text = await blob.text();
      expect(text).toContain('index.html');
    });

    it('includes README.txt in the archive', async () => {
      const blob = await exportAsZip(mockSceneData, mockScripts, defaultOptions);
      const text = await blob.text();
      expect(text).toContain('README.txt');
    });

    it('includes extracted assets', async () => {
      const blob = await exportAsZip(mockSceneData, mockScripts, defaultOptions);
      const text = await blob.text();
      expect(text).toContain('assets/image1.png');
      expect(text).toContain('assets/audio1.mp3');
    });

    it('generates HTML with correct title', async () => {
      const blob = await exportAsZip(mockSceneData, mockScripts, {
        ...defaultOptions,
        title: 'My Awesome Game',
      });
      const text = await blob.text();
      expect(text).toContain('My Awesome Game');
    });

    it('includes debug script when includeDebug is true', async () => {
      const blob = await exportAsZip(mockSceneData, mockScripts, {
        ...defaultOptions,
        includeDebug: true,
      });
      const text = await blob.text();
      expect(text).toContain('window.onerror');
      expect(text).toContain('Debug mode enabled');
    });

    it('excludes debug script when includeDebug is false', async () => {
      const blob = await exportAsZip(mockSceneData, mockScripts, {
        ...defaultOptions,
        includeDebug: false,
      });
      const text = await blob.text();
      expect(text).not.toContain('Debug mode enabled');
    });

    it('applies responsive canvas style', async () => {
      const blob = await exportAsZip(mockSceneData, mockScripts, {
        ...defaultOptions,
        resolution: 'responsive',
      });
      const text = await blob.text();
      expect(text).toContain('width: 100vw; height: 100vh;');
    });

    it('applies 1920x1080 canvas style', async () => {
      const blob = await exportAsZip(mockSceneData, mockScripts, {
        ...defaultOptions,
        resolution: '1920x1080',
      });
      const text = await blob.text();
      expect(text).toContain('width: 1920px; height: 1080px;');
    });

    it('applies 1280x720 canvas style', async () => {
      const blob = await exportAsZip(mockSceneData, mockScripts, {
        ...defaultOptions,
        resolution: '1280x720',
      });
      const text = await blob.text();
      expect(text).toContain('width: 1280px; height: 720px;');
    });

    it('includes custom loading screen when provided', async () => {
      const customLoading = {
        backgroundColor: '#ff0000',
        progressBarColor: '#00ff00',
        progressStyle: 'spinner' as const,
        title: 'Loading Custom',
      };

      const blob = await exportAsZip(mockSceneData, mockScripts, {
        ...defaultOptions,
        customLoadingScreen: customLoading,
      });

      expect(blob).toBeInstanceOf(Blob);
    });

    it('generates README with game title', async () => {
      const blob = await exportAsZip(mockSceneData, mockScripts, {
        ...defaultOptions,
        title: 'Epic Adventure',
      });
      const text = await blob.text();
      expect(text).toContain('Epic Adventure');
      expect(text).toContain('HOW TO PLAY:');
    });

    it('includes browser requirements in README', async () => {
      const blob = await exportAsZip(mockSceneData, mockScripts, defaultOptions);
      const text = await blob.text();
      expect(text).toContain('REQUIREMENTS:');
      expect(text).toContain('WebGL2 or WebGPU');
    });

    it('includes local server instructions in README', async () => {
      const blob = await exportAsZip(mockSceneData, mockScripts, defaultOptions);
      const text = await blob.text();
      expect(text).toContain('RUNNING ON A LOCAL SERVER:');
      expect(text).toContain('python -m http.server');
      expect(text).toContain('npx http-server');
    });

    it('escapes HTML in title', async () => {
      const blob = await exportAsZip(mockSceneData, mockScripts, {
        ...defaultOptions,
        title: '<script>alert("xss")</script>',
      });
      const text = await blob.text();
      expect(text).toContain('&lt;script&gt;');
      expect(text).toContain('&lt;/script&gt;');
    });

    it('includes meta tags for mobile support', async () => {
      const blob = await exportAsZip(mockSceneData, mockScripts, defaultOptions);
      const text = await blob.text();
      expect(text).toContain('name="viewport"');
      expect(text).toContain('mobile-web-app-capable');
      expect(text).toContain('apple-mobile-web-app-capable');
    });

    it('includes canvas element', async () => {
      const blob = await exportAsZip(mockSceneData, mockScripts, defaultOptions);
      const text = await blob.text();
      expect(text).toContain('id="game-canvas"');
      expect(text).toContain('<canvas');
    });

    it('includes game initialization script', async () => {
      const blob = await exportAsZip(mockSceneData, mockScripts, defaultOptions);
      const text = await blob.text();
      expect(text).toContain('fetch(\'game.json\')');
      expect(text).toContain('FORGE_SCENE_DATA');
      expect(text).toContain('FORGE_SCRIPT_BUNDLE');
    });
  });

  describe('supportsCompression', () => {
    beforeEach(() => {
      global.window = { CompressionStream: undefined } as unknown as Window & typeof globalThis;
    });

    afterEach(() => {
      delete (global as { window?: unknown }).window;
    });

    it('returns true when CompressionStream is available', () => {
      global.window = { CompressionStream: class {} } as unknown as Window & typeof globalThis;
      expect(supportsCompression()).toBe(true);
    });

    it('returns false when CompressionStream is not available', () => {
      global.window = {} as unknown as Window & typeof globalThis;
      expect(supportsCompression()).toBe(false);
    });
  });
});
