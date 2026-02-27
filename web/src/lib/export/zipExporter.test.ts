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
  generateLoadingHtml: vi.fn(() => '<div id="loading-screen"><p class="progress-text">Loading...</p></div>'),
  generateLoadingScript: vi.fn(() => 'console.log("Loading script");'),
}));

// Mock fetch for WASM file loading
const mockFetch = vi.fn();

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
      // Mock fetch for WASM files - return 404 by default (no WASM available in test)
      mockFetch.mockResolvedValue({ ok: false, status: 404 });
      global.fetch = mockFetch as unknown as typeof fetch;
    });

    afterEach(() => {
      delete (global as { fetch?: unknown }).fetch;
    });

    it('creates a valid ZIP blob', async () => {
      const blob = await exportAsZip(mockSceneData, mockScripts, defaultOptions);
      expect(blob).toBeInstanceOf(Blob);
      expect(blob.type).toBe('application/zip');
    });

    it('creates a ZIP with valid signature bytes', async () => {
      const blob = await exportAsZip(mockSceneData, mockScripts, defaultOptions);
      const buffer = await blob.arrayBuffer();
      const view = new DataView(buffer);
      // First 4 bytes should be PK\x03\x04 (local file header signature)
      expect(view.getUint32(0, true)).toBe(0x04034b50);
    });

    it('includes game.json in the archive', async () => {
      const blob = await exportAsZip(mockSceneData, mockScripts, defaultOptions);
      const buffer = await blob.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      const text = new TextDecoder().decode(bytes);
      expect(text).toContain('game.json');
    });

    it('includes scripts.js in the archive', async () => {
      const blob = await exportAsZip(mockSceneData, mockScripts, defaultOptions);
      const buffer = await blob.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      const text = new TextDecoder().decode(bytes);
      expect(text).toContain('scripts.js');
    });

    it('includes index.html in the archive', async () => {
      const blob = await exportAsZip(mockSceneData, mockScripts, defaultOptions);
      const buffer = await blob.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      const text = new TextDecoder().decode(bytes);
      expect(text).toContain('index.html');
    });

    it('includes README.txt in the archive', async () => {
      const blob = await exportAsZip(mockSceneData, mockScripts, defaultOptions);
      const buffer = await blob.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      const text = new TextDecoder().decode(bytes);
      expect(text).toContain('README.txt');
    });

    it('includes extracted assets', async () => {
      const blob = await exportAsZip(mockSceneData, mockScripts, defaultOptions);
      const buffer = await blob.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      const text = new TextDecoder().decode(bytes);
      expect(text).toContain('assets/image1.png');
      expect(text).toContain('assets/audio1.mp3');
    });

    it('generates HTML with correct title', async () => {
      const blob = await exportAsZip(mockSceneData, mockScripts, {
        ...defaultOptions,
        title: 'My Awesome Game',
      });
      const buffer = await blob.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      const text = new TextDecoder().decode(bytes);
      expect(text).toContain('My Awesome Game');
    });

    it('includes debug script when includeDebug is true', async () => {
      const blob = await exportAsZip(mockSceneData, mockScripts, {
        ...defaultOptions,
        includeDebug: true,
      });
      const buffer = await blob.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      const text = new TextDecoder().decode(bytes);
      expect(text).toContain('window.onerror');
      expect(text).toContain('Debug mode enabled');
    });

    it('excludes debug script when includeDebug is false', async () => {
      const blob = await exportAsZip(mockSceneData, mockScripts, {
        ...defaultOptions,
        includeDebug: false,
      });
      const buffer = await blob.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      const text = new TextDecoder().decode(bytes);
      expect(text).not.toContain('Debug mode enabled');
    });

    it('applies responsive canvas style', async () => {
      const blob = await exportAsZip(mockSceneData, mockScripts, {
        ...defaultOptions,
        resolution: 'responsive',
      });
      const buffer = await blob.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      const text = new TextDecoder().decode(bytes);
      expect(text).toContain('width: 100vw; height: 100vh;');
    });

    it('applies 1920x1080 canvas style', async () => {
      const blob = await exportAsZip(mockSceneData, mockScripts, {
        ...defaultOptions,
        resolution: '1920x1080',
      });
      const buffer = await blob.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      const text = new TextDecoder().decode(bytes);
      expect(text).toContain('width: 1920px; height: 1080px;');
    });

    it('applies 1280x720 canvas style', async () => {
      const blob = await exportAsZip(mockSceneData, mockScripts, {
        ...defaultOptions,
        resolution: '1280x720',
      });
      const buffer = await blob.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      const text = new TextDecoder().decode(bytes);
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
      const buffer = await blob.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      const text = new TextDecoder().decode(bytes);
      expect(text).toContain('Epic Adventure');
      expect(text).toContain('HOW TO PLAY:');
    });

    it('includes browser requirements in README', async () => {
      const blob = await exportAsZip(mockSceneData, mockScripts, defaultOptions);
      const buffer = await blob.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      const text = new TextDecoder().decode(bytes);
      expect(text).toContain('REQUIREMENTS:');
      expect(text).toContain('WebGL2 or WebGPU');
    });

    it('includes local server instructions in README', async () => {
      const blob = await exportAsZip(mockSceneData, mockScripts, defaultOptions);
      const buffer = await blob.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      const text = new TextDecoder().decode(bytes);
      expect(text).toContain('RUNNING ON A LOCAL SERVER:');
      expect(text).toContain('python -m http.server');
      expect(text).toContain('npx http-server');
    });

    it('escapes HTML in title', async () => {
      const blob = await exportAsZip(mockSceneData, mockScripts, {
        ...defaultOptions,
        title: '<script>alert("xss")</script>',
      });
      const buffer = await blob.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      const text = new TextDecoder().decode(bytes);
      expect(text).toContain('&lt;script&gt;');
      expect(text).toContain('&lt;/script&gt;');
    });

    it('includes meta tags for mobile support', async () => {
      const blob = await exportAsZip(mockSceneData, mockScripts, defaultOptions);
      const buffer = await blob.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      const text = new TextDecoder().decode(bytes);
      expect(text).toContain('name="viewport"');
      expect(text).toContain('mobile-web-app-capable');
      expect(text).toContain('apple-mobile-web-app-capable');
    });

    it('includes canvas element', async () => {
      const blob = await exportAsZip(mockSceneData, mockScripts, defaultOptions);
      const buffer = await blob.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      const text = new TextDecoder().decode(bytes);
      expect(text).toContain('id="game-canvas"');
      expect(text).toContain('<canvas');
    });

    it('includes real WASM loading code', async () => {
      const blob = await exportAsZip(mockSceneData, mockScripts, defaultOptions);
      const buffer = await blob.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      const text = new TextDecoder().decode(bytes);
      expect(text).toContain('engine-pkg-');
      expect(text).toContain('forge_engine.js');
      expect(text).toContain('forge_engine_bg.wasm');
      expect(text).toContain('init_engine');
      expect(text).toContain('handle_command');
    });

    it('includes scene loading via game.json fetch', async () => {
      const blob = await exportAsZip(mockSceneData, mockScripts, defaultOptions);
      const buffer = await blob.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      const text = new TextDecoder().decode(bytes);
      expect(text).toContain("fetch('game.json')");
      expect(text).toContain('__forgeSceneData');
    });

    it('includes script bundle execution', async () => {
      const blob = await exportAsZip(mockSceneData, mockScripts, defaultOptions);
      const buffer = await blob.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      const text = new TextDecoder().decode(bytes);
      expect(text).toContain("fetch('scripts.js')");
      expect(text).toContain('__forgeScriptStart');
      expect(text).toContain('__forgeScriptUpdate');
    });

    it('includes game loop with command flush', async () => {
      const blob = await exportAsZip(mockSceneData, mockScripts, defaultOptions);
      const buffer = await blob.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      const text = new TextDecoder().decode(bytes);
      expect(text).toContain('gameLoop');
      expect(text).toContain('__forgeFlushCommands');
      expect(text).toContain('requestAnimationFrame');
    });

    it('includes event callback setup', async () => {
      const blob = await exportAsZip(mockSceneData, mockScripts, defaultOptions);
      const buffer = await blob.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      const text = new TextDecoder().decode(bytes);
      expect(text).toContain('set_event_callback');
      expect(text).toContain('INPUT_STATE_CHANGED');
      expect(text).toContain('TRANSFORM_CHANGED');
      expect(text).toContain('__forgeInputState');
      expect(text).toContain('__forgeTransforms');
    });

    it('includes click-to-start for audio autoplay policy', async () => {
      const blob = await exportAsZip(mockSceneData, mockScripts, defaultOptions);
      const buffer = await blob.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      const text = new TextDecoder().decode(bytes);
      expect(text).toContain('Click to start');
      expect(text).toContain("addEventListener('click'");
    });

    it('fetches WASM engine files during export', async () => {
      await exportAsZip(mockSceneData, mockScripts, defaultOptions);
      // Should attempt to fetch both variants
      expect(mockFetch).toHaveBeenCalledWith('/engine-pkg-webgl2/forge_engine.js');
      expect(mockFetch).toHaveBeenCalledWith('/engine-pkg-webgl2/forge_engine_bg.wasm');
      expect(mockFetch).toHaveBeenCalledWith('/engine-pkg-webgpu/forge_engine.js');
      expect(mockFetch).toHaveBeenCalledWith('/engine-pkg-webgpu/forge_engine_bg.wasm');
    });

    it('includes WASM files when fetch succeeds', async () => {
      const fakeWasmJs = new Blob(['// WASM JS glue'], { type: 'application/javascript' });
      const fakeWasmBin = new Blob([new Uint8Array([0, 97, 115, 109])], { type: 'application/wasm' });

      mockFetch.mockImplementation(async (url: string) => {
        if (url.endsWith('.js')) return { ok: true, blob: async () => fakeWasmJs };
        if (url.endsWith('.wasm')) return { ok: true, blob: async () => fakeWasmBin };
        return { ok: false };
      });

      const blob = await exportAsZip(mockSceneData, mockScripts, defaultOptions);
      const buffer = await blob.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      const text = new TextDecoder().decode(bytes);

      // Should contain the WASM file paths in the ZIP
      expect(text).toContain('engine-pkg-webgl2/forge_engine.js');
      expect(text).toContain('engine-pkg-webgl2/forge_engine_bg.wasm');
      expect(text).toContain('engine-pkg-webgpu/forge_engine.js');
      expect(text).toContain('engine-pkg-webgpu/forge_engine_bg.wasm');
    });

    it('produces a ZIP with valid end-of-central-directory record', async () => {
      const blob = await exportAsZip(mockSceneData, mockScripts, defaultOptions);
      const buffer = await blob.arrayBuffer();
      const bytes = new Uint8Array(buffer);

      // Find end-of-central-directory signature (0x06054b50)
      let foundEOCD = false;
      for (let i = bytes.length - 22; i >= 0; i--) {
        const view = new DataView(buffer, i);
        if (view.getUint32(0, true) === 0x06054b50) {
          foundEOCD = true;
          break;
        }
      }
      expect(foundEOCD).toBe(true);
    });

    it('includes UI root and touch overlay elements', async () => {
      const blob = await exportAsZip(mockSceneData, mockScripts, defaultOptions);
      const buffer = await blob.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      const text = new TextDecoder().decode(bytes);
      expect(text).toContain('forge-ui-root');
      expect(text).toContain('forge-touch-overlay');
    });
  });

  describe('supportsCompression', () => {
    it('returns true when CompressionStream is available', () => {
      const origWindow = global.window;
      global.window = { CompressionStream: class {} } as unknown as Window & typeof globalThis;
      expect(supportsCompression()).toBe(true);
      global.window = origWindow;
    });

    it('returns false when window is undefined', () => {
      const origWindow = global.window;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (global as any).window;
      expect(supportsCompression()).toBe(false);
      global.window = origWindow;
    });
  });
});
