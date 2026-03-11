import 'server-only';

export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  multiplier?: number;
  jitterFactor?: number;
}

const DEFAULT_OPTIONS: Required<RetryOptions> = {
  maxAttempts: 3,
  baseDelayMs: 100,
  maxDelayMs: 2000,
  multiplier: 2,
  jitterFactor: 0.25,
};

/**
 * Returns true if the error is transient and the operation can be safely retried.
 * Auth errors, syntax errors, and constraint violations should NOT be retried.
 */
export function isTransientError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  const message = error.message.toLowerCase();

  // Connection / network errors — retryable
  if (
    message.includes('connection refused') ||
    message.includes('econnrefused') ||
    message.includes('econnreset') ||
    message.includes('etimedout') ||
    message.includes('timeout') ||
    message.includes('network') ||
    message.includes('socket') ||
    message.includes('enotfound') ||
    message.includes('service unavailable') ||
    message.includes('too many connections') ||
    message.includes('connection terminated') ||
    message.includes('connection closed') ||
    message.includes('server closed the connection') ||
    message.includes('failed to fetch')
  ) {
    return true;
  }

  // Node errno-style socket error codes (ECONNREFUSED, ECONNRESET, ETIMEDOUT)
  const code = (error as NodeJS.ErrnoException).code;
  if (code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === 'ETIMEDOUT') {
    return true;
  }

  return false;
}

/**
 * Compute delay for attempt N (0-indexed) with exponential backoff and jitter.
 * Delay = min(baseDelayMs * multiplier^attempt, maxDelayMs) * jitter
 */
export function computeDelay(attempt: number, options: Required<RetryOptions>): number {
  const exponential = options.baseDelayMs * Math.pow(options.multiplier, attempt);
  const capped = Math.min(exponential, options.maxDelayMs);
  // Apply ±jitterFactor jitter: multiply by [1 - jitterFactor, 1 + jitterFactor]
  const jitter = 1 + options.jitterFactor * (Math.random() * 2 - 1);
  return Math.round(capped * jitter);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wraps an async operation with exponential backoff retry logic.
 * Only retries on transient errors (connection failures, timeouts, network issues).
 * Auth errors, syntax errors, and constraint violations are thrown immediately.
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const opts: Required<RetryOptions> = { ...DEFAULT_OPTIONS, ...options };
  // Guard against 0 or negative maxAttempts which would skip the loop
  // entirely and throw undefined.
  opts.maxAttempts = Math.max(1, opts.maxAttempts);
  let lastError: unknown;

  for (let attempt = 0; attempt < opts.maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      // Don't retry non-transient errors
      if (!isTransientError(error)) {
        throw error;
      }

      // Don't sleep after the last attempt
      if (attempt < opts.maxAttempts - 1) {
        const delay = computeDelay(attempt, opts);
        await sleep(delay);
      }
    }
  }

  throw lastError;
}
