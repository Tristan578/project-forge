/**
 * Report, capture-status and baseline state for the manifest-pinned
 * performance report (#9904 / #10013, operation performance.FR-3.OP-01).
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  usePerformanceStore,
  DEFAULT_PERFORMANCE_STATS,
  IDLE_TIMED_CAPTURE,
  MAX_STORED_REPORTS,
  PERFORMANCE_BASELINE_STORAGE_KEY,
  loadStoredBaseline,
} from '../performanceStore';
import { UNKNOWN } from '@/lib/config/measurementManifest';
import { buildPerformanceReport, compareReports, type PerformanceReport } from '@/lib/perf/performanceReport';
import { DEFAULT_CAPTURE_PROTOCOL } from '@/lib/perf/frameCapture';

function report(id: string): PerformanceReport {
  const stamps = Array.from({ length: 7001 }, (_, i) => i * 10);
  return buildPerformanceReport({
    raw: {
      captureProtocolVersion: 1,
      source: 'editor',
      protocol: { ...DEFAULT_CAPTURE_PROTOCOL },
      frameTimestampsMs: stamps,
      firstInteractiveMs: 1500,
      firstInteractiveBasis: 'editor-navigation-to-engine-ready',
      hiddenDuringCapture: false,
      memory: {
        jsHeapUsedMb: UNKNOWN,
        jsHeapLimitMb: UNKNOWN,
        wasmLinearMemoryMb: UNKNOWN,
        jsHeapSource: 'unavailable',
        wasmMemorySource: 'unavailable',
      },
      startedAt: '2026-09-22T10:00:00.000Z',
      completedAt: '2026-09-22T10:01:10.000Z',
    },
    manifest: {
      schemaVersion: 1,
      buildSha: UNKNOWN,
      fixtureChecksum: 'abcdef01',
      os: 'Windows',
      browserVersion: 'Chrome 153.0.8010.53',
      gpuDriver: UNKNOWN,
      backend: 'webgpu',
      viewport: UNKNOWN,
      deviceMemory: UNKNOWN,
      cacheState: 'warm',
      sampleCount: UNKNOWN,
    },
    profileKey: 'desktop@1',
    reportId: id,
  });
}

describe('performanceStore — reports and baseline (performance.FR-3.OP-01)', () => {
  beforeEach(() => {
    localStorage.clear();
    usePerformanceStore.setState({
      timedCapture: { ...IDLE_TIMED_CAPTURE },
      performanceReports: [],
      baselineReport: null,
      lastComparison: null,
    });
  });

  it('defaults memory to unknown, never a measured 0 MB, before anything reports it', () => {
    expect(DEFAULT_PERFORMANCE_STATS.memoryUsage).toBe(UNKNOWN);
    expect(DEFAULT_PERFORMANCE_STATS.jsHeapMb).toBe(UNKNOWN);
  });

  it('starts idle', () => {
    expect(usePerformanceStore.getState().timedCapture).toEqual(IDLE_TIMED_CAPTURE);
    expect(IDLE_TIMED_CAPTURE.status).toBe('idle');
  });

  it('merges capture-status updates', () => {
    const { setTimedCapture } = usePerformanceStore.getState();
    setTimedCapture({ status: 'running', captureId: 'c1', phase: 'warmup', progress: 0.1 });
    setTimedCapture({ phase: 'capturing', progress: 0.5 });
    expect(usePerformanceStore.getState().timedCapture).toMatchObject({
      status: 'running',
      captureId: 'c1',
      phase: 'capturing',
      progress: 0.5,
    });
  });

  it('keeps at most MAX_STORED_REPORTS, newest last', () => {
    const { addPerformanceReport } = usePerformanceStore.getState();
    for (let i = 0; i < MAX_STORED_REPORTS + 3; i++) addPerformanceReport(report(`r${i}`));
    const ids = usePerformanceStore.getState().performanceReports.map((r) => r.reportId);
    expect(ids).toHaveLength(MAX_STORED_REPORTS);
    expect(ids[ids.length - 1]).toBe(`r${MAX_STORED_REPORTS + 2}`);
    expect(ids[0]).toBe('r3');
  });


  it('clears a comparison when a newer report becomes the displayed report', () => {
    const baseline = report('baseline');
    const previous = report('previous');
    const state = usePerformanceStore.getState();
    state.addPerformanceReport(previous);
    state.setBaselineReport(baseline);
    state.setLastComparison(compareReports(previous, baseline));
    state.addPerformanceReport(report('newer'));
    expect(usePerformanceStore.getState().lastComparison).toBeNull();
    expect(usePerformanceStore.getState().baselineReport?.reportId).toBe('baseline');
  });

  it.each([report('replacement'), null])('clears a comparison when the baseline changes to %s', (next) => {
    const state = usePerformanceStore.getState();
    const current = report('current');
    const baseline = report('baseline');
    state.addPerformanceReport(current);
    state.setBaselineReport(baseline);
    state.setLastComparison(compareReports(current, baseline));
    state.setBaselineReport(next);
    expect(usePerformanceStore.getState().lastComparison).toBeNull();
    expect(usePerformanceStore.getState().performanceReports.at(-1)?.reportId).toBe('current');
  });

  it('persists the pinned baseline so it survives a reload, and clears it', () => {
    const r = report('base-1');
    usePerformanceStore.getState().setBaselineReport(r);
    expect(usePerformanceStore.getState().baselineReport?.reportId).toBe('base-1');
    expect(loadStoredBaseline()?.reportId).toBe('base-1');
    usePerformanceStore.getState().setBaselineReport(null);
    expect(loadStoredBaseline()).toBeNull();
    expect(localStorage.getItem(PERFORMANCE_BASELINE_STORAGE_KEY)).toBeNull();
  });

  it('ignores a stored baseline that fails the report schema instead of trusting it', () => {
    localStorage.setItem(PERFORMANCE_BASELINE_STORAGE_KEY, JSON.stringify({ schemaVersion: 1, verdict: 'pass' }));
    expect(loadStoredBaseline()).toBeNull();
    localStorage.setItem(PERFORMANCE_BASELINE_STORAGE_KEY, '{not json');
    expect(loadStoredBaseline()).toBeNull();
  });
});
