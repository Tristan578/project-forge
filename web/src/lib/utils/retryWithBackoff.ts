/**
 * Retry a promise-returning function with exponential backoff and optional jitter.
 *
 * delay = min(baseDelayMs * 2^attempt, maxDelayMs)
 * jitter: ±25% random variation on top of calculated delay
 *
 * Throws the last error after all attempts are exhausted.
 */

export interface RetryOptions {
  /** Maximum number of attempts (including the initial one). Default: 3 */
  maxAttempts?: number;
  /** Initial delay in milliseconds. Default: 500 */
  baseDelayMs?: number;
  /** Maximum delay cap in milliseconds. Default: 5000 */
  maxDelayMs?: number;
  /** Apply ±25% random jitter to the delay. Default: true */
  jitter?: boolean;
  /** Optional filter — return false to abort retries for non-transient errors. */
  isRetryable?: (error: unknown) => boolean;
}

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options?: RetryOptions,
): Promise<T> {
  const maxAttempts = Math.max(1, options?.maxAttempts ?? 3);
  const baseDelayMs = options?.baseDelayMs ?? 500;
  const maxDelayMs = options?.maxDelayMs ?? 5000;
  const jitter = options?.jitter ?? true;

  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      // Bail immediately on non-retryable errors (e.g. 4xx HTTP responses)
      if (options?.isRetryable && !options.isRetryable(err)) {
        throw err;
      }

      // Do not sleep after the last attempt — just fall through to throw
      if (attempt < maxAttempts - 1) {
        const rawDelay = Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs);
        const delay = jitter
          ? rawDelay * (0.75 + Math.random() * 0.5) // ±25% variation
          : rawDelay;

        await new Promise<void>((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
}
