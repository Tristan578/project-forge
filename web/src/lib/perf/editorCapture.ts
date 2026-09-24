import { onCaptureWorkloadChange } from './captureStability';
/**
 * Editor performance capture: the single implementation behind BOTH the
 * profiler's manual controls and the in-app AI operations (#9904 / #10013,
 * operation `performance.FR-3.OP-01`).
 *
 * | Operation          | Manual control (PerformanceProfiler) | AI tool                      |
 * |--------------------|--------------------------------------|------------------------------|
 * | start a capture    | Run capture                          | capture_performance_report   |
 * | cancel it          | Cancel                               | cancel_performance_capture   |
 * | read the report    | the report panel                     | get_performance_report       |
 * | pin a baseline     | Pin as baseline / Unpin              | set_performance_baseline     |
 * | compare            | Compare with baseline                | compare_performance_reports  |
 *
 * Every entry point takes an untrusted `Record`, validates it with the zod
 * schema exported here, and returns `{ ok: false, error }` with the same text
 * whichever caller sent it — so "identical validation and errors" holds by
 * construction rather than by two copies agreeing.
 *
 * A capture measures the editor's live engine: a warm-up, then a capture window
 * of animation-frame intervals (default 10 s + 60 s), pinned to a manifest whose
 * fixture checksum is the canonical checksum of the scene read back from the
 * engine at the start. Authoring changes, scene replacement and engine restarts
 * invalidate the entire capture, even if an undo restores the original scene. Capturing the pinned fixtures themselves on the EXPORTED
 * runtime is `e2e/perf/fixtureCapture.spec.ts`; both produce the same report.
 */
import { z } from 'zod';
import {
  UNKNOWN,
  buildMeasurementManifest,
  computeSceneFixtureChecksum,
  readExactBrowserVersion,
  readGpuDriver,
  type CacheState,
  type ManifestNavigator,
  type ManifestWindow,
  type RenderBackend,
  type Unknown,
} from '@/lib/config/measurementManifest';
import { usePerformanceStore } from '@/stores/performanceStore';
import { getActiveEngineBackend, getEngineReadyMs, getEngineWasmMemory } from '@/hooks/useEngine';
import {
  createFrameRecorder,
  detectCacheState,
  readMemoryAvailability,
  type CaptureProtocol,
  type PerformanceMemoryLike,
  type ResourceTimingLike,
  type WasmMemoryLike,
} from './frameCapture';
import { DEFAULT_DEVICE_PROFILE_KEY, DEVICE_PROFILE_KEYS, getDeviceProfile } from './deviceProfiles';
import {
  buildPerformanceReport,
  compareReports,
  summarizeReport,
  type PerformanceReport,
  type ReportComparison,
  type ReportSummary,
} from './performanceReport';

/** Minimum interval between progress writes to the store. */
export const CAPTURE_PROGRESS_INTERVAL_MS = 250;

// ---------------------------------------------------------------------------
// Argument schemas — shared by the manual control and the AI handlers
// ---------------------------------------------------------------------------

/** `capture_performance_report` / Run capture. */
export const zCaptureRequest = z
  .object({
    warmupSeconds: z.number().int().min(0).max(60).optional(),
    captureSeconds: z.number().int().min(5).max(300).optional(),
    profileId: z.string().min(1).max(64).optional(),
    cacheState: z.enum(['warm', 'cold', 'unknown']).optional(),
  })
  .strict();

const zReportId = z.string().min(1).max(128);

/** `get_performance_report` / the report panel. */
export const zReportQuery = z.object({ reportId: zReportId.optional(), includeSamples: z.boolean().optional() }).strict();

/** `compare_performance_reports` / Compare with baseline. */
export const zCompareRequest = z.object({ reportId: zReportId.optional(), baselineReportId: zReportId.optional() }).strict();

/** `set_performance_baseline` / Pin as baseline, Unpin. */
export const zBaselineRequest = z.object({ reportId: zReportId.optional(), clear: z.boolean().optional() }).strict();

/** `cancel_performance_capture` / Cancel. */
export const zCancelRequest = z.object({}).strict();

