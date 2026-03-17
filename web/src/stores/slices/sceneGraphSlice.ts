/**
 * Scene graph slice - manages scene hierarchy, visibility, and entity CRUD operations.
 *
 * Supports incremental updates (addNode / removeNode / updateNode) to avoid the
 * O(N) full-rebuild cost that the legacy updateSceneGraph action incurs. Full
 * rebuild is kept as setFullGraph for scene load / new-scene resets.
 */

import { StateCreator } from 'zustand';
import type { SceneGraph, SceneNode, EntityType } from './types';

/** Partial node properties that may be changed in-place. */
export interface SceneNodeChanges {
  name?: string;
  parentId?: string | null;
  children?: string[];
  visible?: boolean;
  components?: string[];
}

export interface SceneGraphSlice {
  // State
  sceneGraph: SceneGraph;

  // Actions
  /** Replace the entire graph (used on scene load / new scene). O(N). */
  setFullGraph: (graph: SceneGraph) => void;
  /** @deprecated Use setFullGraph for full replacement. Kept for backward compatibility. */
  updateSceneGraph: (graph: SceneGraph) => void;

  // Incremental operations — O(1) per call
  /** Insert a new node. Attaches to parent's children list and, if root, to rootIds. */
  addNode: (node: SceneNode) => void;
  /** Remove an existing node. Detaches from parent and rootIds. */
  removeNode: (entityId: string) => void;
  /** Patch specific properties on an existing node without rebuilding the graph. */
  updateNode: (entityId: string, changes: SceneNodeChanges) => void;

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

  // ---------------------------------------------------------------------------
  // Full graph operations
  // ---------------------------------------------------------------------------

  setFullGraph: (graph) => {
    set({ sceneGraph: graph });
  },

  updateSceneGraph: (graph) => {
    set({ sceneGraph: graph });
  },

  // ---------------------------------------------------------------------------
  // Incremental operations
  // ---------------------------------------------------------------------------

  addNode: (node) => {
    const { sceneGraph } = get();
    const newNodes = { ...sceneGraph.nodes, [node.entityId]: node };

    // Attach to parent's children list if the parent exists
    if (node.parentId !== null && newNodes[node.parentId]) {
      const parent = newNodes[node.parentId];
      if (!parent.children.includes(node.entityId)) {
        newNodes[node.parentId] = {
          ...parent,
          children: [...parent.children, node.entityId],
        };
      }
    }

    // Append to rootIds if this is a root-level entity
    const newRootIds =
      node.parentId === null && !sceneGraph.rootIds.includes(node.entityId)
        ? [...sceneGraph.rootIds, node.entityId]
        : sceneGraph.rootIds;

    set({ sceneGraph: { nodes: newNodes, rootIds: newRootIds } });
  },

  removeNode: (entityId) => {
    const { sceneGraph } = get();
    if (!sceneGraph.nodes[entityId]) return;

    const removedNode = sceneGraph.nodes[entityId];
    const newNodes = { ...sceneGraph.nodes };
    delete newNodes[entityId];

    // Detach from parent's children list
    if (removedNode.parentId !== null && newNodes[removedNode.parentId]) {
      const parent = newNodes[removedNode.parentId];
      newNodes[removedNode.parentId] = {
        ...parent,
        children: parent.children.filter((id) => id !== entityId),
      };
    }

    // Remove from rootIds if present
    const newRootIds = sceneGraph.rootIds.filter((id) => id !== entityId);

    set({ sceneGraph: { nodes: newNodes, rootIds: newRootIds } });
  },

  updateNode: (entityId, changes) => {
    const { sceneGraph } = get();
    const node = sceneGraph.nodes[entityId];
    if (!node) return;

    const newNodes = {
      ...sceneGraph.nodes,
      [entityId]: { ...node, ...changes },
    };

    // Handle parentId change — re-attach in the graph
    if (changes.parentId !== undefined && changes.parentId !== node.parentId) {
      // Remove from old parent
      if (node.parentId !== null && newNodes[node.parentId]) {
        const oldParent = newNodes[node.parentId];
        newNodes[node.parentId] = {
          ...oldParent,
          children: oldParent.children.filter((id) => id !== entityId),
        };
      }

      // Attach to new parent
      if (changes.parentId !== null && newNodes[changes.parentId]) {
        const newParent = newNodes[changes.parentId];
        if (!newParent.children.includes(entityId)) {
          newNodes[changes.parentId] = {
            ...newParent,
            children: [...newParent.children, entityId],
          };
        }
      }
    }

    // Update rootIds if parentId changed
    let newRootIds = sceneGraph.rootIds;
    if (changes.parentId !== undefined && changes.parentId !== node.parentId) {
      if (changes.parentId === null) {
        // Became root
        if (!newRootIds.includes(entityId)) {
          newRootIds = [...newRootIds, entityId];
        }
      } else {
        // No longer root
        newRootIds = newRootIds.filter((id) => id !== entityId);
      }
    }

    set({ sceneGraph: { nodes: newNodes, rootIds: newRootIds } });
  },

  // ---------------------------------------------------------------------------
  // Existing higher-level actions (dispatch to Rust + optimistic local update)
  // ---------------------------------------------------------------------------

  toggleVisibility: (entityId) => {
    const state = get();
    const node = state.sceneGraph.nodes[entityId];
    if (!node) return;

    const newVisible = !node.visible;

    // Optimistic update via the new incremental path
    get().updateNode(entityId, { visible: newVisible });

    if (dispatchCommand) {
      dispatchCommand('set_visibility', { entityId, visible: newVisible });
    }
  },

  renameEntity: (entityId, newName) => {
    const state = get();
    const node = state.sceneGraph.nodes[entityId];
    if (node) {
      // Optimistic update via the new incremental path
      get().updateNode(entityId, { name: newName });

      // Also keep primaryName in sync when this is the selected entity
      if (state.primaryId === entityId) {
        set({ primaryName: newName });
      }
    }

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

    if (dispatchCommand) {
      dispatchCommand('delete_entities', { entityIds });
    }
  },

  duplicateSelectedEntity: () => {
    const state = get();

    if (!state.primaryId) return;

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
