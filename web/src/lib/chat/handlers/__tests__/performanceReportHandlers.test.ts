/**
 * In-app AI operations for the manifest-pinned performance report (#9904 /
 * #10013, operation performance.FR-3.OP-01). Each handler is a thin adapter
 * over the `lib/perf/editorCapture` function the profiler's manual control
 * calls, so these tests pin (a) the delegation and (b) that the AI receives the
 * same data and the same error text as the manual control would.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { invokeHandler } from './handlerTestUtils';
import { performanceHandlers } from '../performanceHandlers';
import { usePerformanceStore, IDLE_TIMED_CAPTURE } from '@/stores/performanceStore';
import {
  cancelPerformanceCapture,
  comparePerformanceReports,
  getPerformanceReport,
  resetCaptureEnvironment,
  setCaptureEnvironment,
  setPerformanceBaseline,
  startPerformanceCapture,
  type CaptureEnvironment,
} from '@/lib/perf/editorCapture';
import { UNKNOWN } from '@/lib/config/measurementManifest';

vi.mock('@/hooks/useEngine', () => ({
  getActiveEngineBackend: vi.fn(() => 'webgpu'),
  getEngineReadyMs: vi.fn(() => 'unknown'),
  getEngineWasmMemory: vi.fn(() => null),
}));

let frame: ((ts: number) => void) | null = null;
const env: CaptureEnvironment = {
  requestFrame: (cb) => {
    frame = cb;
    return 1;
  },
  cancelFrame: () => {
    frame = null;
  },
  isHidden: () => false,
  onVisibilityChange: () => () => undefined,
  onSceneChange: () => () => undefined,
  backend: () => 'webgpu',
  engineReadyMs: () => 2000,
  readSceneChecksum: async () => '5e285ced',
  wasmMemory: () => undefined,
  performanceMemory: () => undefined,
  resourceEntries: () => [],
  navigator: () => ({ userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/153.0.0.0 Safari/537.36' }),
  window: () => ({ innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1 }),
  now: () => new Date('2026-09-22T12:00:00.000Z'),
};

async function completeCapture(args: Record<string, unknown>) {
  const { result } = await invokeHandler(performanceHandlers, 'capture_performance_report', args);
  expect(result.success).toBe(true);
  await vi.waitFor(() => expect(frame).not.toBeNull());
  let t = 0;
  while (frame) {
    const cb = frame;
    frame = null;
    cb(t);
    t += 10;
  }
  await vi.waitFor(() => expect(usePerformanceStore.getState().timedCapture.status).toBe('complete'));
  return usePerformanceStore.getState().performanceReports.at(-1)!;
}

beforeEach(() => {
  frame = null;
  localStorage.clear();
  setCaptureEnvironment(env);
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

describe('capture_performance_report', () => {
  it('acknowledges immediately with a pending status instead of waiting 70 s', async () => {
    const { result } = await invokeHandler(performanceHandlers, 'capture_performance_report', {});
    expect(result.success).toBe(true);
    expect(result.result).toMatchObject({
      status: 'pending',
      profileKey: 'desktop@1',
      protocol: { warmupMs: 10_000, captureMs: 60_000 },
      expectedDurationMs: 70_000,
    });
    // The acknowledgement did not wait for a single frame: nothing is measured yet.
    expect(usePerformanceStore.getState().timedCapture).toMatchObject({ status: 'running', progress: 0 });
    expect(usePerformanceStore.getState().performanceReports).toHaveLength(0);
  });

  it('returns the same validation error as the manual control', async () => {
    const args = { warmupSeconds: 61 };
    const { result } = await invokeHandler(performanceHandlers, 'capture_performance_report', args);
    const manual = startPerformanceCapture(args);
    expect(manual.ok).toBe(false);
    expect(result).toEqual({ success: false, error: manual.ok ? '' : manual.error });
    expect(result.error).toBe('Invalid arguments: warmupSeconds: Too big: expected number to be <=60');
  });
});

describe('get_performance_report', () => {
  it('returns the same report the manual panel shows, with raw samples on request', async () => {
    const report = await completeCapture({ warmupSeconds: 0, captureSeconds: 5, cacheState: 'warm' });
    const { result } = await invokeHandler(performanceHandlers, 'get_performance_report', {});
    expect(result.success).toBe(true);
    const direct = getPerformanceReport({});
    expect(result.result).toEqual(direct.ok ? { capture: direct.capture, report: direct.report, baselineReportId: direct.baselineReportId } : null);
    const body = result.result as { report: { reportId: string; aggregates: { frameTime: { p95Ms: number } }; samples: unknown } };
    expect(body.report.reportId).toBe(report.reportId);
    expect(body.report.aggregates.frameTime.p95Ms).toBe(10);
    expect(body.report.samples).toEqual({ count: 500, omitted: true });

    const withSamples = await invokeHandler(performanceHandlers, 'get_performance_report', { includeSamples: true });
    const samples = (withSamples.result.result as { report: { samples: { frameTimesMs: number[] } } }).report.samples.frameTimesMs;
    expect(samples).toHaveLength(500);
  });

  it('errors helpfully before anything has been captured', async () => {
    const { result } = await invokeHandler(performanceHandlers, 'get_performance_report', {});
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/No performance report has been captured yet/);
  });
});

describe('set_performance_baseline and compare_performance_reports', () => {
  it('pins through the same path the manual button uses, then compares like-for-like', async () => {
    const first = await completeCapture({ warmupSeconds: 0, captureSeconds: 5, cacheState: 'warm' });
    const pinned = await invokeHandler(performanceHandlers, 'set_performance_baseline', {});
    expect(pinned.result).toMatchObject({ success: true, result: { baselineReportId: first.reportId } });
    expect(usePerformanceStore.getState().baselineReport?.reportId).toBe(first.reportId);

    await completeCapture({ warmupSeconds: 0, captureSeconds: 5, cacheState: 'warm' });
    const { result } = await invokeHandler(performanceHandlers, 'compare_performance_reports', {});
    expect(result.success).toBe(true);
    expect(result.result).toMatchObject({ comparison: { compatible: true, claim: 'unchanged', baselineReportId: first.reportId } });
  });

  it('a manual correction survives a later AI capture: capturing never repins the baseline', async () => {
    const first = await completeCapture({ warmupSeconds: 0, captureSeconds: 5, cacheState: 'warm' });
    // The creator pins manually (the Pin as baseline button calls this).
    setPerformanceBaseline({ reportId: first.reportId });
    // The AI then runs its own capture.
    await completeCapture({ warmupSeconds: 0, captureSeconds: 5, cacheState: 'warm' });
    expect(usePerformanceStore.getState().baselineReport?.reportId).toBe(first.reportId);
  });

  it('flags an incompatible baseline instead of claiming an improvement', async () => {
    await completeCapture({ warmupSeconds: 0, captureSeconds: 5, cacheState: 'warm' });
    await invokeHandler(performanceHandlers, 'set_performance_baseline', {});
    await completeCapture({ warmupSeconds: 0, captureSeconds: 5, cacheState: 'cold' });
    const { result } = await invokeHandler(performanceHandlers, 'compare_performance_reports', {});
    expect(result.result).toMatchObject({ comparison: { compatible: false, claim: 'incompatible-baseline', metrics: null } });
  });

  it('returns the manual control’s errors for missing ids and a missing baseline', async () => {
    const noReport = await invokeHandler(performanceHandlers, 'compare_performance_reports', { reportId: 'perf-missing' });
    const manual = comparePerformanceReports({ reportId: 'perf-missing' });
    expect(noReport.result).toEqual({ success: false, error: manual.ok ? '' : manual.error });
    const badArgs = await invokeHandler(performanceHandlers, 'set_performance_baseline', { reportId: 5 });
    expect(badArgs.result.error).toMatch(/^Invalid arguments: reportId/);
  });
});

describe('cancel_performance_capture', () => {
  it('cancels a running capture and reports when nothing is running', async () => {
    await invokeHandler(performanceHandlers, 'capture_performance_report', {});
    const { result } = await invokeHandler(performanceHandlers, 'cancel_performance_capture', {});
    expect(result.success).toBe(true);
    expect(usePerformanceStore.getState().timedCapture.status).toBe('cancelled');
    const again = await invokeHandler(performanceHandlers, 'cancel_performance_capture', {});
    expect(again.result).toEqual({ success: false, error: 'No performance capture is running.' });
  });
});

describe('unknown stays unknown through the AI path', () => {
  it('reports an unmeasured JS heap and WASM memory as unknown', async () => {
    await completeCapture({ warmupSeconds: 0, captureSeconds: 5 });
    const { result } = await invokeHandler(performanceHandlers, 'get_performance_report', {});
    const memory = (result.result as { report: { aggregates: { memory: Record<string, unknown> } } }).report.aggregates.memory;
    expect(memory.jsHeapUsedMb).toBe(UNKNOWN);
    expect(memory.wasmLinearMemoryMb).toBe(UNKNOWN);
  });
});
