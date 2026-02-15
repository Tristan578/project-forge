import { NextResponse } from 'next/server';

interface RateLimitEntry {
  timestamps: number[];
}

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

/**
 * In-memory sliding window rate limiter.
 * Maps keys to timestamps of recent requests.
 */
const rateLimitStore = new Map<string, RateLimitEntry>();

/**
 * Auto-cleanup stale entries every 5 minutes to prevent memory leaks.
 */
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
let cleanupInterval: NodeJS.Timeout | null = null;

function startCleanup() {
  if (cleanupInterval) return;
  cleanupInterval = setInterval(() => {
    const now = Date.now();
    const maxAge = 60 * 60 * 1000; // 1 hour
    for (const [key, entry] of rateLimitStore.entries()) {
      if (entry.timestamps.length === 0 || entry.timestamps[entry.timestamps.length - 1] < now - maxAge) {
        rateLimitStore.delete(key);
      }
    }
  }, CLEANUP_INTERVAL_MS);
}

// Start cleanup on module load
if (typeof window === 'undefined') {
  startCleanup();
}

/**
 * Rate limit a request using a sliding window algorithm.
 *
 * @param key - Unique identifier for the rate limit bucket (e.g., user ID + endpoint)
 * @param maxRequests - Maximum number of requests allowed in the window
 * @param windowMs - Time window in milliseconds
 * @returns Result indicating if request is allowed, remaining quota, and reset time
 */
export function rateLimit(
  key: string,
  maxRequests: number,
  windowMs: number
): RateLimitResult {
  const now = Date.now();
  const windowStart = now - windowMs;

  // Get or create entry
  let entry = rateLimitStore.get(key);
  if (!entry) {
    entry = { timestamps: [] };
    rateLimitStore.set(key, entry);
  }

  // Remove timestamps outside the current window
  entry.timestamps = entry.timestamps.filter(ts => ts > windowStart);

  // Check if under limit
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

/**
 * Create a NextResponse with 429 status and rate limit headers.
 *
 * @param remaining - Number of requests remaining in the current window
 * @param resetAt - Unix timestamp (ms) when the rate limit resets
 * @returns NextResponse with appropriate status and headers
 */
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
