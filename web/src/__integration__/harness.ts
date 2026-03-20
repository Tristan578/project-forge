/**
 * Integration test harness for command-level testing.
 *
 * Creates a real Zustand editorStore composed from all domain slices, wires up a
 * mock dispatch that records calls and can return fixture responses, and exposes
 * helpers for simulating engine events arriving back into the store.
 *
 * Usage:
 *   const { store, dispatch, getState, simulateEvent } = createTestHarness();
 *   getState().spawnEntity('cube', 'MyCube');
 *   expect(dispatch).toHaveBeenCalledWith('spawn_entity', { entityType: 'cube', name: 'MyCube' });
 */

import { create } from 'zustand';
import { vi } from 'vitest';

import {
  createSelectionSlice,
  setSelectionDispatcher,
  createSceneGraphSlice,
  setSceneGraphDispatcher,
  createTransformSlice,
  setTransformDispatcher,
  createMaterialSlice,
  setMaterialDispatcher,
  createLightingSlice,
  setLightingDispatcher,
  createPhysicsSlice,
  setPhysicsDispatcher,
  createAudioSlice,
  setAudioDispatcher,
  createAnimationSlice,
  setAnimationDispatcher,
  createParticleSlice,
  setParticleDispatcher,
  createScriptSlice,
  setScriptDispatcher,
  createGameSlice,
  setGameDispatcher,
  createSpriteSlice,
  setSpriteDispatcher,
  createHistorySlice,
  setHistoryDispatcher,
  createSceneSlice,
  setSceneDispatcher,
  createAssetSlice,
  setAssetDispatcher,
  createEditModeSlice,
  setEditModeDispatcher,
  createBridgeSlice,
} from '@/stores/slices';
import type { EditorState } from '@/stores/editorStore';
import type { SceneNode } from '@/stores/slices/types';

// ---------------------------------------------------------------------------
// Store factory
// ---------------------------------------------------------------------------

function createIntegrationStore(): import('zustand').StoreApi<EditorState> {
  return create<EditorState>()((...args) => ({
    ...createSelectionSlice(...args),
    ...createSceneGraphSlice(...args),
    ...createTransformSlice(...args),
    ...createMaterialSlice(...args),
    ...createLightingSlice(...args),
    ...createPhysicsSlice(...args),
    ...createAudioSlice(...args),
    ...createAnimationSlice(...args),
    ...createParticleSlice(...args),
    ...createScriptSlice(...args),
    ...createGameSlice(...args),
    ...createSpriteSlice(...args),
    ...createHistorySlice(...args),
    ...createSceneSlice(...args),
    ...createAssetSlice(...args),
    ...createEditModeSlice(...args),
    ...createBridgeSlice(...args),
  }));
}

// ---------------------------------------------------------------------------
// Dispatcher wiring
// ---------------------------------------------------------------------------

function wireDispatchers(dispatcher: (command: string, payload: unknown) => void): void {
  setSelectionDispatcher(dispatcher);
  setSceneGraphDispatcher(dispatcher);
  setTransformDispatcher(dispatcher);
  setMaterialDispatcher(dispatcher);
  setLightingDispatcher(dispatcher);
  setPhysicsDispatcher(dispatcher);
  setAudioDispatcher(dispatcher);
  setAnimationDispatcher(dispatcher);
  setParticleDispatcher(dispatcher);
  setScriptDispatcher(dispatcher);
  setGameDispatcher(dispatcher);
  setSpriteDispatcher(dispatcher);
  setHistoryDispatcher(dispatcher);
  setSceneDispatcher(dispatcher);
  setAssetDispatcher(dispatcher);
  setEditModeDispatcher(dispatcher);
}

function clearDispatchers(): void {
  const noop = null as unknown as (command: string, payload: unknown) => void;
  setSelectionDispatcher(noop);
  setSceneGraphDispatcher(noop);
  setTransformDispatcher(noop);
  setMaterialDispatcher(noop);
  setLightingDispatcher(noop);
  setPhysicsDispatcher(noop);
  setAudioDispatcher(noop);
  setAnimationDispatcher(noop);
  setParticleDispatcher(noop);
  setScriptDispatcher(noop);
  setGameDispatcher(noop);
  setSpriteDispatcher(noop);
  setHistoryDispatcher(noop);
  setSceneDispatcher(noop);
  setAssetDispatcher(noop);
  setEditModeDispatcher(noop);
}

// ---------------------------------------------------------------------------
// Harness public API
// ---------------------------------------------------------------------------

export interface TestHarness {
  /** The composed Zustand store — real slices, mock dispatch. */
  store: import('zustand').StoreApi<EditorState>;

  /** vi.fn() that intercepts all dispatchCommand calls. Inspect with .mock.calls. */
  dispatch: ReturnType<typeof vi.fn>;

  /** Shortcut: store.getState() */
  getState: () => EditorState;

  /**
   * Simulate a SceneGraph node being added by the engine (as if a SPAWN event
   * arrived from Rust). Sets up the node in the store so the rest of the test
   * can interact with it.
   */
  simulateEntitySpawned: (node: SceneNode) => void;

  /**
   * Simulate the engine removing an entity (as if a DELETE event arrived).
   */
  simulateEntityDeleted: (entityId: string) => void;

  /**
   * Simulate a batch scene graph replacement (as if full scene was loaded).
   */
  simulateSceneLoaded: (nodes: SceneNode[]) => void;

  /**
   * Clears all dispatcher references so the next test starts clean.
   * Call in afterEach.
   */
  cleanup: () => void;
}

/**
 * Creates a fresh integration test harness.
 *
 * Each call returns an independent store instance and an independent vi.fn()
 * dispatch. Tests are fully isolated from each other.
 */
export function createTestHarness(): TestHarness {
  const store = createIntegrationStore();
  const dispatch = vi.fn() as ReturnType<typeof vi.fn> & ((command: string, payload: unknown) => void);

  wireDispatchers(dispatch);

  const getState = (): EditorState => store.getState();

  const simulateEntitySpawned = (node: SceneNode): void => {
    store.getState().addNode(node);
  };

  const simulateEntityDeleted = (entityId: string): void => {
    store.getState().removeNode(entityId);
    // Also clear selection if this was selected
    const state = store.getState();
    if (state.selectedIds.has(entityId)) {
      const remaining = [...state.selectedIds].filter((id) => id !== entityId);
      store.getState().setSelection(remaining, remaining[0] ?? null, null);
    }
  };

  const simulateSceneLoaded = (nodes: SceneNode[]): void => {
    const nodesMap: Record<string, SceneNode> = {};
    const rootIds: string[] = [];
    for (const node of nodes) {
      nodesMap[node.entityId] = node;
      if (node.parentId === null) {
        rootIds.push(node.entityId);
      }
    }
    store.getState().setFullGraph({ nodes: nodesMap, rootIds });
  };

  const cleanup = (): void => {
    clearDispatchers();
  };

  return {
    store,
    dispatch,
    getState,
    simulateEntitySpawned,
    simulateEntityDeleted,
    simulateSceneLoaded,
    cleanup,
  };
}
