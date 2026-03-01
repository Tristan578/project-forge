import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createSliceStore, createMockDispatch } from './sliceTestTemplate';
import { createSelectionSlice, setSelectionDispatcher, type SelectionSlice } from '../selectionSlice';
import type { SceneGraph } from '../types';

// Selection slice depends on sceneGraph, so we compose both
type TestState = SelectionSlice & { sceneGraph: SceneGraph };

function createTestStore() {
  const mockGraph: SceneGraph = {
    nodes: {
      'cam-1': { entityId: 'cam-1', name: 'Camera', parentId: null, children: [], components: [], visible: true },
      'cube-1': { entityId: 'cube-1', name: 'Cube', parentId: null, children: ['sphere-1'], components: [], visible: true },
      'sphere-1': { entityId: 'sphere-1', name: 'Sphere', parentId: 'cube-1', children: [], components: [], visible: true },
      'light-1': { entityId: 'light-1', name: 'Light', parentId: null, children: [], components: [], visible: true },
    },
    rootIds: ['cam-1', 'cube-1', 'light-1'],
  };

  return createSliceStore<TestState>((set, get, api) => ({
    ...createSelectionSlice(set, get, api),
    sceneGraph: mockGraph,
  }));
}

describe('selectionSlice', () => {
  let store: ReturnType<typeof createTestStore>;
  let mockDispatch: ReturnType<typeof createMockDispatch>;

  beforeEach(() => {
    mockDispatch = createMockDispatch();
    setSelectionDispatcher(mockDispatch);
    store = createTestStore();
  });

  afterEach(() => {
    setSelectionDispatcher(null as unknown as (command: string, payload: unknown) => void);
  });

  describe('Initial state', () => {
    it('should have empty selection', () => {
      expect(store.getState().selectedIds.size).toBe(0);
      expect(store.getState().primaryId).toBeNull();
      expect(store.getState().primaryName).toBeNull();
      expect(store.getState().hierarchyFilter).toBe('');
    });
  });

  describe('selectEntity', () => {
    it('should replace selection', () => {
      store.getState().selectEntity('cube-1', 'replace');

      expect(store.getState().selectedIds.size).toBe(1);
      expect(store.getState().selectedIds.has('cube-1')).toBe(true);
      expect(store.getState().primaryId).toBe('cube-1');
      expect(store.getState().primaryName).toBe('Cube');
    });

    it('should add to selection', () => {
      store.getState().selectEntity('cube-1', 'replace');
      store.getState().selectEntity('light-1', 'add');

      expect(store.getState().selectedIds.size).toBe(2);
      expect(store.getState().selectedIds.has('cube-1')).toBe(true);
      expect(store.getState().selectedIds.has('light-1')).toBe(true);
      expect(store.getState().primaryId).toBe('light-1');
    });

    it('should toggle selection on', () => {
      store.getState().selectEntity('cube-1', 'toggle');

      expect(store.getState().selectedIds.has('cube-1')).toBe(true);
      expect(store.getState().primaryId).toBe('cube-1');
    });

    it('should toggle selection off', () => {
      store.getState().selectEntity('cube-1', 'replace');
      store.getState().selectEntity('light-1', 'add');
      store.getState().selectEntity('cube-1', 'toggle');

      expect(store.getState().selectedIds.has('cube-1')).toBe(false);
      expect(store.getState().selectedIds.has('light-1')).toBe(true);
    });

    it('should update primary when toggling off primary', () => {
      store.getState().selectEntity('cube-1', 'replace');
      store.getState().selectEntity('light-1', 'add');
      // Primary is light-1, toggle it off
      store.getState().selectEntity('light-1', 'toggle');

      // Primary should move to remaining item
      expect(store.getState().selectedIds.has('light-1')).toBe(false);
      expect(store.getState().primaryId).toBe('cube-1');
    });

    it('should dispatch select_entity command', () => {
      store.getState().selectEntity('cube-1', 'replace');
      expect(mockDispatch).toHaveBeenCalledWith('select_entity', { entityId: 'cube-1', mode: 'replace' });
    });

    it('should resolve name from sceneGraph', () => {
      store.getState().selectEntity('sphere-1', 'replace');
      expect(store.getState().primaryName).toBe('Sphere');
    });
  });

  describe('selectRange', () => {
    it('should select range of entities in tree order', () => {
      store.getState().selectRange('cam-1', 'light-1');

      // cam-1, cube-1, sphere-1 (child), light-1
      expect(store.getState().selectedIds.size).toBe(4);
      expect(store.getState().primaryId).toBe('light-1');
    });

    it('should select range in reverse order', () => {
      store.getState().selectRange('light-1', 'cam-1');

      expect(store.getState().selectedIds.size).toBe(4);
      expect(store.getState().primaryId).toBe('cam-1');
    });

    it('should select single entity when from === to', () => {
      store.getState().selectRange('cube-1', 'cube-1');

      expect(store.getState().selectedIds.size).toBe(1);
      expect(store.getState().selectedIds.has('cube-1')).toBe(true);
    });

    it('should do nothing for unknown entity IDs', () => {
      store.getState().selectRange('unknown-1', 'cube-1');
      expect(store.getState().selectedIds.size).toBe(0);
    });

    it('should dispatch select_entities command', () => {
      store.getState().selectRange('cam-1', 'cube-1');
      expect(mockDispatch).toHaveBeenCalledWith('select_entities', expect.objectContaining({ mode: 'replace' }));
    });
  });

  describe('clearSelection', () => {
    it('should clear all selection state', () => {
      store.getState().selectEntity('cube-1', 'replace');
      store.getState().clearSelection();

      expect(store.getState().selectedIds.size).toBe(0);
      expect(store.getState().primaryId).toBeNull();
      expect(store.getState().primaryName).toBeNull();
    });

    it('should dispatch clear_selection', () => {
      store.getState().clearSelection();
      expect(mockDispatch).toHaveBeenCalledWith('clear_selection', {});
    });
  });

  describe('setSelection', () => {
    it('should set selection without dispatching', () => {
      store.getState().setSelection(['cube-1', 'light-1'], 'cube-1', 'Cube');

      expect(store.getState().selectedIds.size).toBe(2);
      expect(store.getState().primaryId).toBe('cube-1');
      expect(store.getState().primaryName).toBe('Cube');
      // setSelection does NOT dispatch
      expect(mockDispatch).not.toHaveBeenCalled();
    });
  });

  describe('hierarchyFilter', () => {
    it('should set hierarchy filter', () => {
      store.getState().setHierarchyFilter('cube');
      expect(store.getState().hierarchyFilter).toBe('cube');
    });

    it('should clear hierarchy filter', () => {
      store.getState().setHierarchyFilter('cube');
      store.getState().clearHierarchyFilter();
      expect(store.getState().hierarchyFilter).toBe('');
    });
  });
});
