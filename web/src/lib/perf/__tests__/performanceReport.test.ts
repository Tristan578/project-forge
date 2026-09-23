/**
 * The manifest-pinned performance report (#9904 / #10013, operation
 * performance.FR-3.OP-01).
 *
 * Organised by the issue's three acceptance scenarios:
 *  - "Manual and AI success": a report carries p50/p95/p99 frame time, first
 *    interactive, memory availability, fixture/build identity and sample count;
 *  - "Negative case": an unsupported metric is unknown and never becomes zero or
 *    a passed budget;
 *  - "Boundary and recovery": a baseline from a different browser version or
 *    fixture checksum is flagged incompatible instead of compared.
 * plus the deliberately failing budget the issue asks to demonstrate.
 */
import { describe, it, expect } from 'vitest';
import { UNKNOWN, type MeasurementManifest } from '@/lib/config/measurementManifest';
import {
  buildPerformanceReport,
  compareReports,
  parsePerformanceReport,
  reportFileName,
  serializeReport,
  summarizeReport,
  PERFORMANCE_OPERATION_ID,
  PERFORMANCE_REPORT_SCHEMA_VERSION,
  type RawFrameCapture,
  type PerformanceReport,
} from '../performanceReport';
import { DEFAULT_CAPTURE_PROTOCOL, MIN_FRAME_SAMPLES, type MemoryAvailability } from '../frameCapture';
import { PERF_FIXTURES } from '../perfFixtures';

const FIXTURE_3D = PERF_FIXTURES[1];

const MEMORY: MemoryAvailability = {
  jsHeapUsedMb: 48,
  jsHeapLimitMb: 4096,
  wasmLinearMemoryMb: 256,
  jsHeapSource: 'performance.memory',
  wasmMemorySource: 'wasm-linear-memory',
};

function manifest(overrides: Partial<MeasurementManifest> = {}): MeasurementManifest {
  return {
    schemaVersion: 1,
    buildSha: 'abc1234',
    fixtureChecksum: FIXTURE_3D.checksum,
    os: 'Windows',
    browserVersion: 'Chrome 153.0.8010.53',
    gpuDriver: 'nvidia turing',
    backend: 'webgpu',
    viewport: { width: 1280, height: 720, devicePixelRatio: 1 },
    deviceMemory: 8,
    cacheState: 'cold',
    sampleCount: UNKNOWN,
    ...overrides,
  };
}

/** Timestamps covering warm-up + capture at a fixed frame interval. */
function timestamps(intervalMs: number, protocol = DEFAULT_CAPTURE_PROTOCOL): number[] {
  const count = Math.floor((protocol.warmupMs + protocol.captureMs) / intervalMs) + 1;
  return Array.from({ length: count }, (_, i) => 500 + i * intervalMs);
}

function raw(overrides: Partial<RawFrameCapture> = {}): RawFrameCapture {
  return {
    captureProtocolVersion: 1,
    source: 'exported-runtime',
    protocol: { ...DEFAULT_CAPTURE_PROTOCOL },
    frameTimestampsMs: timestamps(10),
    firstInteractiveMs: 2400,
    firstInteractiveBasis: 'exported-init-to-first-frame',
    hiddenDuringCapture: false,
    memory: MEMORY,
    startedAt: '2026-09-22T10:00:00.000Z',
    completedAt: '2026-09-22T10:01:12.000Z',
    ...overrides,
  };
}

function report(rawOverrides: Partial<RawFrameCapture> = {}, manifestOverrides: Partial<MeasurementManifest> = {}): PerformanceReport {
  return buildPerformanceReport({
    raw: raw(rawOverrides),
    manifest: manifest(manifestOverrides),
    profileKey: 'desktop@1',
    reportId: 'rep-1',
    now: () => new Date('2026-09-22T10:01:13.000Z'),
  });
}

const budget = (r: PerformanceReport, id: string) => r.budgets.find((b) => b.id === id)!;

