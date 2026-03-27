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
import type { ZodSchema } from 'zod';

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
  /**
   * Zod schema to validate the request body against.
   * When provided, the body is parsed from JSON, validated, and passed to the
   * handler as `context.body`. On failure, returns 422 VALIDATION_ERROR.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  validate?: ZodSchema<any>;
}

// ---------------------------------------------------------------------------
// Handler-wrapping overload types (Plan E)
// ---------------------------------------------------------------------------

/** Context passed to wrapped handlers. */
export interface HandlerContext {
  userId: string | null;
  authContext: AuthContext | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any;
}

export type WrappedHandler = (
  req: NextRequest,
  context: HandlerContext,
) => Promise<NextResponse>;

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
 * Run the standard API middleware pipeline (auth → rate-limit → validate)
 * and return either a success result or an error response.
 *
 * **Overload 1 — result object** (existing usage):
 * ```ts
 * const mid = await withApiMiddleware(req, { requireAuth: true });
 * if (mid.error) return mid.error;
 * ```
 *
 * **Overload 2 — handler wrapper** (Plan E):
 * ```ts
 * export const POST = withApiMiddleware(
 *   async (req, { body, userId }) => NextResponse.json({ ok: true }),
 *   { requireAuth: true, validate: z.object({ name: z.string() }) },
 * );
 * ```
 */
export function withApiMiddleware(
  handler: WrappedHandler,
  options: MiddlewareOptions,
): (req: NextRequest) => Promise<NextResponse>;
export function withApiMiddleware(
  req: NextRequest,
  options?: MiddlewareOptions,
): Promise<MiddlewareResult>;
export function withApiMiddleware(
  reqOrHandler: NextRequest | WrappedHandler,
  options: MiddlewareOptions = {},
): Promise<MiddlewareResult> | ((req: NextRequest) => Promise<NextResponse>) {
  // Handler-wrapping overload
  if (typeof reqOrHandler === 'function') {
    const handler = reqOrHandler;
    return (req: NextRequest) => runMiddlewarePipeline(req, options, handler) as Promise<NextResponse>;
  }
  // Legacy result-object overload
  return runMiddlewarePipeline(reqOrHandler, options, null) as Promise<MiddlewareResult>;
}

// ---------------------------------------------------------------------------
// Core pipeline (shared between both overloads)
// ---------------------------------------------------------------------------

async function runMiddlewarePipeline(
  req: NextRequest,
  options: MiddlewareOptions,
  handler: WrappedHandler | null,
): Promise<MiddlewareResult | NextResponse> {
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
      if (handler) return authResult.response;
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
      const errorResponse = rlResponse(remaining, resetAt);
      if (handler) return errorResponse;
      return { error: errorResponse, userId: null, authContext: null };
    }
  }

  // ------------------------------------------------------------------
  // Step 3: Body validation (handler-wrapping overload only)
  // ------------------------------------------------------------------
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: any = undefined;

  if (options.validate) {
    let rawBody: unknown;
    try {
      rawBody = await req.json();
    } catch {
      const { apiError } = await import('@/lib/api/errors');
      const errResponse = apiError(400, 'Invalid JSON body', 'BAD_REQUEST');
      if (handler) return errResponse;
      return { error: errResponse, userId: null, authContext: null };
    }

    const parsed = options.validate.safeParse(rawBody);
    if (!parsed.success) {
      const { apiError } = await import('@/lib/api/errors');
      const errResponse = apiError(422, 'Validation failed', 'VALIDATION_ERROR', parsed.error.format());
      if (handler) return errResponse;
      return { error: errResponse, userId: null, authContext: null };
    }
    body = parsed.data;
  }

  // ------------------------------------------------------------------
  // Handler invocation (handler-wrapping overload only)
  // ------------------------------------------------------------------
  if (handler) {
    return handler(req, { userId, authContext, body });
  }

  return { error: undefined, userId, authContext };
}
