import { create } from 'zustand';
import { buildMeasurementManifest, type MeasurementManifest } from '@/lib/config/measurementManifest';

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
}));
