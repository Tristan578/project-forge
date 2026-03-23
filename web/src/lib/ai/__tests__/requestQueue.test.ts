import { describe, it, expect } from 'vitest';
import { AIRequestQueue, aiQueue, type Priority } from '../requestQueue';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: Error) => void } {
  let resolve!: (v: T) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// ---------------------------------------------------------------------------
// Basic enqueue / concurrency
// ---------------------------------------------------------------------------

describe('AIRequestQueue — basic behaviour', () => {
  it('executes a single request and returns its value', async () => {
    const q = new AIRequestQueue(2);
    const result = await q.enqueue(() => Promise.resolve(42), 1);
    expect(result).toBe(42);
  });

  it('executes multiple requests and returns correct values', async () => {
    const q = new AIRequestQueue(3);
    const [a, b, c] = await Promise.all([
      q.enqueue(() => Promise.resolve('a'), 1),
      q.enqueue(() => Promise.resolve('b'), 2),
      q.enqueue(() => Promise.resolve('c'), 3),
    ]);
    expect([a, b, c]).toEqual(['a', 'b', 'c']);
  });

  it('propagates rejection from the request function', async () => {
    const q = new AIRequestQueue(2);
    await expect(
      q.enqueue(() => Promise.reject(new Error('boom')), 1),
    ).rejects.toThrow('boom');
  });

  it('wraps non-Error rejections in an Error', async () => {
    const q = new AIRequestQueue(2);
    await expect(
      q.enqueue(() => Promise.reject('string error'), 1),
    ).rejects.toThrow('string error');
  });
});

// ---------------------------------------------------------------------------
// Concurrency cap
// ---------------------------------------------------------------------------

describe('AIRequestQueue — concurrency cap', () => {
  it('does not exceed maxConcurrent running requests', async () => {
    const q = new AIRequestQueue(2);
    let concurrent = 0;
    let maxObserved = 0;

    const task = (): Promise<void> =>
      new Promise<void>((res) => {
        concurrent++;
        maxObserved = Math.max(maxObserved, concurrent);
        // Use microtask yield instead of setTimeout to avoid no-restricted-syntax
        void Promise.resolve().then(() => {
          concurrent--;
          res();
        });
      });

    await Promise.all([
      q.enqueue(task, 1),
      q.enqueue(task, 2),
      q.enqueue(task, 3),
      q.enqueue(task, 1),
    ]);

    expect(maxObserved).toBeLessThanOrEqual(2);
  });

  it('respects getConcurrentCount while running', async () => {
    const q = new AIRequestQueue(1);
    const d = deferred<void>();

    // Before any request: count is 0
    expect(q.getConcurrentCount()).toBe(0);

    const running = q.enqueue(() => d.promise, 1);
    // After enqueue: the request starts immediately (slot available) → count 1
    expect(q.getConcurrentCount()).toBe(1);

    d.resolve();
    await running;
    // After await, count should be 0 — we yield a few microtask turns to let
    // the internal .finally() handler run before asserting.
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(q.getConcurrentCount()).toBe(0);
  });

  it('drains the queue after completion', async () => {
    const q = new AIRequestQueue(1);
    const order: number[] = [];

    await Promise.all([
      q.enqueue(async () => { order.push(1); }, 1),
      q.enqueue(async () => { order.push(2); }, 1),
      q.enqueue(async () => { order.push(3); }, 1),
    ]);

    expect(order).toEqual([1, 2, 3]);
  });
});

// ---------------------------------------------------------------------------
// Priority ordering
// ---------------------------------------------------------------------------

describe('AIRequestQueue — priority ordering', () => {
  it('executes priority-1 request before priority-3 when both are queued', async () => {
    // Single-slot queue so we can observe ordering
    const q = new AIRequestQueue(1);
    const d = deferred<void>(); // holds the first slot open
    const order: Priority[] = [];

    // Occupy the slot so subsequent enqueues go to the queue
    const blocker = q.enqueue(() => d.promise, 3 as Priority);

    // These will queue while blocker runs
    const p3 = q.enqueue(async () => { order.push(3); }, 3);
    const p1 = q.enqueue(async () => { order.push(1); }, 1);
    const p2 = q.enqueue(async () => { order.push(2); }, 2);

    // Release the blocker — the queue should drain in priority order
    d.resolve();
    await Promise.all([blocker, p3, p1, p2]);

    // Priority 1 should have run before 2, which before 3
    expect(order[0]).toBe(1);
    expect(order[1]).toBe(2);
    expect(order[2]).toBe(3);
  });

  it('preserves FIFO order within the same priority band', async () => {
    const q = new AIRequestQueue(1);
    const d = deferred<void>();
    const order: string[] = [];

    const blocker = q.enqueue(() => d.promise, 1);
    const first = q.enqueue(async () => { order.push('first'); }, 2);
    const second = q.enqueue(async () => { order.push('second'); }, 2);
    const third = q.enqueue(async () => { order.push('third'); }, 2);

    d.resolve();
    await Promise.all([blocker, first, second, third]);

    expect(order).toEqual(['first', 'second', 'third']);
  });
});

// ---------------------------------------------------------------------------
// Queue depth
// ---------------------------------------------------------------------------

describe('AIRequestQueue — queue depth', () => {
  it('reports correct queue depth while requests are waiting', () => {
    const q = new AIRequestQueue(1);
    const d = deferred<void>();

    void q.enqueue(() => d.promise, 1);   // occupies the slot
    void q.enqueue(() => Promise.resolve(), 2); // queued
    void q.enqueue(() => Promise.resolve(), 3); // queued

    expect(q.getQueueDepth()).toBe(2);
    d.resolve();
  });

  it('returns 0 depth when all slots are free', () => {
    const q = new AIRequestQueue(3);
    expect(q.getQueueDepth()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// AbortSignal support
// ---------------------------------------------------------------------------

describe('AIRequestQueue — abort', () => {
  it('rejects immediately when signal is already aborted', async () => {
    const q = new AIRequestQueue(2);
    const controller = new AbortController();
    controller.abort();

    await expect(
      q.enqueue(() => Promise.resolve('never'), 1, controller.signal),
    ).rejects.toThrow('aborted');
  });

  it('removes a queued request when aborted before execution', async () => {
    const q = new AIRequestQueue(1);
    const controller = new AbortController();
    const d = deferred<void>();

    // Occupy the only slot
    const blocker = q.enqueue(() => d.promise, 1);

    // Enqueue a second request that will be aborted while waiting
    const abortable = q.enqueue(() => Promise.resolve('result'), 1, controller.signal);
    expect(q.getQueueDepth()).toBe(1);

    controller.abort();

    // The abortable request should reject
    await expect(abortable).rejects.toThrow('aborted');

    // The queue should now be empty
    expect(q.getQueueDepth()).toBe(0);

    // Clean up the blocker
    d.resolve();
    await blocker;
  });
});

// ---------------------------------------------------------------------------
// Module-level singleton
// ---------------------------------------------------------------------------

describe('aiQueue singleton', () => {
  it('is an instance of AIRequestQueue', () => {
    expect(aiQueue).toBeInstanceOf(AIRequestQueue);
  });

  it('executes a request via the singleton', async () => {
    const result = await aiQueue.enqueue(() => Promise.resolve('singleton works'), 1);
    expect(result).toBe('singleton works');
  });
});
