import { NextRequest, NextResponse } from 'next/server';
import {
  RATE_LIMIT_PUBLIC_WINDOW_MS,
  RATE_LIMIT_ADMIN_WINDOW_MS,
  RATE_LIMIT_PUBLIC_MAX,
  RATE_LIMIT_ADMIN_MAX,
} from '@/lib/config/timeouts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

// ---------------------------------------------------------------------------
// Upstash Redis rate limiter (distributed, survives cold starts)
// ---------------------------------------------------------------------------

type UpstashRateLimiter = {
  limit: (key: string, opts: { rate: number; window: string }) => Promise<RateLimitResult>;
};

// Singleton promise ensures only one initialization runs at a time.
// Concurrent callers await the same promise, preventing a failed init
// from overwriting a successful one (race condition).
let _initPromise: Promise<UpstashRateLimiter | false> | null = null;

/**
 * Lazily initialise the Upstash-backed rate limiter.
 * Returns the limiter instance, or `false` if env vars are missing.
 *
 * Uses a promise lock so concurrent calls share a single init attempt.
 */
function getUpstashLimiter(): Promise<UpstashRateLimiter | false> {
  if (!_initPromise) {
    _initPromise = doInitUpstash();
  }
  return _initPromise;
}

async function doInitUpstash(): Promise<UpstashRateLimiter | false> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    console.warn(
      '[rateLimit] UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN not set — falling back to in-memory rate limiting. ' +
      'Rate limits will reset on serverless cold starts.'
    );
    return false;
  }

  try {
    const { Redis } = await import('@upstash/redis');
    const { Ratelimit } = await import('@upstash/ratelimit');

    const redis = new Redis({ url, token });

    // We build a thin wrapper so callers can pass arbitrary (max, windowMs)
    // pairs. Upstash Ratelimit instances are bound to a single config, so
    // we cache one instance per unique config key.
    const cache = new Map<string, InstanceType<typeof Ratelimit>>();

    const limiter: UpstashRateLimiter = {
      async limit(key, opts) {
        const configKey = `${opts.rate}:${opts.window}`;
        let rl = cache.get(configKey);
        if (!rl) {
          rl = new Ratelimit({
            redis,
            limiter: Ratelimit.slidingWindow(opts.rate, opts.window as Parameters<typeof Ratelimit.slidingWindow>[1]),
            prefix: '@spawnforge/ratelimit',
          });
          cache.set(configKey, rl);
        }

        const res = await rl.limit(key);
        return {
          allowed: res.success,
          remaining: res.remaining,
          resetAt: res.reset,
        };
      },
    };

    return limiter;
  } catch {
    console.warn('[rateLimit] Failed to initialise Upstash — falling back to in-memory rate limiting.');
    return false;
  }
}

// ---------------------------------------------------------------------------
// In-memory fallback (sliding window)
// ---------------------------------------------------------------------------

interface RateLimitEntry {
  timestamps: number[];
}

const rateLimitStore = new Map<string, RateLimitEntry>();

const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
let cleanupInterval: NodeJS.Timeout | null = null;

function startCleanup() {
  if (cleanupInterval) return;
  cleanupInterval = setInterval(() => {
    const now = Date.now();
    const maxAge = 60 * 60 * 1000;
    for (const [key, entry] of rateLimitStore.entries()) {
      if (entry.timestamps.length === 0 || entry.timestamps[entry.timestamps.length - 1] < now - maxAge) {
        rateLimitStore.delete(key);
      }
    }
  }, CLEANUP_INTERVAL_MS);
}

if (typeof window === 'undefined') {
  startCleanup();
}

function inMemoryRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number
): RateLimitResult {
  const now = Date.now();
  const windowStart = now - windowMs;

  let entry = rateLimitStore.get(key);
  if (!entry) {
    entry = { timestamps: [] };
    rateLimitStore.set(key, entry);
  }

  entry.timestamps = entry.timestamps.filter(ts => ts > windowStart);

  const allowed = entry.timestamps.length < maxRequests;
  if (allowed) {
    entry.timestamps.push(now);
  }

  const remaining = Math.max(0, maxRequests - entry.timestamps.length);
  const resetAt = entry.timestamps.length > 0
    ? entry.timestamps[0] + windowMs
    : now + windowMs;

  return { allowed, remaining, resetAt };
}

// ---------------------------------------------------------------------------
// Public API — same signature as before, transparently uses Upstash or fallback
// ---------------------------------------------------------------------------

/**
 * Convert a millisecond window to an Upstash duration string.
 * Upstash accepts: "Xs", "Xm", "Xh", "Xd".
 */
