import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

/**
 * Integration pins for the business metrics (PF-1053) that `createGenerationHandler`
 * feeds through `withGenerationMetrics`.
 *
 * `generationMetrics.test.ts` covers the emitter in isolation — given a filled-in
 * context, does it ship the right samples. That leaves the half that actually
 * decides what production sees untested: WHERE the handler fills that context in.
 * `generation.tokens_charged` is the sharp edge — it is reconciled against the
 * Stripe `generation_tokens` billing meter, and two success paths resolve a token
 * cost and then spend nothing (a cache HIT and a BYOK request). Setting the cost
 * as soon as it is known is the natural-looking mistake, it is invisible in the
 * unit tests, and it silently inflates the metric by the entire cached + BYOK
 * traffic volume.
 */

const { afterCallbacks } = vi.hoisted(() => ({ afterCallbacks: [] as Array<() => unknown> }));
vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>();
  return { ...actual, after: (cb: () => unknown) => { afterCallbacks.push(cb); } };
});

// Capture Sentry metric emissions. Spreading the real module keeps every other
// SDK export intact — only the metrics sink is swapped.
const { metricCalls } = vi.hoisted(() => ({
  metricCalls: [] as Array<{ name: string; value: number; attributes: Record<string, unknown> }>,
}));
vi.mock('@sentry/nextjs', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const push = (name: string, value: number, options?: { attributes?: Record<string, unknown> }) => {
    metricCalls.push({ name, value, attributes: options?.attributes ?? {} });
  };
  return { ...actual, metrics: { count: push, gauge: push, distribution: push } };
});

vi.mock('server-only', () => ({}));

