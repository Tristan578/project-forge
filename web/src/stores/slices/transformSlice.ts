/**
 * Transform slice - manages entity transform and gizmo state.
 */

import { StateCreator } from 'zustand';
import type { TransformData, GizmoMode, SnapSettings, CameraPreset, CoordinateMode } from './types';

export interface TransformSlice {
  // State
  gizmoMode: GizmoMode;
  primaryTransform: TransformData | null;
  snapSettings: SnapSettings;
  currentCameraPreset: CameraPreset;
  coordinateMode: CoordinateMode;

  // Actions
  setGizmoMode: (mode: GizmoMode) => void;
  setPrimaryTransform: (transform: TransformData) => void;
  updateTransform: (
    entityId: string,
    field: 'position' | 'rotation' | 'scale',
    value: [number, number, number]
  ) => void;
  setSnapSettings: (settings: Partial<SnapSettings>) => void;
  toggleGrid: () => void;
  setCameraPreset: (preset: 'top' | 'front' | 'right' | 'perspective') => void;
  setCurrentCameraPreset: (preset: CameraPreset) => void;
  setCoordinateMode: (mode: CoordinateMode) => void;
  toggleCoordinateMode: () => void;
}

// Internal dispatcher reference
let dispatchCommand: ((command: string, payload: unknown) => void) | null = null;

export function setTransformDispatcher(dispatcher: (command: string, payload: unknown) => void): void {
  dispatchCommand = dispatcher;
}

export const createTransformSlice: StateCreator<
  TransformSlice,
  [],
  [],
  TransformSlice
> = (set, get) => ({
  // Initial state
  gizmoMode: 'translate',
  primaryTransform: null,
  snapSettings: {
    snapEnabled: false,
    translationSnap: 0.5,
    rotationSnapDegrees: 15,
    scaleSnap: 0.25,
    gridVisible: false,
    gridSize: 0.5,
    gridExtent: 20,
  },
  currentCameraPreset: 'perspective',
  coordinateMode: 'world',

  // Actions
  setGizmoMode: (mode) => {
    set({ gizmoMode: mode });

    // Send command to Rust
    if (dispatchCommand) {
      dispatchCommand('set_gizmo_mode', { mode });
    }
  },

  setPrimaryTransform: (transform) => {
    set({ primaryTransform: transform });
  },

  updateTransform: (entityId, field, value) => {
    const state = get();

    // Optimistically update local state
    if (state.primaryTransform && state.primaryTransform.entityId === entityId) {
      set({
        primaryTransform: {
          ...state.primaryTransform,
          [field]: value,
        },
      });
    }

    // Send command to Rust
    if (dispatchCommand) {
      dispatchCommand('update_transform', {
        entityId,
        [field]: value,
      });
    }
  },

  setSnapSettings: (settings) => {
    const state = get();
    const newSettings = { ...state.snapSettings, ...settings };
    set({ snapSettings: newSettings });

    // Send command to Rust (only changed fields)
    if (dispatchCommand) {
      dispatchCommand('set_snap_settings', settings);
    }
  },

  toggleGrid: () => {
    // Send command to Rust
    if (dispatchCommand) {
      dispatchCommand('toggle_grid', {});
    }
  },

  setCameraPreset: (preset) => {
    set({ currentCameraPreset: preset });

    // Send command to Rust
    if (dispatchCommand) {
      dispatchCommand('set_camera_preset', { preset });
    }
  },

  setCurrentCameraPreset: (preset) => {
    set({ currentCameraPreset: preset });
  },

  setCoordinateMode: (mode) => {
    set({ coordinateMode: mode });

    // Send command to Rust
    if (dispatchCommand) {
      dispatchCommand('set_coordinate_mode', { mode });
    }
  },

  toggleCoordinateMode: () => {
    const state = get();
    const newMode = state.coordinateMode === 'world' ? 'local' : 'world';
    set({ coordinateMode: newMode });

    // Send command to Rust
    if (dispatchCommand) {
      dispatchCommand('set_coordinate_mode', { mode: newMode });
    }
  },
});
