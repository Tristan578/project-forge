/**
 * Unit tests for the historySlice — undo/redo state management.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createHistorySlice, setHistoryDispatcher, type HistorySlice } from '../slices/historySlice';

function createTestStore() {
  const store = { state: {} as HistorySlice };
  const set = (partial: Partial<HistorySlice> | ((s: HistorySlice) => Partial<HistorySlice>)) => {
    if (typeof partial === 'function') Object.assign(store.state, partial(store.state));
    else Object.assign(store.state, partial);
  };
  const get = () => store.state;
  store.state = createHistorySlice(set as never, get as never, {} as never);
  return { getState: () => store.state };
}

describe('historySlice', () => {
  let store: ReturnType<typeof createTestStore>;
  let mockDispatch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockDispatch = vi.fn();
    setHistoryDispatcher(mockDispatch as (command: string, payload: unknown) => void);
    store = createTestStore();
  });

  describe('Initial state', () => {
    it('should not be able to undo', () => {
      expect(store.getState().canUndo).toBe(false);
    });

    it('should not be able to redo', () => {
      expect(store.getState().canRedo).toBe(false);
    });

    it('should have null descriptions', () => {
      expect(store.getState().undoDescription).toBeNull();
      expect(store.getState().redoDescription).toBeNull();
    });
  });

  describe('Undo/Redo commands', () => {
    it('undo dispatches command', () => {
      store.getState().undo();
      expect(mockDispatch).toHaveBeenCalledWith('undo', {});
    });

    it('redo dispatches command', () => {
      store.getState().redo();
      expect(mockDispatch).toHaveBeenCalledWith('redo', {});
    });
  });

  describe('setHistoryState', () => {
    it('updates all fields', () => {
      store.getState().setHistoryState(true, true, 'Move entity', 'Rename entity');
      expect(store.getState().canUndo).toBe(true);
      expect(store.getState().canRedo).toBe(true);
      expect(store.getState().undoDescription).toBe('Move entity');
      expect(store.getState().redoDescription).toBe('Rename entity');
    });

    it('accepts null descriptions', () => {
      store.getState().setHistoryState(true, false, null, null);
      expect(store.getState().canUndo).toBe(true);
      expect(store.getState().canRedo).toBe(false);
      expect(store.getState().undoDescription).toBeNull();
      expect(store.getState().redoDescription).toBeNull();
    });

    it('does not dispatch', () => {
      store.getState().setHistoryState(true, true, 'a', 'b');
      expect(mockDispatch).not.toHaveBeenCalled();
    });
  });

  describe('Dispatcher not set', () => {
    it('does not throw when dispatcher is null', () => {
      setHistoryDispatcher(null as never);
      store = createTestStore();
      expect(() => store.getState().undo()).not.toThrow();
      expect(() => store.getState().redo()).not.toThrow();
    });
  });
});
