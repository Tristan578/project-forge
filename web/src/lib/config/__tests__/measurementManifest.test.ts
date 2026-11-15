/**
 * Unit tests for the versioned performance-measurement manifest.
 *
 * Operation covered: performance.FR-3.OP-01 (issue #9904).
 *
 * The load-bearing property under test is the `unknown` invariant: any field
 * the browser does not expose must resolve to the `'unknown'` sentinel, never
 * to 0/false/'' — the negative-case acceptance scenario in #9904.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  MEASUREMENT_MANIFEST_SCHEMA_VERSION,
  UNKNOWN,
  buildMeasurementManifest,
  buildMeasurementManifestAsync,
  computeFixtureChecksum,
  computeSceneFixtureChecksum,
  canonicalSceneJson,
  readExactBrowserVersion,
  readGpuDriver,
  detectRenderBackend,
  parseOs,
  parseBrowserVersion,
  readDeviceMemory,
  type ManifestNavigator,
  type ManifestWindow,
} from '../measurementManifest';

const CHROME_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const FIREFOX_WIN =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0';
const SAFARI_IOS =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const EDGE_WIN =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0';

const fullWindow: ManifestWindow = { innerWidth: 1920, innerHeight: 1080, devicePixelRatio: 2 };

describe('measurementManifest', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('parseOs (performance.FR-3.OP-01)', () => {
    it('parses common OS families', () => {
      expect(parseOs(CHROME_MAC)).toBe('macOS');
      expect(parseOs(FIREFOX_WIN)).toBe('Windows');
      expect(parseOs(SAFARI_IOS)).toBe('iOS');
      expect(parseOs('Mozilla/5.0 (X11; Linux x86_64)')).toBe('Linux');
      expect(parseOs('Mozilla/5.0 (Linux; Android 14)')).toBe('Android');
    });

    it('returns unknown, never a guess, for an absent or unrecognized UA', () => {
      expect(parseOs(undefined)).toBe(UNKNOWN);
      expect(parseOs('')).toBe(UNKNOWN);
      expect(parseOs('CustomAgent/1.0')).toBe(UNKNOWN);
    });
  });

  describe('parseBrowserVersion (performance.FR-3.OP-01)', () => {
    it('parses browser name and major version', () => {
      expect(parseBrowserVersion(CHROME_MAC)).toBe('Chrome 140');
      expect(parseBrowserVersion(FIREFOX_WIN)).toBe('Firefox 130');
      expect(parseBrowserVersion(SAFARI_IOS)).toBe('Safari 18');
    });

    it('prefers the more specific token when a browser masquerades as Chrome', () => {
      expect(parseBrowserVersion(EDGE_WIN)).toBe('Edge 140');
    });

    it('returns unknown for an absent or unrecognized UA', () => {
      expect(parseBrowserVersion(undefined)).toBe(UNKNOWN);
      expect(parseBrowserVersion('CustomAgent/1.0')).toBe(UNKNOWN);
    });
  });

  describe('readDeviceMemory (performance.FR-3.OP-01)', () => {
    it('reads a finite positive deviceMemory', () => {
      expect(readDeviceMemory({ deviceMemory: 8 })).toBe(8);
    });

    it('returns unknown (never 0) when the API is missing or non-positive', () => {
      expect(readDeviceMemory({})).toBe(UNKNOWN);
      expect(readDeviceMemory(undefined)).toBe(UNKNOWN);
      expect(readDeviceMemory({ deviceMemory: 0 })).toBe(UNKNOWN);
      expect(readDeviceMemory({ deviceMemory: Number.NaN })).toBe(UNKNOWN);
    });
  });

  describe('computeFixtureChecksum (performance.FR-3.OP-01)', () => {
    it('is stable and deterministic for identical bytes', () => {
      const a = computeFixtureChecksum('{"entities":[]}');
      const b = computeFixtureChecksum('{"entities":[]}');
      expect(a).toBe(b);
      expect(a).not.toBe(UNKNOWN);
    });

    it('differs for different bytes', () => {
      expect(computeFixtureChecksum('scene-a')).not.toBe(computeFixtureChecksum('scene-b'));
    });

    it('accepts Uint8Array bytes', () => {
      const bytes = new TextEncoder().encode('scene-a');
      expect(computeFixtureChecksum(bytes)).toBe(computeFixtureChecksum('scene-a'));
    });

    it('returns unknown (never an empty/zero digest) for absent bytes', () => {
      expect(computeFixtureChecksum(null)).toBe(UNKNOWN);
      expect(computeFixtureChecksum(undefined)).toBe(UNKNOWN);
      expect(computeFixtureChecksum('')).toBe(UNKNOWN);
    });
  });

  describe('detectRenderBackend (performance.FR-3.OP-01)', () => {
    it('returns unknown off-navigator (SSR), never a defaulted backend', async () => {
      await expect(detectRenderBackend(undefined)).resolves.toBe(UNKNOWN);
    });

    it('returns webgl2 when WebGPU is absent', async () => {
      await expect(detectRenderBackend({})).resolves.toBe('webgl2');
    });

    it('returns webgpu when an adapter is granted', async () => {
      const nav: ManifestNavigator = { gpu: { requestAdapter: async () => ({}) } };
      await expect(detectRenderBackend(nav)).resolves.toBe('webgpu');
    });

    it('falls back to webgl2 when the adapter is denied', async () => {
      const nav: ManifestNavigator = { gpu: { requestAdapter: async () => null } };
      await expect(detectRenderBackend(nav)).resolves.toBe('webgl2');
    });

    it('falls back to webgl2 when the adapter request throws', async () => {
      const nav: ManifestNavigator = {
        gpu: {
          requestAdapter: async () => {
            throw new Error('blocklisted');
          },
        },
      };
      await expect(detectRenderBackend(nav)).resolves.toBe('webgl2');
    });
  });

  describe('buildMeasurementManifest (performance.FR-3.OP-01)', () => {
    it('reads the commit exposed to the browser bundle', () => {
      vi.stubEnv('NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA', 'abcd1234ef567890');
      expect(buildMeasurementManifest().buildSha).toBe('abcd1234ef567890');
    });

    it('records an unidentified build as unknown', () => {
      vi.stubEnv('NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA', undefined);
      vi.stubEnv('VERCEL_GIT_COMMIT_SHA', 'server-only-commit');
      expect(buildMeasurementManifest().buildSha).toBe(UNKNOWN);
    });

    it('always carries the current schema version', () => {
      const manifest = buildMeasurementManifest();
      expect(manifest.schemaVersion).toBe(MEASUREMENT_MANIFEST_SCHEMA_VERSION);
    });

    it('populates every field from a fully-supported environment', () => {
      const nav: ManifestNavigator = { userAgent: CHROME_MAC, deviceMemory: 8 };
      const manifest = buildMeasurementManifest({
        nav,
        win: fullWindow,
        backend: 'webgpu',
        fixtureChecksum: computeFixtureChecksum('scene-a'),
        cacheState: 'cold',
        sampleCount: 5,
        buildSha: 'abc12345',
      });

      expect(manifest.os).toBe('macOS');
      expect(manifest.browserVersion).toBe('Chrome 140');
      expect(manifest.deviceMemory).toBe(8);
      expect(manifest.backend).toBe('webgpu');
      expect(manifest.viewport).toEqual({ width: 1920, height: 1080, devicePixelRatio: 2 });
      expect(manifest.cacheState).toBe('cold');
      expect(manifest.sampleCount).toBe(5);
      expect(manifest.buildSha).toBe('abc12345');
      expect(manifest.fixtureChecksum).not.toBe(UNKNOWN);
      // gpuDriver has no reliable pure API — unknown unless injected.
      expect(manifest.gpuDriver).toBe(UNKNOWN);
    });

    it('resolves unsupported fields to unknown, never 0/false/empty', () => {
      // Nothing supported: no UA, no deviceMemory, no window, no caller inputs.
      const manifest = buildMeasurementManifest({ nav: {}, win: undefined, buildSha: UNKNOWN });

      expect(manifest.os).toBe(UNKNOWN);
      expect(manifest.browserVersion).toBe(UNKNOWN);
      expect(manifest.gpuDriver).toBe(UNKNOWN);
      expect(manifest.backend).toBe(UNKNOWN);
      expect(manifest.viewport).toBe(UNKNOWN);
      expect(manifest.deviceMemory).toBe(UNKNOWN);
      expect(manifest.cacheState).toBe(UNKNOWN);
      expect(manifest.sampleCount).toBe(UNKNOWN);
      expect(manifest.buildSha).toBe(UNKNOWN);
      expect(manifest.fixtureChecksum).toBe(UNKNOWN);

      // The negative-case guarantee spelled out: no field silently became zero.
      const values = Object.values(manifest);
      expect(values).not.toContain(0);
      expect(values).not.toContain(false);
      expect(values).not.toContain('');
    });

    it('records a non-finite sampleCount as unknown rather than NaN', () => {
      const manifest = buildMeasurementManifest({ sampleCount: Number.NaN });
      expect(manifest.sampleCount).toBe(UNKNOWN);
    });

    it('records an empty buildSha as unknown', () => {
      const manifest = buildMeasurementManifest({ buildSha: '' });
      expect(manifest.buildSha).toBe(UNKNOWN);
    });

    it('records a zero-DPR viewport as devicePixelRatio 1, keeping real dimensions', () => {
      const manifest = buildMeasurementManifest({
        win: { innerWidth: 800, innerHeight: 600, devicePixelRatio: 0 },
      });
      expect(manifest.viewport).toEqual({ width: 800, height: 600, devicePixelRatio: 1 });
    });
  });

  describe('buildMeasurementManifestAsync (performance.FR-3.OP-01)', () => {
    it('resolves the backend and attaches it', async () => {
      const nav: ManifestNavigator = {
        userAgent: FIREFOX_WIN,
        gpu: { requestAdapter: async () => ({}) },
      };
      const manifest = await buildMeasurementManifestAsync({ nav, win: fullWindow });
      expect(manifest.backend).toBe('webgpu');
      expect(manifest.os).toBe('Windows');
      expect(manifest.browserVersion).toBe('Firefox 130');
    });

    it('honors a caller-supplied backend without re-detecting', async () => {
      const nav: ManifestNavigator = {
        gpu: {
          requestAdapter: async () => {
            throw new Error('should not be called');
          },
        },
      };
      const manifest = await buildMeasurementManifestAsync({ nav, backend: 'webgl2' });
      expect(manifest.backend).toBe('webgl2');
    });
  });
});

describe('fixture identity (performance.FR-3.OP-01, #10013)', () => {
  const scene = {
    formatVersion: 3,
    metadata: { name: 'Fixture', createdAt: '2026-01-01T00:00:00Z', modifiedAt: '2026-01-02T00:00:00Z' },
    environment: { clearColor: [0.1, 0.1, 0.12], fogEnabled: false },
    entities: [
      { entityId: 'b', name: 'B', transform: { position: [1, 2, 3] } },
      { entityId: 'a', name: 'A', transform: { position: [0, 0, 0] } },
    ],
  };

  it('is the same digest whatever order the keys and entities were serialized in', () => {
    const reordered = {
      entities: [
        { transform: { position: [0, 0, 0] }, name: 'A', entityId: 'a' },
        { name: 'B', entityId: 'b', transform: { position: [1, 2, 3] } },
      ],
      environment: { fogEnabled: false, clearColor: [0.1, 0.1, 0.12] },
      metadata: { modifiedAt: '2026-01-02T00:00:00Z', name: 'Fixture', createdAt: '2026-01-01T00:00:00Z' },
      formatVersion: 3,
    };
    expect(canonicalSceneJson(reordered)).toBe(canonicalSceneJson(scene));
    expect(computeSceneFixtureChecksum(reordered)).toBe(computeSceneFixtureChecksum(scene));
  });

  it('ignores the save timestamps, which change on every export of the same scene', () => {
    const resaved = { ...scene, metadata: { ...scene.metadata, createdAt: '', modifiedAt: '2027-05-05T00:00:00Z' } };
    expect(computeSceneFixtureChecksum(resaved)).toBe(computeSceneFixtureChecksum(scene));
  });

  it('changes when the scene content changes', () => {
    const moved = {
      ...scene,
      entities: [scene.entities[0], { ...scene.entities[1], transform: { position: [0, 0, 1] } }],
    };
    expect(computeSceneFixtureChecksum(moved)).not.toBe(computeSceneFixtureChecksum(scene));
  });

  it('is the djb2 digest of the canonical text, so either helper identifies the same fixture', () => {
    expect(computeSceneFixtureChecksum(scene)).toBe(computeFixtureChecksum(canonicalSceneJson(scene)));
    expect(computeSceneFixtureChecksum(scene)).toMatch(/^[0-9a-f]{8}$/);
  });

  it('is unknown — never a digest of nothing — for a missing or non-object scene', () => {
    expect(computeSceneFixtureChecksum(undefined)).toBe(UNKNOWN);
    expect(computeSceneFixtureChecksum(null)).toBe(UNKNOWN);
    expect(computeSceneFixtureChecksum('{"entities":[]}')).toBe(UNKNOWN);
    expect(computeSceneFixtureChecksum([])).toBe(UNKNOWN);
  });
});

describe('readExactBrowserVersion (performance.FR-3.OP-01)', () => {
  it('prefers the full Chromium version from high-entropy client hints', async () => {
    const nav: ManifestNavigator = {
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36',
      userAgentData: {
        getHighEntropyValues: async () => ({
          fullVersionList: [
            { brand: 'Not;A=Brand', version: '99.0.0.0' },
            { brand: 'Chromium', version: '153.0.8010.53' },
            { brand: 'Google Chrome', version: '153.0.8010.53' },
          ],
        }),
      },
    };
    expect(await readExactBrowserVersion(nav)).toBe('Chrome 153.0.8010.53');
  });

  it('names Edge ahead of the Chromium brand it also reports', async () => {
    const nav: ManifestNavigator = {
      userAgentData: {
        getHighEntropyValues: async () => ({
          fullVersionList: [
            { brand: 'Chromium', version: '153.0.4234.48' },
            { brand: 'Microsoft Edge', version: '153.0.4234.48' },
          ],
        }),
      },
    };
    expect(await readExactBrowserVersion(nav)).toBe('Edge 153.0.4234.48');
  });

  it('falls back to the user-agent string when client hints are absent or refuse', async () => {
    expect(await readExactBrowserVersion({ userAgent: FIREFOX_WIN })).toBe('Firefox 130');
    const refusing: ManifestNavigator = {
      userAgent: CHROME_MAC,
      userAgentData: { getHighEntropyValues: async () => { throw new Error('denied'); } },
    };
    expect(await readExactBrowserVersion(refusing)).toBe('Chrome 140');
  });

  it('is unknown with no navigator at all', async () => {
    expect(await readExactBrowserVersion(undefined)).toBe(UNKNOWN);
  });
});

describe('readGpuDriver (performance.FR-3.OP-01)', () => {
  it('describes the WebGPU adapter the browser exposes', async () => {
    const nav: ManifestNavigator = {
      gpu: {
        requestAdapter: async () => ({
          info: { vendor: 'nvidia', architecture: 'turing', device: '', description: '' },
        }),
      },
    };
    expect(await readGpuDriver(nav, 'webgpu')).toBe('nvidia turing');
  });

  it('prefers the adapter description when the browser fills it in', async () => {
    const nav: ManifestNavigator = {
      gpu: {
        requestAdapter: async () => ({
          info: { vendor: 'nvidia', architecture: 'turing', device: '1e81', description: 'NVIDIA GeForce RTX 2080 SUPER' },
        }),
      },
    };
    expect(await readGpuDriver(nav, 'webgpu')).toBe('NVIDIA GeForce RTX 2080 SUPER');
  });

  it('reads the unmasked WebGL renderer for a WebGL2 run', async () => {
    const lose = vi.fn();
    const createContext = () => ({
      getExtension: (name: string) =>
        name === 'WEBGL_debug_renderer_info'
          ? { UNMASKED_RENDERER_WEBGL: 0x9246 }
          : name === 'WEBGL_lose_context'
            ? { loseContext: lose }
            : null,
      getParameter: (p: number) => (p === 0x9246 ? 'ANGLE (NVIDIA, GeForce RTX 2080 SUPER Direct3D11)' : 'WebKit WebGL'),
      RENDERER: 0x1f01,
    });
    expect(await readGpuDriver({}, 'webgl2', createContext)).toBe('ANGLE (NVIDIA, GeForce RTX 2080 SUPER Direct3D11)');
    expect(lose).toHaveBeenCalledTimes(1);
  });

  it('is unknown when the adapter is missing, blank, or the probe throws', async () => {
    expect(await readGpuDriver({ gpu: { requestAdapter: async () => null } }, 'webgpu')).toBe(UNKNOWN);
    expect(
      await readGpuDriver({ gpu: { requestAdapter: async () => ({ info: { vendor: '', architecture: '' } }) } }, 'webgpu'),
    ).toBe(UNKNOWN);
    expect(
      await readGpuDriver({ gpu: { requestAdapter: async () => { throw new Error('lost'); } } }, 'webgpu'),
    ).toBe(UNKNOWN);
    expect(await readGpuDriver({}, 'webgl2', () => null)).toBe(UNKNOWN);
    expect(await readGpuDriver({}, 'unknown')).toBe(UNKNOWN);
  });
});
