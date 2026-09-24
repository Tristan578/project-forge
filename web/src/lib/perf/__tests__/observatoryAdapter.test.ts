/**
 * Adapter from a performance report to the Forge Observatory evidence schema
 * (#9751), so a fixture run can be ingested without the Observatory UI
 * (#9904 scope boundary). The adapter's output is checked with the
 * Observatory's own validator — not with a restated shape.
 */
import { describe, it, expect } from 'vitest';
import { UNKNOWN } from '@/lib/config/measurementManifest';
import { deriveMetricValue } from '@/lib/observatory/validator';
import { toObservatoryObservation } from '../observatoryAdapter';
import { buildPerformanceReport, type RawFrameCapture } from '../performanceReport';
import { DEFAULT_CAPTURE_PROTOCOL } from '../frameCapture';
import { PERF_FIXTURES } from '../perfFixtures';

function raw(intervals: number[], overrides: Partial<RawFrameCapture> = {}): RawFrameCapture {
  // 10 s of 10 ms warm-up frames, then the given intervals.
  const stamps = [0];
  for (let i = 0; i < 1000; i++) stamps.push(stamps[stamps.length - 1] + 10);
  for (const d of intervals) stamps.push(stamps[stamps.length - 1] + d);
  return {
    captureProtocolVersion: 1,
    source: 'exported-runtime',
    protocol: { ...DEFAULT_CAPTURE_PROTOCOL },
    frameTimestampsMs: stamps,
    firstInteractiveMs: 2100,
    firstInteractiveBasis: 'exported-init-to-first-frame',
    hiddenDuringCapture: false,
    memory: {
      jsHeapUsedMb: UNKNOWN,
      jsHeapLimitMb: UNKNOWN,
      wasmLinearMemoryMb: 128,
      jsHeapSource: 'unavailable',
      wasmMemorySource: 'wasm-linear-memory',
    },
    startedAt: '2026-09-22T10:00:00.000Z',
    completedAt: '2026-09-22T10:01:10.000Z',
    ...overrides,
  };
}

function report(intervals: number[], buildSha = 'abc1234', overrides: Partial<RawFrameCapture> = {}) {
  return buildPerformanceReport({
    raw: raw(intervals, overrides),
    manifest: {
      schemaVersion: 1,
      buildSha,
      fixtureChecksum: PERF_FIXTURES[1].checksum,
      os: 'Windows',
      browserVersion: 'Chrome 153.0.8010.53',
      gpuDriver: 'nvidia turing',
      backend: 'webgpu',
      viewport: { width: 1280, height: 720, devicePixelRatio: 1 },
      deviceMemory: 8,
      cacheState: 'cold',
      sampleCount: UNKNOWN,
    },
    profileKey: 'desktop@1',
    reportId: 'perf-0123456789abcdef',
    now: () => new Date('2026-09-22T10:01:11.000Z'),
  });
}

describe('toObservatoryObservation', () => {
  // 5,000 frames: 4,500 at 10 ms and 500 at 20 ms (the last tenth over budget).
  const intervals = [...Array.from({ length: 4500 }, () => 10), ...Array.from({ length: 500 }, () => 20)];

  it('produces a latency observation the Observatory validator accepts', () => {
    const result = toObservatoryObservation(report(intervals), { ingestedAt: '2026-09-22T11:00:00.000Z' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const obs = result.data;
    expect(obs.metric).toBe('latency');
    expect(obs.environment).toBe('local');
    expect(obs.source).toBe('latency-monitor');
    expect(obs.formulaVersion).toBe('latency@1');
    expect(obs.releaseSha).toBe('abc1234');
    expect(obs.evidence.artifactId).toBe(`art:${PERF_FIXTURES[1].checksum}`);
    expect(obs.window).toEqual({ label: '24h', start: '2026-09-22T00:00:00.000Z', end: '2026-09-23T00:00:00.000Z' });
    expect(obs.sampleSize).toBe(5000);
    expect(obs.latencyDistribution).toEqual({
      p50Ms: 10,
      p95Ms: 20,
      p99Ms: 20,
      budgetMs: 16.7,
      withinBudget: 4500,
      eligible: 5000,
    });
  });

  it('derives the budget-compliance ratio the Observatory would display', () => {
    const result = toObservatoryObservation(report(intervals), { ingestedAt: '2026-09-22T11:00:00.000Z' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const value = deriveMetricValue(result.data);
    expect(value.ok).toBe(true);
    if (value.ok) {
      expect(value.data.state).toBe('measured');
      expect(value.data.value).toBeCloseTo(0.9, 9);
    }
  });

  it('refuses to fabricate evidence from a report whose frame time is unknown', () => {
    const result = toObservatoryObservation(report([10, 10, 10]), { ingestedAt: '2026-09-22T11:00:00.000Z' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(' ')).toMatch(/unknown/);
  });

  it('refuses a throttled (hidden-tab) capture', () => {
    const result = toObservatoryObservation(report(intervals, 'abc1234', { hiddenDuringCapture: true }), {
      ingestedAt: '2026-09-22T11:00:00.000Z',
    });
    expect(result.ok).toBe(false);
  });

  it('records a non-git build identity as release-agnostic rather than inventing a SHA', () => {
    const result = toObservatoryObservation(report(intervals, UNKNOWN), { ingestedAt: '2026-09-22T11:00:00.000Z' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.releaseSha).toBeNull();
  });
});
