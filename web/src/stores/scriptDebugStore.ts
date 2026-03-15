/**
 * Script Debug Store
 * Manages visual script runtime debugger state: breakpoints, execution tracing,
 * active node highlighting, and per-node output recording.
 */

import { create } from 'zustand';

interface ScriptDebugState {
  debugEnabled: boolean;
  activeNodeId: string | null;
  nodeOutputs: Record<string, unknown>;
  executionPath: string[];
  breakpoints: Set<string>;
  isPaused: boolean;

  // Actions
  toggleDebug: () => void;
  setActiveNode: (nodeId: string | null) => void;
  recordNodeOutput: (nodeId: string, output: unknown) => void;
  addToExecutionPath: (nodeId: string) => void;
  addBreakpoint: (nodeId: string) => void;
  removeBreakpoint: (nodeId: string) => void;
  clearBreakpoints: () => void;
  pauseExecution: () => void;
  resumeExecution: () => void;
  clearExecutionPath: () => void;
  resetDebugState: () => void;
}

export const useScriptDebugStore = create<ScriptDebugState>((set, get) => ({
  debugEnabled: false,
  activeNodeId: null,
  nodeOutputs: {},
  executionPath: [],
  breakpoints: new Set<string>(),
  isPaused: false,

  toggleDebug: () => {
    const next = !get().debugEnabled;
    set({
      debugEnabled: next,
      // Clear transient debug state when disabling
      activeNodeId: next ? get().activeNodeId : null,
      isPaused: next ? get().isPaused : false,
    });
  },

  setActiveNode: (nodeId) => set({ activeNodeId: nodeId }),

  recordNodeOutput: (nodeId, output) =>
    set((state) => ({
      nodeOutputs: { ...state.nodeOutputs, [nodeId]: output },
    })),

  addToExecutionPath: (nodeId) =>
    set((state) => ({
      executionPath: [...state.executionPath, nodeId],
    })),

  addBreakpoint: (nodeId) =>
    set((state) => {
      const next = new Set(state.breakpoints);
      next.add(nodeId);
      return { breakpoints: next };
    }),

  removeBreakpoint: (nodeId) =>
    set((state) => {
      const next = new Set(state.breakpoints);
      next.delete(nodeId);
      return { breakpoints: next };
    }),

  clearBreakpoints: () => set({ breakpoints: new Set<string>() }),

  pauseExecution: () => set({ isPaused: true }),

  resumeExecution: () => set({ isPaused: false }),

  clearExecutionPath: () => set({ executionPath: [], activeNodeId: null }),

  resetDebugState: () =>
    set({
      activeNodeId: null,
      nodeOutputs: {},
      executionPath: [],
      isPaused: false,
    }),
}));
