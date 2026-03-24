/**
 * Priority request queue for the AI client.
 *
 * Prevents thundering-herd problems when many AI modules fire simultaneously
 * (e.g. game review + analytics + auto-iteration all triggered at once).
 * Requests are dispatched in priority order with a configurable concurrency cap.
 *
 * Priority levels:
 *   1 — Highest: user-initiated chat (must feel instant)
 *   2 — Medium:  AI Studio panels opened by the user
 *   3 — Lowest:  background analysis / auto-iteration
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Request priority. Lower number = higher priority. */
export type Priority = 1 | 2 | 3;

export interface AIRequestQueueOptions {
  /** Maximum number of requests executing concurrently. Default: 3 */
  maxConcurrent?: number;
  /**
   * Maximum number of requests allowed to sit in the pending queue
   * (not counting those already running).  When the queue is full,
   * `enqueue()` rejects immediately with a friendly backpressure error.
   * Default: 20 (unlimited-ish for most interactive use cases).
   */
  maxQueueDepth?: number;
}

interface QueuedRequest<T> {
  fn: () => Promise<T>;
  priority: Priority;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  signal?: AbortSignal;
}

// ---------------------------------------------------------------------------
// AIRequestQueue
// ---------------------------------------------------------------------------

export class AIRequestQueue {
  private maxConcurrent: number;
  private maxQueueDepth: number;
  private running = 0;
  private queue: QueuedRequest<unknown>[] = [];

  constructor(maxConcurrentOrOptions: number | AIRequestQueueOptions = 3) {
    if (typeof maxConcurrentOrOptions === 'number') {
      this.maxConcurrent = maxConcurrentOrOptions;
      this.maxQueueDepth = 20;
    } else {
      this.maxConcurrent = maxConcurrentOrOptions.maxConcurrent ?? 3;
      this.maxQueueDepth = maxConcurrentOrOptions.maxQueueDepth ?? 20;
    }
  }

  /**
   * Enqueue a request function to be executed when capacity is available.
   *
   * If the signal is already aborted, the request is rejected immediately
   * without entering the queue.  While the request is queued (not yet
   * running), an abort removes it from the queue and rejects the promise.
   *
   * If the pending queue is at capacity (`maxQueueDepth`), the request is
   * rejected immediately with a backpressure error — the caller should surface
   * a friendly message like "Too many requests in progress, please wait."
   *
   * @param fn         Async function to execute
   * @param priority   Execution priority (1 = highest, 3 = lowest)
   * @param signal     Optional AbortSignal
   * @returns          Promise that resolves/rejects with the result of `fn`
   */
  enqueue<T>(fn: () => Promise<T>, priority: Priority, signal?: AbortSignal): Promise<T> {
    // Reject immediately if already aborted
    if (signal?.aborted) {
      return Promise.reject(new Error('Request aborted'));
    }

    // Backpressure: reject if the pending queue is full.
    // Only applies when the request would need to wait in the queue
    // (i.e. all concurrency slots are occupied).
    if (this.running >= this.maxConcurrent && this.queue.length >= this.maxQueueDepth) {
      return Promise.reject(
        new Error('Too many AI requests in progress — please wait a moment and try again.'),
      );
    }

    return new Promise<T>((resolve, reject) => {
      const request: QueuedRequest<T> = {
        fn,
        priority,
        resolve: resolve as (value: unknown) => void,
        reject,
        signal,
      };

      // If the signal fires while the request is waiting in the queue,
      // pull it out and reject without executing fn.
      if (signal) {
        signal.addEventListener('abort', () => {
          const index = this.queue.indexOf(request as QueuedRequest<unknown>);
          if (index !== -1) {
            this.queue.splice(index, 1);
            reject(new Error('Request aborted'));
          }
        }, { once: true });
      }

      this.insertByPriority(request as QueuedRequest<unknown>);
      this.drain();
    });
  }

  /** Number of requests waiting to be dispatched. */
  getQueueDepth(): number {
    return this.queue.length;
  }

  /** Number of requests currently executing. */
  getConcurrentCount(): number {
    return this.running;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Insert into the queue maintaining priority order.
   * Equal-priority requests are appended after existing entries of the same
   * priority (FIFO within each priority band).
   */
  private insertByPriority(request: QueuedRequest<unknown>): void {
    // Find the first position whose priority is strictly lower (higher number)
    const insertAt = this.queue.findIndex((r) => r.priority > request.priority);
    if (insertAt === -1) {
      this.queue.push(request);
    } else {
      this.queue.splice(insertAt, 0, request);
    }
  }

  /**
   * Dispatch queued requests up to the concurrency cap.
   * Called after every enqueue and every request completion.
   */
  private drain(): void {
    while (this.running < this.maxConcurrent && this.queue.length > 0) {
      const request = this.queue.shift();
      if (!request) break;

      // If aborted while draining (race between abort handler and drain),
      // skip execution — the abort handler already rejected the promise.
      if (request.signal?.aborted) continue;

      this.running++;
      request
        .fn()
        .then((value) => {
          request.resolve(value);
        })
        .catch((err: unknown) => {
          request.reject(err instanceof Error ? err : new Error(String(err)));
        })
        .finally(() => {
          this.running--;
          this.drain();
        });
    }
  }
}

// ---------------------------------------------------------------------------
// Module-level singleton
// ---------------------------------------------------------------------------

/** Shared AI request queue used by all feature modules. */
export const aiQueue = new AIRequestQueue();
