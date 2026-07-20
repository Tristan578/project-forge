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

import { NextRequest, NextResponse, after } from 'next/server';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { resolveApiKey, ApiKeyError } from '@/lib/keys/resolver';
import type { Provider } from '@/lib/db/schema';
import { getTokenCost } from '@/lib/tokens/pricing';
import { captureException, sentryLogger } from '@/lib/monitoring/sentry-server';
import { checkBotIdGate } from '@/lib/security/botId';
import { rateLimitResponse } from '@/lib/rateLimit';
import { distributedRateLimit, aggregateGenerationRateLimit } from '@/lib/rateLimit/distributed';
import { sanitizePrompt } from '@/lib/ai/contentSafety';
import { refundTokens } from '@/lib/tokens/service';
import { cachedGenerate } from './responseCache';
import { runGenerationAgent, isGenerationAgentEnabled } from './generationAgent';
import {
  API_MAX_DURATION_STANDARD_GEN_S,
  deriveGenerationStepTimeoutMs,
} from '@/lib/config/timeouts';
import { isQstashConfigured, publishGenerationCallback } from '@/lib/qstash/client';
import type { AsyncGenerationType } from '@/lib/generate/pollProviderStatus';
import { isProviderKilled } from '@/lib/flags/posthogFlags';

/** Default initial delay before the first durable generation callback (PF-906). */
const DEFAULT_CALLBACK_DELAY_SECONDS = 30;

/**
 * Client-facing message for every 500. Raw `err.message` can carry server
 * internals — env var names ("Platform key not configured: ANTHROPIC_API_KEY"),
 * DB connection strings, provider request IDs — so it must never be returned to
 * the caller. The full error goes only to Sentry via captureException; the
 * client gets this opaque string and a 500 (#8597). ApiKeyError messages are
 * exempt: they are deliberately user-facing guidance returned as 402, not 500.
 */
const GENERIC_500_MESSAGE = 'Generation failed due to a server error. Please try again later.';

/**
 * Client-facing message when a provider is disabled via the PF-971 kill
 * switch (`provider-kill-switch-<provider>` PostHog flag). Generic on
 * purpose — same reasoning as GENERIC_500_MESSAGE, no internal flag/provider
 * plumbing leaked beyond the provider name already visible to the caller.
 */
const PROVIDER_UNAVAILABLE_MESSAGE = (provider: string) =>
  `Generation via ${provider} is temporarily unavailable. Please try again shortly.`;

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

  /**
   * Additional user-controlled free-text fields to run through the same
   * content-safety filter as `promptField`. Routes that forward secondary text
   * (e.g. `negativePrompt`, `artStyle`) to a generation provider must list those
   * fields here so they cannot bypass the blocklist/injection screen (#8650).
   * Each named field is checked only when present and a non-empty string.
   */
  secondaryPromptFields?: string[];

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
   * Extract a small metadata object from params for billing records.
   * When omitted, params is passed directly — routes with large fields
   * (imageBase64, strings arrays) SHOULD provide this to avoid bloating
   * the token_usage.metadata JSONB column.
   */
  billingMetadata?: (params: TParams) => Record<string, unknown>;

  /**
   * Execute the provider call with validated params and resolved API key.
   * The return value is sent as the JSON response body.
   */
  execute: (params: TParams, apiKey: string, ctx: {
    userId: string;
    tier: string;
    usageId: string | undefined;
    tokenCost: number;
    /**
     * Abort signal wired to the generation agent's per-step wall-clock deadline.
     * Only present when the USE_GENERATION_AGENT flag is on (otherwise undefined).
     * Routes SHOULD forward it to their provider client / `fetch` so a hung call
     * aborts deterministically before the function `maxDuration`. Optional and
     * additive: existing routes that ignore it are unaffected.
     */
    abortSignal?: AbortSignal;
  }) => Promise<TResult>;

  /**
   * Extract cache-relevant params from validated params. Only these fields
   * contribute to the cache key. Omit large binary fields (imageBase64, etc.)
   * and volatile fields (timestamps, request IDs).
   *
   * When omitted, caching is disabled for this route.
   */
  cacheKeyParams?: (params: TParams) => Record<string, unknown>;

  /** Override TTL for cached results (in seconds). Uses operation-based defaults if omitted. */
  cacheTtlSeconds?: number;

  /**
   * The route's Vercel `maxDuration` (seconds) — i.e. the value of the route's
   * `export const maxDuration`. The generation agent derives its per-step
   * wall-clock cap from this so the abort always fires BEFORE Vercel kills the
   * function (and the refund path runs). Defaults to
   * `API_MAX_DURATION_STANDARD_GEN_S` (60s) — the value 10 of the 13 generate
   * routes use — so a route that forgets to set it still gets an enforceable
   * timeout. Heavy routes (model, music = 180s) MUST set 180 here so the cap is
   * derived against their real budget.
   */
  maxDurationSeconds?: number;

  /**
   * Durable server-side callback config (PF-906, #8816). When set AND QStash is
   * configured, the factory publishes a self-rescheduling QStash callback after
   * a successful provider submission, so the `generation_jobs` row is finalized
   * + refunded server-side even if the user closes the tab.
   *
   * Fully additive and DORMANT by default: when `QSTASH_TOKEN` is unset nothing
   * is published and the response shape is unchanged. The factory cannot know
   * the opaque `TResult` shape, so the route declares how to extract the
   * provider job id and which enum type it is. Only async routes (a provider
   * task id + a status route) should set this.
   */
  asyncJob?: {
    /** generation_type enum member this route produces. */
    type: AsyncGenerationType;
    /**
     * Extract the provider job id from the execute result, or return null for a
     * synchronously-completed result (e.g. DALL-E inline) that needs no polling.
     */
    providerJobId: (result: TResult) => string | null;
    /** Initial callback delay in seconds (defaults to DEFAULT_CALLBACK_DELAY_SECONDS). */
    estimatedSeconds?: number;
  };
}

