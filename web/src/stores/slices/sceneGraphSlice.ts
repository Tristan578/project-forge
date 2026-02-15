/**
 * Scene graph slice - manages scene hierarchy, visibility, and entity CRUD operations.
 */

import { StateCreator } from 'zustand';
import type { SceneGraph, EntityType } from './types';

export interface SceneGraphSlice {
  // State
  sceneGraph: SceneGraph;

  // Actions
  updateSceneGraph: (graph: SceneGraph) => void;
  toggleVisibility: (entityId: string) => void;
  renameEntity: (entityId: string, newName: string) => void;
  spawnEntity: (type: EntityType, name?: string) => void;
  deleteSelectedEntities: () => void;
  duplicateSelectedEntity: () => void;
  reparentEntity: (
    entityId: string,
    newParentId: string | null,
    insertIndex?: number
  ) => void;
}

// Internal dispatcher reference
let dispatchCommand: ((command: string, payload: unknown) => void) | null = null;

export function setSceneGraphDispatcher(dispatcher: (command: string, payload: unknown) => void): void {
  dispatchCommand = dispatcher;
}

export const createSceneGraphSlice: StateCreator<
  SceneGraphSlice & {
    selectedIds: Set<string>;
    primaryId: string | null;
    primaryName: string | null;
    primaryTransform: unknown | null;
    spawnTerrain: () => void;
  },
  [],
  [],
  SceneGraphSlice
> = (set, get) => ({
  // Initial state
  sceneGraph: { nodes: {}, rootIds: [] },

  // Actions
  updateSceneGraph: (graph) => {
    set({ sceneGraph: graph });
  },

  toggleVisibility: (entityId) => {
    const state = get();
    const node = state.sceneGraph.nodes[entityId];
    if (!node) return;

    const newVisible = !node.visible;

    // Optimistically update local state
    set({
      sceneGraph: {
        ...state.sceneGraph,
        nodes: {
          ...state.sceneGraph.nodes,
          [entityId]: { ...node, visible: newVisible },
        },
      },
    });

    // Send command to Rust
    if (dispatchCommand) {
      dispatchCommand('set_visibility', { entityId, visible: newVisible });
    }
  },

  renameEntity: (entityId, newName) => {
    const state = get();

    // Optimistically update local state
    const node = state.sceneGraph.nodes[entityId];
    if (node) {
      set({
        sceneGraph: {
          ...state.sceneGraph,
          nodes: {
            ...state.sceneGraph.nodes,
            [entityId]: { ...node, name: newName },
          },
        },
        // Update primaryName if this is the selected entity
        primaryName: state.primaryId === entityId ? newName : state.primaryName,
      });
    }

    // Send command to Rust
    if (dispatchCommand) {
      dispatchCommand('rename_entity', { entityId, name: newName });
    }
  },

  spawnEntity: (type, name) => {
    if (type === 'terrain') {
      get().spawnTerrain();
      return;
    }
    if (dispatchCommand) {
      dispatchCommand('spawn_entity', { entityType: type, name });
    }
  },

  deleteSelectedEntities: () => {
    const state = get();
    const entityIds = Array.from(state.selectedIds);

    if (entityIds.length === 0) return;

    // Clear selection optimistically
    set({
      selectedIds: new Set(),
      primaryId: null,
      primaryName: null,
      primaryTransform: null,
    });

    // Send command to Rust
    if (dispatchCommand) {
      dispatchCommand('delete_entities', { entityIds });
    }
  },

  duplicateSelectedEntity: () => {
    const state = get();

    if (!state.primaryId) return;

    // Send command to Rust
    if (dispatchCommand) {
      dispatchCommand('duplicate_entity', { entityId: state.primaryId });
    }
  },

  reparentEntity: (entityId, newParentId, insertIndex) => {
    if (dispatchCommand) {
      dispatchCommand('reparent_entity', {
        entityId,
        newParentId,
        insertIndex,
      });
    }
  },
});
