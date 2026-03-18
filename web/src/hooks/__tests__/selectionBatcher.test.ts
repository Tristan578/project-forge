import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createSelectionBatcher, type SelectionPayload } from '../selectionBatcher';

/** Flush all pending microtasks (queueMicrotask callbacks). */
async function flushMicrotasks(): Promise<void> {
  // Two awaits: first flushes Promise callbacks, second flushes queueMicrotask callbacks
  await Promise.resolve();
  await Promise.resolve();
}

describe('createSelectionBatcher', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls handler once when a single event is batched', async () => {
    const handler = vi.fn();
    const { batch } = createSelectionBatcher(handler);

    const payload: SelectionPayload = {
      selectedIds: ['entity-1'],
      primaryId: 'entity-1',
      primaryName: 'Cube',
    };

    batch(payload);
    expect(handler).not.toHaveBeenCalled();

    await flushMicrotasks();
    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(payload);
  });

  it('coalesces multiple rapid events into a single handler call', async () => {
    const handler = vi.fn();
    const { batch } = createSelectionBatcher(handler);

    const payload1: SelectionPayload = {
      selectedIds: ['entity-1'],
      primaryId: 'entity-1',
      primaryName: 'Cube',
    };
    const payload2: SelectionPayload = {
      selectedIds: ['entity-1', 'entity-2'],
      primaryId: 'entity-2',
      primaryName: 'Sphere',
    };
    const payload3: SelectionPayload = {
      selectedIds: ['entity-3'],
      primaryId: 'entity-3',
      primaryName: 'Cylinder',
    };

    // Simulate 3 SELECTION_CHANGED events arriving in the same synchronous tick
    batch(payload1);
    batch(payload2);
    batch(payload3);

    expect(handler).not.toHaveBeenCalled();

    await flushMicrotasks();

    // Only one call with the last payload
    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(payload3);
  });

  it('uses the last payload when 15 events are batched', async () => {
    const handler = vi.fn();
    const { batch } = createSelectionBatcher(handler);

    for (let i = 0; i < 15; i++) {
      batch({
        selectedIds: [`entity-${i}`],
        primaryId: `entity-${i}`,
        primaryName: `Entity ${i}`,
      });
    }

    await flushMicrotasks();

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith({
      selectedIds: ['entity-14'],
      primaryId: 'entity-14',
      primaryName: 'Entity 14',
    });
  });

  it('allows a second batch after the first microtask has flushed', async () => {
    const handler = vi.fn();
    const { batch } = createSelectionBatcher(handler);

    const firstPayload: SelectionPayload = {
      selectedIds: ['entity-1'],
      primaryId: 'entity-1',
      primaryName: 'Cube',
    };

    batch(firstPayload);
    await flushMicrotasks();

    expect(handler).toHaveBeenCalledOnce();

    const secondPayload: SelectionPayload = {
      selectedIds: ['entity-2'],
      primaryId: 'entity-2',
      primaryName: 'Sphere',
    };

    batch(secondPayload);
    await flushMicrotasks();

    expect(handler).toHaveBeenCalledTimes(2);
    expect(handler).toHaveBeenNthCalledWith(2, secondPayload);
  });

  it('does not call handler if flush is called with no pending payload', () => {
    const handler = vi.fn();
    const { flush } = createSelectionBatcher(handler);

    flush();
    expect(handler).not.toHaveBeenCalled();
  });

  it('flush immediately applies the pending payload without waiting for microtask', async () => {
    const handler = vi.fn();
    const { batch, flush } = createSelectionBatcher(handler);

    const payload: SelectionPayload = {
      selectedIds: ['entity-1'],
      primaryId: 'entity-1',
      primaryName: 'Cube',
    };

    batch(payload);
    expect(handler).not.toHaveBeenCalled();

    // Manually flush before microtask fires
    flush();
    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(payload);

    // Microtask should not trigger a second call
    await flushMicrotasks();
    expect(handler).toHaveBeenCalledOnce();
  });

  it('tracks pending count correctly', async () => {
    const handler = vi.fn();
    const { batch, getPendingCount } = createSelectionBatcher(handler);

    expect(getPendingCount()).toBe(0);

    batch({ selectedIds: [], primaryId: null, primaryName: null });
    expect(getPendingCount()).toBe(1);

    batch({ selectedIds: ['entity-1'], primaryId: 'entity-1', primaryName: 'Cube' });
    expect(getPendingCount()).toBe(2);

    await flushMicrotasks();
    expect(getPendingCount()).toBe(0);
  });

  it('handles empty selection payload', async () => {
    const handler = vi.fn();
    const { batch } = createSelectionBatcher(handler);

    const emptyPayload: SelectionPayload = {
      selectedIds: [],
      primaryId: null,
      primaryName: null,
    };

    batch(emptyPayload);
    await flushMicrotasks();

    expect(handler).toHaveBeenCalledWith(emptyPayload);
  });

  it('schedules only one microtask for many rapid calls', async () => {
    const handler = vi.fn();
    const queueMicrotaskSpy = vi.spyOn(globalThis, 'queueMicrotask');
    const { batch } = createSelectionBatcher(handler);

    batch({ selectedIds: ['a'], primaryId: 'a', primaryName: 'A' });
    batch({ selectedIds: ['b'], primaryId: 'b', primaryName: 'B' });
    batch({ selectedIds: ['c'], primaryId: 'c', primaryName: 'C' });

    // Only one microtask should have been scheduled
    expect(queueMicrotaskSpy).toHaveBeenCalledOnce();

    await flushMicrotasks();

    queueMicrotaskSpy.mockRestore();
  });

  it('handler receives correct selectedIds array', async () => {
    const handler = vi.fn();
    const { batch } = createSelectionBatcher(handler);

    const multiSelectPayload: SelectionPayload = {
      selectedIds: ['a', 'b', 'c', 'd'],
      primaryId: 'a',
      primaryName: 'Entity A',
    };

    batch(multiSelectPayload);
    await flushMicrotasks();

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ selectedIds: ['a', 'b', 'c', 'd'] })
    );
  });
});
