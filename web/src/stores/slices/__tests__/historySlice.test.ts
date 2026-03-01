import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createSliceStore, createMockDispatch } from './sliceTestTemplate';
import { createHistorySlice, setHistoryDispatcher, type HistorySlice } from '../historySlice';

describe('historySlice', () => {
  let store: ReturnType<typeof createSliceStore<HistorySlice>>;
  let mockDispatch: ReturnType<typeof createMockDispatch>;

  beforeEach(() => {
    mockDispatch = createMockDispatch();
    setHistoryDispatcher(mockDispatch);
    store = createSliceStore(createHistorySlice);
  });

  afterEach(() => {
    setHistoryDispatcher(null as unknown as (command: string, payload: unknown) => void);
  });

  describe('Initial state', () => {
    it('should start with no undo/redo available', () => {
      expect(store.getState().canUndo).toBe(false);
      expect(store.getState().canRedo).toBe(false);
      expect(store.getState().undoDescription).toBeNull();
      expect(store.getState().redoDescription).toBeNull();
    });
  });

  describe('undo', () => {
    it('should dispatch undo command', () => {
      store.getState().undo();
      expect(mockDispatch).toHaveBeenCalledWith('undo', {});
    });

    it('should not dispatch without dispatcher', () => {
      setHistoryDispatcher(null as unknown as (command: string, payload: unknown) => void);
      store.getState().undo();
      // Only the beforeEach dispatcher was set; after clearing, no dispatch
      expect(mockDispatch).not.toHaveBeenCalledWith('undo', {});
    });
  });

  describe('redo', () => {
    it('should dispatch redo command', () => {
      store.getState().redo();
      expect(mockDispatch).toHaveBeenCalledWith('redo', {});
    });

    it('should not dispatch without dispatcher', () => {
      setHistoryDispatcher(null as unknown as (command: string, payload: unknown) => void);
      store.getState().redo();
      expect(mockDispatch).not.toHaveBeenCalledWith('redo', {});
    });
  });

  describe('setHistoryState', () => {
    it('should update all history state fields', () => {
      store.getState().setHistoryState(true, true, 'Move entity', 'Delete entity');

      expect(store.getState().canUndo).toBe(true);
      expect(store.getState().canRedo).toBe(true);
      expect(store.getState().undoDescription).toBe('Move entity');
      expect(store.getState().redoDescription).toBe('Delete entity');
    });

    it('should clear descriptions with null', () => {
      store.getState().setHistoryState(true, false, 'Move', null);

      expect(store.getState().canUndo).toBe(true);
      expect(store.getState().canRedo).toBe(false);
      expect(store.getState().undoDescription).toBe('Move');
      expect(store.getState().redoDescription).toBeNull();
    });

    it('should reset to initial state', () => {
      store.getState().setHistoryState(true, true, 'A', 'B');
      store.getState().setHistoryState(false, false, null, null);

      expect(store.getState().canUndo).toBe(false);
      expect(store.getState().canRedo).toBe(false);
      expect(store.getState().undoDescription).toBeNull();
      expect(store.getState().redoDescription).toBeNull();
    });
  });
});
