/**
 * localStorage-backed queue for failed token refunds.
 *
 * When retryWithBackoff exhausts all attempts for a refund API call, the
 * refund is persisted here so it can be retried in the next browser session.
 *
 * Storage key: forge-failed-refunds
 * Max queue size: 50 entries (FIFO eviction — oldest entries dropped first)
 */

import { retryWithBackoff } from './retryWithBackoff';

export interface FailedRefund {
  jobId: string;
  provider: string;
  amount: number;
  timestamp: number;
}

const STORAGE_KEY = 'forge-failed-refunds';
const MAX_QUEUE_SIZE = 50;

function readQueue(): FailedRefund[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as FailedRefund[];
  } catch {
    return [];
  }
}

function writeQueue(entries: FailedRefund[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // localStorage may be unavailable (e.g. private browsing quota exceeded)
  }
}

/** Add a failed refund to the persistent queue. Evicts the oldest entry when
 *  the queue would exceed MAX_QUEUE_SIZE (FIFO). */
export function enqueueFailedRefund(refund: FailedRefund): void {
  const queue = readQueue();
  queue.push(refund);
  // Evict oldest entries if we exceed the cap
  const trimmed = queue.length > MAX_QUEUE_SIZE ? queue.slice(queue.length - MAX_QUEUE_SIZE) : queue;
  writeQueue(trimmed);
}

/** Return all queued failed refunds without removing them. */
export function dequeueFailedRefunds(): FailedRefund[] {
  return readQueue();
}

/** Remove a single queued refund by jobId (called after a successful retry). */
export function removeFailedRefund(jobId: string): void {
  const queue = readQueue().filter((r) => r.jobId !== jobId);
  writeQueue(queue);
}

/** Attempt to process all queued refunds.
 *
 *  For each entry:
 *  - Calls POST /api/generate/refund with { usageId: jobId }
 *  - On success: removes from the queue
 *  - On failure: leaves the entry in the queue for the next session
 */
export async function processFailedRefunds(): Promise<void> {
  const queue = readQueue();
  if (queue.length === 0) return;

  await Promise.allSettled(
    queue.map(async (refund) => {
      try {
        await retryWithBackoff(
          () =>
            fetch('/api/generate/refund', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ usageId: refund.jobId }),
            }).then((res) => {
              if (!res.ok) throw new Error(`Refund failed: ${res.status}`);
            }),
          { maxAttempts: 2, baseDelayMs: 300 },
        );
        removeFailedRefund(refund.jobId);
      } catch {
        // Leave in queue for next session
      }
    }),
  );
}