/**
 * Create a POST handler for an AI generation route.
 *
 * Handles the full billing pipeline:
 *   1. Authenticate via Clerk
 *   2. Distributed rate limiting
 *   3. Parse + validate request body
 *   4. Content safety filter on prompt
 *   5. Resolve provider/operation/token cost, check the PF-971 provider
 *      kill switch, then check the response cache
 *   6. Resolve API key + deduct tokens
 *   7. Execute provider call
 *   8. Refund tokens on provider failure
 *   9. Capture exceptions to Sentry
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
    secondaryPromptFields,
    skipContentSafety = false,
    successStatus = 200,
    tokenCost: tokenCostFn,
    billingMetadata: billingMetadataFn,
    validate,
    execute,
    cacheKeyParams,
    cacheTtlSeconds,
    maxDurationSeconds = API_MAX_DURATION_STANDARD_GEN_S,
    asyncJob,
  } = config;

  /**
   * After a successful provider submission, publish the durable QStash callback
   * (PF-906). No-ops unless QStash is configured, `asyncJob` is declared, and
   * the result carries a pollable provider job id. A publish failure is logged
   * to Sentry but NEVER fails the user's request — the client poller still
   * covers completion, and the response shape is unchanged.
   */
  async function maybePublishAsyncCallback(
    result: TResult,
    userId: string,
    usageId: string | undefined,
  ): Promise<void> {
    if (!asyncJob || !isQstashConfigured()) return;

    let providerJobId: string | null;
    try {
      providerJobId = asyncJob.providerJobId(result);
    } catch (err) {
      captureException(err, { route, action: 'qstash_extract_job_id' });
      return;
    }
    if (!providerJobId) return;

    try {
      await publishGenerationCallback(
        {
          userId,
          providerJobId,
          type: asyncJob.type,
          tokenUsageId: usageId ?? null,
          attempt: 0,
        },
        { delaySeconds: asyncJob.estimatedSeconds ?? DEFAULT_CALLBACK_DELAY_SECONDS },
      );
    } catch (err) {
      captureException(err, { route, action: 'qstash_publish' });
    }
  }

  // Per-route enforceable step timeout: derived from this route's maxDuration so
  // the agent's abort always fires before Vercel kills the function. A 150s base
  // cap (the old bug) could never fire on a 60s route — this clamps it.
  const stepTimeoutMs = deriveGenerationStepTimeoutMs(maxDurationSeconds);

  // Run the provider call either inline (legacy default) or through the
  // deterministic generation agent (step + timeout caps) when the
  // USE_GENERATION_AGENT flag is on. Either way the result — and therefore the
  // response shape, usageId, and no-artifact→failed mapping the route encodes —
  // is identical; only the termination guarantees differ. Refund-on-failure
  // stays in the factory, so the async-refund contract is path-independent.
  const useAgent = isGenerationAgentEnabled();
  const runExecute = (
    params: TParams,
    apiKey: string,
    ctx: { userId: string; tier: string; usageId: string | undefined; tokenCost: number },
  ): Promise<TResult> => {
    if (!useAgent) {
      return execute(params, apiKey, ctx);
    }
    return runGenerationAgent<TResult>({
      step: ({ signal }) => execute(params, apiKey, { ...ctx, abortSignal: signal }),
      timeoutMs: stepTimeoutMs,
    });
  };

  return async (request: NextRequest): Promise<NextResponse> => {
    // 1. Authenticate
    const authResult = await authenticateRequest();
    if (!authResult.ok) return authResult.response;

    const userId = authResult.ctx.user.id;
    const tier = authResult.ctx.user.tier;

    // 1b. BotID gate (PF-975 / #8948) — before ANY rate-limit consumption or
    // token deduction, so a blocked bot never spends either budget.
    const botIdResponse = await checkBotIdGate();
    if (botIdResponse) return botIdResponse;

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
      const parsed = await request.json();
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return NextResponse.json({ error: 'Request body must be a JSON object' }, { status: 400 });
      }
      rawBody = parsed as Record<string, unknown>;
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

    // 5. Content safety filter.
    //
    // Screen every user-controlled free-text field — the primary `promptField`
    // and any `secondaryPromptFields` — so secondary text (negativePrompt,
    // artStyle, …) cannot bypass the blocklist/injection screen that protects
    // the primary prompt (#8650). Each field is checked only when present and a
    // non-empty string; rejected content fails the whole request 422.
    if (!skipContentSafety) {
      const paramRecord = params as Record<string, unknown>;
      const fieldsToScreen = [promptField, ...(secondaryPromptFields ?? [])];
      for (const field of fieldsToScreen) {
        const value = paramRecord[field];
        if (typeof value === 'string' && value.length > 0) {
          const safety = sanitizePrompt(value);
          if (!safety.safe) {
            return NextResponse.json(
              { error: safety.reason ?? 'Content rejected by safety filter' },
              { status: 422 }
            );
          }
          // Replace with filtered version
          paramRecord[field] = safety.filtered ?? value;
        }
      }
    }

    // 6. Resolve provider, operation, and token cost
    let resolvedProvider: Provider;
    let resolvedOperation: string;
    let tokenCost: number;
    try {
      resolvedProvider = typeof provider === 'function' ? provider(params) : provider;
      resolvedOperation = typeof operation === 'function' ? operation(params) : operation;
      const rawCost = tokenCostFn ? tokenCostFn(params) : getTokenCost(resolvedOperation);
      tokenCost = Math.round(rawCost);
      if (!Number.isFinite(tokenCost) || tokenCost < 0) {
        captureException(new Error(`Invalid token cost: ${rawCost}`), { route });
        return NextResponse.json({ error: 'Internal pricing error' }, { status: 500 });
      }
    } catch (err) {
      captureException(err, { route, action: 'resolve_billing_params' });
      return NextResponse.json({ error: 'Internal pricing error' }, { status: 500 });
    }

    // 6b. Provider kill switch (PF-971 / #8952). Checked immediately after the
    // provider resolves and BEFORE any cache lookup or token deduction, so a
    // killed provider costs the caller nothing on either path. Fails open:
    // dormant unless PostHog flag evaluation is configured, and any
    // evaluation failure resolves to "not killed" (see posthogFlags.ts).
    if (isProviderKilled(resolvedProvider)) {
      // Lifecycle signal, not per-request noise: a killed provider is a rare,
      // operator-driven state change worth a searchable Sentry Logs entry
      // (PF-967 / #8956), distinct from the exception-tracking captureException
      // calls elsewhere in this file.
      sentryLogger.warn('provider kill switch tripped', { route, provider: resolvedProvider });
      return NextResponse.json(
        { error: PROVIDER_UNAVAILABLE_MESSAGE(resolvedProvider) },
        { status: 503 }
      );
    }

    // 6c. Check response cache (before token deduction — cache hits are free)
    if (cacheKeyParams) {
      const cacheParams = cacheKeyParams(params);
      // Captured on a cache MISS so the durable callback can be published after
      // cachedGenerate returns (a cache HIT is a re-served prior result — no new
      // provider job, so nothing to poll).
      let cacheMiss: { result: TResult; usageId: string | undefined } | undefined;
      try {
        const cacheResult = await cachedGenerate<TResult>(
          resolvedOperation,
          cacheParams,
          async () => {
            // Cache miss — deduct tokens and execute provider call
            // This runs only on cache miss — deduct tokens and execute
            const metadata = billingMetadataFn ? billingMetadataFn(params) : (params as Record<string, unknown>);
            const resolved = await resolveApiKey(userId, resolvedProvider, tokenCost, resolvedOperation, metadata);
            const apiKey = resolved.key;
            const usageId = resolved.usageId;

            try {
              const generated = await runExecute(params, apiKey, { userId, tier, usageId, tokenCost });
              cacheMiss = { result: generated, usageId };
              return generated;
            } catch (err) {
              // Refund tokens on provider failure
              if (usageId) {
                try {
                  await refundTokens(userId, usageId);
                  sentryLogger.info('token refund issued', { route, usageId });
                } catch (refundErr) {
                  captureException(refundErr, { route, action: 'refund', usageId });
                }
              }
              throw err;
            }
          },
          { ttlSeconds: cacheTtlSeconds, userId }
        );

        if (!cacheResult.cached && cacheMiss && asyncJob && isQstashConfigured()) {
          // Run the durable publish post-response: `after()` keeps the Vercel
          // function alive so the publish never adds latency to — or can fail —
          // the submit. maybePublishAsyncCallback is self-guarded (never throws),
          // safe to fire-and-forget. Gated on asyncJob + QStash so the dormant
          // path (and every non-async route) never touches `after()` at all —
          // `after()` requires a request scope, which only exists at runtime.
          const { result: missResult, usageId: missUsageId } = cacheMiss;
          after(() => maybePublishAsyncCallback(missResult, userId, missUsageId));
        }

        const headers: Record<string, string> = {
          'X-Cache': cacheResult.cached ? 'HIT' : 'MISS',
        };
        return NextResponse.json(cacheResult.result, { status: successStatus, headers });
      } catch (err) {
        if (err instanceof ApiKeyError) {
          return NextResponse.json({ error: err.message, code: err.code }, { status: 402 });
        }
        captureException(err, { route });
        return NextResponse.json({ error: GENERIC_500_MESSAGE }, { status: 500 });
      }
    }

    // 6d. No caching — original path: resolve key, deduct, execute
    let apiKey: string;
    let usageId: string | undefined;

    try {
      const metadata = billingMetadataFn ? billingMetadataFn(params) : (params as Record<string, unknown>);
      const resolved = await resolveApiKey(userId, resolvedProvider, tokenCost, resolvedOperation, metadata);
      apiKey = resolved.key;
      usageId = resolved.usageId;
    } catch (err) {
      if (err instanceof ApiKeyError) {
        return NextResponse.json({ error: err.message, code: err.code }, { status: 402 });
      }
      // A non-ApiKeyError here is a server-side failure (missing platform key,
      // DB error, etc.). Re-throwing surfaced it as an uninstrumented unhandled
      // rejection with no Sentry signal and a generic framework 500. Convert it
      // to a structured 500 and alert Sentry, mirroring the cached path (#8597).
      captureException(err, { route });
      return NextResponse.json({ error: GENERIC_500_MESSAGE }, { status: 500 });
    }

    try {
      const result = await runExecute(params, apiKey, { userId, tier, usageId, tokenCost });
      // Run the durable publish post-response (see cached path). Same asyncJob +
      // QStash gate so the dormant/non-async path never touches `after()`.
      if (asyncJob && isQstashConfigured()) {
        after(() => maybePublishAsyncCallback(result, userId, usageId));
      }
      return NextResponse.json(result, { status: successStatus });
    } catch (err) {
      // Refund tokens on provider failure
      if (usageId) {
        try {
          await refundTokens(userId, usageId);
          sentryLogger.info('token refund issued', { route, usageId });
        } catch (refundErr) {
          captureException(refundErr, { route, action: 'refund', usageId });
        }
      }
      captureException(err, { route });
      return NextResponse.json({ error: GENERIC_500_MESSAGE }, { status: 500 });
    }
  };
}
