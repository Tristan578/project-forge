import { describe, it, expect, vi, beforeEach } from 'vitest';

// Capture every Sentry.metrics.* emission without a real client.
const { metricCalls } = vi.hoisted(() => ({
  metricCalls: [] as Array<{
    kind: 'count' | 'gauge' | 'distribution';
    name: string;
    value: number;
    options?: { unit?: string; attributes?: Record<string, unknown> };
  }>,
}));

vi.mock('@sentry/nextjs', () => ({
  metrics: {
    count: (name: string, value: number, options?: Record<string, unknown>) => {
      metricCalls.push({ kind: 'count', name, value, options });
    },
    gauge: (name: string, value: number, options?: Record<string, unknown>) => {
      metricCalls.push({ kind: 'gauge', name, value, options });
    },
    distribution: (name: string, value: number, options?: Record<string, unknown>) => {
      metricCalls.push({ kind: 'distribution', name, value, options });
    },
  },
}));

import * as Sentry from '@sentry/nextjs';
import {
  classifyGenerationOutcome,
  recordGenerationMetrics,
  withGenerationMetrics,
  GENERATION_OUTCOMES,
  GENERATION_REQUEST_METRIC,
  GENERATION_DURATION_METRIC,
  GENERATION_TOKENS_METRIC,
} from '../generationMetrics';

beforeEach(() => {
  metricCalls.length = 0;
  vi.restoreAllMocks();
});

function find(name: string) {
  return metricCalls.filter((c) => c.name === name);
}

// ---------------------------------------------------------------------------
// classifyGenerationOutcome — status → business outcome
// ---------------------------------------------------------------------------

describe('classifyGenerationOutcome', () => {
  it.each([
    [200, 'success'],
    [201, 'success'],
    [401, 'signed_out'],
    [403, 'bot_blocked'],
    [429, 'rate_limited'],
    [402, 'insufficient_tokens'],
    [400, 'rejected'],
    [422, 'rejected'],
    [503, 'provider_unavailable'],
    [500, 'error'],
  ])('maps %i to "%s"', (status, expected) => {
    expect(classifyGenerationOutcome(status)).toBe(expected);
  });

  it('treats any unmapped 4xx as a client rejection, not a server error', () => {
    // A future validation branch returning 409/415 must not pollute the error
    // rate — outcome is the alerting dimension.
    expect(classifyGenerationOutcome(409)).toBe('rejected');
    expect(classifyGenerationOutcome(415)).toBe('rejected');
  });

  it('treats any unmapped 5xx as an error', () => {
    expect(classifyGenerationOutcome(502)).toBe('error');
    expect(classifyGenerationOutcome(504)).toBe('error');
  });
});

// ---------------------------------------------------------------------------
// Outcome vocabulary — must survive Sentry's server-side data scrubber
// ---------------------------------------------------------------------------

/**
 * Substrings that Sentry's default server-side data scrubber redacts when they
 * appear in a metric ATTRIBUTE VALUE, replacing the whole value with
 * `[Filtered]`. The project has `dataScrubberDefaults: true` (and no custom
 * field list), so this is not something the SDK config can opt out of.
 *
 * Derived empirically against the live project rather than from documentation:
 * of the candidates probed, `auth`/`authorization`/`unauth`/`authenticated`/
 * `reauth`/`password`/`passwd`/`secret`/`credentials`/`apikey`/`privatekey` were
 * all returned as `[Filtered]`, while `token`, `session`, `anonymous`,
 * `no_session`, `insufficient_tokens`, `out_of_credits`, `bot_blocked`,
 * `rate_limited`, `provider_unavailable`, `success` and `error` all survived
 * intact. Note `token`/`session` are NOT triggers on their own.
 */
const SENTRY_SCRUBBED_VALUE_RE = /auth|passw(or)?d|secret|credential|api[_-]?key|private[_-]?key/i;