type Failure = { ok: false; error: string };

function parse<T>(schema: z.ZodType<T>, input: unknown): { ok: true; data: T } | Failure {
  const result = schema.safeParse(input ?? {});
  if (result.success) return { ok: true, data: result.data };
  const issues = result.error.issues.map((i) => `${i.path.length > 0 ? i.path.join('.') : '(root)'}: ${i.message}`).join('; ');
  return { ok: false, error: `Invalid arguments: ${issues}` };
}

// ---------------------------------------------------------------------------
// Environment seam — the browser in production, a fake in tests
// ---------------------------------------------------------------------------

/** Everything the capture reads from the browser and the engine. */
export interface CaptureEnvironment {
  requestFrame(cb: (timestampMs: number) => void): number;
  cancelFrame(id: number): void;
  isHidden(): boolean;
  onVisibilityChange(cb: () => void): () => void;
  /** Subscribe synchronously before the initial scene read; every change is terminal. */
  onSceneChange(cb: () => void): () => void;
  /** The engine's selected backend, or unknown when no engine is running. */
  backend(): RenderBackend | Unknown;
  /** Navigation start -> engine ready, ms. */
  engineReadyMs(): number | Unknown;
  /** Canonical checksum of the scene the engine holds. */
  readSceneChecksum(): Promise<string | Unknown>;
  wasmMemory(): WasmMemoryLike | undefined;
  performanceMemory(): PerformanceMemoryLike | undefined;
  resourceEntries(): ResourceTimingLike[];
  navigator(): ManifestNavigator | undefined;
  window(): ManifestWindow | undefined;
  now(): Date;
}

async function readLiveSceneChecksum(): Promise<string | Unknown> {
  // Loaded lazily: the scene slice pulls in the editor store, which this module
  // must not force on its importers (the chat handlers, the profiler tests).
  const [{ captureCheckpointScene }, { requestSceneExport }] = await Promise.all([
    import('@/lib/scenes/checkpointRecovery'),
    import('@/stores/slices/sceneSlice'),
  ]);
  // The checkpoint-prefixed export is a side-effect-free read: the
  // SCENE_EXPORTED handler skips autosave for it (transformEvents.ts).
  const scene = await captureCheckpointScene(requestSceneExport);
  return computeSceneFixtureChecksum(scene);
}

function browserEnvironment(): CaptureEnvironment {
  return {
    requestFrame: (cb) => requestAnimationFrame(cb),
    cancelFrame: (id) => cancelAnimationFrame(id),
    isHidden: () => typeof document !== 'undefined' && document.visibilityState === 'hidden',
    onVisibilityChange: (cb) => {
      if (typeof document === 'undefined') return () => undefined;
      document.addEventListener('visibilitychange', cb);
      return () => document.removeEventListener('visibilitychange', cb);
    },
    onSceneChange: onCaptureWorkloadChange,
    backend: () => getActiveEngineBackend(),
    engineReadyMs: () => getEngineReadyMs(),
    readSceneChecksum: readLiveSceneChecksum,
    wasmMemory: () => getEngineWasmMemory() ?? undefined,
    performanceMemory: () => (typeof performance === 'undefined' ? undefined : (performance as unknown as PerformanceMemoryLike)),
    resourceEntries: () => {
      try {
        return performance.getEntriesByType('resource') as unknown as ResourceTimingLike[];
      } catch {
        return [];
      }
    },
    navigator: () => (typeof navigator === 'undefined' ? undefined : (navigator as unknown as ManifestNavigator)),
    window: () =>
      typeof window === 'undefined'
        ? undefined
        : { innerWidth: window.innerWidth, innerHeight: window.innerHeight, devicePixelRatio: window.devicePixelRatio },
    now: () => new Date(),
  };
}

let environment: CaptureEnvironment = browserEnvironment();

/** Replace the environment (tests). */
export function setCaptureEnvironment(env: CaptureEnvironment): void {
  environment = env;
}

/** Restore the browser environment. */
export function resetCaptureEnvironment(): void {
  environment = browserEnvironment();
}

// ---------------------------------------------------------------------------
// The capture
// ---------------------------------------------------------------------------

