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

export const createHistorySlice: StateCreator<
  HistorySlice,
  [],
  [],
  HistorySlice
> = (set) => ({
  // Initial state
  canUndo: false,
  canRedo: false,
  undoDescription: null,
  redoDescription: null,

  // Actions
  undo: () => {
    if (dispatchCommand) {
      dispatchCommand('undo', {});
    }
  },

  redo: () => {
    if (dispatchCommand) {
      dispatchCommand('redo', {});
    }
  },

  setHistoryState: (canUndo, canRedo, undoDescription, redoDescription) => {
    set({ canUndo, canRedo, undoDescription, redoDescription });
  },
});
