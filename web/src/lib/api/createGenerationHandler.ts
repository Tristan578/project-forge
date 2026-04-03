/**
 * Factory for AI generation API route handlers (PF-316, PF-903).
 *
 * Eliminates ~80 lines of boilerplate per route by centralizing:
 *   auth → rate limit → parse body → validate → content safety → resolve key →
 *   deduct tokens → call provider → refund on failure → captureException
 *
 * Usage:
 *   export const POST = createGenerationHandler({
 *     route: '/api/generate/sfx',
 *     provider: 'elevenlabs',
 *     operation: 'sfx_generation',
 *     rateLimitKey: 'gen-sfx',
 *     validate: (body) => { ... return { prompt, durationSeconds }; },
 *     execute: async (params, apiKey) => { ... return responsePayload; },
 *   });
 */

import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { resolveApiKey, ApiKeyError } from '@/lib/keys/resolver';
import type { Provider } from '@/lib/db/schema';
import { getTokenCost } from '@/lib/tokens/pricing';
import { captureException } from '@/lib/monitoring/sentry-server';
import { rateLimitResponse } from '@/lib/rateLimit';
import { distributedRateLimit, aggregateGenerationRateLimit } from '@/lib/rateLimit/distributed';
import { sanitizePrompt } from '@/lib/ai/contentSafety';
import { refundTokens } from '@/lib/tokens/service';

/** Validation result: either the parsed params or an error response. */
type ValidateResult<T> =
  | { ok: true; params: T }
  | { ok: false; error: string; status?: number };

/** Configuration for a generation handler. */
export interface GenerationHandlerConfig<TParams, TResult> {
  /** Route path for Sentry context (e.g. '/api/generate/sfx') */
  route: string;

  /** Provider name for API key resolution. Static or computed from validated params. */
  provider: Provider | ((params: TParams) => Provider);

  /** Token operation name for pricing lookup. Static or computed from validated params. */
  operation: string | ((params: TParams) => string);

  /** Rate limit key prefix (user ID is appended) */
  rateLimitKey: string;

  /** Rate limit: max requests per window (default: 10) */
  rateLimitMax?: number;

  /** Rate limit: window in seconds (default: 300 = 5 minutes) */
  rateLimitWindowSeconds?: number;

  /** Field in the parsed body to pass through content safety (default: 'prompt') */
  promptField?: string;

  /** Skip content safety check (for routes that don't have a text prompt) */
  skipContentSafety?: boolean;

  /** HTTP status code for successful responses (default: 200) */
  successStatus?: number;

  /**
   * Override the token cost with a dynamic value computed from validated params.
   * When provided, this replaces the static `getTokenCost(operation)` lookup.
   */
  tokenCost?: (params: TParams) => number;

  /**
   * Validate and extract typed params from the raw request body.
   * Return `{ ok: true, params }` or `{ ok: false, error, status }`.
   */
  validate: (body: Record<string, unknown>) => ValidateResult<TParams>;

  /**
   * Execute the provider call with validated params and resolved API key.
   * The return value is sent as the JSON response body.
   */
  execute: (params: TParams, apiKey: string, ctx: {
    userId: string;
    tier: string;
    usageId: string | undefined;
    tokenCost: number;
  }) => Promise<TResult>;
}

/**
 * Create a POST handler for an AI generation route.
 *
 * Handles the full billing pipeline:
 *   1. Authenticate via Clerk
 *   2. Distributed rate limiting
 *   3. Parse + validate request body
 *   4. Content safety filter on prompt
 *   5. Resolve API key + deduct tokens
 *   6. Execute provider call
 *   7. Refund tokens on provider failure
 *   8. Capture exceptions to Sentry
 */
export function createGenerationHandler<TParams, TResult>(
  config: GenerationHandlerConfig<TParams, TResult>
): (request: NextRequest) => Promise<NextResponse> {
  const {
    route,
    provider,
    operation,
    rateLimitKey,
    rateLimitMax = 10,
    rateLimitWindowSeconds = 300,
    promptField = 'prompt',
    skipContentSafety = false,
    successStatus = 200,
    tokenCost: tokenCostFn,
    validate,
    execute,
  } = config;

  return async (request: NextRequest): Promise<NextResponse> => {
    // 1. Authenticate
    const authResult = await authenticateRequest();
    if (!authResult.ok) return authResult.response;

    const userId = authResult.ctx.user.id;
    const tier = authResult.ctx.user.tier;

    // 2a. Aggregate rate limit across ALL generation routes (30 req / 15 min per user)
    const aggRl = await aggregateGenerationRateLimit(userId);
    if (!aggRl.allowed) return rateLimitResponse(aggRl.remaining, aggRl.resetAt);

    // 2b. Per-route rate limit (distributed via Upstash)
    const rl = await distributedRateLimit(
      `${rateLimitKey}:${userId}`,
      rateLimitMax,
      rateLimitWindowSeconds
    );
    if (!rl.allowed) return rateLimitResponse(rl.remaining, rl.resetAt);

    // 3. Parse request body
    let rawBody: Record<string, unknown>;
    try {
      rawBody = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    // 4. Validate
    const validation = validate(rawBody);
    if (!validation.ok) {
      return NextResponse.json(
        { error: validation.error },
        { status: validation.status ?? 422 }
      );
    }
    const params = validation.params;

    // 5. Content safety filter
    if (!skipContentSafety) {
      const promptValue = (params as Record<string, unknown>)[promptField];
      if (typeof promptValue === 'string' && promptValue.length > 0) {
        const safety = sanitizePrompt(promptValue);
        if (!safety.safe) {
          return NextResponse.json(
            { error: safety.reason ?? 'Content rejected by safety filter' },
            { status: 422 }
          );
        }
        // Replace with filtered version
        (params as Record<string, unknown>)[promptField] = safety.filtered ?? promptValue;
      }
    }

    // 6. Resolve API key + deduct tokens
    const resolvedProvider = typeof provider === 'function' ? provider(params) : provider;
    const resolvedOperation = typeof operation === 'function' ? operation(params) : operation;
    let tokenCost: number;
    try {
      tokenCost = tokenCostFn ? tokenCostFn(params) : getTokenCost(resolvedOperation);
      if (!Number.isFinite(tokenCost) || tokenCost < 0) {
        captureException(new Error(`Invalid token cost: ${tokenCost}`), { route });
        return NextResponse.json({ error: 'Internal pricing error' }, { status: 500 });
      }
    } catch (err) {
      captureException(err, { route, action: 'tokenCost' });
      return NextResponse.json({ error: 'Internal pricing error' }, { status: 500 });
    }
    let apiKey: string;
    let usageId: string | undefined;

    try {
      const resolved = await resolveApiKey(userId, resolvedProvider, tokenCost, resolvedOperation, params as Record<string, unknown>);
      apiKey = resolved.key;
      usageId = resolved.usageId;
    } catch (err) {
      if (err instanceof ApiKeyError) {
        return NextResponse.json({ error: err.message, code: err.code }, { status: 402 });
      }
      throw err;
    }

    // 7. Execute provider call
    try {
      const result = await execute(params, apiKey, { userId, tier, usageId, tokenCost });
      return NextResponse.json(result, { status: successStatus });
    } catch (err) {
      // 8. Refund tokens on provider failure
      if (usageId) {
        try {
          await refundTokens(userId, usageId);
        } catch (refundErr) {
          captureException(refundErr, { route, action: 'refund', usageId });
        }
      }
      captureException(err, { route });
      const message = err instanceof Error ? err.message : 'Provider error';
      return NextResponse.json({ error: message }, { status: 500 });
    }
  };
}
