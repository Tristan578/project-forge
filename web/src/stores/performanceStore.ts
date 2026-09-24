import { create } from 'zustand';
import { buildMeasurementManifest, UNKNOWN, type MeasurementManifest, type Unknown } from '@/lib/config/measurementManifest';
import { safeGetItem, safeSetItem } from '@/lib/storage/safeLocalStorage';
import type { CaptureProtocol } from '@/lib/perf/frameCapture';
import {
  parsePerformanceReport,
  type PerformanceReport,
  type ReportComparison,
} from '@/lib/perf/performanceReport';

export interface PerformanceStats {
  fps: number;
  frameTime: number;
  triangleCount: number;
  drawCalls: number;
  entityCount: number;
  /**
   * Engine mesh memory in MB (`PERFORMANCE_STATS.meshMemoryBytes`), or unknown
   * until the engine has reported it — never a placeholder 0.
   */
  memoryUsage: number | Unknown;
  /**
   * JS heap in use, MB (`performance.memory`, Chromium only), or unknown where
   * the browser does not expose it. It used to be written into `memoryUsage`
   * as `0` on Firefox/Safari, which read as "measured, and empty" (#10013).
   */
  jsHeapMb: number | Unknown;
  wasmHeapSize: number;
  gpuMemory: number;
}

export interface PerformanceBudget {
  maxTriangles: number;
  maxDrawCalls: number;
  targetFps: number;
  warningThreshold: number;
}

/**
 * A manually-captured performance report: a snapshot of the live stats pinned
 * to the {@link MeasurementManifest} identifying the machine and build it was
 * taken on. Operation performance.FR-3.OP-01 (#9904). Fields the browser could
 * not measure live on the manifest as `'unknown'`, never as a real zero.
 */
export interface CapturedPerformanceReport {
  stats: PerformanceStats;
  manifest: MeasurementManifest;
  /** Epoch ms the report was captured. */
  capturedAt: number;
}

// ---------------------------------------------------------------------------
// Per-system-group CPU timing (performance.FR-1.OP-01 / OP-04)
// ---------------------------------------------------------------------------

/**
 * Coarse engine system groups a frame's CPU cost is attributed to. Mirrors the
 * Rust `SystemGroup::label()` strings exactly (same order) — these are the wire
 * contract with the `SYSTEM_TIMINGS` bridge event. Each id names exactly what
 * the engine bracket measures: `entitySync` is the Rust-side entity-state emit
 * (NOT user-script CPU, which runs off-frame in the JS Worker), `transformApply`
 * is the one transform command drain (NOT every JS→engine drain), and `physics`
 * is Rapier's real solver step.
 */
export const SYSTEM_GROUPS = ['entitySync', 'transformApply', 'physics', 'rendering'] as const;
export type SystemGroupId = (typeof SYSTEM_GROUPS)[number];

/**
 * Human-readable label per group, for the "Top costly systems" panel. These are
 * deliberately narrow ("Entity sync", "Transform apply") rather than the broad
 * "Scripting"/"Bridge" they replaced, so the panel never claims to measure cost
 * it cannot see (user-script CPU, or command drains other than transforms).
 */
export const SYSTEM_GROUP_LABELS: Record<SystemGroupId, string> = {
  entitySync: 'Entity sync',
  transformApply: 'Transform apply',
  physics: 'Physics',
  rendering: 'Rendering',
};

/** Max buffered per-frame snapshots. Mirrors the engine ring so a long capture
 * session stays memory-bounded on the JS side too (N1 boundary condition). */
export const MAX_SYSTEM_TIMING_FRAMES = 240;

/**
 * One captured frame's per-group CPU cost in ms. A group ABSENT from
 * `perGroupMs` was not measured that frame — it must surface as unavailable
 * ("unknown"), never as 0. A present `0` is a real "ran, effectively free".
 */
export interface SystemTimingFrame {
  frameIndex: number;
  perGroupMs: Partial<Record<SystemGroupId, number>>;
}

/**
 * Aggregated cost for one group over a capture session. `totalMs` is the
 * {@link UNKNOWN} sentinel when the group was never measured (e.g. rendering /
 * GPU timing, deferred to OP-02) — deliberately not `0`.
 */
export interface SystemCost {
  group: SystemGroupId;
  label: string;
  totalMs: number | Unknown;
}

/**
 * Fold a frame history into ranked per-group totals. A group measured at least
 * once is `Some(sum)`; a group never measured stays {@link UNKNOWN}. Measured
 * groups sort by descending cost (the spike attribution); unknown groups sort
 * last so they never masquerade as "cheapest".
 */
