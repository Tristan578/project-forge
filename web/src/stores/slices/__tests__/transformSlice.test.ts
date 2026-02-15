import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createSliceStore, createMockDispatch } from './sliceTestTemplate';
import { createTransformSlice, setTransformDispatcher, type TransformSlice } from '../transformSlice';

describe('transformSlice', () => {
  let store: ReturnType<typeof createSliceStore<TransformSlice>>;
  let mockDispatch: ReturnType<typeof createMockDispatch>;

  beforeEach(() => {
    store = createSliceStore(createTransformSlice);
    mockDispatch = createMockDispatch();
    setTransformDispatcher(mockDispatch);
  });

  afterEach(() => {
    setTransformDispatcher(null as unknown as (command: string, payload: unknown) => void);
  });

  describe('Initial State', () => {
    it('should initialize with translate gizmo mode', () => {
      expect(store.getState().gizmoMode).toBe('translate');
    });

    it('should initialize with null primary transform', () => {
      expect(store.getState().primaryTransform).toBeNull();
    });

    it('should initialize with default snap settings', () => {
      const { snapSettings } = store.getState();
      expect(snapSettings).toEqual({
        snapEnabled: false,
        translationSnap: 0.5,
        rotationSnapDegrees: 15,
        scaleSnap: 0.25,
        gridVisible: false,
        gridSize: 0.5,
        gridExtent: 20,
      });
    });

    it('should initialize with perspective camera preset', () => {
      expect(store.getState().currentCameraPreset).toBe('perspective');
    });

    it('should initialize with world coordinate mode', () => {
      expect(store.getState().coordinateMode).toBe('world');
    });
  });

  describe('Gizmo Mode', () => {
    it('should update gizmo mode and dispatch command', () => {
      store.getState().setGizmoMode('rotate');
      expect(store.getState().gizmoMode).toBe('rotate');
      expect(mockDispatch).toHaveBeenCalledWith('set_gizmo_mode', { mode: 'rotate' });
    });

    it('should handle all gizmo modes', () => {
      store.getState().setGizmoMode('scale');
      expect(store.getState().gizmoMode).toBe('scale');
      expect(mockDispatch).toHaveBeenCalledWith('set_gizmo_mode', { mode: 'scale' });

      store.getState().setGizmoMode('translate');
      expect(store.getState().gizmoMode).toBe('translate');
      expect(mockDispatch).toHaveBeenCalledWith('set_gizmo_mode', { mode: 'translate' });
    });
  });

  describe('Primary Transform', () => {
    it('should update primary transform without dispatching', () => {
      const transform = {
        entityId: 'entity1',
        position: [1, 2, 3] as [number, number, number],
        rotation: [0, 45, 0] as [number, number, number],
        scale: [1, 1, 1] as [number, number, number],
      };

      store.getState().setPrimaryTransform(transform);
      expect(store.getState().primaryTransform).toEqual(transform);
      expect(mockDispatch).not.toHaveBeenCalled();
    });
  });

  describe('Update Transform', () => {
    it('should optimistically update primary transform when entity matches', () => {
      const transform = {
        entityId: 'entity1',
        position: [0, 0, 0] as [number, number, number],
        rotation: [0, 0, 0] as [number, number, number],
        scale: [1, 1, 1] as [number, number, number],
      };

      store.getState().setPrimaryTransform(transform);
      store.getState().updateTransform('entity1', 'position', [5, 10, 15]);

      const updated = store.getState().primaryTransform;
      expect(updated?.position).toEqual([5, 10, 15]);
      expect(mockDispatch).toHaveBeenCalledWith('update_transform', {
        entityId: 'entity1',
        position: [5, 10, 15],
      });
    });

    it('should dispatch but not update when entity does not match', () => {
      const transform = {
        entityId: 'entity1',
        position: [0, 0, 0] as [number, number, number],
        rotation: [0, 0, 0] as [number, number, number],
        scale: [1, 1, 1] as [number, number, number],
      };

      store.getState().setPrimaryTransform(transform);
      store.getState().updateTransform('entity2', 'position', [5, 10, 15]);

      const unchanged = store.getState().primaryTransform;
      expect(unchanged?.position).toEqual([0, 0, 0]);
      expect(mockDispatch).toHaveBeenCalledWith('update_transform', {
        entityId: 'entity2',
        position: [5, 10, 15],
      });
    });

    it('should handle updates to different transform fields', () => {
      const transform = {
        entityId: 'entity1',
        position: [0, 0, 0] as [number, number, number],
        rotation: [0, 0, 0] as [number, number, number],
        scale: [1, 1, 1] as [number, number, number],
      };

      store.getState().setPrimaryTransform(transform);

      store.getState().updateTransform('entity1', 'rotation', [90, 45, 0]);
      expect(store.getState().primaryTransform?.rotation).toEqual([90, 45, 0]);
      expect(mockDispatch).toHaveBeenCalledWith('update_transform', {
        entityId: 'entity1',
        rotation: [90, 45, 0],
      });

      store.getState().updateTransform('entity1', 'scale', [2, 2, 2]);
      expect(store.getState().primaryTransform?.scale).toEqual([2, 2, 2]);
      expect(mockDispatch).toHaveBeenCalledWith('update_transform', {
        entityId: 'entity1',
        scale: [2, 2, 2],
      });
    });
  });

  describe('Snap Settings', () => {
    it('should merge partial snap settings and dispatch partial', () => {
      store.getState().setSnapSettings({ snapEnabled: true, translationSnap: 1.0 });

      const settings = store.getState().snapSettings;
      expect(settings.snapEnabled).toBe(true);
      expect(settings.translationSnap).toBe(1.0);
      expect(settings.rotationSnapDegrees).toBe(15); // unchanged
      expect(settings.gridVisible).toBe(false); // unchanged

      expect(mockDispatch).toHaveBeenCalledWith('set_snap_settings', {
        snapEnabled: true,
        translationSnap: 1.0,
      });
    });

    it('should handle multiple partial updates', () => {
      store.getState().setSnapSettings({ gridVisible: true });
      expect(store.getState().snapSettings.gridVisible).toBe(true);
      expect(mockDispatch).toHaveBeenCalledWith('set_snap_settings', { gridVisible: true });

      store.getState().setSnapSettings({ gridSize: 2.0, gridExtent: 50 });
      expect(store.getState().snapSettings.gridSize).toBe(2.0);
      expect(store.getState().snapSettings.gridExtent).toBe(50);
      expect(mockDispatch).toHaveBeenCalledWith('set_snap_settings', {
        gridSize: 2.0,
        gridExtent: 50,
      });
    });
  });

  describe('Toggle Grid', () => {
    it('should dispatch toggle_grid without changing state', () => {
      const initialSettings = store.getState().snapSettings;

      store.getState().toggleGrid();

      expect(store.getState().snapSettings).toEqual(initialSettings);
      expect(mockDispatch).toHaveBeenCalledWith('toggle_grid', {});
    });
  });

  describe('Camera Preset', () => {
    it('should update camera preset and dispatch command', () => {
      store.getState().setCameraPreset('top');
      expect(store.getState().currentCameraPreset).toBe('top');
      expect(mockDispatch).toHaveBeenCalledWith('set_camera_preset', { preset: 'top' });
    });

    it('should update current camera preset without dispatching', () => {
      store.getState().setCurrentCameraPreset('front');
      expect(store.getState().currentCameraPreset).toBe('front');
      expect(mockDispatch).not.toHaveBeenCalled();
    });
  });

  describe('Coordinate Mode', () => {
    it('should update coordinate mode and dispatch command', () => {
      store.getState().setCoordinateMode('local');
      expect(store.getState().coordinateMode).toBe('local');
      expect(mockDispatch).toHaveBeenCalledWith('set_coordinate_mode', { mode: 'local' });
    });

    it('should toggle coordinate mode from world to local', () => {
      expect(store.getState().coordinateMode).toBe('world');

      store.getState().toggleCoordinateMode();

      expect(store.getState().coordinateMode).toBe('local');
      expect(mockDispatch).toHaveBeenCalledWith('set_coordinate_mode', { mode: 'local' });
    });

    it('should toggle coordinate mode from local to world', () => {
      store.getState().setCoordinateMode('local');
      mockDispatch.mockClear();

      store.getState().toggleCoordinateMode();

      expect(store.getState().coordinateMode).toBe('world');
      expect(mockDispatch).toHaveBeenCalledWith('set_coordinate_mode', { mode: 'world' });
    });
  });
});
