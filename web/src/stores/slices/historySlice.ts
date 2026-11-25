/**
 * History slice - manages undo/redo state.
 */

import { StateCreator } from 'zustand';

export interface HistorySlice {
  // State
  canUndo: boolean;
  canRedo: boolean;
  undoDescription: string | null;
  redoDescription: string | null;

  // Actions
  undo: () => void;
  redo: () => void;
  setHistoryState: (
    canUndo: boolean,
    canRedo: boolean,
    undoDescription: string | null,
    redoDescription: string | null
  ) => void;
}

// Internal dispatcher reference
let dispatchCommand: ((command: string, payload: unknown) => void) | null = null;

export function setHistoryDispatcher(dispatcher: (command: string, payload: unknown) => void): void {
  dispatchCommand = dispatcher;
}

// The engine labels a quality-profile history entry with this description.
const QUALITY_CHANGE_DESCRIPTION = 'Quality Change';

export const createHistorySlice: StateCreator<
  HistorySlice & { sceneModified: boolean },
  [],
  [],
  HistorySlice
> = (set, get) => ({
  // Initial state
  canUndo: false,
  canRedo: false,
  undoDescription: null,
  redoDescription: null,

  // Actions
  undo: () => {
    // Undoing a quality change emits no scene-node event, so mark the scene
    // modified here or autosave / New Scene would miss the reverted profile.
    if (get().canUndo && get().undoDescription === QUALITY_CHANGE_DESCRIPTION) {
      set({ sceneModified: true });
    }
    if (dispatchCommand) {
      dispatchCommand('undo', {});
    }
  },

  redo: () => {
    if (get().canRedo && get().redoDescription === QUALITY_CHANGE_DESCRIPTION) {
      set({ sceneModified: true });
    }
    if (dispatchCommand) {
      dispatchCommand('redo', {});
    }
  },

  setHistoryState: (canUndo, canRedo, undoDescription, redoDescription) => {
    set({ canUndo, canRedo, undoDescription, redoDescription });
  },
});
