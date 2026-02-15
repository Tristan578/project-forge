/**
 * Selection slice - manages entity selection state and actions.
 */

import { StateCreator } from 'zustand';
import type { SceneGraph } from './types';

export interface SelectionSlice {
  // State
  selectedIds: Set<string>;
  primaryId: string | null;
  primaryName: string | null;
  hierarchyFilter: string;

  // Actions
  selectEntity: (id: string, mode: 'replace' | 'add' | 'toggle') => void;
  selectRange: (fromId: string, toId: string) => void;
  clearSelection: () => void;
  setSelection: (
    selectedIds: string[],
    primaryId: string | null,
    primaryName: string | null
  ) => void;
  setHierarchyFilter: (filter: string) => void;
  clearHierarchyFilter: () => void;
}

// Internal dispatcher reference
let dispatchCommand: ((command: string, payload: unknown) => void) | null = null;

export function setSelectionDispatcher(dispatcher: (command: string, payload: unknown) => void): void {
  dispatchCommand = dispatcher;
}

export const createSelectionSlice: StateCreator<
  SelectionSlice & { sceneGraph: SceneGraph },
  [],
  [],
  SelectionSlice
> = (set, get) => ({
  // Initial state
  selectedIds: new Set<string>(),
  primaryId: null,
  primaryName: null,
  hierarchyFilter: '',

  // Actions
  selectEntity: (id, mode) => {
    const state = get();

    switch (mode) {
      case 'replace':
        set({
          selectedIds: new Set([id]),
          primaryId: id,
          primaryName: state.sceneGraph.nodes[id]?.name ?? null,
        });
        break;
      case 'add': {
        const newSet = new Set(state.selectedIds);
        newSet.add(id);
        set({
          selectedIds: newSet,
          primaryId: id,
          primaryName: state.sceneGraph.nodes[id]?.name ?? null,
        });
        break;
      }
      case 'toggle': {
        const toggleSet = new Set(state.selectedIds);
        if (toggleSet.has(id)) {
          toggleSet.delete(id);
          // Update primary if we removed it
          const newPrimaryId =
            state.primaryId === id
              ? (toggleSet.values().next().value ?? null)
              : state.primaryId;
          set({
            selectedIds: toggleSet,
            primaryId: newPrimaryId,
            primaryName: newPrimaryId
              ? (state.sceneGraph.nodes[newPrimaryId]?.name ?? null)
              : null,
          });
        } else {
          toggleSet.add(id);
          set({
            selectedIds: toggleSet,
            primaryId: id,
            primaryName: state.sceneGraph.nodes[id]?.name ?? null,
          });
        }
        break;
      }
    }

    // Send command to Rust
    if (dispatchCommand) {
      dispatchCommand('select_entity', { entityId: id, mode });
    }
  },

  selectRange: (fromId, toId) => {
    const state = get();
    const { rootIds, nodes } = state.sceneGraph;

    // Flatten the tree to get ordered entity IDs
    const flattenTree = (ids: string[]): string[] => {
      const result: string[] = [];
      for (const id of ids) {
        result.push(id);
        const node = nodes[id];
        if (node?.children.length) {
          result.push(...flattenTree(node.children));
        }
      }
      return result;
    };

    const orderedIds = flattenTree(rootIds);
    const fromIndex = orderedIds.indexOf(fromId);
    const toIndex = orderedIds.indexOf(toId);

    if (fromIndex === -1 || toIndex === -1) return;

    const start = Math.min(fromIndex, toIndex);
    const end = Math.max(fromIndex, toIndex);
    const rangeIds = orderedIds.slice(start, end + 1);

    set({
      selectedIds: new Set(rangeIds),
      primaryId: toId,
      primaryName: nodes[toId]?.name ?? null,
    });

    // Send command to Rust
    if (dispatchCommand) {
      dispatchCommand('select_entities', { entityIds: rangeIds, mode: 'replace' });
    }
  },

  clearSelection: () => {
    set({
      selectedIds: new Set(),
      primaryId: null,
      primaryName: null,
    });

    // Send command to Rust
    if (dispatchCommand) {
      dispatchCommand('clear_selection', {});
    }
  },

  setSelection: (selectedIds, primaryId, primaryName) => {
    set({
      selectedIds: new Set(selectedIds),
      primaryId,
      primaryName,
    });
  },

  setHierarchyFilter: (filter) => {
    set({ hierarchyFilter: filter });
  },

  clearHierarchyFilter: () => {
    set({ hierarchyFilter: '' });
  },
});
