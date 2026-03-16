import { NextRequest, NextResponse } from 'next/server';

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
/**
 * Validate that a string looks like a reasonable IP address (IPv4 or IPv6).
 * Rejects strings with suspicious characters that could indicate injection.
 */
function isValidIpFormat(ip: string): boolean {
  // IPv4: digits and dots
  // IPv6: hex digits, colons, and optional dots (for mapped IPv4)
  // Reject anything with spaces, slashes, or other suspicious chars
  return /^[\da-fA-F.:]+$/.test(ip) && ip.length <= 45;
}

/**
 * Extract a client identifier from the request for rate limiting.
 *
 * On Vercel, X-Forwarded-For is stripped and re-added by the edge, so the
 * first entry is trustworthy. For other deployments, we use the last IP in
 * the chain (the one added by the closest trusted proxy). In all cases we
 * validate that the value looks like a real IP to prevent spoofing with
 * arbitrary strings.
 */
export function getClientIp(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) {
    const parts = forwarded.split(',').map(s => s.trim()).filter(Boolean);
    // On Vercel the platform overwrites X-Forwarded-For, so the first IP is
    // the real client. On other proxies the last IP is the most trustworthy.
    // We use the first entry (Vercel-compatible) and validate it.
    const candidate = parts[0];
    if (candidate && isValidIpFormat(candidate)) {
      return candidate;
    }
    // If the first entry looks spoofed, try the last entry (closest proxy).
    const lastCandidate = parts[parts.length - 1];
    if (lastCandidate && isValidIpFormat(lastCandidate)) {
      return lastCandidate;
    }
    // All entries look invalid — fall through
  }

  const realIp = req.headers.get('x-real-ip');
  if (realIp && isValidIpFormat(realIp)) {
    return realIp;
  }

  return 'unknown';
}

/**
 * Rate limit a public (unauthenticated) route by IP address.
 * Returns a 429 response if limit is exceeded, or null if allowed.
 */
export function rateLimitPublicRoute(
  req: NextRequest,
  endpoint: string,
  maxRequests: number = 30,
  windowMs: number = 5 * 60 * 1000
): NextResponse | null {
  const ip = getClientIp(req);
  const key = `public:${endpoint}:${ip}`;
  const result = rateLimit(key, maxRequests, windowMs);
  if (!result.allowed) {
    return rateLimitResponse(result.remaining, result.resetAt);
  }
  return null;
}

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
 * Rate limit an admin (authenticated) route by userId.
 * Returns a 429 response if limit is exceeded, or null if allowed.
 *
 * Default: 10 requests per 60 seconds per user.
 */
export function rateLimitAdminRoute(
  userId: string,
  endpoint: string,
  maxRequests: number = 10,
  windowMs: number = 60_000
): NextResponse | null {
  const key = `admin:${endpoint}:${userId}`;
  const result = rateLimit(key, maxRequests, windowMs);
  if (!result.allowed) {
    return rateLimitResponse(result.remaining, result.resetAt);
  }
  return null;
}
