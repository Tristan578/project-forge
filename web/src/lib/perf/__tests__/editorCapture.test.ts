/**
 * The editor performance capture — the ONE implementation behind the
 * profiler's manual controls and the in-app AI operations (#9904 / #10013,
 * operation performance.FR-3.OP-01). Manual/AI parity holds because both call
 * these functions; `performanceHandlers` and `PerformanceProfiler` tests pin
 * that they do.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { UNKNOWN } from '@/lib/config/measurementManifest';
import {
  cancelPerformanceCapture,
  comparePerformanceReports,
  getPerformanceReport,
  resetCaptureEnvironment,
  setCaptureEnvironment,
  setPerformanceBaseline,
  startPerformanceCapture,
  type CaptureEnvironment,
} from '../editorCapture';
import { usePerformanceStore, IDLE_TIMED_CAPTURE } from '@/stores/performanceStore';
import { PERF_FIXTURES } from '../perfFixtures';

/** A controllable animation-frame clock and engine. */
function fakeEnvironment(overrides: Partial<CaptureEnvironment> = {}) {
  let rafCallback: ((ts: number) => void) | null = null;
  let visibilityListener: (() => void) | null = null;
  let hidden = false;
  let sceneListener: (() => void) | null = null;
  const env: CaptureEnvironment = {
    requestFrame: (cb) => {
      rafCallback = cb;
      return 1;
    },
    cancelFrame: () => {
      rafCallback = null;
    },
    isHidden: () => hidden,
    onVisibilityChange: (cb) => {
      visibilityListener = cb;
      return () => {
        visibilityListener = null;
      };
    },
    onSceneChange: (cb) => {
      sceneListener = cb;
      return () => { sceneListener = null; };
    },
    backend: () => 'webgpu',
    engineReadyMs: () => 2300,
    readSceneChecksum: async () => PERF_FIXTURES[1].checksum,
    wasmMemory: () => ({ buffer: { byteLength: 128 * 1048576 } }),
    performanceMemory: () => ({ memory: { usedJSHeapSize: 90 * 1048576, jsHeapSizeLimit: 4096 * 1048576 } }),
    resourceEntries: () => [],
    navigator: () => ({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36',
      deviceMemory: 8,
      userAgentData: {
        getHighEntropyValues: async () => ({ fullVersionList: [{ brand: 'Google Chrome', version: '153.0.8010.53' }] }),
      },
      gpu: { requestAdapter: async () => ({ info: { vendor: 'nvidia', architecture: 'turing', device: '', description: '' } }) },
    }),
    window: () => ({ innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1 }),
    now: () => new Date('2026-09-22T12:00:00.000Z'),
    ...overrides,
  };
  return {
    env,
    /** Drive frames at a fixed interval until the capture stops asking for them. */
    async runFrames(intervalMs: number, maxFrames = 20_000) {
      let t = 1000;
      for (let i = 0; i < maxFrames && rafCallback; i++) {
        const cb = rafCallback;
        rafCallback = null;
        cb(t);
        t += intervalMs;
      }
      await vi.waitFor(() => {
        const status = usePerformanceStore.getState().timedCapture.status;
        expect(status === 'running').toBe(false);
      });
    },
    /** Advance only until the scene read resolves and frames start. */
    async untilFrames() {
      await vi.waitFor(() => expect(rafCallback).not.toBeNull());
    },
    frame(ts: number) {
      const cb = rafCallback;
      rafCallback = null;
      cb?.(ts);
    },
    hide() {
      hidden = true;
      visibilityListener?.();
    },
    changeScene() { sceneListener?.(); },
    get subscribed() { return sceneListener !== null || visibilityListener !== null; },
    get waiting() {
      return rafCallback !== null;
    },
  };
}

beforeEach(() => {
  localStorage.clear();
  usePerformanceStore.setState({
    timedCapture: { ...IDLE_TIMED_CAPTURE },
    performanceReports: [],
    baselineReport: null,
    lastComparison: null,
  });
});

afterEach(() => {
  cancelPerformanceCapture();
  resetCaptureEnvironment();
});