export function computeSystemCosts(history: SystemTimingFrame[]): SystemCost[] {
  const totals: Record<SystemGroupId, number | null> = {
    entitySync: null,
    transformApply: null,
    physics: null,
    rendering: null,
  };
  for (const frame of history) {
    for (const group of SYSTEM_GROUPS) {
      const value = frame.perGroupMs[group];
      if (typeof value === 'number' && Number.isFinite(value)) {
        totals[group] = (totals[group] ?? 0) + value;
      }
    }
  }
  const costs: SystemCost[] = SYSTEM_GROUPS.map((group) => ({
    group,
    label: SYSTEM_GROUP_LABELS[group],
    totalMs: totals[group] === null ? UNKNOWN : (totals[group] as number),
  }));
  return costs.sort((a, b) => {
    const aUnknown = a.totalMs === UNKNOWN;
    const bUnknown = b.totalMs === UNKNOWN;
    if (aUnknown && bUnknown) return 0;
    if (aUnknown) return 1;
    if (bUnknown) return -1;
    return (b.totalMs as number) - (a.totalMs as number);
  });
}

// ---------------------------------------------------------------------------
// Timed capture + reports (performance.FR-3.OP-01, #9904 / #10013)
// ---------------------------------------------------------------------------

/** Lifecycle of the editor's timed performance capture. */
export type TimedCaptureStatus = 'idle' | 'running' | 'complete' | 'failed' | 'cancelled';

/** Where a running capture is. */
export type TimedCapturePhase = 'reading-scene' | 'warmup' | 'capturing' | 'building-report';

/**
 * State of the timed capture that the profiler's Run capture button and the
 * in-app AI's `capture_performance_report` both start (`lib/perf/editorCapture.ts`).
 */
export interface TimedCaptureState {
  status: TimedCaptureStatus;
  captureId: string | null;
  phase: TimedCapturePhase | null;
  /** Fraction of warm-up + capture elapsed, 0..1. */
  progress: number;
  profileKey: string | null;
  protocol: CaptureProtocol | null;
  /** Epoch ms the capture was started. */
  startedAt: number | null;
  /** Report produced by the last completed capture. */
  reportId: string | null;
  error: string | null;
}

/** A capture that has never run. */
export const IDLE_TIMED_CAPTURE: Readonly<TimedCaptureState> = Object.freeze({
  status: 'idle',
  captureId: null,
  phase: null,
  progress: 0,
  profileKey: null,
  protocol: null,
  startedAt: null,
  reportId: null,
  error: null,
});

/** Reports kept in memory for the session (each carries its raw samples). */
export const MAX_STORED_REPORTS = 10;

/** localStorage key of the pinned baseline, versioned with the report schema. */
export const PERFORMANCE_BASELINE_STORAGE_KEY = 'forge:perf-baseline:v1';

/**
 * Read the pinned baseline back from localStorage. A value that fails the
 * report schema is ignored rather than trusted: a baseline is only useful if
 * its manifest can be compared field for field.
 * @returns The stored baseline report, or null.
 */
export function loadStoredBaseline(): PerformanceReport | null {
  const raw = safeGetItem(PERFORMANCE_BASELINE_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = parsePerformanceReport(JSON.parse(raw));
    return parsed.ok ? parsed.report : null;
  } catch {
    return null;
  }
}

function storeBaseline(report: PerformanceReport | null): void {
  if (report) {
    safeSetItem(PERFORMANCE_BASELINE_STORAGE_KEY, JSON.stringify(report));
    return;
  }
  try {
    localStorage.removeItem(PERFORMANCE_BASELINE_STORAGE_KEY);
  } catch {
    // Storage unavailable: nothing persisted to remove.
  }
}

interface PerformanceState {
  stats: PerformanceStats;
  isProfilerOpen: boolean;
  history: PerformanceStats[]; // Last 60 frames for sparkline
  budget: PerformanceBudget;
  warnings: string[];
  /** Current LOD level per entity (entity_id -> lod_level) */
  lodLevels: Record<string, number>;
  /** Manifest for the current measurement session, or null before capture. */
  manifest: MeasurementManifest | null;
  /** The most recently captured manual report (stats + manifest), or null. */
  capturedReport: CapturedPerformanceReport | null;
  /** Whether a per-system-group timing capture session is active. */
  captureActive: boolean;
  /** Bounded rolling buffer of per-frame system-group timings for the session. */
  systemTimingHistory: SystemTimingFrame[];
  /** Ranked per-group totals for the current session (derived from history). */
  systemCosts: SystemCost[];
  /** The timed capture shared by the manual control and the in-app AI. */
  timedCapture: TimedCaptureState;
  /** Reports captured this session, oldest first, at most {@link MAX_STORED_REPORTS}. */
  performanceReports: PerformanceReport[];
  /** The pinned baseline comparisons default to; persisted across reloads. */
  baselineReport: PerformanceReport | null;
  /** The most recent comparison, shown in the profiler. */
  lastComparison: ReportComparison | null;