function msToUpstashWindow(ms: number): string {
  if (ms >= 86_400_000 && ms % 86_400_000 === 0) return `${ms / 86_400_000}d`;
  if (ms >= 3_600_000 && ms % 3_600_000 === 0) return `${ms / 3_600_000}h`;
  if (ms >= 60_000 && ms % 60_000 === 0) return `${ms / 60_000}m`;
  return `${Math.ceil(ms / 1000)}s`;
}

/**
 * Rate limit a request using a sliding window algorithm.
 *
 * Uses Upstash Redis when `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`
 * are set, otherwise falls back to an in-memory sliding window.
 *
 * @param key - Unique identifier for the rate limit bucket
 * @param maxRequests - Maximum number of requests allowed in the window
 * @param windowMs - Time window in milliseconds
 */
export async function rateLimit(
  key: string,
  maxRequests: number,
  windowMs: number
): Promise<RateLimitResult> {
  const limiter = await getUpstashLimiter();
  if (limiter) {
    try {
      return await limiter.limit(key, {
        rate: maxRequests,
        window: msToUpstashWindow(windowMs),
      });
    } catch {
      // If Upstash call fails (network error, etc.), fall back to in-memory
      // so the request is not rejected outright.
      return inMemoryRateLimit(key, maxRequests, windowMs);
    }
  }
  return inMemoryRateLimit(key, maxRequests, windowMs);
}

// ---------------------------------------------------------------------------
// IP extraction
// ---------------------------------------------------------------------------

function isValidIpFormat(ip: string): boolean {
  return /^[\da-fA-F.:]+$/.test(ip) && ip.length <= 45;
}

/**
 * Extract a client identifier from the request for rate limiting.
 */
export function getClientIp(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) {
    const parts = forwarded.split(',').map(s => s.trim()).filter(Boolean);
    const candidate = parts[0];
    if (candidate && isValidIpFormat(candidate)) {
      return candidate;
    }
    const lastCandidate = parts[parts.length - 1];
    if (lastCandidate && isValidIpFormat(lastCandidate)) {
      return lastCandidate;
    }
  }

  const realIp = req.headers.get('x-real-ip');
  if (realIp && isValidIpFormat(realIp)) {
    return realIp;
  }

  return 'unknown';
}

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

export function rateLimitResponse(remaining: number, resetAt: number): NextResponse {
  const resetInSeconds = Math.ceil((resetAt - Date.now()) / 1000);

  return NextResponse.json(
    { error: 'Too many requests. Please try again later.' },
    {
      status: 429,
      headers: {
        'X-RateLimit-Remaining': remaining.toString(),
        'X-RateLimit-Reset': Math.floor(resetAt / 1000).toString(),
        'Retry-After': resetInSeconds.toString(),
      },
    }
  );
}

/**
 * Rate limit a public (unauthenticated) route by IP address.
 * Returns a 429 response if limit is exceeded, or null if allowed.
 */
export async function rateLimitPublicRoute(
  req: NextRequest,
  endpoint: string,
  maxRequests: number = RATE_LIMIT_PUBLIC_MAX,
  windowMs: number = RATE_LIMIT_PUBLIC_WINDOW_MS
): Promise<NextResponse | null> {
  const ip = getClientIp(req);
  const key = `public:${endpoint}:${ip}`;
  const result = await rateLimit(key, maxRequests, windowMs);
  if (!result.allowed) {
    return rateLimitResponse(result.remaining, result.resetAt);
  }
  return null;
}

/**
 * Rate limit an admin (authenticated) route by userId.
 * Returns a 429 response if limit is exceeded, or null if allowed.
 *
 * Default: 10 requests per 60 seconds per user.
 */
export async function rateLimitAdminRoute(
  userId: string,
  endpoint: string,
  maxRequests: number = RATE_LIMIT_ADMIN_MAX,
  windowMs: number = RATE_LIMIT_ADMIN_WINDOW_MS
): Promise<NextResponse | null> {
  const key = `admin:${endpoint}:${userId}`;
  const result = await rateLimit(key, maxRequests, windowMs);
  if (!result.allowed) {
    return rateLimitResponse(result.remaining, result.resetAt);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Test helpers (exported for testing only)
// ---------------------------------------------------------------------------

/** Reset the Upstash limiter state — for testing only. */
export function _resetUpstashLimiter(): void {
  _initPromise = null;
}

/** Expose in-memory rate limit for direct testing. */
export { inMemoryRateLimit as _inMemoryRateLimit };
