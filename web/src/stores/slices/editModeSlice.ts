/**
 * Edit mode store slice for polygon modeling.
 */

import type { StateCreator } from 'zustand';

export type SelectionMode = 'vertex' | 'edge' | 'face';

export interface EditModeState {
  editModeActive: boolean;
  editModeEntityId: string | null;
  selectionMode: SelectionMode;
  selectedIndices: number[];
  wireframeVisible: boolean;
  xrayMode: boolean;
  vertexCount: number;
  edgeCount: number;
  faceCount: number;
}

export interface EditModeActions {
  enterEditMode: (entityId: string) => void;
  exitEditMode: () => void;
  setSelectionMode: (mode: SelectionMode) => void;
  selectElements: (indices: number[]) => void;
  performMeshOperation: (operation: string, params: Record<string, unknown>) => void;
  recalcNormals: (smooth: boolean) => void;
  setEditModeState: (state: Partial<EditModeState>) => void;
  toggleWireframe: () => void;
  toggleXray: () => void;
}

export type EditModeSlice = EditModeState & EditModeActions;

let editModeDispatch: ((command: string, payload: unknown) => void) | null = null;

export function setEditModeDispatcher(fn: (command: string, payload: unknown) => void) {
  editModeDispatch = fn;
}

export const createEditModeSlice: StateCreator<EditModeSlice, [], [], EditModeSlice> = (set, get) => ({
  // Initial state
  editModeActive: false,
  editModeEntityId: null,
  selectionMode: 'face',
  selectedIndices: [],
  wireframeVisible: true,
  xrayMode: false,
  vertexCount: 0,
  edgeCount: 0,
  faceCount: 0,

  // Actions
  enterEditMode: (entityId) => {
    set({ editModeActive: true, editModeEntityId: entityId, selectedIndices: [] });
    editModeDispatch?.('enter_edit_mode', { entityId });
  },

  exitEditMode: () => {
    const entityId = get().editModeEntityId;
    set({ editModeActive: false, editModeEntityId: null, selectedIndices: [] });
    if (entityId) {
      editModeDispatch?.('exit_edit_mode', { entityId });
    }
  },

  setSelectionMode: (mode) => {
    set({ selectionMode: mode, selectedIndices: [] });
    const entityId = get().editModeEntityId;
    if (entityId) {
      editModeDispatch?.('set_selection_mode', { entityId, mode });
    }
  },

  selectElements: (indices) => {
    set({ selectedIndices: indices });
    const entityId = get().editModeEntityId;
    if (entityId) {
      editModeDispatch?.('select_elements', { entityId, indices });
    }
  },

  performMeshOperation: (operation, params) => {
    const entityId = get().editModeEntityId;
    if (entityId) {
      editModeDispatch?.('mesh_operation', { entityId, operation, params: JSON.stringify(params) });
    }
  },

  recalcNormals: (smooth) => {
    const entityId = get().editModeEntityId;
    if (entityId) {
      editModeDispatch?.('recalc_normals', { entityId, smooth });
    }
  },

  setEditModeState: (state) => set(state),

  toggleWireframe: () => {
    const prev = get().wireframeVisible;
    set({ wireframeVisible: !prev });
  },

  toggleXray: () => {
    const prev = get().xrayMode;
    set({ xrayMode: !prev });
  },
});
