/**
 * Unit tests for the editModeSlice — polygon modeling edit mode.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createEditModeSlice, setEditModeDispatcher, type EditModeSlice } from '../slices/editModeSlice';

function createTestStore() {
  const store = { state: {} as EditModeSlice };
  const set = (partial: Partial<EditModeSlice> | ((s: EditModeSlice) => Partial<EditModeSlice>)) => {
    if (typeof partial === 'function') Object.assign(store.state, partial(store.state));
    else Object.assign(store.state, partial);
  };
  const get = () => store.state;
  store.state = createEditModeSlice(set as never, get as never, {} as never);
  return { getState: () => store.state };
}

describe('editModeSlice', () => {
  let store: ReturnType<typeof createTestStore>;
  let mockDispatch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockDispatch = vi.fn();
    setEditModeDispatcher(mockDispatch as (command: string, payload: unknown) => void);
    store = createTestStore();
  });

  describe('Initial state', () => {
    it('should not be in edit mode', () => {
      expect(store.getState().editModeActive).toBe(false);
    });

    it('should have null entity', () => {
      expect(store.getState().editModeEntityId).toBeNull();
    });

    it('should default to face selection mode', () => {
      expect(store.getState().selectionMode).toBe('face');
    });

    it('should have empty selected indices', () => {
      expect(store.getState().selectedIndices).toEqual([]);
    });

    it('should have wireframe visible by default', () => {
      expect(store.getState().wireframeVisible).toBe(true);
    });

    it('should have xray disabled', () => {
      expect(store.getState().xrayMode).toBe(false);
    });

    it('should have zero mesh stats', () => {
      expect(store.getState().vertexCount).toBe(0);
      expect(store.getState().edgeCount).toBe(0);
      expect(store.getState().faceCount).toBe(0);
    });
  });

  describe('Enter/exit edit mode', () => {
    it('enterEditMode activates and dispatches', () => {
      store.getState().enterEditMode('ent-1');
      expect(store.getState().editModeActive).toBe(true);
      expect(store.getState().editModeEntityId).toBe('ent-1');
      expect(store.getState().selectedIndices).toEqual([]);
      expect(mockDispatch).toHaveBeenCalledWith('enter_edit_mode', { entityId: 'ent-1' });
    });

    it('exitEditMode deactivates and dispatches', () => {
      store.getState().enterEditMode('ent-1');
      mockDispatch.mockClear();
      store.getState().exitEditMode();
      expect(store.getState().editModeActive).toBe(false);
      expect(store.getState().editModeEntityId).toBeNull();
      expect(mockDispatch).toHaveBeenCalledWith('exit_edit_mode', { entityId: 'ent-1' });
    });

    it('exitEditMode without entity does not dispatch', () => {
      store.getState().exitEditMode();
      expect(mockDispatch).not.toHaveBeenCalled();
    });
  });

  describe('Selection mode', () => {
    it('setSelectionMode changes mode and clears indices', () => {
      store.getState().enterEditMode('ent-1');
      store.getState().selectElements([0, 1, 2]);
      mockDispatch.mockClear();

      store.getState().setSelectionMode('vertex');
      expect(store.getState().selectionMode).toBe('vertex');
      expect(store.getState().selectedIndices).toEqual([]);
      expect(mockDispatch).toHaveBeenCalledWith('set_selection_mode', { entityId: 'ent-1', mode: 'vertex' });
    });

    it('selectElements updates indices and dispatches', () => {
      store.getState().enterEditMode('ent-1');
      mockDispatch.mockClear();

      store.getState().selectElements([3, 7, 11]);
      expect(store.getState().selectedIndices).toEqual([3, 7, 11]);
      expect(mockDispatch).toHaveBeenCalledWith('select_elements', { entityId: 'ent-1', indices: [3, 7, 11] });
    });
  });

  describe('Mesh operations', () => {
    it('performMeshOperation dispatches with stringified params', () => {
      store.getState().enterEditMode('ent-1');
      mockDispatch.mockClear();

      store.getState().performMeshOperation('extrude', { distance: 1.5 });
      expect(mockDispatch).toHaveBeenCalledWith('mesh_operation', {
        entityId: 'ent-1',
        operation: 'extrude',
        params: JSON.stringify({ distance: 1.5 }),
      });
    });

    it('performMeshOperation does nothing without entity', () => {
      store.getState().performMeshOperation('subdivide', {});
      expect(mockDispatch).not.toHaveBeenCalled();
    });

    it('recalcNormals dispatches', () => {
      store.getState().enterEditMode('ent-1');
      mockDispatch.mockClear();
      store.getState().recalcNormals(true);
      expect(mockDispatch).toHaveBeenCalledWith('recalc_normals', { entityId: 'ent-1', smooth: true });
    });
  });

  describe('View toggles', () => {
    it('toggleWireframe toggles state', () => {
      expect(store.getState().wireframeVisible).toBe(true);
      store.getState().toggleWireframe();
      expect(store.getState().wireframeVisible).toBe(false);
      store.getState().toggleWireframe();
      expect(store.getState().wireframeVisible).toBe(true);
    });

    it('toggleXray toggles state', () => {
      expect(store.getState().xrayMode).toBe(false);
      store.getState().toggleXray();
      expect(store.getState().xrayMode).toBe(true);
    });
  });

  describe('setEditModeState', () => {
    it('merges partial state', () => {
      store.getState().setEditModeState({ vertexCount: 100, faceCount: 50, edgeCount: 150 });
      expect(store.getState().vertexCount).toBe(100);
      expect(store.getState().faceCount).toBe(50);
      expect(store.getState().edgeCount).toBe(150);
    });
  });

  describe('Dispatcher not set', () => {
    it('does not throw when dispatcher is null', () => {
      setEditModeDispatcher(null as never);
      store = createTestStore();
      expect(() => store.getState().enterEditMode('e')).not.toThrow();
      expect(() => store.getState().exitEditMode()).not.toThrow();
    });
  });
});