  // Actions
  updateStats: (stats: Partial<PerformanceStats>) => void;
  setProfilerOpen: (open: boolean) => void;
  setBudget: (budget: Partial<PerformanceBudget>) => void;
  addWarning: (warning: string) => void;
  clearWarnings: () => void;
  setLodLevel: (entityId: string, level: number) => void;
  /** Replace the current manifest wholesale. */
  setManifest: (manifest: MeasurementManifest) => void;
  /** Merge fields into the current manifest (no-op-safe before one exists). */
  updateManifest: (manifest: Partial<MeasurementManifest>) => void;
  /** Store a captured report and adopt its manifest as the current one. */
  captureReport: (report: CapturedPerformanceReport) => void;
  /** Arm a fresh system-timing capture session (clears prior frames). */
  startSystemCapture: () => void;
  /** Halt the current session; buffered frames are retained. */
  stopSystemCapture: () => void;
  /** Append one per-frame timing snapshot (ignored unless capturing). */
  pushSystemTimingFrame: (frame: SystemTimingFrame) => void;
  /** Merge fields into the timed-capture state. */
  setTimedCapture: (next: Partial<TimedCaptureState>) => void;
  /** Keep a finished report (bounded, newest last). */
  addPerformanceReport: (report: PerformanceReport) => void;
  /** Pin (or with null, clear) the baseline; persisted to localStorage. */
  setBaselineReport: (report: PerformanceReport | null) => void;
  /** Record the latest comparison. */
  setLastComparison: (comparison: ReportComparison | null) => void;
}

/** Stats before the engine or the profiler has reported anything. */
export const DEFAULT_PERFORMANCE_STATS: Readonly<PerformanceStats> = Object.freeze({
  fps: 60,
  frameTime: 16.67,
  triangleCount: 0,
  drawCalls: 0,
  entityCount: 0,
  memoryUsage: UNKNOWN,
  jsHeapMb: UNKNOWN,
  wasmHeapSize: 0,
  gpuMemory: 0,
});

const defaultBudget: PerformanceBudget = {
  maxTriangles: 500_000,
  maxDrawCalls: 200,
  targetFps: 60,
  warningThreshold: 0.8,
};

export const usePerformanceStore = create<PerformanceState>((set) => ({
  stats: { ...DEFAULT_PERFORMANCE_STATS },
  isProfilerOpen: false,
  history: [],
  budget: defaultBudget,
  warnings: [],
  lodLevels: {},
  manifest: null,
  capturedReport: null,
  captureActive: false,
  systemTimingHistory: [],
  systemCosts: computeSystemCosts([]),
  timedCapture: { ...IDLE_TIMED_CAPTURE },
  performanceReports: [],
  baselineReport: typeof window === 'undefined' ? null : loadStoredBaseline(),
  lastComparison: null,

  updateStats: (newStats) =>
    set((state) => {
      const updatedStats = { ...state.stats, ...newStats };
      const newHistory = [...state.history, updatedStats].slice(-60);

      // Check budget violations
      const newWarnings: string[] = [];
      if (updatedStats.triangleCount > state.budget.maxTriangles * state.budget.warningThreshold) {
        newWarnings.push('Triangle count approaching budget limit');
      }
      if (updatedStats.drawCalls > state.budget.maxDrawCalls * state.budget.warningThreshold) {
        newWarnings.push('Draw calls approaching budget limit');
      }
      if (updatedStats.fps < state.budget.targetFps * 0.9) {
        newWarnings.push('FPS below target');
      }

      return {
        stats: updatedStats,
        history: newHistory,
        warnings: newWarnings.length > 0 ? newWarnings : state.warnings,
      };
    }),

  setProfilerOpen: (open) => set({ isProfilerOpen: open }),

  setBudget: (budgetUpdate) =>
    set((state) => ({ budget: { ...state.budget, ...budgetUpdate } })),

  addWarning: (warning) =>
    set((state) => ({ warnings: [...state.warnings, warning] })),

  clearWarnings: () => set({ warnings: [] }),

  setLodLevel: (entityId, level) =>
    set((state) => ({
      lodLevels: { ...state.lodLevels, [entityId]: level },
    })),

  setManifest: (manifest) => set({ manifest }),

  updateManifest: (manifestUpdate) =>
    set((state) =>
      // Seed every required field before applying a partial update.
      state.manifest
        ? { manifest: { ...state.manifest, ...manifestUpdate } }
        : { manifest: { ...buildMeasurementManifest(), ...manifestUpdate } },
    ),

  captureReport: (report) => set({ capturedReport: report, manifest: report.manifest }),

  startSystemCapture: () =>
    set({ captureActive: true, systemTimingHistory: [], systemCosts: computeSystemCosts([]) }),

  stopSystemCapture: () => set({ captureActive: false }),

  pushSystemTimingFrame: (frame) =>
    set((state) => {
      // Ignore stray frames arriving outside a capture session.
      if (!state.captureActive) return {};
      const history = [...state.systemTimingHistory, frame].slice(-MAX_SYSTEM_TIMING_FRAMES);
      return { systemTimingHistory: history, systemCosts: computeSystemCosts(history) };
    }),

  setTimedCapture: (next) => set((state) => ({ timedCapture: { ...state.timedCapture, ...next } })),

  addPerformanceReport: (report) =>
    set((state) => ({ performanceReports: [...state.performanceReports, report].slice(-MAX_STORED_REPORTS), lastComparison: null })),

  setBaselineReport: (report) => {
    storeBaseline(report);
    set({ baselineReport: report, lastComparison: null });
  },

  setLastComparison: (comparison) => set({ lastComparison: comparison }),
}));
