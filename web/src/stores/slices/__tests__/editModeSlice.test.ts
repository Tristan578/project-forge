import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createSliceStore, createMockDispatch } from './sliceTestTemplate';
import { createEditModeSlice, setEditModeDispatcher, type EditModeSlice } from '../editModeSlice';

describe('editModeSlice', () => {
  let store: ReturnType<typeof createSliceStore<EditModeSlice>>;
  let mockDispatch: ReturnType<typeof createMockDispatch>;

  beforeEach(() => {
    mockDispatch = createMockDispatch();
    setEditModeDispatcher(mockDispatch);
    store = createSliceStore(createEditModeSlice);
  });

  afterEach(() => {
    setEditModeDispatcher(null as unknown as (command: string, payload: unknown) => void);
  });

  describe('Initial state', () => {
    it('should start inactive', () => {
      expect(store.getState().editModeActive).toBe(false);
      expect(store.getState().editModeEntityId).toBeNull();
      expect(store.getState().selectionMode).toBe('face');
      expect(store.getState().selectedIndices).toEqual([]);
      expect(store.getState().wireframeVisible).toBe(true);
      expect(store.getState().xrayMode).toBe(false);
    });
  });

  describe('enterEditMode / exitEditMode', () => {
    it('should enter edit mode for entity', () => {
      store.getState().enterEditMode('mesh-1');

      expect(store.getState().editModeActive).toBe(true);
      expect(store.getState().editModeEntityId).toBe('mesh-1');
      expect(mockDispatch).toHaveBeenCalledWith('enter_edit_mode', { entityId: 'mesh-1' });
    });

    it('should exit edit mode and clear state', () => {
      store.getState().enterEditMode('mesh-1');
      store.getState().selectElements([0, 1, 2]);
      store.getState().exitEditMode();

      expect(store.getState().editModeActive).toBe(false);
      expect(store.getState().editModeEntityId).toBeNull();
      expect(store.getState().selectedIndices).toEqual([]);
      expect(mockDispatch).toHaveBeenCalledWith('exit_edit_mode', { entityId: 'mesh-1' });
    });

    it('should not dispatch exit if no entity was in edit mode', () => {
      store.getState().exitEditMode();
      expect(mockDispatch).not.toHaveBeenCalledWith('exit_edit_mode', expect.anything());
    });
  });

  describe('setSelectionMode', () => {
    it('should change selection mode and clear indices', () => {
      store.getState().enterEditMode('mesh-1');
      store.getState().selectElements([0, 1]);
      store.getState().setSelectionMode('vertex');

      expect(store.getState().selectionMode).toBe('vertex');
      expect(store.getState().selectedIndices).toEqual([]);
    });

    it('should dispatch when entity is active', () => {
      store.getState().enterEditMode('mesh-1');
      store.getState().setSelectionMode('edge');

      expect(mockDispatch).toHaveBeenCalledWith('set_selection_mode', { entityId: 'mesh-1', mode: 'edge' });
    });
  });

  describe('selectElements', () => {
    it('should set selected indices', () => {
      store.getState().enterEditMode('mesh-1');
      store.getState().selectElements([3, 7, 12]);

      expect(store.getState().selectedIndices).toEqual([3, 7, 12]);
    });

    it('should dispatch with entity ID', () => {
      store.getState().enterEditMode('mesh-1');
      store.getState().selectElements([0]);

      expect(mockDispatch).toHaveBeenCalledWith('select_elements', { entityId: 'mesh-1', indices: [0] });
    });
  });

  describe('performMeshOperation', () => {
    it('should dispatch mesh operation with serialized params', () => {
      store.getState().enterEditMode('mesh-1');
      store.getState().performMeshOperation('extrude', { distance: 1.5 });

      expect(mockDispatch).toHaveBeenCalledWith('mesh_operation', {
        entityId: 'mesh-1',
        operation: 'extrude',
        params: JSON.stringify({ distance: 1.5 }),
      });
    });

    it('should not dispatch without active entity', () => {
      store.getState().performMeshOperation('extrude', { distance: 1 });
      expect(mockDispatch).not.toHaveBeenCalledWith('mesh_operation', expect.anything());
    });
  });

  describe('recalcNormals', () => {
    it('should dispatch recalc_normals', () => {
      store.getState().enterEditMode('mesh-1');
      store.getState().recalcNormals(true);

      expect(mockDispatch).toHaveBeenCalledWith('recalc_normals', { entityId: 'mesh-1', smooth: true });
    });
  });

  describe('toggleWireframe / toggleXray', () => {
    it('should toggle wireframe off', () => {
      expect(store.getState().wireframeVisible).toBe(true);
      store.getState().toggleWireframe();
      expect(store.getState().wireframeVisible).toBe(false);
    });

    it('should toggle wireframe back on', () => {
      store.getState().toggleWireframe();
      store.getState().toggleWireframe();
      expect(store.getState().wireframeVisible).toBe(true);
    });

    it('should toggle xray on', () => {
      expect(store.getState().xrayMode).toBe(false);
      store.getState().toggleXray();
      expect(store.getState().xrayMode).toBe(true);
    });
  });

  describe('setEditModeState', () => {
    it('should merge partial state', () => {
      store.getState().setEditModeState({ vertexCount: 100, edgeCount: 150, faceCount: 50 });

      expect(store.getState().vertexCount).toBe(100);
      expect(store.getState().edgeCount).toBe(150);
      expect(store.getState().faceCount).toBe(50);
    });
  });
});