interface ActiveCapture {
  captureId: string;
  finished: boolean;
  env: CaptureEnvironment;
  resolveFrames: (() => void) | null;
  frameId: number | null;
  unsubscribe: () => void;
}

let active: ActiveCapture | null = null;

function newCaptureId(): string {
  try {
    return `cap-${crypto.randomUUID()}`;
  } catch {
    return `cap-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

/** Successful acknowledgement of a started capture. */
export interface CaptureStarted {
  ok: true;
  captureId: string;
  profileKey: string;
  protocol: CaptureProtocol;
  expectedDurationMs: number;
  message: string;
}

function finishActive(capture: ActiveCapture): void {
  capture.finished = true;
  capture.unsubscribe();
  capture.unsubscribe = () => undefined;
  capture.resolveFrames?.();
  capture.resolveFrames = null;
  if (capture.frameId !== null) capture.env.cancelFrame(capture.frameId);
  capture.frameId = null;
  if (active === capture) active = null;
}

/**
 * Start a timed capture. Returns immediately; progress and the finished report
 * land in `usePerformanceStore` (`timedCapture`, `performanceReports`).
 * @param input `{ warmupSeconds?, captureSeconds?, profileId?, cacheState? }`.
 * @returns The acknowledgement, or why the capture cannot start.
 */
export function startPerformanceCapture(input: unknown): CaptureStarted | Failure {
  const parsed = parse(zCaptureRequest, input);
  if (!parsed.ok) return parsed;
  const args = parsed.data;
  const profileKey = args.profileId ?? DEFAULT_DEVICE_PROFILE_KEY;
  if (!getDeviceProfile(profileKey)) {
    return { ok: false, error: `Unknown device profile: ${profileKey}. Registered profiles: ${DEVICE_PROFILE_KEYS.join(', ')}.` };
  }
  if (active) {
    return { ok: false, error: `A performance capture is already running (${active.captureId}). Cancel it or wait for it to finish.` };
  }
  const env = environment;
  const backend = env.backend();
  if (backend === UNKNOWN) {
    return { ok: false, error: 'The engine is not running. Wait for the viewport to finish loading, then start the capture.' };
  }

  const protocol: CaptureProtocol = {
    warmupMs: (args.warmupSeconds ?? 10) * 1000,
    captureMs: (args.captureSeconds ?? 60) * 1000,
  };
  const declaredCache: CacheState | Unknown | undefined =
    args.cacheState === undefined ? undefined : args.cacheState === 'unknown' ? UNKNOWN : args.cacheState;
  const capture: ActiveCapture = { captureId: newCaptureId(), finished: false, env, resolveFrames: null, frameId: null, unsubscribe: () => undefined };
  active = capture;
  const store = usePerformanceStore.getState();
  store.setTimedCapture({
    status: 'running',
    captureId: capture.captureId,
    phase: 'reading-scene',
    progress: 0,
    profileKey,
    protocol,
    startedAt: env.now().getTime(),
    reportId: null,
    error: null,
  });

  void runCapture(capture, env, { backend, protocol, profileKey, declaredCache });

  const expectedDurationMs = protocol.warmupMs + protocol.captureMs;
  return {
    ok: true,
    captureId: capture.captureId,
    profileKey,
    protocol,
    expectedDurationMs,
    message: `Performance capture started: ${protocol.warmupMs / 1000} s warm-up, then ${protocol.captureMs / 1000} s capture against ${profileKey}. Query it with get_performance_report.`,
  };
}

async function runCapture(
  capture: ActiveCapture,
  env: CaptureEnvironment,
  opts: { backend: RenderBackend; protocol: CaptureProtocol; profileKey: string; declaredCache: CacheState | Unknown | undefined },
): Promise<void> {
  const setStatus = usePerformanceStore.getState().setTimedCapture;
  const fail = (error: string) => {
    if (capture.finished) return;
    finishActive(capture);
    setStatus({ status: 'failed', phase: null, error });
  };

  capture.unsubscribe = env.onSceneChange(() => {
    fail('The scene or engine changed during the capture; no report was produced. Keep the scene unchanged and run the capture again.');
  });

  let checksum: string | Unknown;
  try {
    checksum = await env.readSceneChecksum();
  } catch {
    // The scene could not be read back: its identity is unknown, not guessed.
    checksum = UNKNOWN;
  }
  if (capture.finished) return;

  const recorder = createFrameRecorder(opts.protocol);
  let hidden = env.isHidden();
  const unsubscribeScene = capture.unsubscribe;
  const unsubscribeVisibility = env.onVisibilityChange(() => {
    if (env.isHidden()) hidden = true;
  });
  capture.unsubscribe = () => { unsubscribeScene(); unsubscribeVisibility(); };
  const startedAt = env.now().toISOString();
  let lastProgressAt = Number.NEGATIVE_INFINITY;
  setStatus({ phase: 'warmup', progress: 0 });

  await new Promise<void>((resolve) => {
    capture.resolveFrames = resolve;
    const onFrame = (ts: number) => {
      if (capture.finished) return resolve();
      const phase = recorder.onFrame(ts);
      if (phase === 'complete') {
        capture.frameId = null;
        capture.resolveFrames = null;
        return resolve();
      }
      if (ts - lastProgressAt >= CAPTURE_PROGRESS_INTERVAL_MS) {
        lastProgressAt = ts;
        setStatus({ phase: phase === 'capturing' ? 'capturing' : 'warmup', progress: recorder.progress() });
      }
      capture.frameId = env.requestFrame(onFrame);
    };
    capture.frameId = env.requestFrame(onFrame);
  });
  if (capture.finished) return;

  setStatus({ phase: 'building-report', progress: 1 });
  const backendNow = env.backend();
  if (backendNow !== opts.backend) {
    return fail('The engine stopped (or switched backend) during the capture; no report was produced. Run the capture again.');
  }

  try {
    const nav = env.navigator();
    const [browserVersion, gpuDriver] = await Promise.all([readExactBrowserVersion(nav), readGpuDriver(nav, opts.backend)]);
    if (capture.finished) return;
    const manifest = buildMeasurementManifest({
      nav,
      win: env.window(),
      backend: opts.backend,
      browserVersion,
      gpuDriver,
      fixtureChecksum: checksum,
      cacheState: opts.declaredCache ?? detectCacheState(env.resourceEntries()),
    });
    const report = buildPerformanceReport({
      raw: {
        captureProtocolVersion: 1,
        source: 'editor',
        protocol: opts.protocol,
        frameTimestampsMs: [...recorder.timestamps()],
        firstInteractiveMs: env.engineReadyMs(),
        firstInteractiveBasis: 'editor-navigation-to-engine-ready',
        hiddenDuringCapture: hidden,
        memory: readMemoryAvailability(env.performanceMemory(), env.wasmMemory()),
        startedAt,
        completedAt: env.now().toISOString(),
      },
      manifest,
      profileKey: opts.profileKey,
      now: () => env.now(),
    });
    finishActive(capture);
    usePerformanceStore.getState().addPerformanceReport(report);
    setStatus({ status: 'complete', phase: null, progress: 1, reportId: report.reportId, error: null });
  } catch (error) {
    fail(`The report could not be built: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Cancel the running capture.
 * @param input `{}`.
 * @returns ok, or why there was nothing to cancel.
 */
export function cancelPerformanceCapture(input: unknown = {}): { ok: true; message: string } | Failure {
  const parsed = parse(zCancelRequest, input);
  if (!parsed.ok) return parsed;
  const capture = active;
  if (!capture) return { ok: false, error: 'No performance capture is running.' };
  capture.finished = true;
  finishActive(capture);
  usePerformanceStore.getState().setTimedCapture({ status: 'cancelled', phase: null, error: null });
  return { ok: true, message: `Performance capture ${capture.captureId} cancelled; no report was kept.` };
}

// ---------------------------------------------------------------------------
// Queries, baseline, comparison
// ---------------------------------------------------------------------------

function findReport(reportId: string | undefined): PerformanceReport | null | undefined {
  const { performanceReports, baselineReport } = usePerformanceStore.getState();
  if (reportId === undefined) return performanceReports.at(-1) ?? null;
  return performanceReports.find((r) => r.reportId === reportId) ?? (baselineReport?.reportId === reportId ? baselineReport : undefined);
}

const missing = (reportId: string): Failure => ({ ok: false, error: `No performance report with id ${reportId} in this session.` });

/** Capture status as the AI and the panel read it. */
export interface CaptureStatusView {
  status: ReturnType<typeof usePerformanceStore.getState>['timedCapture']['status'];
  captureId: string | null;
  phase: ReturnType<typeof usePerformanceStore.getState>['timedCapture']['phase'];
  progress: number;
  error: string | null;
}

/**
 * The latest (or named) report plus the capture status.
 * @param input `{ reportId?, includeSamples? }`.
 * @returns Status and report summary; `report` is null while the first capture runs.
 */
export function getPerformanceReport(
  input: unknown,
): { ok: true; capture: CaptureStatusView; report: ReportSummary | null; baselineReportId: string | null } | Failure {
  const parsed = parse(zReportQuery, input);
  if (!parsed.ok) return parsed;
  const state = usePerformanceStore.getState();
  const tc = state.timedCapture;
  const capture: CaptureStatusView = { status: tc.status, captureId: tc.captureId, phase: tc.phase, progress: tc.progress, error: tc.error };
  const report = findReport(parsed.data.reportId);
  if (report === undefined) return missing(parsed.data.reportId!);
  if (report === null && tc.status !== 'running') {
    return {
      ok: false,
      error: "No performance report has been captured yet. Start one with capture_performance_report or the profiler's Run capture button.",
    };
  }
  return {
    ok: true,
    capture,
    report: report ? summarizeReport(report, { includeSamples: parsed.data.includeSamples ?? false }) : null,
    baselineReportId: state.baselineReport?.reportId ?? null,
  };
}

/**
 * Pin a report as the baseline (persisted across reloads), or clear it.
 * @param input `{ reportId?, clear? }` — defaults to the latest report.
 * @returns The pinned id (null when cleared).
 */
export function setPerformanceBaseline(input: unknown): { ok: true; baselineReportId: string | null; message: string } | Failure {
  const parsed = parse(zBaselineRequest, input);
  if (!parsed.ok) return parsed;
  const store = usePerformanceStore.getState();
  if (parsed.data.clear) {
    store.setBaselineReport(null);
    return { ok: true, baselineReportId: null, message: 'Performance baseline cleared.' };
  }
  const report = findReport(parsed.data.reportId);
  if (report === undefined) return missing(parsed.data.reportId!);
  if (report === null) return { ok: false, error: 'No performance report has been captured yet, so there is nothing to pin.' };
  store.setBaselineReport(report);
  return { ok: true, baselineReportId: report.reportId, message: `Report ${report.reportId} pinned as the performance baseline.` };
}

/**
 * Compare a report (default: latest) with a baseline (default: the pinned one).
 * An incompatible pair is reported as such, with no improvement claim.
 * @param input `{ reportId?, baselineReportId? }`.
 * @returns The comparison.
 */
export function comparePerformanceReports(input: unknown): { ok: true; comparison: ReportComparison } | Failure {
  const parsed = parse(zCompareRequest, input);
  if (!parsed.ok) return parsed;
  const current = findReport(parsed.data.reportId);
  if (current === undefined) return missing(parsed.data.reportId!);
  if (current === null) return { ok: false, error: 'No performance report has been captured yet, so there is nothing to compare.' };
  let baseline: PerformanceReport | null | undefined;
  if (parsed.data.baselineReportId !== undefined) {
    baseline = findReport(parsed.data.baselineReportId);
    if (baseline === undefined) return missing(parsed.data.baselineReportId);
  } else {
    baseline = usePerformanceStore.getState().baselineReport;
  }
  if (!baseline) {
    return { ok: false, error: "No baseline is pinned. Pin one with set_performance_baseline or the profiler's Pin as baseline button." };
  }
  const comparison = compareReports(current, baseline);
  usePerformanceStore.getState().setLastComparison(comparison);
  return { ok: true, comparison };
}
