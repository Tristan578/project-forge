/**
 * Exported-runtime harness state -> performance report (#10013, operation
 * performance.FR-3.OP-01). The E2E capture and the evidence runs read
 * `window.__forgePerf` out of the page and hand it here, so the report comes
 * from the same code as an editor capture.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { UNKNOWN } from '@/lib/config/measurementManifest';
import { buildExportedRunReport } from '../exportedCapture';
import { PERF_FIXTURES } from '../perfFixtures';

const scene3d = JSON.parse(readFileSync(join(__dirname, '..', 'fixtures', 'perf-3d-v1.scene.json'), 'utf8')) as unknown;

function harness(overrides: Record<string, unknown> = {}, envOverrides: Record<string, unknown> = {}) {
  const frameTimestampsMs: number[] = [];
  for (let t = 3000; t <= 3000 + 70_000; t += 8) frameTimestampsMs.push(t);
  return {
    harnessVersion: 1,
    status: 'complete',
    protocol: { warmupMs: 10000, captureMs: 60000 },
    initStartMs: 1200,
    firstFrameMs: 3000,
    frameTimestampsMs,
    hiddenDuringCapture: false,
    backend: 'webgpu',
    sceneLoad: { success: true, error: null },
    sceneApplied: true,
    sceneName: 'Perf fixture 3D v1',
    error: null,
    startedAt: '2026-09-22T10:00:00.000Z',
    completedAt: '2026-09-22T10:01:12.000Z',
    env: {
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36',
      deviceMemory: 8,
      viewport: { width: 1280, height: 720, devicePixelRatio: 1 },
      memory: { usedJSHeapSize: 80 * 1048576, jsHeapSizeLimit: 4096 * 1048576 },
      wasmMemoryBytes: 300 * 1048576,
      resources: [
        { name: 'http://127.0.0.1/engine-pkg-webgpu-runtime/forge_engine_bg.wasm', transferSize: 90843266, encodedBodySize: 90842966, decodedBodySize: 90842966 },
      ],
      fullVersionList: [
        { brand: 'Chromium', version: '153.0.8010.53' },
        { brand: 'Google Chrome', version: '153.0.8010.53' },
      ],
      gpu: { vendor: 'nvidia', architecture: 'turing', device: '', description: '' },
      ...envOverrides,
    },
    ...overrides,
  };
}

const build = (h: unknown, extra: Partial<Parameters<typeof buildExportedRunReport>[0]> = {}) =>
  buildExportedRunReport({
    harness: h,
    fixtureScene: scene3d,
    profileKey: 'desktop@1',
    buildSha: 'bf38d0b6',
    reportId: 'perf-exported-1',
    now: () => new Date('2026-09-22T10:01:13.000Z'),
    ...extra,
  });

describe('buildExportedRunReport', () => {
  it('builds a pinned-fixture report from a completed harness run', async () => {
    const result = await build(harness());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const r = result.report;
    expect(r.source).toBe('exported-runtime');
    expect(r.fixture).toEqual({ id: 'perf-3d@1', checksum: PERF_FIXTURES[1].checksum });
    expect(r.manifest).toMatchObject({
      buildSha: 'bf38d0b6',
      os: 'Windows',
      browserVersion: 'Chrome 153.0.8010.53',
      gpuDriver: 'nvidia turing',
      backend: 'webgpu',
      viewport: { width: 1280, height: 720, devicePixelRatio: 1 },
      deviceMemory: 8,
      // The engine binary crossed the wire: a cold run, detected rather than assumed.
      cacheState: 'cold',
      sampleCount: 7500,
    });
    // First interactive: init start (the click) to the first game-loop frame.
    expect(r.aggregates.firstInteractiveMs).toBe(1800);
    expect(r.capture.firstInteractiveBasis).toBe('exported-init-to-first-frame');
    expect(r.aggregates.frameTime.p95Ms).toBe(8);
    expect(r.aggregates.memory).toMatchObject({ jsHeapUsedMb: 80, wasmLinearMemoryMb: 300 });
    expect(r.verdict).toBe('pass');
  });

  it('lets a declared cache state override detection (a fresh browser profile is cold by construction)', async () => {
    const result = await build(harness({}, { resources: [] }), { declaredCacheState: 'cold' });
    expect(result.ok && result.report.manifest.cacheState).toBe('cold');
    const undeclared = await build(harness({}, { resources: [] }));
    expect(undeclared.ok && undeclared.report.manifest.cacheState).toBe(UNKNOWN);
  });

  it('refuses a run whose fixture never loaded — an empty world is not a fixture measurement', async () => {
    const result = await build(harness({ sceneLoad: { success: false, error: "Missing 'json' field in load_scene payload" } }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/fixture scene was not loaded.*Missing 'json' field/);
  });

  it('refuses a failed or unfinished run', async () => {
    const failed = await build(harness({ status: 'failed', error: 'Scene failed to load: boom' }));
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.error).toMatch(/boom/);
    const running = await build(harness({ status: 'recording' }));
    expect(running.ok).toBe(false);
  });

  it('refuses a missing or malformed harness state', async () => {
    expect((await build(undefined)).ok).toBe(false);
    expect((await build({ status: 'complete' })).ok).toBe(false);
  });

  it('keeps unsupported browser surfaces unknown', async () => {
    const result = await build(
      harness({ initStartMs: null }, { memory: null, wasmMemoryBytes: null, deviceMemory: null, fullVersionList: null, gpu: null }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const r = result.report;
    expect(r.aggregates.firstInteractiveMs).toBe(UNKNOWN);
    expect(r.aggregates.memory.jsHeapUsedMb).toBe(UNKNOWN);
    expect(r.aggregates.memory.wasmLinearMemoryMb).toBe(UNKNOWN);
    expect(r.manifest.deviceMemory).toBe(UNKNOWN);
    expect(r.manifest.gpuDriver).toBe(UNKNOWN);
    // Without client hints only the reduced UA major version is known.
    expect(r.manifest.browserVersion).toBe('Chrome 153');
    expect(r.budgets.find((b) => b.id === 'first-interactive-cold')?.status).toBe('unknown');
  });

  it('reads the WebGL renderer string for a WebGL2 run', async () => {
    const result = await build(harness({ backend: 'webgl2' }, { gpu: { renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 2080 SUPER Direct3D11 vs_5_0 ps_5_0, D3D11)' } }));
    expect(result.ok && result.report.manifest.gpuDriver).toBe('ANGLE (NVIDIA, NVIDIA GeForce RTX 2080 SUPER Direct3D11 vs_5_0 ps_5_0, D3D11)');
  });
});

describe('buildExportedRunReport scene application (#10013)', () => {
  it('refuses a run where load_scene was accepted but the engine never applied the scene', async () => {
    // Measured on the webgpu,runtime build: load_scene returns success (the
    // command is queued) but nothing drains the queue, so the default scene is
    // what gets measured. Without this check that run reported a PASS for
    // perf-3d@1 while a flat default scene was on screen.
    const result = await build(harness({ sceneApplied: false, sceneName: null }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/never applied the fixture scene/);
  });
});
