/**
 * Distributed rate limiting via the Upstash Redis REST API.
 *
 * One atomic Lua EVAL per check (`SLIDING_WINDOW_SCRIPT`), sent in Upstash's
 * body form. When Upstash is not configured, or the call fails, the check
 * degrades to `rateLimit()` from `../rateLimit`: the `@upstash/ratelimit` SDK
 * limiter when the same two env vars are set, per-instance memory otherwise.
 */

import { rateLimit, type RateLimitResult } from '../rateLimit';
import { sampledCaptureException } from '@/lib/monitoring/sampledCapture';
import { isUpstashConfigured, postUpstashCommand } from '@/lib/upstash/restCommand';

/**
 * Alias of the canonical RateLimitResult from rateLimit.ts.
 * Both in-memory and distributed rate limiters return this shape,
 * so callers can use either interchangeably (PF-39).
 */
export type DistributedRateLimitResult = RateLimitResult;

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
 * Returns {allowed (0|1), count, oldest} — `oldest` is the score of the
 * earliest entry still in the window, present only on the deny branch. It is
 * what turns "try again later" into a real wait: the window reopens when that
 * entry expires, not a full window from now.
 *
 * Exported so `__tests__/slidingWindowScript.lua.test.ts` can execute this exact
 * source in a real Lua VM. Every other test in this directory mocks `fetch` and
 * therefore asserts what we *send* to Redis, never what Redis *does* with it —
 * the boundary arithmetic below (`<` vs `<=`, the `tonumber` coercions) is only
 * observable by running it. Do not inline a copy in the test.
 */
export const SLIDING_WINDOW_SCRIPT = `
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
local count = redis.call('ZCARD', KEYS[1])
if count < tonumber(ARGV[2]) then
  redis.call('ZADD', KEYS[1], tonumber(ARGV[3]), ARGV[4])
  redis.call('EXPIRE', KEYS[1], tonumber(ARGV[5]))
  return {1, count + 1}
else
  redis.call('EXPIRE', KEYS[1], tonumber(ARGV[5]))
  local oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
  return {0, count, tonumber(oldest[2]) or tonumber(ARGV[3])}
end
`;

async function upstashSlidingWindow(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<DistributedRateLimitResult> {
  const prefixedKey = `${REDIS_KEY_PREFIX}:${key}`;
  const now = Date.now();
  const windowMs = windowSeconds * 1000;
  const windowStart = now - windowMs;
  // Append random suffix to prevent ZADD member collisions when multiple
  // requests arrive in the same millisecond (each member must be unique).
  const member = `${now}:${Math.random().toString(36).slice(2, 8)}`;

  // Body form via the shared transport: `["EVAL", script, numkeys, key,
  // ...argv]` posted to the base URL (see `lib/upstash/restCommand.ts` for
  // why the path form that shipped in #8369 was refused with 400 on every call
  // until #9623, and why that was a silent degrade to the SDK limiter rather
  // than a fail-open). Do not "tidy" this into a path — the unit test pins the
  // shape.
  const result = (await postUpstashCommand([
    'EVAL',
    SLIDING_WINDOW_SCRIPT,
    1,
    prefixedKey,
    windowStart,
    limit,
    now,
    member,
    windowSeconds,
  ])) as [number, number, number?];
  const [allowed, count, oldest] = result;

  const remaining = Math.max(0, limit - count);
  // On deny the window reopens when the OLDEST entry expires, which the script
  // reports; a full window from now overstated the wait by up to the whole
  // window in the sentence users see (#9623 review). On allow there is nothing
  // to wait for, so the conventional "window from now" reset stands.
  const resetAt =
    allowed === 1 || typeof oldest !== 'number' || !Number.isFinite(oldest)
      ? now + windowMs
      : oldest + windowMs;

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
    // Report the Upstash failure so this silent fallback is visible (#8210), but
    // through the per-action throttle: during a sustained outage this path can
    // fire on every request, and an unconditional capture would become its own
    // Sentry storm (#8666). Strip user-identifying suffixes from the key to keep
    // PII out of the Sentry extra context.
    sampledCaptureException('distributedRateLimit.failOpen', err, {
      keyPrefix: key.split(':')[0],
      limit,
      windowSeconds,
    });
    // Degrade to rateLimit(): the @upstash/ratelimit SDK limiter when the same
    // env vars are set (still distributed, approximate window), per-instance
    // memory otherwise. Never reject the request over a limiter failure.
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
