/**
 * Bridge slice — tracks external tool connections and running operations.
 *
 * ## Architecture: JS-Only Slice
 *
 * This slice is populated entirely from the JS layer. It does NOT receive data
 * from the Bevy WASM engine and has no corresponding `bridgeEvents.ts` hook in
 * `hooks/events/`. There are no Bevy ECS components or engine events that feed
 * into it.
 *
 * ## Communication Pattern
 *
 * External tool bridges (e.g. Aseprite integration) discover tools at startup
 * and call the slice actions directly:
 *
 * ```
 * Bridge Adapter (lib/bridges/*.ts)
 *   → setBridgeTool({ id, name, status: 'connected', ... })
 *   → addBridgeOperation({ id, toolId, operationName, status: 'running', ... })
 *   → updateBridgeOperation(opId, { status: 'completed' })
 *   → removeBridgeOperation(opId)
 * ```
 *
 * ## Types
 *
 * `BridgeToolInfo` (this file) is the Zustand-store-level shape — a superset
 * of `BridgeToolConfig` from `@/lib/bridges/types`. Use `BridgeToolInfo` when
 * reading or writing store state. Use `BridgeToolConfig` when interacting with
 * the bridge adapter library (discovery, launch, IPC).
 *
 * `BridgeOperationInfo` (this file) tracks in-flight async operations from the
 * perspective of the editor UI (status, elapsed time, error). It is not the
 * same as `BridgeOperation` from `@/lib/bridges/types` (which is a request
 * descriptor sent to the tool subprocess).
 *
 * ## State Transitions
 *
 * ```
 * Tool connection lifecycle:
 *   not in store → setBridgeTool({ status: 'not_found' | 'disconnected' })
 *   → setBridgeTool({ status: 'connected', activeVersion: '...' })
 *   → removeBridgeTool(toolId)   // on adapter shutdown
 *
 * Operation lifecycle:
 *   addBridgeOperation({ status: 'running' })
 *   → updateBridgeOperation(opId, { status: 'completed' | 'failed', error? })
 *   → removeBridgeOperation(opId)  // after UI has consumed the result
 * ```
 *
 * ## Error States
 *
 * A tool can be in `status: 'error'` when the subprocess exits unexpectedly or
 * the IPC channel drops. Bridge adapters call `setBridgeTool({ status: 'error' })`
 * to surface this in the UI. The editor shows a warning badge but does not
 * block the user — all bridge functionality degrades gracefully.
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
