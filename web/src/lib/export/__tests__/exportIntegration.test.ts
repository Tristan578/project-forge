/**
 * PF-155: Export pipeline integration tests.
 *
 * Tests the full pipeline flow between modules:
 * - extractAssets: scene walk → asset extraction → dedup → path replacement
 * - bundleScripts: enabled filtering → closure wrapping → forge API runtime
 * - generateGameHTML: all options combined (scene + scripts + WASM + UI + touch)
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { extractAssets } from '../assetExtractor';
import { bundleScripts } from '../scriptBundler';
import { generateGameHTML, type EmbeddedWasmData } from '../gameTemplate';
import type { ScriptData } from '@/stores/editorStore';

// FNV-1a hash — deterministic, sufficient for asset dedup testing.
function fnv1aDigest(data: BufferSource): ArrayBuffer {
  // Normalise ArrayBufferView correctly, honouring byteOffset and byteLength.
  const bytes =
    data instanceof ArrayBuffer
      ? new Uint8Array(data)
      : new Uint8Array((data as ArrayBufferView).buffer, (data as ArrayBufferView).byteOffset, (data as ArrayBufferView).byteLength);
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193);
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    out[i] = (h >>> ((i % 4) * 8)) & 0xff;
    h = Math.imul(h, 0x01000193) ^ i;
  }
  return out.buffer;
}

// Polyfill Blob.arrayBuffer and crypto.subtle.digest for jsdom/CI compat.
// jsdom's Blob.arrayBuffer may return a type SubtleCrypto.digest rejects.
// vi.stubGlobal bypasses property descriptor restrictions.
const originalBlobArrayBuffer = Blob.prototype.arrayBuffer;

beforeAll(() => {
  Blob.prototype.arrayBuffer = function () {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = reject;
      reader.readAsArrayBuffer(this);
    });
  };

  vi.stubGlobal('crypto', {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    subtle: { digest: async (_algo: any, data: any) => fnv1aDigest(data) },
    getRandomValues: (arr: Uint8Array) => arr,
  });
});

afterAll(() => {
  Blob.prototype.arrayBuffer = originalBlobArrayBuffer;
  vi.unstubAllGlobals();
});

// ---------- helpers ----------

function toBase64(text: string): string {
  return Buffer.from(text).toString('base64');
}

/** Valid base64 that atob() in Node.js can decode */
const VALID_PNG_B64 = toBase64('\x89PNG\r\n\x1a\nfake-png-bytes');
const VALID_MP3_B64 = toBase64('fake-mp3-bytes');
const VALID_JPEG_B64 = toBase64('fake-jpeg-bytes');

function makeDataUrl(mime: string, data: string) {
  return `data:${mime};base64,${data}`;
}

function makeScripts(
  entries: [string, { source: string; enabled: boolean }][]
): Record<string, ScriptData> {
  const out: Record<string, ScriptData> = {};
  for (const [id, { source, enabled }] of entries) {
    out[id] = { source, enabled };
  }
  return out;
}

function makeBaseOptions(overrides: Partial<Parameters<typeof generateGameHTML>[0]> = {}) {
  return {
    title: 'Test Game',
    bgColor: '#000000',
    resolution: 'responsive' as const,
    sceneData: '{"entities":[]}',
    scriptBundle: '',
    includeDebug: false,
    ...overrides,
  };
}

const mockWasm: Record<string, EmbeddedWasmData> = {
  webgl2: {
    jsBase64: toBase64('export default function init(){}; export function init_engine(){}'),
    wasmBase64: toBase64('fake-wasm-webgl2'),
  },
};

// ---------- Tests ----------

