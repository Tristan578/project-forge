import { create } from 'zustand';
import { buildMeasurementManifest, UNKNOWN, type MeasurementManifest, type Unknown } from '@/lib/config/measurementManifest';

export interface PerformanceStats {
  fps: number;
  frameTime: number;
  triangleCount: number;
  drawCalls: number;
  entityCount: number;
  memoryUsage: number; // MB
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
 * Rust `SystemGroup` labels exactly — these strings are the wire contract with
 * the `SYSTEM_TIMINGS` bridge event.
 */
export const SYSTEM_GROUPS = ['scripting', 'bridge', 'physics', 'rendering'] as const;
export type SystemGroupId = (typeof SYSTEM_GROUPS)[number];

/** Human-readable label per group, for the "Top costly systems" panel. */
export const SYSTEM_GROUP_LABELS: Record<SystemGroupId, string> = {
  scripting: 'Scripting',
  bridge: 'Bridge',
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
    scripting: null,
    bridge: null,
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
}

const defaultStats: PerformanceStats = {
  fps: 60,
  frameTime: 16.67,
  triangleCount: 0,
  drawCalls: 0,
  entityCount: 0,
  memoryUsage: 0,
  wasmHeapSize: 0,
  gpuMemory: 0,
};

const defaultBudget: PerformanceBudget = {
  maxTriangles: 500_000,
  maxDrawCalls: 200,
  targetFps: 60,
  warningThreshold: 0.8,
};

export const usePerformanceStore = create<PerformanceState>((set) => ({
  stats: defaultStats,
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
}));
