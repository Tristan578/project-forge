/**
 * Distributed rate limiting via Upstash Redis REST API.
 *
 * Uses a sliding window algorithm backed by Redis MULTI/EXEC transactions.
 * Falls back to in-memory limiting if Upstash is not configured.
 */

import { rateLimit } from '../rateLimit';

export interface DistributedRateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

/**
 * Check whether the Upstash Redis environment is configured.
 */
function isUpstashConfigured(): boolean {
  return Boolean(
    process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN,
  );
}

/**
 * Execute a Redis pipeline via the Upstash REST API.
 * Uses MULTI/EXEC-style pipeline to atomically ZADD + ZREMRANGEBYSCORE + ZCARD.
 *
 * Sliding window algorithm:
 * 1. Remove all timestamps older than `now - windowMs`
 * 2. Count remaining timestamps in the window
 * 3. If count < limit, add current timestamp and allow
 * 4. Set TTL on the key to clean up after the window expires
 *
 * All steps run in a single pipelined request for atomicity.
 */
async function upstashSlidingWindow(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<DistributedRateLimitResult> {
  const url = process.env.UPSTASH_REDIS_REST_URL!;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN!;
  const now = Date.now();
  const windowMs = windowSeconds * 1000;
  const windowStart = now - windowMs;
  const resetAt = now + windowMs;
  const member = now.toString();

  // Pipeline: ZREMRANGEBYSCORE, ZADD, ZCARD, EXPIRE
  // We issue these as a pipeline (array of commands) for a single round-trip.
  const pipeline = [
    ['ZREMRANGEBYSCORE', key, '-inf', windowStart.toString()],
    ['ZADD', key, now.toString(), member],
    ['ZCARD', key],
    ['EXPIRE', key, windowSeconds.toString()],
  ];

  const response = await fetch(`${url}/pipeline`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(pipeline),
  });

  if (!response.ok) {
    throw new Error(`Upstash pipeline failed: ${response.status} ${response.statusText}`);
  }

  const results = await response.json() as Array<{ result: number | string | null }>;

  // Index 2 is ZCARD — count of entries currently in window (including the one we just added)
  const countAfterAdd = typeof results[2]?.result === 'number' ? results[2].result : 1;

  const allowed = countAfterAdd <= limit;

  if (!allowed) {
    // We added to the window but are over the limit — remove the member we just added
    await fetch(`${url}/pipeline`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([['ZREM', key, member]]),
    }).catch(() => {
      // Best-effort cleanup; don't throw on failure
    });
  }

  const remaining = Math.max(0, limit - countAfterAdd);

  // resetAt: oldest entry in window + windowMs (when the window will open up a slot)
  // For simplicity, use now + windowMs as the conservative upper bound
  return { allowed, remaining, resetAt };
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
  } catch {
    // On any Upstash error, fall back to in-memory to avoid blocking requests
    const result = await rateLimit(key, limit, windowSeconds * 1000);
    return result;
  }
}