describe('Export Pipeline Integration', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('Asset extraction → ZIP content flow', () => {
    it('should extract data URLs and replace with relative paths', async () => {
      const scene = {
        name: 'TestScene',
        entities: [
          {
            id: 'entity-1',
            material: {
              baseColorTexture: makeDataUrl('image/png', VALID_PNG_B64),
            },
          },
        ],
      };

      const { modifiedScene, assets } = await extractAssets(scene);

      // Asset should be extracted
      expect(assets.length).toBeGreaterThanOrEqual(1);
      expect(assets[0].relativePath).toMatch(/^assets\/textures\/.+\.png$/);

      // Scene should have relative path instead of data URL
      const modified = modifiedScene as {
        entities: { material: { baseColorTexture: string } }[];
      };
      expect(modified.entities[0].material.baseColorTexture).not.toContain('data:');
      expect(modified.entities[0].material.baseColorTexture).toMatch(/^assets\//);
    });

    it('should deduplicate identical assets by content hash', async () => {
      const sameDataUrl = makeDataUrl('image/png', VALID_PNG_B64);
      const scene = {
        entities: [{ texture1: sameDataUrl }, { texture2: sameDataUrl }],
      };

      const { assets } = await extractAssets(scene);

      // Only one unique asset extracted (second is deduplicated by hash)
      expect(assets.length).toBe(1);
    });

    it('should extract different MIME types into correct categories', async () => {
      const scene = {
        image: makeDataUrl('image/png', VALID_PNG_B64),
        audio: makeDataUrl('audio/mpeg', VALID_MP3_B64),
      };

      const { assets } = await extractAssets(scene);

      const paths = assets.map((a) => a.relativePath);
      expect(paths.some((p) => p.startsWith('assets/textures/'))).toBe(true);
      expect(paths.some((p) => p.startsWith('assets/audio/'))).toBe(true);
    });

    it('should handle nested scene structures', async () => {
      const scene = {
        root: {
          children: [
            {
              components: {
                material: {
                  textures: {
                    diffuse: makeDataUrl('image/jpeg', VALID_JPEG_B64),
                  },
                },
              },
            },
          ],
        },
      };

      const { assets, modifiedScene } = await extractAssets(scene);

      expect(assets.length).toBe(1);
      expect(assets[0].relativePath).toMatch(/\.jpg$/);

      // Verify the nested path was replaced
      const modified = modifiedScene as {
        root: {
          children: [
            { components: { material: { textures: { diffuse: string } } } },
          ];
        };
      };
      expect(
        modified.root.children[0].components.material.textures.diffuse
      ).toMatch(/^assets\//);
    });

    it('should handle empty scene with no assets', async () => {
      const scene = { name: 'Empty', entities: [] };
      const { modifiedScene, assets } = await extractAssets(scene);

      expect(assets).toEqual([]);
      expect(modifiedScene).toEqual(scene);
    });

    it('should handle scene with data URLs in object properties within arrays', async () => {
      // Data URLs must be object properties (not bare array elements) to be extracted
      const scene = {
        layers: [
          { frame: makeDataUrl('image/png', VALID_PNG_B64) },
        ],
      };

      const { assets } = await extractAssets(scene);
      expect(assets.length).toBe(1);
      expect(assets[0].relativePath).toMatch(/^assets\/textures\//);
    });
  });

  describe('Script bundling → HTML integration', () => {
    it('should bundle enabled scripts and include forge API runtime', () => {
      const scripts = makeScripts([
        [
          'entity-1',
          {
            source: 'function onStart() { forge.log("hello"); }',
            enabled: true,
          },
        ],
        [
          'entity-2',
          {
            source: 'function onUpdate(dt) { forge.translate(self, 0, dt, 0); }',
            enabled: true,
          },
        ],
      ]);

      const bundle = bundleScripts(scripts);
      expect(bundle.count).toBe(2);
      expect(bundle.code).toContain('forge.log');
      expect(bundle.code).toContain('forge.translate');
      expect(bundle.code).toContain('__forgeFlushCommands');
      expect(bundle.code).toContain('__forgeScriptStart');
      expect(bundle.code).toContain('__forgeScriptUpdate');

      // Feed bundle into HTML generator
      const html = generateGameHTML(
        makeBaseOptions({
          title: 'Script Test',
          sceneData: '{"entities":[]}',
          scriptBundle: bundle.code,
        })
      );

      expect(html).toContain('forge.log');
      expect(html).toContain('__forgeFlushCommands');
    });

    it('should filter disabled scripts from bundle', () => {
      const scripts = makeScripts([
        ['entity-1', { source: 'function onStart() {}', enabled: true }],
        [
          'entity-2',
          {
            source: 'function onStart() { DISABLED_MARKER(); }',
            enabled: false,
          },
        ],
      ]);

      const bundle = bundleScripts(scripts);
      expect(bundle.count).toBe(1);
      expect(bundle.code).not.toContain('DISABLED_MARKER');
    });

    it('should produce empty bundle for no scripts', () => {
      const bundle = bundleScripts({});
      expect(bundle.count).toBe(0);
      expect(bundle.code).toBe('');
    });

    it('should wrap script source as string literal via closure pattern', () => {
      const scripts = makeScripts([
        [
          'entity-1',
          {
            source: 'function onStart() { var x = "test"; }',
            enabled: true,
          },
        ],
      ]);

      const bundle = bundleScripts(scripts);

      // The source should be JSON-stringified in the output (as a const string literal)
      expect(bundle.code).toContain('const src = "function onStart()');
      // Script wrapping uses Function constructor to prevent closure breakout
      expect(bundle.code).toContain("new Function('forge'");
    });
  });

  describe('Full HTML generation with all options', () => {
    it('should generate complete HTML with scene data + scripts + WASM', () => {
      const html = generateGameHTML(
        makeBaseOptions({
          title: 'Full Game',
          bgColor: '#1a1a2e',
          resolution: '1920x1080',
          sceneData: JSON.stringify({
            entities: [{ id: 'cube-1', type: 'Cube' }],
          }),
          scriptBundle: 'window.__forgeScriptStart = function() {};',
          includeDebug: true,
          embeddedWasm: mockWasm,
        })
      );

      // Structure
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('<title>Full Game</title>');
      expect(html).toContain('game-canvas');

      // Scene data embedded
      expect(html).toContain('cube-1');

      // Scripts embedded
      expect(html).toContain('__forgeScriptStart');

      // WASM embedded
      expect(html).toContain('forge-wasm-webgl2-js');

      // Debug mode
      expect(html).toContain('[Forge]');

      // Resolution
      expect(html).toContain('1920px');
      expect(html).toContain('1080px');

      // Background
      expect(html).toContain('#1a1a2e');
    });

    it('should include UI root div always (for runtime population)', () => {
      const html = generateGameHTML(
        makeBaseOptions({ uiData: '{"screens":[]}' })
      );

      expect(html).toContain('forge-ui-root');
    });

    it('should include touch overlay div always', () => {
      const html = generateGameHTML(
        makeBaseOptions({
          mobileTouchConfig: JSON.stringify({
            enabled: true,
            preset: 'platformer',
            joystick: { enabled: true, side: 'left' },
            buttons: [{ label: 'Jump', action: 'jump' }],
          }),
        })
      );

      expect(html).toContain('forge-touch-overlay');
    });

    it('should handle custom resolution object', () => {
      const html = generateGameHTML(
        makeBaseOptions({ resolution: { width: 800, height: 600 } })
      );

      expect(html).toContain('800px');
      expect(html).toContain('600px');
    });

    it('should escape special characters in title', () => {
      const html = generateGameHTML(
        makeBaseOptions({
          title: "Game <with> \"quotes\" & hero's more",
        })
      );

      expect(html).toContain('&lt;with&gt;');
      expect(html).toContain('&quot;quotes&quot;');
      expect(html).toContain('&amp;');
      // Apostrophe must also be escaped to keep the HTML attribute value safe
      expect(html).toContain('&#39;');
    });
  });

  describe('Script bundle forge API completeness', () => {
    it('should include all forge API namespaces in bundle', () => {
      const scripts = makeScripts([
        ['e1', { source: 'function onStart() {}', enabled: true }],
      ]);
      const { code } = bundleScripts(scripts);

      // The forge object is defined with property syntax (not dot notation)
      expect(code).toContain('const forge = {');

      // Core logging
      expect(code).toContain('log: function');
      expect(code).toContain('warn: function');
      expect(code).toContain('error: function');

      // Sub-namespaces
      expect(code).toContain('state: {');
      expect(code).toContain('input: {');
      expect(code).toContain('audio: {');
      expect(code).toContain('physics: {');

      // Top-level transform methods
      expect(code).toContain('getTransform: function');
      expect(code).toContain('setPosition: function');
      expect(code).toContain('setRotation: function');
      expect(code).toContain('translate: function');
      expect(code).toContain('rotate: function');
    });

    it('should include all audio methods', () => {
      const scripts = makeScripts([
        ['e1', { source: 'function onStart() {}', enabled: true }],
      ]);
      const { code } = bundleScripts(scripts);

      // Audio methods are properties inside the audio object literal
      expect(code).toContain('play: function');
      expect(code).toContain('stop: function');
      expect(code).toContain('pause: function');
      expect(code).toContain('setVolume: function');
      expect(code).toContain('setPitch: function');
      expect(code).toContain('isPlaying: function');
    });

    it('should include physics force methods', () => {
      const scripts = makeScripts([
        ['e1', { source: 'function onStart() {}', enabled: true }],
      ]);
      const { code } = bundleScripts(scripts);

      expect(code).toContain('applyForce: function');
      expect(code).toContain('applyImpulse: function');
      expect(code).toContain('applyTorque: function');
    });

    it('should register lifecycle hooks (onStart, onUpdate, onDestroy)', () => {
      const scripts = makeScripts([
        [
          'e1',
          {
            source:
              'function onStart() {} function onUpdate(dt) {} function onDestroy() {}',
            enabled: true,
          },
        ],
      ]);
      const { code } = bundleScripts(scripts);

      expect(code).toContain('__forgeScriptStart');
      expect(code).toContain('__forgeScriptUpdate');
      expect(code).toContain('__forgeScriptDestroy');
      expect(code).toContain('onStart');
      expect(code).toContain('onUpdate');
      expect(code).toContain('onDestroy');
    });
  });

  describe('Pipeline edge cases', () => {
    it('should handle null and undefined values in scene tree', async () => {
      const scene = {
        entity: {
          nullProp: null,
          undefinedProp: undefined,
          name: 'test',
        },
      };

      const { modifiedScene, assets } = await extractAssets(scene);
      expect(assets).toEqual([]);
      expect(
        (modifiedScene as { entity: { name: string } }).entity.name
      ).toBe('test');
    });

    it('should handle cross-referenced entity data without data-URL extraction', async () => {
      const scene = {
        a: { ref: 'b' },
        b: { ref: 'a' },
      };

      const { modifiedScene } = await extractAssets(scene);
      expect(modifiedScene).toBeDefined();
    });

    it('should handle very large script source gracefully', () => {
      const bigSource = `function onStart() { ${' '.repeat(100000)} }`;
      const scripts = makeScripts([
        ['e1', { source: bigSource, enabled: true }],
      ]);

      const bundle = bundleScripts(scripts);
      expect(bundle.count).toBe(1);
      expect(bundle.code.length).toBeGreaterThan(100000);
    });

    it('should handle malformed data URL gracefully (no crash)', async () => {
      const scene = {
        bad: 'data:not-a-real-data-url',
      };

      // Should not throw
      const { assets } = await extractAssets(scene);
      expect(assets).toBeDefined();
    });

    it('should preserve non-data-URL strings in scene', async () => {
      const scene = {
        name: 'My Scene',
        entityType: 'Cube',
        path: '/some/path.obj',
        url: 'https://example.com/model.glb',
      };

      const { modifiedScene } = await extractAssets(scene);
      const modified = modifiedScene as typeof scene;
      expect(modified.name).toBe('My Scene');
      expect(modified.entityType).toBe('Cube');
      expect(modified.path).toBe('/some/path.obj');
      expect(modified.url).toBe('https://example.com/model.glb');
    });
  });

  describe('HTML generation variants', () => {
    it('should generate different loader for embedded vs external WASM', () => {
      const embeddedHtml = generateGameHTML(
        makeBaseOptions({ embeddedWasm: mockWasm })
      );

      const externalHtml = generateGameHTML(makeBaseOptions());

      // Embedded uses Blob URL approach
      expect(embeddedHtml).toContain('URL.createObjectURL');
      expect(embeddedHtml).toContain('atob');

      // External uses import paths
      expect(externalHtml).toContain('__forgeBasePath');
      expect(externalHtml).not.toContain('URL.createObjectURL');
    });

    it('should include click-to-start for autoplay policy', () => {
      const html = generateGameHTML(makeBaseOptions());

      expect(html).toContain('Click to start');
      expect(html).toContain("addEventListener('click'");
    });

    it('should include WebGPU detection logic', () => {
      const html = generateGameHTML(makeBaseOptions());

      expect(html).toContain('navigator.gpu');
      expect(html).toContain('webgpu');
      expect(html).toContain('webgl2');
    });
  });
});
