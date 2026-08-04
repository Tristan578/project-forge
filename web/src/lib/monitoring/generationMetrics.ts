import * as Sentry from '@sentry/nextjs';

/**
 * Business metrics for the `/api/generate/*` surface (PF-1053).
 *
 * These are deliberately BUSINESS metrics, not runtime ones: request volume by
 * outcome, end-to-end latency, and tokens actually charged. Runtime health (RSS,
 * heap, CPU, event loop) is already covered by `nodeRuntimeMetricsIntegration`
 * in sentry.server.config.ts — duplicating it here would cost cardinality for
 * nothing.
 *
 * Everything in this module FAILS OPEN. `createGenerationHandler` is a single
 * point of failure for all 12 generate routes; observability must never be able
 * to take them down, and on the error path it must never mask the real cause.
 */

/** Counter: one sample per generate request, faceted by outcome. */
export const GENERATION_REQUEST_METRIC = 'generation.request';
/** Distribution: end-to-end handler latency in milliseconds. */
export const GENERATION_DURATION_METRIC = 'generation.duration';
/** Distribution: tokens actually charged (successes only — failures are refunded). */
export const GENERATION_TOKENS_METRIC = 'generation.tokens_charged';

/**
 * Business outcome of a generate request. This is the alerting dimension — a
 * spike in `provider_unavailable` is an upstream incident, a spike in
 * `insufficient_tokens` is a billing/UX signal, and neither should be buried in
 * an undifferentiated "non-200" bucket.
 *
 * NAMING CONSTRAINT: Sentry's server-side data scrubber runs over metric
 * ATTRIBUTE VALUES, not just keys, and replaces any value containing one of its
 * default sensitive substrings with `[Filtered]` before the value is ever
 * indexed. `dataScrubberDefaults` is on for this project, so no SDK-side option
 * turns it off. The obvious name for 401 — `unauthenticated` — contains `auth`
 * and shipped as an unqueryable `[Filtered]` bucket; hence `signed_out`.
 * `GENERATION_OUTCOMES` exists so a test can iterate the vocabulary and pin
 * this, since a scrubbed value is invisible in code review and silently
 * un-alertable in production.
 */
export const GENERATION_OUTCOMES = [
  'success',
  'signed_out',
  'bot_blocked',
  'rate_limited',
  'insufficient_tokens',
  'rejected',
  'provider_unavailable',
  'error',
] as const;

export type GenerationOutcome = (typeof GENERATION_OUTCOMES)[number];

/**
 * Mutable per-request context. The handler resolves provider/operation/cost/tier
 * partway through its own body (after auth, rate limiting, and validation), so
 * the wrapper hands it this object to fill in and reads it back only AFTER the
 * handler returns. A request rejected early simply leaves fields unset, and
 * unset fields are omitted from the metric rather than shipped as `undefined`.
 */
export interface GenerationMetricsContext {
  provider?: string;
  operation?: string;
  tokenCost?: number;
  tier?: string;
}

const STATUS_OUTCOMES: Record<number, GenerationOutcome> = {
  200: 'success',
  201: 'success',
  400: 'rejected',
  401: 'signed_out',
  402: 'insufficient_tokens',
  403: 'bot_blocked',
  422: 'rejected',
  429: 'rate_limited',
  503: 'provider_unavailable',
};

/**
 * Map an HTTP status to its business outcome.
 *
 * Unmapped statuses fall back by CLASS, not to `error`: a future validation
 * branch returning 409/415 is a client rejection and must not inflate the error
 * rate that pages someone.
 */
export function classifyGenerationOutcome(status: number): GenerationOutcome {
  const known = STATUS_OUTCOMES[status];
  if (known) return known;
  if (status >= 200 && status < 300) return 'success';
  if (status >= 400 && status < 500) return 'rejected';
  return 'error';
}

/** Emit the metrics for one completed generate request. Never throws. */
export function recordGenerationMetrics({
  route,
  status,
  durationMs,
  ctx,
  cache,
}: {
  route: string;
  status: number;
  durationMs: number;
  ctx: GenerationMetricsContext;
  cache?: string;
}): void {
  try {
    const outcome = classifyGenerationOutcome(status);

    // Built by assignment rather than an object literal so unresolved fields are
    // ABSENT, not present-and-undefined: Sentry would otherwise render a junk
    // `undefined` facet value alongside the real providers.
    const attributes: Record<string, string | number> = { route, outcome, status };
    if (ctx.provider !== undefined) attributes.provider = ctx.provider;
    if (ctx.operation !== undefined) attributes.operation = ctx.operation;
    if (ctx.tier !== undefined) attributes.tier = ctx.tier;
    if (cache !== undefined) attributes.cache = cache;

    Sentry.metrics.count(GENERATION_REQUEST_METRIC, 1, { attributes });
    Sentry.metrics.distribution(GENERATION_DURATION_METRIC, durationMs, {
      unit: 'millisecond',
      attributes,
    });

    // Successes only. A failed generation is refunded, so counting its would-be
    // cost as consumption would overstate revenue for every provider outage.
    // `!== undefined` rather than a truthiness check: a free (0-token) success
    // is a real sample, and dropping it biases the mean upward.
    if (outcome === 'success' && ctx.tokenCost !== undefined) {
      Sentry.metrics.distribution(GENERATION_TOKENS_METRIC, ctx.tokenCost, { attributes });
    }
  } catch {
    // Fail open — see the module header.
  }
}

/**
 * Wrap a generate route handler so every request emits business metrics.
 *
 * The handler receives a mutable {@link GenerationMetricsContext} it fills in as
 * it resolves provider/cost/tier. The response is returned by IDENTITY: the
 * wrapper never re-wraps the body, so streaming and header behaviour are
 * untouched.
 */
export function withGenerationMetrics<Req, Res extends Response>(
  route: string,
  handler: (request: Req, ctx: GenerationMetricsContext) => Promise<Res>,
): (request: Req) => Promise<Res> {
  return async (request: Req): Promise<Res> => {
    const ctx: GenerationMetricsContext = {};
    const startedAt = Date.now();

    let response: Res;
    try {
      response = await handler(request, ctx);
    } catch (error) {
      // recordGenerationMetrics swallows its own failures, so the handler's
      // error is what propagates — a metrics outage must not mask the outage
      // that actually broke the request.
      recordGenerationMetrics({
        route,
        status: 500,
        durationMs: Date.now() - startedAt,
        ctx,
      });
      throw error;
    }

    let cache: string | undefined;
    try {
      cache = response.headers.get('X-Cache') ?? undefined;
    } catch {
      // A handler returning a non-standard Response-like object must not break.
    }

    recordGenerationMetrics({
      route,
      status: response.status,
      durationMs: Date.now() - startedAt,
      ctx,
      cache,
    });

    return response;
  };
}
