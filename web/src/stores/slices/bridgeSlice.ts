// Bridge state is JS-only (Aseprite, external tools). No engine event handler needed — updates come from UI components directly.

/**
 * Bridge slice — tracks external tool connections and running operations.
 *
 * JS-only slice: state is populated entirely from the JS layer (external IDE
 * bridge integrations, tool discovery, operation lifecycle). There are no
 * Bevy engine events that feed into this slice — it does NOT have a
 * corresponding `bridgeEvents.ts` hook in `hooks/events/`.
 *
 * State transitions:
 *   - setBridgeTool / removeBridgeTool: called by bridge adapter code when
 *     a tool connects or disconnects.
 *   - addBridgeOperation / updateBridgeOperation / removeBridgeOperation:
 *     called by bridge adapters to track in-flight async operations.
 */

import type { StateCreator } from 'zustand';
import type { PlatformPaths } from '@/lib/bridges/types';

export interface BridgeToolInfo {
  id: string;
  name: string;
  paths?: PlatformPaths;
  activeVersion: string | null;
  status: 'connected' | 'disconnected' | 'not_found' | 'error';
}

export interface BridgeOperationInfo {
  id: string;
  toolId: string;
  operationName: string;
  status: 'running' | 'completed' | 'failed';
  startedAt: number;
  error?: string;
}

export interface BridgeSlice {
  bridgeTools: Record<string, BridgeToolInfo>;
  bridgeOperations: BridgeOperationInfo[];

  setBridgeTool: (tool: BridgeToolInfo) => void;
  removeBridgeTool: (toolId: string) => void;
  addBridgeOperation: (op: BridgeOperationInfo) => void;
  updateBridgeOperation: (opId: string, update: Partial<BridgeOperationInfo>) => void;
  removeBridgeOperation: (opId: string) => void;
}

export const createBridgeSlice: StateCreator<BridgeSlice, [], [], BridgeSlice> = (set) => ({
  bridgeTools: {},
  bridgeOperations: [],

  setBridgeTool: (tool) =>
    set((s) => ({
      bridgeTools: { ...s.bridgeTools, [tool.id]: tool },
    })),

  removeBridgeTool: (toolId) =>
    set((s) => {
      const { [toolId]: _removed, ...rest } = s.bridgeTools;
      return { bridgeTools: rest };
    }),

  addBridgeOperation: (op) =>
    set((s) => ({
      bridgeOperations: [...s.bridgeOperations, op],
    })),

  updateBridgeOperation: (opId, update) =>
    set((s) => ({
      bridgeOperations: s.bridgeOperations.map((op) =>
        op.id === opId ? { ...op, ...update } : op
      ),
    })),

  removeBridgeOperation: (opId) =>
    set((s) => ({
      bridgeOperations: s.bridgeOperations.filter((op) => op.id !== opId),
    })),
});