describe('startPerformanceCapture — validation shared by the manual control and the AI', () => {
  it('rejects out-of-range durations with the same message whichever caller sends them', () => {
    setCaptureEnvironment(fakeEnvironment().env);
    const result = startPerformanceCapture({ captureSeconds: 1 });
    expect(result).toEqual({
      ok: false,
      error: 'Invalid arguments: captureSeconds: Too small: expected number to be >=5',
    });
    expect(usePerformanceStore.getState().timedCapture.status).toBe('idle');
  });

  it('rejects unknown keys rather than silently ignoring a typo', () => {
    setCaptureEnvironment(fakeEnvironment().env);
    const result = startPerformanceCapture({ captureSecs: 60 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/^Invalid arguments: .*captureSecs/);
  });

  it('rejects an unregistered device profile, naming the registered ones', () => {
    setCaptureEnvironment(fakeEnvironment().env);
    const result = startPerformanceCapture({ profileId: 'desktop@9' });
    expect(result).toEqual({ ok: false, error: 'Unknown device profile: desktop@9. Registered profiles: desktop@1.' });
  });

  it('refuses to measure when the engine is not running', () => {
    setCaptureEnvironment(fakeEnvironment({ backend: () => UNKNOWN }).env);
    const result = startPerformanceCapture({});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/engine is not running/);
  });

  it('refuses a second capture while one is running', async () => {
    const fake = fakeEnvironment();
    setCaptureEnvironment(fake.env);
    const first = startPerformanceCapture({});
    expect(first.ok).toBe(true);
    const second = startPerformanceCapture({});
    expect(second.ok).toBe(false);
    if (!second.ok && first.ok) expect(second.error).toContain(first.captureId);
  });
});