describe('Scenario: manual and AI success — the report contents', () => {
  it('carries p50/p95/p99 frame time, first interactive and memory with fixture/build identity and sample count', () => {
    const r = report();
    expect(r.schemaVersion).toBe(PERFORMANCE_REPORT_SCHEMA_VERSION);
    expect(r.operationId).toBe(PERFORMANCE_OPERATION_ID);
    expect(r.fixture).toEqual({ id: FIXTURE_3D.id, checksum: FIXTURE_3D.checksum });
    expect(r.manifest.buildSha).toBe('abc1234');
    expect(r.aggregates.frameTime.p50Ms).toBe(10);
    expect(r.aggregates.frameTime.p95Ms).toBe(10);
    expect(r.aggregates.frameTime.p99Ms).toBe(10);
    expect(r.aggregates.firstInteractiveMs).toBe(2400);
    expect(r.aggregates.memory.jsHeapUsedMb).toBe(48);
    expect(r.aggregates.memory.deviceMemoryGb).toBe(8);
    // 60 s of 10 ms frames after the warm-up.
    expect(r.aggregates.frameTime.sampleCount).toBe(6000);
    expect(r.manifest.sampleCount).toBe(6000);
    expect(r.samples.frameTimesMs).toHaveLength(6000);
    expect(r.profile).toEqual({ key: 'desktop@1', id: 'desktop', version: 1 });
  });

  it('passes the desktop profile when p95 <= 16.7 ms and the cold first interactive <= 5 s', () => {
    const r = report();
    expect(budget(r, 'frame-time-p95')).toMatchObject({ status: 'pass', observed: 10, limit: 16.7 });
    expect(budget(r, 'first-interactive-cold')).toMatchObject({ status: 'pass', observed: 2400, limit: 5000 });
    expect(r.verdict).toBe('pass');
  });

  it('labels a scene that is not a pinned fixture as unpinned, with its real checksum', () => {
    const r = report({}, { fixtureChecksum: '0badf00d' });
    expect(r.fixture).toEqual({ id: 'unpinned-scene', checksum: '0badf00d' });
  });

  it('round-trips through its JSON download and the schema used for stored baselines', () => {
    const r = report();
    const parsed = parsePerformanceReport(JSON.parse(serializeReport(r)));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.report).toEqual(r);
    expect(reportFileName(r)).toBe('spawnforge-perf-report-perf-3d-1-desktop-1-2026-09-22T10-01-13Z.json');
  });

  it('summarises for the AI with the raw samples withheld unless asked for', () => {
    const r = report();
    const summary = summarizeReport(r, { includeSamples: false });
    expect(summary.samples).toEqual({ count: 6000, omitted: true });
    expect(summary.aggregates).toEqual(r.aggregates);
    expect(summary.manifest).toEqual(r.manifest);
    const full = summarizeReport(r, { includeSamples: true });
    expect(full.samples).toEqual({ count: 6000, frameTimesMs: r.samples.frameTimesMs });
  });
});