vi.mock('@/lib/auth/api-auth', () => ({ authenticateRequest: vi.fn() }));
vi.mock('@/lib/keys/resolver', () => ({
  resolveApiKey: vi.fn(),
  ApiKeyError: class ApiKeyError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
      this.name = 'ApiKeyError';
    }
  },
}));
vi.mock('@/lib/tokens/pricing', () => ({ getTokenCost: vi.fn().mockReturnValue(40) }));
vi.mock('@/lib/monitoring/sentry-server', () => ({
  captureException: vi.fn(),
  sentryLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('@/lib/security/botId', () => ({ checkBotIdGate: vi.fn().mockResolvedValue(null) }));
vi.mock('@/lib/rateLimit', () => ({
  rateLimitResponse: vi.fn().mockReturnValue(
    new Response(JSON.stringify({ error: 'Rate limited' }), { status: 429 }),
  ),
}));
vi.mock('@/lib/rateLimit/distributed', () => ({
  distributedRateLimit: vi.fn(),
  aggregateGenerationRateLimit: vi.fn(),
}));
vi.mock('@/lib/ai/contentSafety', () => ({
  sanitizePrompt: vi.fn((p: string) => ({ safe: true, filtered: p })),
}));
vi.mock('@/lib/tokens/service', () => ({
  refundTokens: vi.fn().mockResolvedValue({ refunded: true }),
}));
vi.mock('@/lib/db/client', () => ({
  getDb: vi.fn().mockReturnValue({}),
  getNeonSql: vi.fn().mockReturnValue(
    Object.assign(vi.fn(), { transaction: vi.fn().mockResolvedValue([]) }),
  ),
}));
vi.mock('@/lib/api/responseCache', () => ({
  cachedGenerate: vi.fn(async (_op: string, _params: unknown, factory: () => Promise<unknown>) => ({
    result: await factory(),
    cached: false,
  })),
}));
vi.mock('@/lib/qstash/client', () => ({
  isQstashConfigured: vi.fn(() => false),
  publishGenerationCallback: vi.fn(async () => {}),
}));
vi.mock('@/lib/flags/posthogFlags', () => ({ isProviderKilled: vi.fn(() => false) }));

import { authenticateRequest } from '@/lib/auth/api-auth';
import { resolveApiKey } from '@/lib/keys/resolver';
import { distributedRateLimit, aggregateGenerationRateLimit } from '@/lib/rateLimit/distributed';
import { checkBotIdGate } from '@/lib/security/botId';
import { cachedGenerate } from '@/lib/api/responseCache';
import { isQstashConfigured } from '@/lib/qstash/client';
import { isProviderKilled } from '@/lib/flags/posthogFlags';
import { sanitizePrompt } from '@/lib/ai/contentSafety';
import {
  GENERATION_REQUEST_METRIC,
  GENERATION_DURATION_METRIC,
  GENERATION_TOKENS_METRIC,
} from '@/lib/monitoring/generationMetrics';
import { createGenerationHandler } from '../createGenerationHandler';

const mockAuth = vi.mocked(authenticateRequest);
const mockResolve = vi.mocked(resolveApiKey);
const mockRateLimit = vi.mocked(distributedRateLimit);
const mockAggRateLimit = vi.mocked(aggregateGenerationRateLimit);
const mockCachedGenerate = vi.mocked(cachedGenerate);
const mockBotIdGate = vi.mocked(checkBotIdGate);
const mockConfigured = vi.mocked(isQstashConfigured);
const mockProviderKilled = vi.mocked(isProviderKilled);
const mockSanitize = vi.mocked(sanitizePrompt);

const TOKEN_COST = 40;

function makeRequest(): NextRequest {
  return new NextRequest('http://localhost:3000/api/generate/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: 'a test prompt' }),
  });
}

const baseConfig = {
  route: '/api/generate/test',
  provider: 'elevenlabs' as const,
  operation: 'test_generation',
  rateLimitKey: 'gen-test',
  validate: (body: Record<string, unknown>) => {
    const prompt = body.prompt;
    if (typeof prompt !== 'string' || prompt.length < 3) {
      return { ok: false as const, error: 'Prompt must be at least 3 characters' };
    }
    return { ok: true as const, params: { prompt } };
  },
  execute: async (params: { prompt: string }) => ({
    result: `Generated from: ${params.prompt}`,
    provider: 'elevenlabs' as const,
  }),
};

/** Uncached route — exercises step 6d. */
const uncachedHandler = createGenerationHandler(baseConfig);
/** Cached route — exercises step 6c, where the HIT/MISS split lives. */
const cachedHandler = createGenerationHandler({
  ...baseConfig,
  cacheKeyParams: (params: { prompt: string }) => ({ prompt: params.prompt }),
});

function samples(name: string) {
  return metricCalls.filter((c) => c.name === name);
}

function attributesOf(name: string): Record<string, unknown> {
  const found = samples(name);
  expect(found).toHaveLength(1);
  return found[0].attributes;
}

describe('createGenerationHandler — business metrics wiring (PF-1053)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    metricCalls.length = 0;
    afterCallbacks.length = 0;
    mockAuth.mockResolvedValue({
      ok: true,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ctx: { user: { id: 'user-1', tier: 'pro' } as any, clerkId: 'clerk-1' },
    });
    mockAggRateLimit.mockResolvedValue({ allowed: true, remaining: 29, resetAt: Date.now() + 900_000 });
    mockRateLimit.mockResolvedValue({ allowed: true, remaining: 9, resetAt: Date.now() + 300_000 });
    mockResolve.mockResolvedValue({ type: 'platform', key: 'test-key', metered: true, usageId: 'usage-1' });
    mockBotIdGate.mockResolvedValue(null);
    mockConfigured.mockReturnValue(false);
    mockProviderKilled.mockReturnValue(false);
    mockSanitize.mockImplementation((p: string) => ({ safe: true, filtered: p }));
    mockCachedGenerate.mockImplementation(
      async (_op: string, _params: unknown, factory: () => Promise<unknown>) => ({
        result: (await factory()) as never,
        cached: false,
      }),
    );
  });

  // -------------------------------------------------------------------------
  // The charge marker — what `generation.tokens_charged` is allowed to count
  // -------------------------------------------------------------------------

  it('records charged tokens on a real platform deduction (uncached path)', async () => {
    const res = await uncachedHandler(makeRequest());

    expect(res.status).toBe(200);
    expect(samples(GENERATION_TOKENS_METRIC)).toHaveLength(1);
    expect(samples(GENERATION_TOKENS_METRIC)[0].value).toBe(TOKEN_COST);
  });

  it('records charged tokens on a cache MISS, which really does deduct', async () => {
    const res = await cachedHandler(makeRequest());

    expect(res.status).toBe(200);
    expect(res.headers.get('X-Cache')).toBe('MISS');
    expect(samples(GENERATION_TOKENS_METRIC)).toHaveLength(1);
    expect(samples(GENERATION_TOKENS_METRIC)[0].value).toBe(TOKEN_COST);
  });

  it('does NOT record charged tokens on a cache HIT', async () => {
    // A HIT re-serves a prior result without ever invoking the factory, so
    // resolveApiKey is never called and no balance moves. Counting the resolved
    // cost here would inflate the metric by the entire cached traffic volume and
    // put it permanently out of step with the Stripe billing meter.
    mockCachedGenerate.mockResolvedValue({
      result: { result: 'cached', provider: 'elevenlabs' } as never,
      cached: true,
    });

    const res = await cachedHandler(makeRequest());

    expect(res.status).toBe(200);
    expect(res.headers.get('X-Cache')).toBe('HIT');
    expect(mockResolve).not.toHaveBeenCalled();
    expect(samples(GENERATION_TOKENS_METRIC)).toHaveLength(0);
    // The request itself is still a success and still counted — only the
    // charge is absent.
    expect(attributesOf(GENERATION_REQUEST_METRIC)).toMatchObject({
      outcome: 'success',
      cache: 'HIT',
    });
  });

  it('does NOT record charged tokens for a BYOK request', async () => {
    // resolveApiKey returns a usageId ONLY on the platform-deduction path. A BYOK
    // caller spends their own provider quota, not platform tokens — that missing
    // usageId is the marker the handler gates on.
    mockResolve.mockResolvedValue({ type: 'byok', key: 'user-supplied-key', metered: false });

    const res = await uncachedHandler(makeRequest());

    expect(res.status).toBe(200);
    expect(mockResolve).toHaveBeenCalled();
    expect(samples(GENERATION_TOKENS_METRIC)).toHaveLength(0);
    expect(attributesOf(GENERATION_REQUEST_METRIC)).toMatchObject({ outcome: 'success' });
  });

  it('does NOT record charged tokens for a BYOK cache MISS either', async () => {
    // Same marker, other branch — the cached path has its own copy of the
    // assignment, so it needs its own pin.
    mockResolve.mockResolvedValue({ type: 'byok', key: 'user-supplied-key', metered: false });

    const res = await cachedHandler(makeRequest());

    expect(res.status).toBe(200);
    expect(res.headers.get('X-Cache')).toBe('MISS');
    expect(samples(GENERATION_TOKENS_METRIC)).toHaveLength(0);
  });

  it('does NOT record charged tokens when the request is rejected before any deduction', async () => {
    mockProviderKilled.mockReturnValue(true);

    const res = await uncachedHandler(makeRequest());

    expect(res.status).toBe(503);
    expect(samples(GENERATION_TOKENS_METRIC)).toHaveLength(0);
    expect(attributesOf(GENERATION_REQUEST_METRIC)).toMatchObject({
      outcome: 'provider_unavailable',
      status: 503,
      // The provider resolved before the kill switch fired, so it is still a
      // usable facet — that is what makes the sample worth alerting on.
      provider: 'elevenlabs',
    });
  });

  // -------------------------------------------------------------------------
  // Facet wiring — the attributes alerts actually group by
  // -------------------------------------------------------------------------

  it('stamps route, provider, operation and tier onto a successful request', async () => {
    await uncachedHandler(makeRequest());

    expect(attributesOf(GENERATION_REQUEST_METRIC)).toEqual({
      route: '/api/generate/test',
      outcome: 'success',
      status: 200,
      provider: 'elevenlabs',
      operation: 'test_generation',
      tier: 'pro',
    });
  });

  it('emits exactly one request counter and one duration sample per request', async () => {
    await uncachedHandler(makeRequest());

    expect(samples(GENERATION_REQUEST_METRIC)).toHaveLength(1);
    expect(samples(GENERATION_DURATION_METRIC)).toHaveLength(1);
    expect(samples(GENERATION_DURATION_METRIC)[0].value).toBeGreaterThanOrEqual(0);
  });

  it('classifies an unauthenticated request as signed_out with no resolved facets', async () => {
    // 401 returns before tier/provider/operation exist. They must be ABSENT
    // rather than `undefined`, which Sentry would render as a junk facet value.
    // `signed_out` (not `unauthenticated`) is load-bearing: Sentry's server-side
    // scrubber redacts any attribute value containing `auth` to `[Filtered]`.
    mockAuth.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    });

    const res = await uncachedHandler(makeRequest());

    expect(res.status).toBe(401);
    expect(attributesOf(GENERATION_REQUEST_METRIC)).toEqual({
      route: '/api/generate/test',
      outcome: 'signed_out',
      status: 401,
    });
  });

  it('classifies a bot-blocked request as bot_blocked, with the tier already resolved', async () => {
    mockBotIdGate.mockResolvedValue(NextResponse.json({ error: 'Request blocked' }, { status: 403 }));

    const res = await uncachedHandler(makeRequest());

    expect(res.status).toBe(403);
    expect(attributesOf(GENERATION_REQUEST_METRIC)).toEqual({
      route: '/api/generate/test',
      outcome: 'bot_blocked',
      status: 403,
      tier: 'pro',
    });
  });

  it('separates a BANNED account from bot traffic, though both return 403', async () => {
    // Two different gates on this route return 403. Left to the status
    // classifier they collapse into one `bot_blocked` bucket, and ban-evasion
    // volume becomes unqueryable — hidden inside what reads as bot noise.
    mockAuth.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: 'Account banned', code: 'ACCOUNT_BANNED' }, { status: 403 }),
    });

    const res = await uncachedHandler(makeRequest());

    expect(res.status).toBe(403);
    expect(attributesOf(GENERATION_REQUEST_METRIC)).toEqual({
      route: '/api/generate/test',
      outcome: 'banned',
      status: 403,
    });
  });

  it('separates a DEGRADED auth path from a provider outage, though both return 503', async () => {
    // authenticateRequest returns 503 when the DB/user-sync path is degraded —
    // a Neon circuit-breaker signal. Reported as `provider_unavailable` it pages
    // on-call for an upstream AI incident that is not happening.
    mockAuth.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: 'Service degraded', code: 'SERVICE_DEGRADED' }, { status: 503 }),
    });

    const res = await uncachedHandler(makeRequest());

    expect(res.status).toBe(503);
    expect(attributesOf(GENERATION_REQUEST_METRIC)).toEqual({
      route: '/api/generate/test',
      outcome: 'degraded',
      status: 503,
    });
  });

  it('separates a content-safety rejection from a schema rejection, though both return 422', async () => {
    // The blocklist/injection screen is the most security-relevant rejection on
    // this surface. Bucketed with malformed-body 422s, blocklist probing across
    // the 12 routes is invisible.
    mockSanitize.mockReturnValue({ safe: false, reason: 'Blocked content' });

    const res = await uncachedHandler(makeRequest());

    expect(res.status).toBe(422);
    expect(attributesOf(GENERATION_REQUEST_METRIC)).toEqual({
      route: '/api/generate/test',
      outcome: 'content_rejected',
      status: 422,
      tier: 'pro',
    });
    expect(samples(GENERATION_TOKENS_METRIC)).toHaveLength(0);
  });

  it('still reports a schema rejection as the generic rejected bucket', async () => {
    // The counterpart to the test above: the override must not leak onto the
    // branch it was introduced to distinguish itself FROM.
    const res = await uncachedHandler(
      new NextRequest('http://localhost:3000/api/generate/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'x' }),
      }),
    );

    expect(res.status).toBe(422);
    expect(attributesOf(GENERATION_REQUEST_METRIC)).toMatchObject({
      outcome: 'rejected',
      status: 422,
    });
  });

  it('classifies a killed provider as provider_unavailable with the provider facet intact', async () => {
    mockProviderKilled.mockReturnValue(true);

    const res = await uncachedHandler(makeRequest());

    expect(res.status).toBe(503);
    expect(attributesOf(GENERATION_REQUEST_METRIC)).toMatchObject({
      outcome: 'provider_unavailable',
      status: 503,
      provider: 'elevenlabs',
    });
  });

  it('classifies a rate-limited request as rate_limited', async () => {
    mockAggRateLimit.mockResolvedValue({ allowed: false, remaining: 0, resetAt: Date.now() + 900_000 });

    const res = await uncachedHandler(makeRequest());

    expect(res.status).toBe(429);
    expect(attributesOf(GENERATION_REQUEST_METRIC)).toMatchObject({
      outcome: 'rate_limited',
      status: 429,
    });
    expect(samples(GENERATION_TOKENS_METRIC)).toHaveLength(0);
  });

  it('classifies an out-of-tokens 402 as insufficient_tokens and charges nothing', async () => {
    const { ApiKeyError } = await import('@/lib/keys/resolver');
    mockResolve.mockRejectedValue(new ApiKeyError('INSUFFICIENT_TOKENS', 'Not enough tokens'));

    const res = await uncachedHandler(makeRequest());

    expect(res.status).toBe(402);
    expect(attributesOf(GENERATION_REQUEST_METRIC)).toMatchObject({
      outcome: 'insufficient_tokens',
      status: 402,
    });
    expect(samples(GENERATION_TOKENS_METRIC)).toHaveLength(0);
  });

  it('FAILS OPEN: the request still succeeds when the metrics sink throws', async () => {
    // createGenerationHandler is the single point of failure behind all 12
    // generate routes. Observability must never be able to take them down.
    const sentry = await import('@sentry/nextjs');
    vi.spyOn(sentry.metrics, 'count').mockImplementation(() => {
      throw new Error('metrics transport down');
    });

    const res = await uncachedHandler(makeRequest());

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ result: 'Generated from: a test prompt' });
  });
});