describe('GENERATION_OUTCOMES vocabulary', () => {
  it('contains no value that Sentry redacts to [Filtered]', () => {
    // `outcome` is THE alerting dimension. A scrubbed value is not merely ugly —
    // it collapses that bucket into an unqueryable `[Filtered]` facet, so an
    // alert on it can never fire. This shipped once: 401 was `unauthenticated`,
    // and every 401 sample landed in Sentry as `outcome: [Filtered]`.
    const scrubbed = GENERATION_OUTCOMES.filter((o) => SENTRY_SCRUBBED_VALUE_RE.test(o));
    expect(scrubbed).toEqual([]);
  });

  it('has a guard regex that actually matches the value that shipped broken', () => {
    // Without this, gutting the regex above would make the guard vacuously pass.
    expect(SENTRY_SCRUBBED_VALUE_RE.test('unauthenticated')).toBe(true);
    expect(SENTRY_SCRUBBED_VALUE_RE.test('signed_out')).toBe(false);
  });

  it('lists every outcome classifyGenerationOutcome can return', () => {
    // The guard is only as complete as this array — an outcome reachable from
    // the classifier but missing here would never be checked.
    const reachable = new Set(
      [200, 201, 400, 401, 402, 403, 409, 415, 422, 429, 500, 502, 503, 504].map(
        classifyGenerationOutcome,
      ),
    );
    for (const outcome of reachable) {
      expect(GENERATION_OUTCOMES).toContain(outcome);
    }
  });
});

// ---------------------------------------------------------------------------
// recordGenerationMetrics — what actually ships
// ---------------------------------------------------------------------------