describe('startPerformanceCapture — a full run', () => {
  it('acknowledges at once, then produces the manifest-pinned report', async () => {
    const fake = fakeEnvironment();
    setCaptureEnvironment(fake.env);
    const ack = startPerformanceCapture({ warmupSeconds: 10, captureSeconds: 60, cacheState: 'warm' });
    expect(ack).toMatchObject({ ok: true, profileKey: 'desktop@1', protocol: { warmupMs: 10_000, captureMs: 60_000 }, expectedDurationMs: 70_000 });
    expect(usePerformanceStore.getState().timedCapture).toMatchObject({ status: 'running', phase: 'reading-scene' });

    await fake.untilFrames();
    await fake.runFrames(10);

    const state = usePerformanceStore.getState();
    expect(state.timedCapture.status).toBe('complete');
    expect(state.timedCapture.progress).toBe(1);
    const report = state.performanceReports[0];
    expect(state.timedCapture.reportId).toBe(report.reportId);
    expect(report.source).toBe('editor');
    expect(report.fixture).toEqual({ id: 'perf-3d@1', checksum: PERF_FIXTURES[1].checksum });
    expect(report.manifest).toMatchObject({
      backend: 'webgpu',
      browserVersion: 'Chrome 153.0.8010.53',
      gpuDriver: 'nvidia turing',
      cacheState: 'warm',
      viewport: { width: 1280, height: 720, devicePixelRatio: 1 },
      sampleCount: 6000,
    });
    expect(report.aggregates.frameTime).toMatchObject({ p50Ms: 10, p95Ms: 10, p99Ms: 10 });
    expect(report.aggregates.firstInteractiveMs).toBe(2300);
    expect(report.capture.firstInteractiveBasis).toBe('editor-navigation-to-engine-ready');
    expect(report.aggregates.memory).toMatchObject({ jsHeapUsedMb: 90, wasmLinearMemoryMb: 128 });
    // Warm run, 10 ms frames: the frame budget passes and the cold budget does not apply.
    expect(report.verdict).toBe('pass');
  });

  it('detects the cache state from resource timing when none is declared', async () => {
    const fake = fakeEnvironment({
      resourceEntries: () => [{ name: 'https://engine.spawnforge.ai/x/engine-pkg-webgpu/forge_engine_bg.wasm', transferSize: 0, encodedBodySize: 5, decodedBodySize: 5 }],
    });
    setCaptureEnvironment(fake.env);
    startPerformanceCapture({ warmupSeconds: 0, captureSeconds: 5 });
    await fake.untilFrames();
    await fake.runFrames(10);
    expect(usePerformanceStore.getState().performanceReports[0].manifest.cacheState).toBe('warm');
  });

  it('records an unreadable scene as unknown identity rather than failing the capture', async () => {
    const fake = fakeEnvironment({ readSceneChecksum: async () => { throw new Error('export timed out'); } });
    setCaptureEnvironment(fake.env);
    startPerformanceCapture({ warmupSeconds: 0, captureSeconds: 5 });
    await fake.untilFrames();
    await fake.runFrames(10);
    const report = usePerformanceStore.getState().performanceReports[0];
    expect(report.fixture).toEqual({ id: UNKNOWN, checksum: UNKNOWN });
  });

  it('marks a capture during which the page was hidden, so its frame budget cannot pass', async () => {
    const fake = fakeEnvironment();
    setCaptureEnvironment(fake.env);
    startPerformanceCapture({ warmupSeconds: 10, captureSeconds: 60 });
    await fake.untilFrames();
    fake.frame(1000);
    fake.hide();
    await fake.runFrames(10);
    const report = usePerformanceStore.getState().performanceReports[0];
    expect(report.capture.hiddenDuringCapture).toBe(true);
    expect(report.budgets.find((b) => b.id === 'frame-time-p95')?.status).toBe('unknown');
  });

  it('fails the capture, without a report, if the engine stops mid-run', async () => {
    let backend: 'webgpu' | 'unknown' = 'webgpu';
    const fake = fakeEnvironment({ backend: () => backend });
    setCaptureEnvironment(fake.env);
    startPerformanceCapture({ warmupSeconds: 0, captureSeconds: 5 });
    await fake.untilFrames();
    fake.frame(1000);
    backend = UNKNOWN;
    await fake.runFrames(10);
    const state = usePerformanceStore.getState();
    expect(state.timedCapture.status).toBe('failed');
    expect(state.timedCapture.error).toMatch(/engine stopped/);
    expect(state.performanceReports).toHaveLength(0);
  });


  it.each(['warmup', 'capturing'] as const)('rejects edits during %s even after an undo restores the checksum', async (phase) => {
    const fake = fakeEnvironment();
    setCaptureEnvironment(fake.env);
    startPerformanceCapture({ warmupSeconds: 10, captureSeconds: 60 });
    await fake.untilFrames();
    fake.frame(1000);
    if (phase === 'capturing') fake.frame(11000);
    fake.changeScene();
    fake.changeScene(); // Undo: final checksum is unchanged, but samples are mixed.
    await vi.waitFor(() => expect(usePerformanceStore.getState().timedCapture.status).toBe('failed'));
    expect(usePerformanceStore.getState().timedCapture.error).toMatch(/scene or engine changed/);
    expect(usePerformanceStore.getState().performanceReports).toHaveLength(0);
    expect(fake.waiting).toBe(false);
    expect(fake.subscribed).toBe(false);
    expect(startPerformanceCapture({ warmupSeconds: 0, captureSeconds: 5 }).ok).toBe(true);
    await fake.untilFrames();
    await fake.runFrames(10);
    expect(usePerformanceStore.getState().performanceReports).toHaveLength(1);
  });

  it('arms the guard before scene reading and prevents a stale read from overwriting a new capture', async () => {
    let resolveChecksum!: (checksum: string) => void;
    const fake = fakeEnvironment({ readSceneChecksum: () => new Promise((resolve) => { resolveChecksum = resolve; }) });
    setCaptureEnvironment(fake.env);
    startPerformanceCapture({});
    fake.changeScene();
    expect(usePerformanceStore.getState().timedCapture.status).toBe('failed');
    const next = fakeEnvironment();
    setCaptureEnvironment(next.env);
    startPerformanceCapture({ warmupSeconds: 0, captureSeconds: 5 });
    await next.untilFrames();
    resolveChecksum(PERF_FIXTURES[1].checksum);
    await Promise.resolve();
    expect(fake.waiting).toBe(false);
    expect(usePerformanceStore.getState().timedCapture.status).toBe('running');
    await next.runFrames(10);
    expect(usePerformanceStore.getState().performanceReports).toHaveLength(1);
  });

  it('rejects a scene change while asynchronous report metadata is being read', async () => {
    let resolveVersion!: (value: { fullVersionList: { brand: string; version: string }[] }) => void;
    const fake = fakeEnvironment({
      navigator: () => ({
        userAgentData: { getHighEntropyValues: () => new Promise((resolve) => { resolveVersion = resolve; }) },
      }),
    });
    setCaptureEnvironment(fake.env);
    startPerformanceCapture({ warmupSeconds: 0, captureSeconds: 5 });
    await fake.untilFrames();
    fake.frame(1000);
    fake.frame(6010);
    await vi.waitFor(() => expect(usePerformanceStore.getState().timedCapture.phase).toBe('building-report'));
    fake.changeScene();
    resolveVersion({ fullVersionList: [{ brand: 'Google Chrome', version: '153.0.8010.53' }] });
    await vi.waitFor(() => expect(usePerformanceStore.getState().timedCapture.status).toBe('failed'));
    expect(usePerformanceStore.getState().performanceReports).toHaveLength(0);
    expect(fake.subscribed).toBe(false);
  });

  it('cancels frames using the captured environment even after the test seam changes', async () => {
    const fake = fakeEnvironment();
    setCaptureEnvironment(fake.env);
    startPerformanceCapture({});
    await fake.untilFrames();
    setCaptureEnvironment(fakeEnvironment().env);
    cancelPerformanceCapture();
    expect(fake.waiting).toBe(false);
    expect(fake.subscribed).toBe(false);
  });

  it('cancels: frames stop, no report is kept, and the status says so', async () => {
    const fake = fakeEnvironment();
    setCaptureEnvironment(fake.env);
    startPerformanceCapture({});
    await fake.untilFrames();
    fake.frame(1000);
    expect(cancelPerformanceCapture()).toEqual({ ok: true, message: expect.stringContaining('cancelled') });
    expect(fake.waiting).toBe(false);
    expect(usePerformanceStore.getState().timedCapture.status).toBe('cancelled');
    expect(usePerformanceStore.getState().performanceReports).toHaveLength(0);
    expect(cancelPerformanceCapture()).toEqual({ ok: false, error: 'No performance capture is running.' });
  });
});

