import { create } from 'zustand';

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

interface PerformanceState {
  stats: PerformanceStats;
  isProfilerOpen: boolean;
  history: PerformanceStats[]; // Last 60 frames for sparkline
  budget: PerformanceBudget;
  warnings: string[];

  // Actions
  updateStats: (stats: Partial<PerformanceStats>) => void;
  setProfilerOpen: (open: boolean) => void;
  setBudget: (budget: Partial<PerformanceBudget>) => void;
  addWarning: (warning: string) => void;
  clearWarnings: () => void;
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
}));