describe('recordGenerationMetrics', () => {
  it('emits a request counter and a duration distribution with the full attribute set', () => {
    recordGenerationMetrics({
      route: '/api/generate/image',
      status: 200,
      durationMs: 1234,
      ctx: { provider: 'replicate', operation: 'image_generation', tokenCost: 40, tier: 'pro' },
      cache: 'MISS',
    });

    const counters = find(GENERATION_REQUEST_METRIC);
    expect(counters).toHaveLength(1);
    expect(counters[0].kind).toBe('count');
    expect(counters[0].value).toBe(1);
    expect(counters[0].options?.attributes).toEqual({
      route: '/api/generate/image',
      outcome: 'success',
      status: 200,
      provider: 'replicate',
      operation: 'image_generation',
      tier: 'pro',
      cache: 'MISS',
    });

    const durations = find(GENERATION_DURATION_METRIC);
    expect(durations).toHaveLength(1);
    expect(durations[0].kind).toBe('distribution');
    expect(durations[0].value).toBe(1234);
    expect(durations[0].options?.unit).toBe('millisecond');
  });

  it('records charged tokens ONLY on success', () => {
    recordGenerationMetrics({
      route: '/api/generate/image',
      status: 200,
      durationMs: 10,
      ctx: { tokenCost: 40 },
    });
    expect(find(GENERATION_TOKENS_METRIC)).toHaveLength(1);
    expect(find(GENERATION_TOKENS_METRIC)[0].value).toBe(40);

    metricCalls.length = 0;
    // A refunded failure charged the user nothing — counting it as revenue would
    // overstate consumption for every provider outage.
    recordGenerationMetrics({
      route: '/api/generate/image',
      status: 500,
      durationMs: 10,
      ctx: { tokenCost: 40 },
    });
    expect(find(GENERATION_TOKENS_METRIC)).toHaveLength(0);
  });

  it('records charged tokens of 0 on a free success (does not treat 0 as absent)', () => {
    // `||` here would drop the sample entirely and silently bias the mean upward.
    recordGenerationMetrics({
      route: '/api/generate/image',
      status: 200,
      durationMs: 10,
      ctx: { tokenCost: 0 },
    });
    expect(find(GENERATION_TOKENS_METRIC)).toHaveLength(1);
    expect(find(GENERATION_TOKENS_METRIC)[0].value).toBe(0);
  });

  it('omits unresolved attributes rather than shipping undefined values', () => {
    // A request rejected at validation never resolves provider/operation/tier.
    // Emitting `provider: undefined` creates a junk facet value in Sentry.
    recordGenerationMetrics({
      route: '/api/generate/image',
      status: 422,
      durationMs: 5,
      ctx: {},
    });
    const attrs = find(GENERATION_REQUEST_METRIC)[0].options?.attributes ?? {};
    expect(attrs).toEqual({ route: '/api/generate/image', outcome: 'rejected', status: 422 });
    expect(Object.values(attrs).some((v) => v === undefined)).toBe(false);
  });

  it('skips the tokens metric when no cost was ever resolved', () => {
    recordGenerationMetrics({ route: '/api/generate/image', status: 200, durationMs: 5, ctx: {} });
    expect(find(GENERATION_TOKENS_METRIC)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// withGenerationMetrics — the wrapper around the 12-route SPOF handler
// ---------------------------------------------------------------------------

describe('withGenerationMetrics', () => {
  it('returns the handler response untouched and records one request metric', async () => {
    const response = new Response('{}', { status: 200 });
    const wrapped = withGenerationMetrics('/api/generate/image', async () => response);

    const out = await wrapped({} as never);

    expect(out).toBe(response); // identity — the wrapper must not re-wrap the body
    expect(find(GENERATION_REQUEST_METRIC)).toHaveLength(1);
    expect(find(GENERATION_REQUEST_METRIC)[0].options?.attributes).toMatchObject({
      route: '/api/generate/image',
      outcome: 'success',
    });
  });

  it('passes a mutable context the handler fills in, and reads it AFTER the handler returns', async () => {
    const wrapped = withGenerationMetrics('/api/generate/image', async (_req, ctx) => {
      ctx.provider = 'meshy';
      ctx.operation = 'model_generation';
      ctx.tokenCost = 100;
      ctx.tier = 'studio';
      return new Response('{}', { status: 200 });
    });

    await wrapped({} as never);

    expect(find(GENERATION_REQUEST_METRIC)[0].options?.attributes).toMatchObject({
      provider: 'meshy',
      operation: 'model_generation',
      tier: 'studio',
    });
    expect(find(GENERATION_TOKENS_METRIC)[0].value).toBe(100);
  });

  it('reads the cache disposition off the response X-Cache header', async () => {
    const wrapped = withGenerationMetrics(
      '/api/generate/image',
      async () => new Response('{}', { status: 200, headers: { 'X-Cache': 'HIT' } }),
    );
    await wrapped({} as never);
    expect(find(GENERATION_REQUEST_METRIC)[0].options?.attributes).toMatchObject({ cache: 'HIT' });
  });

  it('records an error outcome and RE-THROWS when the handler throws', async () => {
    const boom = new Error('provider exploded');
    const wrapped = withGenerationMetrics('/api/generate/image', async () => {
      throw boom;
    });

    await expect(wrapped({} as never)).rejects.toThrow('provider exploded');
    expect(find(GENERATION_REQUEST_METRIC)).toHaveLength(1);
    expect(find(GENERATION_REQUEST_METRIC)[0].options?.attributes).toMatchObject({
      outcome: 'error',
      status: 500,
    });
  });

  it('FAILS OPEN: a metrics backend error never breaks the request', async () => {
    // createGenerationHandler is a single point of failure for all 12 generate
    // routes. Observability must never be able to take them down.
    vi.spyOn(Sentry.metrics, 'count').mockImplementation(() => {
      throw new Error('metrics transport down');
    });
    const response = new Response('{}', { status: 200 });
    const wrapped = withGenerationMetrics('/api/generate/image', async () => response);

    await expect(wrapped({} as never)).resolves.toBe(response);
  });

  it('FAILS OPEN on the error path too: the handler error propagates, not the metrics error', async () => {
    vi.spyOn(Sentry.metrics, 'count').mockImplementation(() => {
      throw new Error('metrics transport down');
    });
    const wrapped = withGenerationMetrics('/api/generate/image', async () => {
      throw new Error('provider exploded');
    });

    // The metrics failure must not mask the real cause of the outage.
    await expect(wrapped({} as never)).rejects.toThrow('provider exploded');
  });

  it('records a non-negative duration', async () => {
    const wrapped = withGenerationMetrics(
      '/api/generate/image',
      async () => new Response('{}', { status: 200 }),
    );
    await wrapped({} as never);
    const d = find(GENERATION_DURATION_METRIC)[0];
    expect(d.value).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(d.value)).toBe(true);
  });
});
