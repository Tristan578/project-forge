/**
 * The manifest-pinned performance report (#9904 / #10013, operation
 * `performance.FR-3.OP-01`).
 *
 * One report = one capture run: the {@link MeasurementManifest} identifying the
 * machine and build, the fixture identity, the capture protocol, the raw
 * frame-time samples, the aggregates (p50/p95/p99 frame time, first-interactive
 * time, memory availability) and the verdict of every budget in the chosen
 * device profile. The editor capture (manual button and in-app AI) and the
 * exported-runtime harness both produce this shape, and the downloadable JSON
 * is exactly {@link serializeReport} of it.
 *
 * Three rules, each pinned by `__tests__/performanceReport.test.ts`:
 *  1. Unknown is never zero and never a pass. A budget whose metric is unknown,
 *     is `unknown`; a throttled capture or non-profile protocol also makes the
 *     frame-time budget unknown. A pass requires no unknown budget.
 *  2. A failure is reported with the observed and the expected value.
 *  3. Two reports compare like-for-like only when fixture checksum, exact
 *     browser version and backend are known and equal; source, timing basis,
 *     profile and protocol match; and neither capture was hidden. Known warm
 *     versus cold is incompatible; unknown cache state is advisory. An
 *     incompatible pair carries no deltas or directional claim.
 */
import { z } from 'zod';
import {
  MEASUREMENT_MANIFEST_SCHEMA_VERSION,
  UNKNOWN,
  type MeasurementManifest,
  type Unknown,
} from '@/lib/config/measurementManifest';
import {
  aggregateFrameTimes,
  sliceCaptureWindow,
  type CaptureProtocol,
  type FrameTimeStats,
  type MemoryAvailability,
} from './frameCapture';
import { getDeviceProfile, type BudgetDefinition } from './deviceProfiles';
import { describeFixtureIdentity } from './perfFixtures';

/** Report wire-shape version. Bump on any breaking change. */
export const PERFORMANCE_REPORT_SCHEMA_VERSION = 1;

/** The operation every report and test in this slice is recorded against. */
export const PERFORMANCE_OPERATION_ID = 'performance.FR-3.OP-01';

/**
 * Relative p95 change inside which two like-for-like reports are called
 * `unchanged`. A single pair of runs is descriptive, not a statistical claim.
 */
export const COMPARISON_TOLERANCE = 0.05;

/** Which capture path produced a report. */
export type CaptureSource = 'editor' | 'exported-runtime';

/**
 * What a first-interactive time was measured from and to.
 * - exported runtime: from the start of `init()` (the player's click) to the
 *   first game-loop frame after `play`;
 * - editor: from navigation start to the engine reporting ready.
 */
export type FirstInteractiveBasis = 'exported-init-to-first-frame' | 'editor-navigation-to-engine-ready';

/** Everything a capture path hands to {@link buildPerformanceReport}. */
export interface RawFrameCapture {
  captureProtocolVersion: 1;
  source: CaptureSource;
  protocol: CaptureProtocol;
  /** Raw animation-frame timestamps (ms), first frame to window close. */
  frameTimestampsMs: number[];
  firstInteractiveMs: number | Unknown;
  firstInteractiveBasis: FirstInteractiveBasis;
  /** The page was hidden at some point in the run, so rAF was throttled. */
  hiddenDuringCapture: boolean;
  memory: MemoryAvailability;
  startedAt: string;
  completedAt: string;
}

/** Outcome of one budget. `unknown` and `not_applicable` are never a pass. */
export type BudgetStatus = 'pass' | 'fail' | 'unknown' | 'not_applicable';

/** One evaluated budget, with the observed and expected value side by side. */
export interface BudgetResult {
  id: string;
  metric: BudgetDefinition['metric'];
  comparison: 'lte';
  limit: number;
  unit: 'ms';
  observed: number | Unknown;
  status: BudgetStatus;
  reason: string;
}