describe('Scenario: negative case — unsupported metrics stay unknown', () => {
  it('an unsupported first-interactive mark is unknown and its budget is unknown, not passed', () => {
    const r = report({ firstInteractiveMs: UNKNOWN });
    expect(r.aggregates.firstInteractiveMs).toBe(UNKNOWN);
    expect(budget(r, 'first-interactive-cold')).toMatchObject({ status: 'unknown', observed: UNKNOWN });
    expect(r.verdict).toBe('unknown');
  });

  it('unsupported memory APIs are reported unknown, never 0 MB', () => {
    const r = report({
      memory: {
        jsHeapUsedMb: UNKNOWN,
        jsHeapLimitMb: UNKNOWN,
        wasmLinearMemoryMb: UNKNOWN,
        jsHeapSource: 'unavailable',
        wasmMemorySource: 'unavailable',
      },
    }, { deviceMemory: UNKNOWN });
    expect(r.aggregates.memory.jsHeapUsedMb).toBe(UNKNOWN);
    expect(r.aggregates.memory.wasmLinearMemoryMb).toBe(UNKNOWN);
    expect(r.aggregates.memory.deviceMemoryGb).toBe(UNKNOWN);
    expect(JSON.stringify(r.aggregates.memory)).not.toMatch(/:0[,}]/);
  });

  it('too few frames make every frame statistic unknown and the frame budget unknown, not passed', () => {
    const r = report({ frameTimestampsMs: timestamps(10).slice(0, 1000 + MIN_FRAME_SAMPLES - 50) });
    expect(r.aggregates.frameTime.status).toBe('insufficient_sample');
    expect(r.aggregates.frameTime.p95Ms).toBe(UNKNOWN);
    expect(budget(r, 'frame-time-p95')).toMatchObject({ status: 'unknown', observed: UNKNOWN });
    expect(r.verdict).not.toBe('pass');
  });

  it('a page hidden during capture cannot pass the frame budget (rAF was throttled)', () => {
    const r = report({ hiddenDuringCapture: true });
    expect(budget(r, 'frame-time-p95').status).toBe('unknown');
    expect(budget(r, 'frame-time-p95').reason).toMatch(/hidden/);
  });

  it('a shortened capture cannot claim the 60 s budget', () => {
    const protocol = { warmupMs: 1000, captureMs: 5000 };
    const r = report({ protocol, frameTimestampsMs: timestamps(10, protocol) });
    expect(r.aggregates.frameTime.status).toBe('measured');
    expect(budget(r, 'frame-time-p95')).toMatchObject({ status: 'unknown' });
    expect(budget(r, 'frame-time-p95').reason).toMatch(/protocol/);
  });

  it('an undeclared cache state cannot evaluate the cold budget; a warm run does not apply it', () => {
    expect(budget(report({}, { cacheState: UNKNOWN }), 'first-interactive-cold').status).toBe('unknown');
    const warm = report({}, { cacheState: 'warm' });
    expect(budget(warm, 'first-interactive-cold').status).toBe('not_applicable');
    // Warm run: the frame budget alone decides.
    expect(warm.verdict).toBe('pass');
  });

  it('unknown identity stays unknown in the report rather than being filled in', () => {
    const r = report({}, { fixtureChecksum: UNKNOWN, buildSha: UNKNOWN, gpuDriver: UNKNOWN });
    expect(r.fixture).toEqual({ id: UNKNOWN, checksum: UNKNOWN });
    expect(r.manifest.buildSha).toBe(UNKNOWN);
    expect(r.manifest.gpuDriver).toBe(UNKNOWN);
  });

  it('refuses an unregistered profile instead of evaluating against nothing', () => {
    expect(() =>
      buildPerformanceReport({ raw: raw(), manifest: manifest(), profileKey: 'desktop@9' }),
    ).toThrow(/Unknown device profile/);
  });
});

describe('Deliberately failing budget', () => {
  it('fails the frame budget when p95 exceeds 16.7 ms, with observed and expected values', () => {
    // 20 ms frames: 50 fps, a real miss of the 60 fps budget.
    const r = report({ frameTimestampsMs: timestamps(20) });
    expect(budget(r, 'frame-time-p95')).toMatchObject({ status: 'fail', observed: 20, limit: 16.7 });
    expect(r.verdict).toBe('fail');
  });

  it('fails the cold first-interactive budget at 5.2 s', () => {
    const r = report({ firstInteractiveMs: 5200 });
    expect(budget(r, 'first-interactive-cold')).toMatchObject({ status: 'fail', observed: 5200, limit: 5000 });
    expect(r.verdict).toBe('fail');
  });

  it('a failure outranks an unknown elsewhere in the verdict', () => {
    const r = report({ frameTimestampsMs: timestamps(20) }, { cacheState: UNKNOWN });
    expect(budget(r, 'first-interactive-cold').status).toBe('unknown');
    expect(r.verdict).toBe('fail');
  });
});