describe('query, baseline and comparison operations', () => {
  async function captured(fake = fakeEnvironment(), args: Record<string, unknown> = { warmupSeconds: 0, captureSeconds: 5, cacheState: 'warm' }) {
    setCaptureEnvironment(fake.env);
    const ack = startPerformanceCapture(args);
    expect(ack.ok).toBe(true);
    await fake.untilFrames();
    await fake.runFrames(10);
    return usePerformanceStore.getState().performanceReports.at(-1)!;
  }

  it('reports "nothing captured yet" as an error the caller can act on', () => {
    const result = getPerformanceReport({});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/No performance report has been captured yet/);
  });

  it('returns progress while a capture runs, then the report', async () => {
    const fake = fakeEnvironment();
    setCaptureEnvironment(fake.env);
    startPerformanceCapture({ warmupSeconds: 0, captureSeconds: 5 });
    const pending = getPerformanceReport({});
    expect(pending).toMatchObject({ ok: true, capture: { status: 'running' }, report: null });
    await fake.untilFrames();
    await fake.runFrames(10);
    const done = getPerformanceReport({});
    expect(done.ok).toBe(true);
    if (done.ok) {
      expect(done.capture.status).toBe('complete');
      expect(done.report?.samples).toEqual({ count: 500, omitted: true });
    }
    const withSamples = getPerformanceReport({ includeSamples: true });
    if (withSamples.ok) expect(withSamples.report?.samples).toMatchObject({ count: 500 });
  });

  it('pins a baseline (persisted) and compares like-for-like reports', async () => {
    const first = await captured();
    expect(setPerformanceBaseline({})).toEqual({ ok: true, baselineReportId: first.reportId, message: expect.any(String) });
    expect(usePerformanceStore.getState().baselineReport?.reportId).toBe(first.reportId);
    const second = await captured();
    const cmp = comparePerformanceReports({});
    expect(cmp.ok).toBe(true);
    if (cmp.ok) {
      expect(cmp.comparison).toMatchObject({ currentReportId: second.reportId, baselineReportId: first.reportId, compatible: true, claim: 'unchanged' });
    }
    expect(usePerformanceStore.getState().lastComparison?.currentReportId).toBe(second.reportId);
  });

  it('flags a baseline from another browser version as incompatible (boundary scenario)', async () => {
    const first = await captured();
    setPerformanceBaseline({ reportId: first.reportId });
    const otherBrowser = fakeEnvironment({
      navigator: () => ({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0' }),
    });
    await captured(otherBrowser);
    const cmp = comparePerformanceReports({});
    expect(cmp.ok && cmp.comparison.claim).toBe('incompatible-baseline');
    expect(cmp.ok && cmp.comparison.incompatibilities.map((i) => i.field)).toContain('browserVersion');
  });

  it('refuses to compare without a baseline, and names the unknown report id', async () => {
    await captured();
    const noBaseline = comparePerformanceReports({});
    expect(noBaseline.ok).toBe(false);
    if (!noBaseline.ok) expect(noBaseline.error).toMatch(/No baseline is pinned/);
    const missing = comparePerformanceReports({ reportId: 'perf-nope' });
    expect(missing).toEqual({ ok: false, error: 'No performance report with id perf-nope in this session.' });
  });

  it('clears the pinned baseline', async () => {
    await captured();
    setPerformanceBaseline({});
    expect(setPerformanceBaseline({ clear: true })).toMatchObject({ ok: true, baselineReportId: null });
    expect(usePerformanceStore.getState().baselineReport).toBeNull();
  });

  it('validates query arguments with the same "Invalid arguments" contract', () => {
    expect(getPerformanceReport({ includeSamples: 'yes' })).toMatchObject({ ok: false, error: expect.stringMatching(/^Invalid arguments: includeSamples/) });
    expect(setPerformanceBaseline({ reportId: '' })).toMatchObject({ ok: false, error: expect.stringMatching(/^Invalid arguments: reportId/) });
    expect(comparePerformanceReports({ extra: 1 })).toMatchObject({ ok: false, error: expect.stringMatching(/^Invalid arguments/) });
  });
});
