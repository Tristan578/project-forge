/**
 * Global DB operation rate limiter via Upstash Redis.
 *
 * Prevents stampedes from overwhelming Neon's per-project connection limit
 * across all Vercel function instances. A module-level semaphore is useless
 * on serverless (each invocation is its own process), so we use Upstash
 * Redis for cross-instance coordination.
 *
 * Configurable via DB_RATE_LIMIT_PER_SECOND env var (default: 80).
 * Adds ~1ms latency per DB operation for the Redis round-trip.
 */

import 'server-only';
import { UPSTASH_REST_TIMEOUT_MS } from '@/lib/config/timeouts';
import { sampledCaptureException } from '@/lib/monitoring/sampledCapture';

export class DbRateLimitError extends Error {
  constructor() {
    super('Database rate limit exceeded — too many concurrent operations across all instances');
    this.name = 'DbRateLimitError';
  }
}

function getLimit(): number {
  const env = process.env.DB_RATE_LIMIT_PER_SECOND;
  if (!env) return 80;
  const n = Number(env);
  return Number.isFinite(n) && n > 0 ? n : 80;
}

// ---------------------------------------------------------------------------
// Lazy Upstash Ratelimit singleton
// ---------------------------------------------------------------------------

type LimiterInstance = {
  limit: (key: string) => Promise<{ success: boolean; remaining: number; reset: number; reason?: string }>;
};

let _initPromise: Promise<LimiterInstance | null> | null = null;

function getLimiter(): Promise<LimiterInstance | null> {
  if (!_initPromise) {
    _initPromise = initLimiter();
  }
  return _initPromise;
}

async function initLimiter(): Promise<LimiterInstance | null> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) return null;

  try {
    const { Redis } = await import('@upstash/redis');
    const { Ratelimit } = await import('@upstash/ratelimit');

    const redis = new Redis({ url, token });
    const rl = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(getLimit(), '1 s'),
      prefix: '@spawnforge/db-ratelimit',
      // The SDK's default is 5 s, and on expiry it RESOLVES
      // `{ success: true, reason: 'timeout' }` instead of throwing, so the
      // catch in checkDbRateLimit() never sees a stalled Upstash. Same bound
      // as every other Upstash call (#9623); the resolved-open case is
      // reported below.
      timeout: UPSTASH_REST_TIMEOUT_MS,
    });

    return rl;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const RETRY_DELAY_MS = 100;

/**
 * Check the global DB rate limit before executing a query.
 *
 * If the limit is exceeded, waits 100ms and retries once. If still limited,
 * throws DbRateLimitError. Callers (queryWithResilience) catch this and can
 * surface a 503 to the client.
 *
 * When Upstash is not configured, this is a no-op (allows all operations).
 */
export async function checkDbRateLimit(): Promise<void> {
  const limiter = await getLimiter();
  if (!limiter) return; // No Upstash = no global rate limit (dev/CI)

  const key = 'global-db-ops';

  try {
    const result = await limiter.limit(key);
    if (result.success) {
      reportTimeoutFailOpen(result.reason);
      return;
    }

    // Brief backoff and retry once
    await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    const retry = await limiter.limit(key);
    if (retry.success) {
      reportTimeoutFailOpen(retry.reason);
      return;
    }

    throw new DbRateLimitError();
  } catch (err) {
    if (err instanceof DbRateLimitError) throw err;
    // Upstash failure (network error, 5xx, a thrown SDK error) — fail open so
    // a Redis incident doesn't take down every DB-backed request. This
    // silently disables global DB-overload protection, so report it (sampled,
    // to avoid a Sentry storm during a sustained outage) before allowing the
    // query through (#8664). A STALL never reaches here: the SDK resolves it
    // as allowed with `reason: 'timeout'`, which reportTimeoutFailOpen covers.
    sampledCaptureException('checkDbRateLimit.failOpen', err);
  }
}

/**
 * The SDK's timeout is a resolve, not a throw — `success: true` with
 * `reason: 'timeout'` — so the global DB-overload guard fails open with no
 * exception to catch. Report it as the fail-open it is, sampled like the
 * catch above.
 */
function reportTimeoutFailOpen(reason: string | undefined): void {
  if (reason !== 'timeout') return;
  sampledCaptureException(
    'checkDbRateLimit.timeoutFailOpen',
    new Error(`Upstash DB rate limit timed out after ${UPSTASH_REST_TIMEOUT_MS}ms; query allowed`),
  );
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Reset the limiter singleton — for testing only. */
export function _resetDbRateLimiter(): void {
  _initPromise = null;
}