/** Memory availability plus the manifest's device memory, all in one place. */
export interface ReportMemory extends MemoryAvailability {
  deviceMemoryGb: number | Unknown;
}

/** One capture run, pinned to its manifest. */
export interface PerformanceReport {
  schemaVersion: typeof PERFORMANCE_REPORT_SCHEMA_VERSION;
  operationId: typeof PERFORMANCE_OPERATION_ID;
  reportId: string;
  generatedAt: string;
  source: CaptureSource;
  fixture: { id: string | Unknown; checksum: string | Unknown };
  profile: { key: string; id: string; version: number };
  manifest: MeasurementManifest;
  protocol: CaptureProtocol;
  capture: {
    startedAt: string;
    completedAt: string;
    hiddenDuringCapture: boolean;
    firstInteractiveBasis: FirstInteractiveBasis;
  };
  samples: { frameTimesMs: number[] };
  aggregates: {
    frameTime: FrameTimeStats;
    firstInteractiveMs: number | Unknown;
    memory: ReportMemory;
  };
  budgets: BudgetResult[];
  verdict: 'pass' | 'fail' | 'unknown';
}

/** Inputs to {@link buildPerformanceReport}. */
export interface BuildReportInput {
  raw: RawFrameCapture;
  /** Manifest for the run; `sampleCount` is overwritten with the real count. */
  manifest: MeasurementManifest;
  /** Device profile key, e.g. `desktop@1`. */
  profileKey: string;
  reportId?: string;
  now?: () => Date;
}

