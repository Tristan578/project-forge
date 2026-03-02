/**
 * Unit tests for the transformSlice — gizmo, transforms, snap, camera, coordinates.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTransformSlice, setTransformDispatcher, type TransformSlice } from '../slices/transformSlice';

function createTestStore() {
  const store = { state: {} as TransformSlice };
  const set = (partial: Partial<TransformSlice> | ((s: TransformSlice) => Partial<TransformSlice>)) => {
    if (typeof partial === 'function') Object.assign(store.state, partial(store.state));
    else Object.assign(store.state, partial);
  };
  const get = () => store.state;
  store.state = createTransformSlice(set as never, get as never, {} as never);
  return { getState: () => store.state };
}

describe('transformSlice', () => {
  let store: ReturnType<typeof createTestStore>;
  let mockDispatch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockDispatch = vi.fn();
    setTransformDispatcher(mockDispatch as (command: string, payload: unknown) => void);
    store = createTestStore();
  });

  describe('Initial state', () => {
    it('should have translate gizmo mode', () => {
      expect(store.getState().gizmoMode).toBe('translate');
    });

    it('should have null primary transform', () => {
      expect(store.getState().primaryTransform).toBeNull();
    });

    it('should have default snap settings', () => {
      const snap = store.getState().snapSettings;
      expect(snap.snapEnabled).toBe(false);
      expect(snap.translationSnap).toBe(0.5);
      expect(snap.rotationSnapDegrees).toBe(15);
      expect(snap.scaleSnap).toBe(0.25);
      expect(snap.gridVisible).toBe(false);
    });

    it('should have perspective camera preset', () => {
      expect(store.getState().currentCameraPreset).toBe('perspective');
    });

    it('should have world coordinate mode', () => {
      expect(store.getState().coordinateMode).toBe('world');
    });
  });

  describe('Gizmo mode', () => {
    it('setGizmoMode updates state and dispatches', () => {
      store.getState().setGizmoMode('rotate');
      expect(store.getState().gizmoMode).toBe('rotate');
      expect(mockDispatch).toHaveBeenCalledWith('set_gizmo_mode', { mode: 'rotate' });
    });

    it('setGizmoMode to scale', () => {
      store.getState().setGizmoMode('scale');
      expect(store.getState().gizmoMode).toBe('scale');
    });
  });

  describe('Transform updates', () => {
    it('setPrimaryTransform sets without dispatch', () => {
      const t = { entityId: 'ent-1', position: [0, 1, 2] as [number, number, number], rotation: [0, 0, 0] as [number, number, number], scale: [1, 1, 1] as [number, number, number] };
      store.getState().setPrimaryTransform(t);
      expect(store.getState().primaryTransform).toEqual(t);
      expect(mockDispatch).not.toHaveBeenCalled();
    });

    it('updateTransform dispatches and updates local state', () => {
      const t = { entityId: 'ent-1', position: [0, 0, 0] as [number, number, number], rotation: [0, 0, 0] as [number, number, number], scale: [1, 1, 1] as [number, number, number] };
      store.getState().setPrimaryTransform(t);
      mockDispatch.mockClear();

      store.getState().updateTransform('ent-1', 'position', [5, 10, 15]);
      expect(store.getState().primaryTransform?.position).toEqual([5, 10, 15]);
      expect(mockDispatch).toHaveBeenCalledWith('update_transform', { entityId: 'ent-1', position: [5, 10, 15] });
    });

    it('updateTransform does not update local state for different entity', () => {
      const t = { entityId: 'ent-1', position: [0, 0, 0] as [number, number, number], rotation: [0, 0, 0] as [number, number, number], scale: [1, 1, 1] as [number, number, number] };
      store.getState().setPrimaryTransform(t);
      mockDispatch.mockClear();

      store.getState().updateTransform('ent-2', 'position', [5, 10, 15]);
      expect(store.getState().primaryTransform?.position).toEqual([0, 0, 0]); // unchanged
      expect(mockDispatch).toHaveBeenCalledWith('update_transform', { entityId: 'ent-2', position: [5, 10, 15] });
    });
  });

  describe('Snap settings', () => {
    it('setSnapSettings merges and dispatches', () => {
      store.getState().setSnapSettings({ snapEnabled: true, translationSnap: 1.0 });
      expect(store.getState().snapSettings.snapEnabled).toBe(true);
      expect(store.getState().snapSettings.translationSnap).toBe(1.0);
      expect(store.getState().snapSettings.rotationSnapDegrees).toBe(15); // unchanged
      expect(mockDispatch).toHaveBeenCalledWith('set_snap_settings', { snapEnabled: true, translationSnap: 1.0 });
    });

    it('toggleGrid dispatches', () => {
      store.getState().toggleGrid();
      expect(mockDispatch).toHaveBeenCalledWith('toggle_grid', {});
    });
  });

  describe('Camera preset', () => {
    it('setCameraPreset updates and dispatches', () => {
      store.getState().setCameraPreset('top');
      expect(store.getState().currentCameraPreset).toBe('top');
      expect(mockDispatch).toHaveBeenCalledWith('set_camera_preset', { preset: 'top' });
    });

    it('setCurrentCameraPreset sets without dispatch', () => {
      store.getState().setCurrentCameraPreset('front');
      expect(store.getState().currentCameraPreset).toBe('front');
      expect(mockDispatch).not.toHaveBeenCalled();
    });
  });

  describe('Coordinate mode', () => {
    it('setCoordinateMode updates and dispatches', () => {
      store.getState().setCoordinateMode('local');
      expect(store.getState().coordinateMode).toBe('local');
      expect(mockDispatch).toHaveBeenCalledWith('set_coordinate_mode', { mode: 'local' });
    });

    it('toggleCoordinateMode toggles world to local', () => {
      store.getState().toggleCoordinateMode();
      expect(store.getState().coordinateMode).toBe('local');
      expect(mockDispatch).toHaveBeenCalledWith('set_coordinate_mode', { mode: 'local' });
    });

    it('toggleCoordinateMode toggles local to world', () => {
      store.getState().setCoordinateMode('local');
      mockDispatch.mockClear();
      store.getState().toggleCoordinateMode();
      expect(store.getState().coordinateMode).toBe('world');
      expect(mockDispatch).toHaveBeenCalledWith('set_coordinate_mode', { mode: 'world' });
    });
  });

  describe('Dispatcher not set', () => {
    it('does not throw when dispatcher is null', () => {
      setTransformDispatcher(null as never);
      store = createTestStore();
      expect(() => store.getState().setGizmoMode('rotate')).not.toThrow();
      expect(() => store.getState().setCameraPreset('top')).not.toThrow();
    });
  });
});
