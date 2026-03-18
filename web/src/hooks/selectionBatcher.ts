/**
 * SelectionEventBatcher
 *
 * When a user selects an entity, the Rust bridge emits a SELECTION_CHANGED
 * event followed by up to 15 component-data events (material, physics, audio,
 * etc.) — all within the same synchronous execution tick. Each call crosses the
 * WASM-JS boundary, which acts as a microtask boundary in V8, breaking React 19
 * automatic batching.
 *
 * This module coalesces rapid SELECTION_CHANGED events into a single store
 * update using queueMicrotask. The last payload received before the microtask
 * fires wins (it always contains the complete, up-to-date selection state).
 */

export interface SelectionPayload {
  selectedIds: string[];
  primaryId: string | null;
  primaryName: string | null;
}

type SelectionHandler = (payload: SelectionPayload) => void;

/**
 * Creates a selection event batcher for a given handler function.
 *
 * Returns a `batch` function that should be called for each incoming
 * SELECTION_CHANGED event payload. The handler is invoked at most once per
 * microtask with the most recent payload.
 */
export function createSelectionBatcher(handler: SelectionHandler): {
  batch: (payload: SelectionPayload) => void;
  flush: () => void;
  getPendingCount: () => number;
} {
  let pendingPayload: SelectionPayload | null = null;
  let microtaskScheduled = false;
  let pendingCount = 0;

  function flush(): void {
    if (pendingPayload !== null) {
      const payload = pendingPayload;
      pendingPayload = null;
      microtaskScheduled = false;
      pendingCount = 0;
      handler(payload);
    } else {
      microtaskScheduled = false;
      pendingCount = 0;
    }
  }

  function batch(payload: SelectionPayload): void {
    // Always keep the latest payload — it contains the current selection state
    pendingPayload = payload;
    pendingCount++;

    if (!microtaskScheduled) {
      microtaskScheduled = true;
      queueMicrotask(flush);
    }
  }

  return { batch, flush, getPendingCount: () => pendingCount };
}
