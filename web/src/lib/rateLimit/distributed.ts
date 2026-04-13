/**
 * Distributed rate limiting via Upstash Redis REST API.
 *
 * Uses a sliding window algorithm backed by Redis MULTI/EXEC transactions.
 * Falls back to in-memory limiting if Upstash is not configured.
 */

import { rateLimit, type RateLimitResult } from '../rateLimit';
import { captureException } from '@/lib/monitoring/sentry-server';

/**
 * Alias of the canonical RateLimitResult from rateLimit.ts.
 * Both in-memory and distributed rate limiters return this shape,
 * so callers can use either interchangeably (PF-39).
 */
export type DistributedRateLimitResult = RateLimitResult;

/**
 * Check whether the Upstash Redis environment is configured.
 */
function isUpstashConfigured(): boolean {
  return Boolean(
    process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN,
  );
}

/**
 * Atomic sliding window rate limiter via a single Lua EVAL script (PF-744).
 *
 * Sliding window algorithm — all steps run atomically in Redis:
 * 1. Remove all timestamps older than `now - windowMs`
 * 2. Count remaining timestamps in the window
 * 3. If count < limit, add current timestamp and set TTL → allow
 * 4. If count >= limit, set TTL only (never add the entry) → deny
 *
 * This eliminates phantom entries: the entry is never written when over limit,
 * so there's nothing to clean up and no window for ZREM failures to leave
 * stale data behind.
 */
/** Prefix must match the @upstash/ratelimit prefix used by rateLimit.ts */
const REDIS_KEY_PREFIX = '@spawnforge/ratelimit';

/**
 * Lua script for atomic sliding window rate limiting.
 *
 * KEYS[1] = rate limit key
 * ARGV[1] = windowStart (oldest allowed timestamp)
 * ARGV[2] = limit (max entries per window)
 * ARGV[3] = now (score for ZADD)
 * ARGV[4] = member (unique value for ZADD)
 * ARGV[5] = windowSeconds (TTL for EXPIRE)
 *
 * Returns {allowed (0|1), count} as a two-element array.
 */
const SLIDING_WINDOW_SCRIPT = `
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
local count = redis.call('ZCARD', KEYS[1])
if count < tonumber(ARGV[2]) then
  redis.call('ZADD', KEYS[1], tonumber(ARGV[3]), ARGV[4])
  redis.call('EXPIRE', KEYS[1], tonumber(ARGV[5]))
  return {1, count + 1}
else
  redis.call('EXPIRE', KEYS[1], tonumber(ARGV[5]))
  return {0, count}
end
`;

async function upstashSlidingWindow(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<DistributedRateLimitResult> {
  const url = process.env.UPSTASH_REDIS_REST_URL!;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN!;
  const prefixedKey = `${REDIS_KEY_PREFIX}:${key}`;
  const now = Date.now();
  const windowMs = windowSeconds * 1000;
  const windowStart = now - windowMs;
  const resetAt = now + windowMs;
  // Append random suffix to prevent ZADD member collisions when multiple
  // requests arrive in the same millisecond (each member must be unique).
  const member = `${now}:${Math.random().toString(36).slice(2, 8)}`;

  const response = await fetch(`${url}/eval`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify([SLIDING_WINDOW_SCRIPT, 1, prefixedKey, windowStart, limit, now, member, windowSeconds]),
  });

  if (!response.ok) {
    throw new Error(`Upstash EVAL failed: ${response.status} ${response.statusText}`);
  }

  const result = await response.json() as { result: [number, number] };
  const [allowed, count] = result.result;

  const remaining = Math.max(0, limit - count);

  return { allowed: allowed === 1, remaining, resetAt };
}

/**
 * Distributed sliding window rate limiter.
 *
 * Uses Upstash Redis when configured, falls back to in-memory when not.
 *
 * @param key - Unique bucket key (e.g. `billing-checkout:user-123`)
 * @param limit - Maximum requests per window
 * @param windowSeconds - Window size in seconds
 */
export async function distributedRateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<DistributedRateLimitResult> {
  if (!isUpstashConfigured()) {
    // Fall back to in-memory rate limiter
    const result = await rateLimit(key, limit, windowSeconds * 1000);
    return result;
  }

  try {
    return await upstashSlidingWindow(key, limit, windowSeconds);
  } catch (err) {
    // Report Upstash failure to Sentry so silent fallbacks are visible (#8210)
    // Strip user-identifying suffixes from key to avoid PII in Sentry extra context
    captureException(err, { component: 'distributedRateLimit', keyPrefix: key.split(':')[0], limit, windowSeconds });
    // Fall back to in-memory to avoid blocking requests
    const result = await rateLimit(key, limit, windowSeconds * 1000);
    return result;
  }
}

/**
 * Aggregate rate limit across all /api/generate/* routes.
 * 30 requests per user per 15 minutes. Prevents token exhaustion
 * via batch orchestration or rapid-fire generation requests.
 *
 * Call this BEFORE the per-route rate limit in each generation endpoint.
 * If the aggregate limit is exceeded, return a 429 immediately.
 */
export async function aggregateGenerationRateLimit(
  userId: string,
): Promise<DistributedRateLimitResult> {
  return distributedRateLimit(`gen-all:${userId}`, 30, 900);
}
