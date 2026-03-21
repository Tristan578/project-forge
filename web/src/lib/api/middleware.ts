/**
 * Shared API middleware helper.
 *
 * Standardises the auth → rate-limit pipeline for Next.js Route Handlers.
 *
 * ## Why this exists
 * Before PF-652, individual routes mixed the ordering of auth and rate-limit
 * calls, some routes used the in-memory `rateLimit()` where the distributed
 * Upstash limiter should be used, and a handful called `rateLimit()` without
 * awaiting the result. This helper centralises those concerns.
 *
 * ## Usage (authenticated route, distributed rate limit)
 * ```ts
 * export async function POST(req: NextRequest) {
 *   const mid = await withApiMiddleware(req, {
 *     requireAuth: true,
 *     rateLimit: true,
 *     rateLimitConfig: { key: (userId) => `chat:${userId}`, max: 10, windowSeconds: 60 },
 *   });
 *   if (mid.error) return mid.error;
 *   const { userId } = mid;
 *   // ...handler logic
 * }
 * ```
 *
 * ## Usage (public route, IP rate limit)
 * ```ts
 * export async function GET(req: NextRequest) {
 *   const mid = await withApiMiddleware(req, {
 *     requireAuth: false,
 *     rateLimit: true,
 *     rateLimitConfig: { key: () => 'health', max: 60, windowSeconds: 60, useIp: true },
 *   });
 *   if (mid.error) return mid.error;
 *   // ...handler logic
 * }
 * ```
 *
 * ## Pipeline order (always)
 * 1. Authentication (when requireAuth = true)
 * 2. Rate limiting  (when rateLimit = true)
 *
 * Auth always runs before rate limiting so that user-based rate-limit keys
 * are available, and so unauthenticated requests are rejected cheaply before
 * a Redis call is made.
 */

import type { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { rateLimit, getClientIp } from '@/lib/rateLimit';
import { distributedRateLimit } from '@/lib/rateLimit/distributed';
import type { AuthContext } from '@/lib/auth/api-auth';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RateLimitConfig {
  /**
   * Build the rate-limit bucket key.
   * Receives the authenticated userId (or the client IP when useIp = true).
   */
  key: (identifier: string) => string;
  /** Maximum requests allowed in the window. */
  max: number;
  /** Window size in seconds. */
  windowSeconds: number;
  /**
   * When true, use the client IP as the identifier rather than the userId.
   * Suitable for unauthenticated (public) endpoints.
   * Default: false
   */
  useIp?: boolean;
  /**
   * When true, use the distributed (Upstash) rate limiter.
   * When false, use the in-memory fallback.
   * Default: true — the distributed limiter always falls back to in-memory
   *   when Upstash is not configured, so this is safe to leave as true.
   */
  distributed?: boolean;
}

export interface MiddlewareOptions {
  /** Require a valid Clerk session + DB user. Default: true */
  requireAuth?: boolean;
  /** Run rate limiting. Default: false */
  rateLimit?: boolean;
  /** Rate-limit configuration. Required when rateLimit = true. */
  rateLimitConfig?: RateLimitConfig;
}

/** Successful middleware result — handler may proceed. */
export interface MiddlewareSuccess {
  error: undefined;
  /** Clerk user ID. Null when requireAuth = false and the user is unauthenticated. */
  userId: string | null;
  /** Full auth context (user + clerkId). Null when requireAuth = false. */
  authContext: AuthContext | null;
}

/** Failed middleware result — return the error response directly. */
export interface MiddlewareFailure {
  error: NextResponse;
  userId: null;
  authContext: null;
}

export type MiddlewareResult = MiddlewareSuccess | MiddlewareFailure;

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Run the standard API middleware pipeline (auth → rate-limit) and return
 * either a success result or an error response to return immediately.
 *
 * @example
 * ```ts
 * const mid = await withApiMiddleware(req, { requireAuth: true, rateLimit: true,
 *   rateLimitConfig: { key: (id) => `chat:${id}`, max: 10, windowSeconds: 60 } });
 * if (mid.error) return mid.error;
 * ```
 */
export async function withApiMiddleware(
  req: NextRequest,
  options: MiddlewareOptions = {},
): Promise<MiddlewareResult> {
  const requireAuth = options.requireAuth ?? true;
  const shouldRateLimit = options.rateLimit ?? false;

  // ------------------------------------------------------------------
  // Step 1: Authentication
  // ------------------------------------------------------------------
  let authContext: AuthContext | null = null;
  let userId: string | null = null;

  if (requireAuth) {
    const authResult = await authenticateRequest();
    if (!authResult.ok) {
      return { error: authResult.response, userId: null, authContext: null };
    }
    authContext = authResult.ctx;
    userId = authResult.ctx.user.id;
  }

  // ------------------------------------------------------------------
  // Step 2: Rate limiting
  // ------------------------------------------------------------------
  if (shouldRateLimit && options.rateLimitConfig) {
    const cfg = options.rateLimitConfig;
    const useDistributed = cfg.distributed ?? true;

    // Determine the bucket identifier
    const identifier = cfg.useIp ? getClientIp(req) : (userId ?? getClientIp(req));
    const bucketKey = cfg.key(identifier);

    let allowed: boolean;
    let remaining: number;
    let resetAt: number;

    if (useDistributed) {
      const result = await distributedRateLimit(bucketKey, cfg.max, cfg.windowSeconds);
      allowed = result.allowed;
      remaining = result.remaining;
      resetAt = result.resetAt;
    } else {
      const result = await rateLimit(bucketKey, cfg.max, cfg.windowSeconds * 1000);
      allowed = result.allowed;
      remaining = result.remaining;
      resetAt = result.resetAt;
    }

    if (!allowed) {
      const { rateLimitResponse: rlResponse } = await import('@/lib/rateLimit');
      return {
        error: rlResponse(remaining, resetAt),
        userId: null,
        authContext: null,
      };
    }
  }

  return { error: undefined, userId, authContext };
}
