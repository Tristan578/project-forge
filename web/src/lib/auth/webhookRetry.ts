/**
 * In-memory retry queue for transient Clerk webhook failures.
 *
 * When a webhook handler encounters a transient error (network timeout, DB
 * connection failure, 5xx from downstream), the event payload is enqueued for
 * retry with exponential backoff. Permanent errors (invalid payload, missing
 * required fields) are logged and discarded.
 *
 * The queue is processed opportunistically on the next incoming webhook call
 * via `processRetryQueue()`, or can be triggered externally (e.g., cron).
 *
 * NOTE: This is an in-memory queue — retries are lost on process restart.
 * For durable retry, migrate to a persistent queue (DB table, Redis, SQS).
 */

export interface RetryEntry {
  id: string;
  eventType: string;
  payload: Record<string, unknown>;
  attempt: number;
  nextRetryAt: number; // ms since epoch
  createdAt: number;
  lastError: string;
}

export interface RetryQueueConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  maxQueueSize: number;
}

const DEFAULT_CONFIG: RetryQueueConfig = {
  maxRetries: 5,
  baseDelayMs: 1000,
  maxDelayMs: 60_000,
  maxQueueSize: 100,
};

// Module-level queue (in-memory, per-process)
let queue: RetryEntry[] = [];
let config: RetryQueueConfig = { ...DEFAULT_CONFIG };

/** Generate a simple unique ID for retry entries. */
function generateId(): string {
  return `retry_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Calculate delay with exponential backoff + jitter. */
export function calculateDelay(attempt: number, cfg: RetryQueueConfig = config): number {
  const exponential = cfg.baseDelayMs * Math.pow(2, attempt);
  const capped = Math.min(exponential, cfg.maxDelayMs);
  // Add up to 25% jitter
  const jitter = capped * 0.25 * Math.random();
  return Math.floor(capped + jitter);
}

/**
 * Classify an error as transient (retryable) or permanent (discard).
 *
 * Transient: network errors, timeouts, 5xx responses, DB connection failures.
 * Permanent: invalid payload, missing fields, auth errors, 4xx responses.
 */
export function isTransientError(error: unknown): boolean {
  if (error instanceof TypeError) {
    // fetch() network errors are TypeErrors
    return true;
  }

  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();

  const transientPatterns = [
    'timeout',
    'econnreset',
    'econnrefused',
    'enotfound',
    'network',
    'socket hang up',
    'abort',
    '5xx',
    '502',
    '503',
    '504',
    'connection',
    'temporarily unavailable',
    'too many requests',
    'rate limit',
    'database',
    'deadlock',
  ];

  return transientPatterns.some((pattern) => message.includes(pattern));
}

/** Enqueue a failed webhook event for retry. */
export function enqueueRetry(
  eventType: string,
  payload: Record<string, unknown>,
  error: unknown,
): boolean {
  if (queue.length >= config.maxQueueSize) {
    // eslint-disable-next-line no-console
    console.warn('[WebhookRetry] Queue full, dropping event:', eventType);
    return false;
  }

  const entry: RetryEntry = {
    id: generateId(),
    eventType,
    payload,
    attempt: 0,
    nextRetryAt: Date.now() + calculateDelay(0),
    createdAt: Date.now(),
    lastError: error instanceof Error ? error.message : String(error),
  };

  queue.push(entry);
  return true;
}

/**
 * Process all entries in the retry queue that are due.
 *
 * @param handler - Async function to process the event (same as webhook handler logic).
 * @returns Number of successfully processed entries.
 */
export async function processRetryQueue(
  handler: (eventType: string, data: Record<string, unknown>) => Promise<void>,
): Promise<number> {
  const now = Date.now();
  const due = queue.filter((entry) => entry.nextRetryAt <= now);
  let processed = 0;

  for (const entry of due) {
    try {
      await handler(entry.eventType, entry.payload);
      // Success — remove from queue
      queue = queue.filter((e) => e.id !== entry.id);
      processed++;
    } catch (retryError) {
      entry.attempt++;
      entry.lastError = retryError instanceof Error ? retryError.message : String(retryError);

      if (entry.attempt >= config.maxRetries || !isTransientError(retryError)) {
        // Max retries exceeded or permanent error — discard
        // eslint-disable-next-line no-console
        console.error(
          `[WebhookRetry] Permanently failed after ${entry.attempt} attempts:`,
          entry.eventType,
          entry.lastError,
        );
        queue = queue.filter((e) => e.id !== entry.id);
      } else {
        // Schedule next retry
        entry.nextRetryAt = now + calculateDelay(entry.attempt);
      }
    }
  }

  return processed;
}

/** Get current queue state (for monitoring/debugging). */
export function getQueueStatus(): {
  size: number;
  entries: ReadonlyArray<Readonly<RetryEntry>>;
  config: Readonly<RetryQueueConfig>;
} {
  return {
    size: queue.length,
    entries: queue,
    config,
  };
}

/** Clear the retry queue (for testing). */
export function clearQueue(): void {
  queue = [];
}

/** Override config (for testing). */
export function setConfig(overrides: Partial<RetryQueueConfig>): void {
  config = { ...DEFAULT_CONFIG, ...overrides };
}

/** Reset config to defaults (for testing). */
export function resetConfig(): void {
  config = { ...DEFAULT_CONFIG };
}
