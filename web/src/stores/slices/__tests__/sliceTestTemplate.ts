/**
 * Domain slice test utilities.
 * Creates standalone Zustand stores from individual slices for isolated testing.
 */
import { create } from 'zustand';
import { vi } from 'vitest';

/**
 * Creates an isolated Zustand store from a single slice creator.
 * The store only contains that slice's state and actions — no cross-slice deps.
 */
export function createSliceStore<T extends object>(
  sliceCreator: import('zustand').StateCreator<T, [], [], T>
): import('zustand').StoreApi<T> {
  return create<T>()(sliceCreator);
}

/**
 * Creates a mock command dispatcher (vi.fn) and returns it.
 * Use with the slice's setXxxDispatcher() function.
 */
export function createMockDispatch() {
  return vi.fn() as ReturnType<typeof vi.fn> & ((command: string, payload: unknown) => void);
}