function newReportId(): string {
  try {
    return `perf-${crypto.randomUUID()}`;
  } catch {
    return `perf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

function sameProtocol(a: CaptureProtocol, b: CaptureProtocol): boolean {
  return a.warmupMs === b.warmupMs && a.captureMs === b.captureMs;
}

function evaluateBudget(
  budget: BudgetDefinition,
  context: {
    frameTime: FrameTimeStats;
    firstInteractiveMs: number | Unknown;
    cacheState: MeasurementManifest['cacheState'];
    hidden: boolean;
    protocolMatches: boolean;
  },
): BudgetResult {
  const base = {
    id: budget.id,
    metric: budget.metric,
    comparison: budget.comparison,
    limit: budget.limit,
    unit: budget.unit,
  };
  const judge = (observed: number | Unknown, unknownReason: string): BudgetResult => {
    if (observed === UNKNOWN) return { ...base, observed, status: 'unknown', reason: unknownReason };
    const pass = observed <= budget.limit;
    return {
      ...base,
      observed,
      status: pass ? 'pass' : 'fail',
      reason: `observed ${observed} ${budget.unit} ${pass ? '<=' : '>'} limit ${budget.limit} ${budget.unit}`,
    };
  };

  if (budget.metric === 'frameTimeP95Ms') {
    const observed = context.frameTime.p95Ms;
    if (context.hidden) {
      return { ...base, observed, status: 'unknown', reason: 'the page was hidden during capture, so animation frames were throttled' };
    }
    if (!context.protocolMatches) {
      return { ...base, observed, status: 'unknown', reason: 'the capture protocol differs from the profile protocol' };
    }
    return judge(observed, `fewer than the minimum frame samples were captured (${context.frameTime.sampleCount})`);
  }

  // firstInteractiveMs
  if (budget.cacheState === 'cold') {
    if (context.cacheState === 'warm') {
      return { ...base, observed: context.firstInteractiveMs, status: 'not_applicable', reason: 'cold-cache budget; this run was warm' };
    }
    if (context.cacheState === UNKNOWN) {
      return { ...base, observed: context.firstInteractiveMs, status: 'unknown', reason: 'the cache state was not established, so a cold-cache budget cannot be judged' };
    }
  }
  return judge(context.firstInteractiveMs, 'first-interactive time was not measured');
}

function overallVerdict(budgets: BudgetResult[]): PerformanceReport['verdict'] {
  if (budgets.some((b) => b.status === 'fail')) return 'fail';
  if (budgets.some((b) => b.status === 'unknown')) return 'unknown';
  return budgets.some((b) => b.status === 'pass') ? 'pass' : 'unknown';
}

/**
 * Build the report for one capture run.
 * @param input Raw capture, manifest and device profile key.
 * @returns A complete, versioned report.
 * @throws When the profile key is not registered.
 */
export function buildPerformanceReport(input: BuildReportInput): PerformanceReport {
  const profile = getDeviceProfile(input.profileKey);
  if (!profile) throw new Error(`Unknown device profile: ${input.profileKey}`);
  const { raw } = input;

  const frameTimesMs = sliceCaptureWindow(raw.frameTimestampsMs, raw.protocol);
  const frameTime = aggregateFrameTimes(frameTimesMs);
  const manifest: MeasurementManifest = { ...input.manifest, sampleCount: frameTime.sampleCount };
  const context = {
    frameTime,
    firstInteractiveMs: raw.firstInteractiveMs,
    cacheState: manifest.cacheState,
    hidden: raw.hiddenDuringCapture,
    protocolMatches: sameProtocol(raw.protocol, profile.protocol),
  };
  const budgets = profile.budgets.map((b) => evaluateBudget(b, context));

  return {
    schemaVersion: PERFORMANCE_REPORT_SCHEMA_VERSION,
    operationId: PERFORMANCE_OPERATION_ID,
    reportId: input.reportId ?? newReportId(),
    generatedAt: (input.now ?? (() => new Date()))().toISOString(),
    source: raw.source,
    fixture: describeFixtureIdentity(manifest.fixtureChecksum),
    profile: { key: input.profileKey, id: profile.id, version: profile.version },
    manifest,
    protocol: { ...raw.protocol },
    capture: {
      startedAt: raw.startedAt,
      completedAt: raw.completedAt,
      hiddenDuringCapture: raw.hiddenDuringCapture,
      firstInteractiveBasis: raw.firstInteractiveBasis,
    },
    samples: { frameTimesMs },
    aggregates: {
      frameTime,
      firstInteractiveMs: raw.firstInteractiveMs,
      memory: { ...raw.memory, deviceMemoryGb: manifest.deviceMemory },
    },
    budgets,
    verdict: overallVerdict(budgets),
  };
}

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

/** One field that differs between two reports. */
export interface ComparisonDifference {
  field: string;
  current: unknown;
  baseline: unknown;
  reason: string;
}

/** One metric compared across a like-for-like pair. */
export interface MetricDelta {
  metric: 'frameTimeP50Ms' | 'frameTimeP95Ms' | 'frameTimeP99Ms' | 'firstInteractiveMs';
  current: number | Unknown;
  baseline: number | Unknown;
  deltaMs: number | Unknown;
}

/** Result of comparing a report with a baseline. */
export interface ReportComparison {
  currentReportId: string;
  baselineReportId: string;
  compatible: boolean;
  /**
   * `incompatible-baseline` whenever `compatible` is false. Otherwise the
   * direction of the p95 frame-time change beyond {@link COMPARISON_TOLERANCE},
   * or `inconclusive` when either p95 is unknown.
   */
  claim: 'incompatible-baseline' | 'improved' | 'regressed' | 'unchanged' | 'inconclusive';
  incompatibilities: ComparisonDifference[];
  /** Machine differences that do not by themselves break comparability. */
  advisories: ComparisonDifference[];
  /** Null when incompatible: no numbers are offered for a non-like-for-like pair. */
  metrics: MetricDelta[] | null;
}

/** Identity that must be known on both sides AND equal. */
const REQUIRED_IDENTITY: Array<keyof MeasurementManifest> = ['fixtureChecksum', 'browserVersion', 'backend'];
/** Machine facts reported when they differ, without blocking the comparison. */
const ADVISORY_IDENTITY: Array<keyof MeasurementManifest> = ['os', 'gpuDriver', 'viewport', 'deviceMemory'];

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function delta(current: number | Unknown, baseline: number | Unknown): number | Unknown {
  return current === UNKNOWN || baseline === UNKNOWN ? UNKNOWN : Math.round((current - baseline) * 1000) / 1000;
}

/**
 * Compare a report with a baseline, refusing to call a non-like-for-like pair
 * an improvement (boundary scenario of #9904).
 * @param current The newer report.
 * @param baseline The report it is measured against.
 * @returns Compatibility, differences and — only when compatible — deltas.
 */
export function compareReports(current: PerformanceReport, baseline: PerformanceReport): ReportComparison {
  const incompatibilities: ComparisonDifference[] = [];
  const advisories: ComparisonDifference[] = [];

  for (const field of REQUIRED_IDENTITY) {
    const c = current.manifest[field];
    const b = baseline.manifest[field];
    if (c === UNKNOWN || b === UNKNOWN) {
      incompatibilities.push({ field, current: c, baseline: b, reason: `${field} is unknown on one side, so the runs cannot be shown to match` });
    } else if (!sameValue(c, b)) {
      incompatibilities.push({ field, current: c, baseline: b, reason: `${field} differs` });
    }
  }

  if (current.source !== baseline.source) {
    incompatibilities.push({ field: 'source', current: current.source, baseline: baseline.source, reason: 'editor and exported-game measurements have different workloads' });
  }
  if (current.capture.firstInteractiveBasis !== baseline.capture.firstInteractiveBasis) {
    incompatibilities.push({
      field: 'firstInteractiveBasis',
      current: current.capture.firstInteractiveBasis,
      baseline: baseline.capture.firstInteractiveBasis,
      reason: 'first-interactive timings use different start and end points',
    });
  }
  if (current.capture.hiddenDuringCapture || baseline.capture.hiddenDuringCapture) {
    incompatibilities.push({
      field: 'hiddenDuringCapture',
      current: current.capture.hiddenDuringCapture,
      baseline: baseline.capture.hiddenDuringCapture,
      reason: 'a hidden tab can throttle frame sampling, so the runs cannot support a performance comparison',
    });
  }

  const cCache = current.manifest.cacheState;
  const bCache = baseline.manifest.cacheState;
  if (cCache !== UNKNOWN && bCache !== UNKNOWN && cCache !== bCache) {
    incompatibilities.push({ field: 'cacheState', current: cCache, baseline: bCache, reason: 'one run started warm and the other cold' });
  } else if (cCache === UNKNOWN || bCache === UNKNOWN) {
    advisories.push({ field: 'cacheState', current: cCache, baseline: bCache, reason: 'cache state is unknown on one side' });
  }
  if (current.profile.key !== baseline.profile.key) {
    incompatibilities.push({ field: 'profile', current: current.profile.key, baseline: baseline.profile.key, reason: 'different device profiles' });
  }
  if (!sameProtocol(current.protocol, baseline.protocol)) {
    incompatibilities.push({ field: 'protocol', current: current.protocol, baseline: baseline.protocol, reason: 'different warm-up or capture durations' });
  }
  for (const field of ADVISORY_IDENTITY) {
    const c = current.manifest[field];
    const b = baseline.manifest[field];
    if (!sameValue(c, b)) advisories.push({ field, current: c, baseline: b, reason: `${field} differs` });
  }

  const ids = { currentReportId: current.reportId, baselineReportId: baseline.reportId };
  if (incompatibilities.length > 0) {
    return { ...ids, compatible: false, claim: 'incompatible-baseline', incompatibilities, advisories, metrics: null };
  }

  const cf = current.aggregates.frameTime;
  const bf = baseline.aggregates.frameTime;
  const metrics: MetricDelta[] = [
    { metric: 'frameTimeP50Ms', current: cf.p50Ms, baseline: bf.p50Ms, deltaMs: delta(cf.p50Ms, bf.p50Ms) },
    { metric: 'frameTimeP95Ms', current: cf.p95Ms, baseline: bf.p95Ms, deltaMs: delta(cf.p95Ms, bf.p95Ms) },
    { metric: 'frameTimeP99Ms', current: cf.p99Ms, baseline: bf.p99Ms, deltaMs: delta(cf.p99Ms, bf.p99Ms) },
    {
      metric: 'firstInteractiveMs',
      current: current.aggregates.firstInteractiveMs,
      baseline: baseline.aggregates.firstInteractiveMs,
      deltaMs: delta(current.aggregates.firstInteractiveMs, baseline.aggregates.firstInteractiveMs),
    },
  ];

  let claim: ReportComparison['claim'];
  if (cf.p95Ms === UNKNOWN || bf.p95Ms === UNKNOWN || bf.p95Ms <= 0) {
    claim = 'inconclusive';
  } else {
    const relative = (cf.p95Ms - bf.p95Ms) / bf.p95Ms;
    claim = relative < -COMPARISON_TOLERANCE ? 'improved' : relative > COMPARISON_TOLERANCE ? 'regressed' : 'unchanged';
  }
  return { ...ids, compatible: true, claim, incompatibilities, advisories, metrics };
}

// ---------------------------------------------------------------------------
// Serialization, schema, AI summary
// ---------------------------------------------------------------------------

/**
 * The downloadable JSON: the complete report — manifest, raw samples and
 * aggregates — pretty-printed.
 * @param report A report.
 * @returns JSON text.
 */
export function serializeReport(report: PerformanceReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

/**
 * File name for a downloaded report: fixture, profile and generation time.
 * @param report A report.
 * @returns A filesystem-safe name ending in `.json`.
 */
export function reportFileName(report: PerformanceReport): string {
  const safe = (s: string) => s.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  const stamp = report.generatedAt.replace(/\.\d+Z$/, 'Z').replace(/:/g, '-');
  return `spawnforge-perf-report-${safe(String(report.fixture.id))}-${safe(report.profile.key)}-${stamp}.json`;
}

/** What `get_performance_report` returns: the report, samples optional. */
export type ReportSummary = Omit<PerformanceReport, 'samples'> & {
  samples: { count: number; omitted: true } | { count: number; frameTimesMs: number[] };
};

/**
 * The report as the in-app AI receives it. Identical to the downloaded report
 * except that the raw sample array (thousands of numbers) is replaced by its
 * count unless `includeSamples` is set.
 * @param report A report.
 * @param options Whether to include raw samples.
 * @returns The summary.
 */
export function summarizeReport(report: PerformanceReport, options: { includeSamples: boolean }): ReportSummary {
  const count = report.samples.frameTimesMs.length;
  return {
    ...report,
    samples: options.includeSamples ? { count, frameTimesMs: report.samples.frameTimesMs } : { count, omitted: true },
  };
}

const zUnknown = z.literal(UNKNOWN);
const zNumOrUnknown = z.union([z.number().finite(), zUnknown]);
const zStrOrUnknown = z.string().min(1);

const zManifest = z.object({
  schemaVersion: z.literal(MEASUREMENT_MANIFEST_SCHEMA_VERSION),
  buildSha: zStrOrUnknown,
  fixtureChecksum: zStrOrUnknown,
  os: zStrOrUnknown,
  browserVersion: zStrOrUnknown,
  gpuDriver: zStrOrUnknown,
  backend: z.enum(['webgpu', 'webgl2', UNKNOWN]),
  viewport: z.union([
    z.object({ width: z.number().finite(), height: z.number().finite(), devicePixelRatio: z.number().finite() }),
    zUnknown,
  ]),
  deviceMemory: zNumOrUnknown,
  cacheState: z.enum(['warm', 'cold', UNKNOWN]),
  sampleCount: z.union([z.number().int().nonnegative(), zUnknown]),
});

const zProtocol = z.object({
  warmupMs: z.number().int().nonnegative(),
  captureMs: z.number().int().positive(),
});

const zMemory = z.object({
  jsHeapUsedMb: zNumOrUnknown,
  jsHeapLimitMb: zNumOrUnknown,
  wasmLinearMemoryMb: zNumOrUnknown,
  jsHeapSource: z.enum(['performance.memory', 'unavailable']),
  wasmMemorySource: z.enum(['wasm-linear-memory', 'unavailable']),
});

const zBasis = z.enum(['exported-init-to-first-frame', 'editor-navigation-to-engine-ready']);

/** Runtime schema for a raw capture (the exported harness hands one over the page boundary). */
export const zRawFrameCapture = z.object({
  captureProtocolVersion: z.literal(1),
  source: z.enum(['editor', 'exported-runtime']),
  protocol: zProtocol,
  frameTimestampsMs: z.array(z.number().finite()),
  firstInteractiveMs: zNumOrUnknown,
  firstInteractiveBasis: zBasis,
  hiddenDuringCapture: z.boolean(),
  memory: zMemory,
  startedAt: z.string().min(1),
  completedAt: z.string().min(1),
});

/** Runtime schema for a stored or downloaded report. */
export const zPerformanceReport = z.object({
  schemaVersion: z.literal(PERFORMANCE_REPORT_SCHEMA_VERSION),
  operationId: z.literal(PERFORMANCE_OPERATION_ID),
  reportId: z.string().min(1).max(128),
  generatedAt: z.string().min(1),
  source: z.enum(['editor', 'exported-runtime']),
  fixture: z.object({ id: zStrOrUnknown, checksum: zStrOrUnknown }),
  profile: z.object({ key: z.string().min(1), id: z.string().min(1), version: z.number().int().positive() }),
  manifest: zManifest,
  protocol: zProtocol,
  capture: z.object({
    startedAt: z.string().min(1),
    completedAt: z.string().min(1),
    hiddenDuringCapture: z.boolean(),
    firstInteractiveBasis: zBasis,
  }),
  samples: z.object({ frameTimesMs: z.array(z.number().finite()) }),
  aggregates: z.object({
    frameTime: z.object({
      status: z.enum(['measured', 'insufficient_sample']),
      sampleCount: z.number().int().nonnegative(),
      p50Ms: zNumOrUnknown,
      p95Ms: zNumOrUnknown,
      p99Ms: zNumOrUnknown,
      meanMs: zNumOrUnknown,
      minMs: zNumOrUnknown,
      maxMs: zNumOrUnknown,
    }),
    firstInteractiveMs: zNumOrUnknown,
    memory: zMemory.extend({ deviceMemoryGb: zNumOrUnknown }),
  }),
  budgets: z.array(
    z.object({
      id: z.string().min(1),
      metric: z.enum(['frameTimeP95Ms', 'firstInteractiveMs']),
      comparison: z.literal('lte'),
      limit: z.number().finite(),
      unit: z.literal('ms'),
      observed: zNumOrUnknown,
      status: z.enum(['pass', 'fail', 'unknown', 'not_applicable']),
      reason: z.string(),
    }),
  ),
  verdict: z.enum(['pass', 'fail', 'unknown']),
});

/**
 * Validate a report read from storage or a file.
 * @param value Parsed JSON.
 * @returns The report, or the validation error.
 */
export function parsePerformanceReport(value: unknown): { ok: true; report: PerformanceReport } | { ok: false; error: string } {
  const result = zPerformanceReport.safeParse(value);
  if (!result.success) {
    return { ok: false, error: result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ') };
  }
  return { ok: true, report: result.data as PerformanceReport };
}