describe('Scenario: boundary and recovery — baseline compatibility', () => {
  it('flags a baseline from a different browser version as incompatible and makes no improvement claim', () => {
    const baseline = report({ frameTimestampsMs: timestamps(15) }, { browserVersion: 'Chrome 152.0.7990.10' });
    const current = report({ frameTimestampsMs: timestamps(10) });
    const cmp = compareReports(current, baseline);
    expect(cmp.compatible).toBe(false);
    expect(cmp.claim).toBe('incompatible-baseline');
    expect(cmp.metrics).toBeNull();
    expect(cmp.incompatibilities).toEqual([
      expect.objectContaining({ field: 'browserVersion', current: 'Chrome 153.0.8010.53', baseline: 'Chrome 152.0.7990.10' }),
    ]);
  });

  it('flags a baseline with a different fixture checksum as incompatible', () => {
    const baseline = report({}, { fixtureChecksum: PERF_FIXTURES[0].checksum });
    const cmp = compareReports(report(), baseline);
    expect(cmp.compatible).toBe(false);
    expect(cmp.incompatibilities.map((d) => d.field)).toEqual(['fixtureChecksum']);
  });

  it('treats an unknown browser or fixture on either side as incompatible — unverifiable is not like-for-like', () => {
    expect(compareReports(report({}, { browserVersion: UNKNOWN }), report()).compatible).toBe(false);
    expect(compareReports(report(), report({}, { fixtureChecksum: UNKNOWN })).compatible).toBe(false);
  });

  it('flags a different backend, profile protocol or cache state', () => {
    const fields = (c: ReturnType<typeof compareReports>) => c.incompatibilities.map((d) => d.field);
    expect(fields(compareReports(report({}, { backend: 'webgl2' }), report()))).toEqual(['backend']);
    expect(fields(compareReports(report({}, { cacheState: 'warm' }), report()))).toEqual(['cacheState']);
    const shortProtocol = { warmupMs: 1000, captureMs: 5000 };
    expect(fields(compareReports(report({ protocol: shortProtocol, frameTimestampsMs: timestamps(10, shortProtocol) }), report()))).toEqual(['protocol']);
  });

  it('compares a like-for-like pair and names the direction of the p95 change', () => {
    const baseline = report({ frameTimestampsMs: timestamps(15) });
    const improved = compareReports(report({ frameTimestampsMs: timestamps(10) }), baseline);
    expect(improved.compatible).toBe(true);
    expect(improved.claim).toBe('improved');
    expect(improved.metrics).toContainEqual({ metric: 'frameTimeP95Ms', current: 10, baseline: 15, deltaMs: -5 });
    expect(compareReports(baseline, report({ frameTimestampsMs: timestamps(10) })).claim).toBe('regressed');
    expect(compareReports(report(), report()).claim).toBe('unchanged');
  });

  it('keeps machine differences that do not break comparability as advisories', () => {
    const cmp = compareReports(report({}, { gpuDriver: 'amd rdna3', os: 'Linux' }), report());
    expect(cmp.compatible).toBe(true);
    expect(cmp.advisories.map((a) => a.field).sort()).toEqual(['gpuDriver', 'os']);
  });

  it('is inconclusive, not improved, when either p95 is unknown', () => {
    const thin = report({ frameTimestampsMs: timestamps(10).slice(0, 1050) });
    expect(compareReports(thin, report()).claim).toBe('inconclusive');
  });
});

describe('parsePerformanceReport', () => {
  it('rejects a stored baseline whose shape does not match the schema', () => {
    expect(parsePerformanceReport({ schemaVersion: 1 }).ok).toBe(false);
    expect(parsePerformanceReport(null).ok).toBe(false);
    const r = report();
    expect(parsePerformanceReport({ ...r, schemaVersion: 2 }).ok).toBe(false);
    expect(parsePerformanceReport({ ...r, verdict: 'great' }).ok).toBe(false);
  });
});
