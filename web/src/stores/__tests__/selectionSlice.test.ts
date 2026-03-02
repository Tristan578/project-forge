/**
 * Unit tests for the selectionSlice — entity selection state management.
 *
 * Tests cover: initial state, selectEntity (replace/add/toggle), setSelection,
 * clearSelection, selectRange, hierarchy filter, and dispatch command calls.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createSelectionSlice,
  setSelectionDispatcher,
  type SelectionSlice,
} from '../slices/selectionSlice';
import type { SceneGraph } from '../slices/types';

// The slice requires access to `sceneGraph` from the full store state.
// We extend the test state to include a minimal SceneGraph so that
// node name lookups in selectEntity / selectRange work correctly.
type TestStoreState = SelectionSlice & { sceneGraph: SceneGraph };

function createTestStore(sceneGraph?: SceneGraph) {
  const defaultGraph: SceneGraph = {
    nodes: {},
    rootIds: [],
  };

  const store = { state: null as unknown as TestStoreState };

  const set = (
    partial:
      | Partial<TestStoreState>
      | ((s: TestStoreState) => Partial<TestStoreState>)
  ) => {
    if (typeof partial === 'function') {
      Object.assign(store.state, partial(store.state));
    } else {
      Object.assign(store.state, partial);
    }
  };

  const get = () => store.state;

  const sliceState = createSelectionSlice(set as never, get as never, {} as never);

  store.state = {
    ...sliceState,
    sceneGraph: sceneGraph ?? defaultGraph,
  };

  return { getState: () => store.state };
}

// Build a simple scene graph with named nodes for testing name resolution.
function buildSceneGraph(): SceneGraph {
  return {
    rootIds: ['ent-1', 'ent-2', 'ent-3'],
    nodes: {
      'ent-1': {
        entityId: 'ent-1',
        name: 'Player',
        parentId: null,
        children: ['ent-4'],
        components: [],
        visible: true,
      },
      'ent-2': {
        entityId: 'ent-2',
        name: 'Enemy',
        parentId: null,
        children: [],
        components: [],
        visible: true,
      },
      'ent-3': {
        entityId: 'ent-3',
        name: 'Terrain',
        parentId: null,
        children: [],
        components: [],
        visible: true,
      },
      'ent-4': {
        entityId: 'ent-4',
        name: 'Weapon',
        parentId: 'ent-1',
        children: [],
        components: [],
        visible: true,
      },
    },
  };
}

describe('selectionSlice', () => {
  let store: ReturnType<typeof createTestStore>;
  let mockDispatch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockDispatch = vi.fn();
    setSelectionDispatcher(mockDispatch as (command: string, payload: unknown) => void);
    store = createTestStore(buildSceneGraph());
  });

  // ---------------------------------------------------------------------------
  // Initial state
  // ---------------------------------------------------------------------------

  describe('Initial state', () => {
    it('should have an empty selectedIds set', () => {
      expect(store.getState().selectedIds.size).toBe(0);
    });

    it('should have null primaryId', () => {
      expect(store.getState().primaryId).toBeNull();
    });

    it('should have null primaryName', () => {
      expect(store.getState().primaryName).toBeNull();
    });

    it('should have an empty hierarchyFilter string', () => {
      expect(store.getState().hierarchyFilter).toBe('');
    });
  });

  // ---------------------------------------------------------------------------
  // selectEntity — replace mode
  // ---------------------------------------------------------------------------

  describe('selectEntity (replace mode)', () => {
    it('selects a single entity and sets it as primary', () => {
      store.getState().selectEntity('ent-1', 'replace');
      const state = store.getState();
      expect(state.selectedIds.size).toBe(1);
      expect(state.selectedIds.has('ent-1')).toBe(true);
      expect(state.primaryId).toBe('ent-1');
    });

    it('resolves entity name from sceneGraph', () => {
      store.getState().selectEntity('ent-1', 'replace');
      expect(store.getState().primaryName).toBe('Player');
    });

    it('replaces a previous selection entirely', () => {
      store.getState().selectEntity('ent-1', 'replace');
      store.getState().selectEntity('ent-2', 'replace');
      const state = store.getState();
      expect(state.selectedIds.size).toBe(1);
      expect(state.selectedIds.has('ent-1')).toBe(false);
      expect(state.selectedIds.has('ent-2')).toBe(true);
      expect(state.primaryId).toBe('ent-2');
      expect(state.primaryName).toBe('Enemy');
    });

    it('dispatches select_entity command with replace mode', () => {
      store.getState().selectEntity('ent-1', 'replace');
      expect(mockDispatch).toHaveBeenCalledWith('select_entity', {
        entityId: 'ent-1',
        mode: 'replace',
      });
    });

    it('sets primaryName to null for an unknown entity id', () => {
      store.getState().selectEntity('unknown-99', 'replace');
      expect(store.getState().primaryName).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // selectEntity — add mode
  // ---------------------------------------------------------------------------

  describe('selectEntity (add mode)', () => {
    it('adds an entity to an empty selection', () => {
      store.getState().selectEntity('ent-1', 'add');
      const state = store.getState();
      expect(state.selectedIds.size).toBe(1);
      expect(state.selectedIds.has('ent-1')).toBe(true);
    });

    it('adds a second entity without removing the first', () => {
      store.getState().selectEntity('ent-1', 'replace');
      store.getState().selectEntity('ent-2', 'add');
      const state = store.getState();
      expect(state.selectedIds.size).toBe(2);
      expect(state.selectedIds.has('ent-1')).toBe(true);
      expect(state.selectedIds.has('ent-2')).toBe(true);
    });

    it('updates primaryId to the newly added entity', () => {
      store.getState().selectEntity('ent-1', 'replace');
      store.getState().selectEntity('ent-2', 'add');
      expect(store.getState().primaryId).toBe('ent-2');
      expect(store.getState().primaryName).toBe('Enemy');
    });

    it('dispatches select_entity command with add mode', () => {
      store.getState().selectEntity('ent-2', 'add');
      expect(mockDispatch).toHaveBeenCalledWith('select_entity', {
        entityId: 'ent-2',
        mode: 'add',
      });
    });

    it('adding the same entity again keeps set size at 1', () => {
      store.getState().selectEntity('ent-1', 'replace');
      store.getState().selectEntity('ent-1', 'add');
      expect(store.getState().selectedIds.size).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // selectEntity — toggle mode
  // ---------------------------------------------------------------------------

  describe('selectEntity (toggle mode)', () => {
    it('adds entity when not currently selected', () => {
      store.getState().selectEntity('ent-1', 'toggle');
      const state = store.getState();
      expect(state.selectedIds.has('ent-1')).toBe(true);
      expect(state.primaryId).toBe('ent-1');
    });

    it('removes entity when already selected', () => {
      store.getState().selectEntity('ent-1', 'replace');
      store.getState().selectEntity('ent-1', 'toggle');
      const state = store.getState();
      expect(state.selectedIds.has('ent-1')).toBe(false);
      expect(state.selectedIds.size).toBe(0);
    });

    it('sets primaryId to null when the only selected entity is toggled off', () => {
      store.getState().selectEntity('ent-1', 'replace');
      store.getState().selectEntity('ent-1', 'toggle');
      expect(store.getState().primaryId).toBeNull();
      expect(store.getState().primaryName).toBeNull();
    });

    it('updates primaryId to a remaining entity when primary is toggled off', () => {
      // Start with two entities selected; ent-1 is primary.
      store.getState().selectEntity('ent-1', 'replace');
      store.getState().selectEntity('ent-2', 'add');
      // Toggle ent-2 off — it is the current primary.
      store.getState().selectEntity('ent-2', 'toggle');
      const state = store.getState();
      expect(state.selectedIds.has('ent-2')).toBe(false);
      // primaryId should fall back to ent-1 (the remaining entity).
      expect(state.primaryId).toBe('ent-1');
    });

    it('dispatches select_entity command with toggle mode', () => {
      store.getState().selectEntity('ent-3', 'toggle');
      expect(mockDispatch).toHaveBeenCalledWith('select_entity', {
        entityId: 'ent-3',
        mode: 'toggle',
      });
    });

    it('dispatches even when toggling off', () => {
      store.getState().selectEntity('ent-1', 'replace');
      mockDispatch.mockClear();
      store.getState().selectEntity('ent-1', 'toggle');
      expect(mockDispatch).toHaveBeenCalledWith('select_entity', {
        entityId: 'ent-1',
        mode: 'toggle',
      });
    });
  });

  // ---------------------------------------------------------------------------
  // setSelection
  // ---------------------------------------------------------------------------

  describe('setSelection', () => {
    it('sets selectedIds from the provided array', () => {
      store.getState().setSelection(['ent-1', 'ent-2'], 'ent-1', 'Player');
      const state = store.getState();
      expect(state.selectedIds.size).toBe(2);
      expect(state.selectedIds.has('ent-1')).toBe(true);
      expect(state.selectedIds.has('ent-2')).toBe(true);
    });

    it('sets primaryId and primaryName from arguments', () => {
      store.getState().setSelection(['ent-2'], 'ent-2', 'Enemy');
      expect(store.getState().primaryId).toBe('ent-2');
      expect(store.getState().primaryName).toBe('Enemy');
    });

    it('accepts null for primaryId and primaryName', () => {
      store.getState().setSelection([], null, null);
      expect(store.getState().primaryId).toBeNull();
      expect(store.getState().primaryName).toBeNull();
      expect(store.getState().selectedIds.size).toBe(0);
    });

    it('replaces any previous selection', () => {
      store.getState().selectEntity('ent-1', 'replace');
      store.getState().selectEntity('ent-2', 'add');
      store.getState().setSelection(['ent-3'], 'ent-3', 'Terrain');
      const state = store.getState();
      expect(state.selectedIds.size).toBe(1);
      expect(state.selectedIds.has('ent-3')).toBe(true);
      expect(state.selectedIds.has('ent-1')).toBe(false);
    });

    it('does not dispatch any engine command', () => {
      store.getState().setSelection(['ent-1'], 'ent-1', 'Player');
      expect(mockDispatch).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // clearSelection
  // ---------------------------------------------------------------------------

  describe('clearSelection', () => {
    it('empties selectedIds', () => {
      store.getState().selectEntity('ent-1', 'replace');
      store.getState().selectEntity('ent-2', 'add');
      store.getState().clearSelection();
      expect(store.getState().selectedIds.size).toBe(0);
    });

    it('sets primaryId to null', () => {
      store.getState().selectEntity('ent-1', 'replace');
      store.getState().clearSelection();
      expect(store.getState().primaryId).toBeNull();
    });

    it('sets primaryName to null', () => {
      store.getState().selectEntity('ent-1', 'replace');
      store.getState().clearSelection();
      expect(store.getState().primaryName).toBeNull();
    });

    it('dispatches clear_selection command to the engine', () => {
      store.getState().clearSelection();
      expect(mockDispatch).toHaveBeenCalledWith('clear_selection', {});
    });

    it('dispatches clear_selection even when already empty', () => {
      store.getState().clearSelection();
      expect(mockDispatch).toHaveBeenCalledTimes(1);
    });
  });

  // ---------------------------------------------------------------------------
  // selectRange
  // ---------------------------------------------------------------------------

  describe('selectRange', () => {
    it('selects all entities between two ids in tree order', () => {
      // Tree order from rootIds [ent-1, ent-2, ent-3] + child ent-4:
      // ent-1 -> ent-4 -> ent-2 -> ent-3
      store.getState().selectRange('ent-4', 'ent-2');
      const state = store.getState();
      expect(state.selectedIds.has('ent-4')).toBe(true);
      expect(state.selectedIds.has('ent-2')).toBe(true);
    });

    it('sets primaryId to the toId argument', () => {
      store.getState().selectRange('ent-1', 'ent-3');
      expect(store.getState().primaryId).toBe('ent-3');
    });

    it('sets primaryName from sceneGraph for toId', () => {
      store.getState().selectRange('ent-1', 'ent-3');
      expect(store.getState().primaryName).toBe('Terrain');
    });

    it('handles reversed fromId/toId (min wins)', () => {
      // ent-1 is index 0, ent-3 is index 3 in flattened order — both directions same result
      store.getState().selectRange('ent-3', 'ent-1');
      const state = store.getState();
      expect(state.selectedIds.has('ent-1')).toBe(true);
      expect(state.selectedIds.has('ent-3')).toBe(true);
    });

    it('does nothing when fromId is not in the scene graph', () => {
      store.getState().selectEntity('ent-1', 'replace');
      store.getState().selectRange('nonexistent', 'ent-2');
      // Previous state should be preserved (the implementation returns early)
      // Note: selectRange calls set() even with the new Set when ids are found.
      // When not found it returns early, so selectedIds should remain unchanged.
      expect(store.getState().selectedIds.has('ent-1')).toBe(true);
    });

    it('dispatches select_entities command with all range ids', () => {
      store.getState().selectRange('ent-1', 'ent-1');
      expect(mockDispatch).toHaveBeenCalledWith('select_entities', {
        entityIds: ['ent-1'],
        mode: 'replace',
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Hierarchy filter
  // ---------------------------------------------------------------------------

  describe('Hierarchy filter', () => {
    it('setHierarchyFilter updates the filter string', () => {
      store.getState().setHierarchyFilter('Player');
      expect(store.getState().hierarchyFilter).toBe('Player');
    });

    it('clearHierarchyFilter resets filter to empty string', () => {
      store.getState().setHierarchyFilter('Enemy');
      store.getState().clearHierarchyFilter();
      expect(store.getState().hierarchyFilter).toBe('');
    });

    it('setHierarchyFilter does not dispatch any engine command', () => {
      store.getState().setHierarchyFilter('Terrain');
      expect(mockDispatch).not.toHaveBeenCalled();
    });

    it('clearHierarchyFilter does not dispatch any engine command', () => {
      store.getState().setHierarchyFilter('Weapon');
      mockDispatch.mockClear();
      store.getState().clearHierarchyFilter();
      expect(mockDispatch).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // Dispatcher not set
  // ---------------------------------------------------------------------------

  describe('Dispatcher not set', () => {
    it('does not throw when dispatcher is null for selectEntity', () => {
      setSelectionDispatcher(null as never);
      store = createTestStore(buildSceneGraph());
      expect(() => store.getState().selectEntity('ent-1', 'replace')).not.toThrow();
    });

    it('does not throw when dispatcher is null for clearSelection', () => {
      setSelectionDispatcher(null as never);
      store = createTestStore(buildSceneGraph());
      expect(() => store.getState().clearSelection()).not.toThrow();
    });

    it('state is still updated correctly without a dispatcher', () => {
      setSelectionDispatcher(null as never);
      store = createTestStore(buildSceneGraph());
      store.getState().selectEntity('ent-2', 'replace');
      expect(store.getState().selectedIds.has('ent-2')).toBe(true);
      expect(store.getState().primaryId).toBe('ent-2');
    });
  });
});
