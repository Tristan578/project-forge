import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

// Capture every after() callback so tests can assert the deferred-publish gate
// is dormant (no callbacks registered) without triggering real Next.js after().
// Pattern mirrors createGenerationHandler.qstash.test.ts.
const { afterCallbacks } = vi.hoisted(() => ({ afterCallbacks: [] as Array<() => unknown> }));
vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>();
  return { ...actual, after: (cb: () => unknown) => { afterCallbacks.push(cb); } };
});

vi.mock('server-only', () => ({}));

// Mock all dependencies
vi.mock('@/lib/auth/api-auth', () => ({
  authenticateRequest: vi.fn(),
}));
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
vi.mock('@/lib/tokens/pricing', () => ({
  getTokenCost: vi.fn().mockReturnValue(10),
}));
vi.mock('@/lib/monitoring/sentry-server', () => ({
  captureException: vi.fn(),
}));
vi.mock('@/lib/rateLimit', () => ({
  rateLimitResponse: vi.fn().mockReturnValue(
    new Response(JSON.stringify({ error: 'Rate limited' }), { status: 429 })
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
// Drive the cached path deterministically: run the miss factory and surface any
// thrown error to the handler's cached-path catch site (so its 500 behaviour,
// including the #8597 message-leak guard, is exercised without real Redis).
vi.mock('@/lib/api/responseCache', () => ({
  cachedGenerate: vi.fn(async (_op: string, _params: unknown, factory: () => Promise<unknown>) => ({
    result: await factory(),
    cached: false,
  })),
}));
// QStash client: default dormant (isQstashConfigured → false) so existing tests
// are unaffected. Tests that need it active set mockConfigured.mockReturnValue(true).
vi.mock('@/lib/qstash/client', () => ({
  isQstashConfigured: vi.fn(() => false),
  publishGenerationCallback: vi.fn(async () => {}),
}));

// Client-facing message for every 500 (#8597). Raw err.message can leak server
// internals (env var names, DB DSNs, provider request IDs), so the client gets
// this opaque string while the full error goes only to Sentry.
const GENERIC_500 = 'Generation failed due to a server error. Please try again later.';

import { authenticateRequest } from '@/lib/auth/api-auth';
import { resolveApiKey } from '@/lib/keys/resolver';
import { distributedRateLimit, aggregateGenerationRateLimit } from '@/lib/rateLimit/distributed';
import { sanitizePrompt } from '@/lib/ai/contentSafety';
import { refundTokens } from '@/lib/tokens/service';
import { captureException } from '@/lib/monitoring/sentry-server';
import { cachedGenerate } from '@/lib/api/responseCache';
import { isQstashConfigured } from '@/lib/qstash/client';
import { createGenerationHandler } from '../createGenerationHandler';

const mockAuth = vi.mocked(authenticateRequest);
const mockResolve = vi.mocked(resolveApiKey);
const mockRateLimit = vi.mocked(distributedRateLimit);
const mockAggRateLimit = vi.mocked(aggregateGenerationRateLimit);
const mockSanitize = vi.mocked(sanitizePrompt);
const mockRefund = vi.mocked(refundTokens);
const mockCapture = vi.mocked(captureException);
const mockCachedGenerate = vi.mocked(cachedGenerate);
const mockConfigured = vi.mocked(isQstashConfigured);

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost:3000/api/generate/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const testHandler = createGenerationHandler({
  route: '/api/generate/test',
  provider: 'elevenlabs',
  operation: 'test_generation',
  rateLimitKey: 'gen-test',
  validate: (body) => {
    const prompt = body.prompt;
    if (!prompt || typeof prompt !== 'string' || prompt.length < 3) {
      return { ok: false, error: 'Prompt must be at least 3 characters' };
    }
    return { ok: true, params: { prompt } };
  },
  execute: async (params) => {
    return { result: `Generated from: ${params.prompt}`, provider: 'elevenlabs' as const };
  },
});

describe('createGenerationHandler', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    afterCallbacks.length = 0;
    mockAuth.mockResolvedValue({
      ok: true,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ctx: { user: { id: 'user-1', tier: 'pro' } as any, clerkId: 'clerk-1' },
    });
    mockAggRateLimit.mockResolvedValue({ allowed: true, remaining: 29, resetAt: Date.now() + 900000 });
    mockRateLimit.mockResolvedValue({ allowed: true, remaining: 9, resetAt: Date.now() + 300000 });
    mockResolve.mockResolvedValue({ type: 'platform', key: 'test-key', metered: true, usageId: 'usage-1' });
    mockSanitize.mockReturnValue({ safe: true, filtered: 'test prompt' });
    // QStash dormant by default — handlers in this file that omit asyncJob never
    // reach isQstashConfigured() (short-circuit), so this is safe for all existing tests.
    mockConfigured.mockReturnValue(false);
  });

  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    });
    const res = await testHandler(makeRequest({ prompt: 'test prompt' }));
    expect(res.status).toBe(401);
  });

  it('returns 429 when aggregate rate limited', async () => {
    mockAggRateLimit.mockResolvedValue({ allowed: false, remaining: 0, resetAt: Date.now() });
    const res = await testHandler(makeRequest({ prompt: 'test prompt' }));
    expect(res.status).toBe(429);
    // Per-route rate limit should not be called when aggregate rejects
    expect(mockRateLimit).not.toHaveBeenCalled();
  });

  it('returns 429 when per-route rate limited', async () => {
    mockRateLimit.mockResolvedValue({ allowed: false, remaining: 0, resetAt: Date.now() });
    const res = await testHandler(makeRequest({ prompt: 'test prompt' }));
    expect(res.status).toBe(429);
  });

  it('returns 400 for invalid JSON', async () => {
    const req = new NextRequest('http://localhost:3000/api/generate/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    });
    const res = await testHandler(req);
    expect(res.status).toBe(400);
  });

  it('returns 422 for invalid params', async () => {
    const res = await testHandler(makeRequest({ prompt: 'ab' }));
    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.error).toContain('3 characters');
  });

  it('returns 422 when content safety rejects prompt', async () => {
    mockSanitize.mockReturnValue({ safe: false, reason: 'Unsafe content', filtered: undefined });
    const res = await testHandler(makeRequest({ prompt: 'bad prompt here' }));
    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.error).toContain('Unsafe content');
  });

  it('returns 402 when no API key available', async () => {
    const { ApiKeyError } = await import('@/lib/keys/resolver');
    mockResolve.mockRejectedValue(new ApiKeyError('NO_KEY_CONFIGURED', 'No API key'));
    const res = await testHandler(makeRequest({ prompt: 'test prompt' }));
    expect(res.status).toBe(402);
  });

  it('returns a structured 500 and captures when resolveApiKey throws a non-ApiKeyError (#8597)', async () => {
    // A server-side key/resolution failure (e.g. missing ANTHROPIC_API_KEY, or a
    // DB error) surfaces as a plain Error, NOT an ApiKeyError. The non-cached
    // path must convert it to a structured 500 and alert Sentry — not re-throw
    // it as an uninstrumented unhandled rejection (the old bare `throw err`).
    mockResolve.mockRejectedValue(new Error('Platform key not configured: ANTHROPIC_API_KEY'));
    const res = await testHandler(makeRequest({ prompt: 'test prompt' }));
    expect(res.status).toBe(500);
    expect(mockCapture).toHaveBeenCalled();
    // The client must NOT see the raw server error — env var names / infra detail
    // leak server internals (#8597). It gets the generic message instead…
    const data = await res.json();
    expect(data.error).not.toContain('ANTHROPIC_API_KEY');
    expect(data.error).not.toMatch(/not configured/i);
    expect(data.error).toBe(GENERIC_500);
    // …while the full error still reaches Sentry for debugging.
    expect((mockCapture.mock.calls[0][0] as Error).message).toBe(
      'Platform key not configured: ANTHROPIC_API_KEY',
    );
    // Nothing was deducted (resolveApiKey threw before returning a usageId), so
    // there is no refund to issue.
    expect(mockRefund).not.toHaveBeenCalled();
  });

  it('returns 200 with result on success', async () => {
    const res = await testHandler(makeRequest({ prompt: 'test prompt' }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.result).toContain('Generated from:');
    expect(data.provider).toBe('elevenlabs');
  });

  it('refunds tokens and returns 500 on provider failure', async () => {
    const failHandler = createGenerationHandler({
      route: '/api/generate/test',
      provider: 'elevenlabs',
      operation: 'test_generation',
      rateLimitKey: 'gen-test',
      validate: (body) => ({ ok: true, params: { prompt: body.prompt as string } }),
      execute: async () => { throw new Error('ElevenLabs internal: request 0xDEADBEEF failed'); },
    });

    const res = await failHandler(makeRequest({ prompt: 'test prompt' }));
    expect(res.status).toBe(500);
    expect(mockRefund).toHaveBeenCalledWith('user-1', 'usage-1');
    expect(mockCapture).toHaveBeenCalled();
    // Raw provider error (request IDs / internals) must not reach the client (#8597).
    const data = await res.json();
    expect(data.error).not.toContain('0xDEADBEEF');
    expect(data.error).not.toContain('ElevenLabs internal');
    expect(data.error).toBe(GENERIC_500);
    expect((mockCapture.mock.calls.at(-1)?.[0] as Error).message).toBe(
      'ElevenLabs internal: request 0xDEADBEEF failed',
    );
  });

  it('does not leak a raw error message to the client on a 500 (cached path) (#8597)', async () => {
    const cachedHandler = createGenerationHandler({
      route: '/api/generate/test',
      provider: 'elevenlabs',
      operation: 'test_generation',
      rateLimitKey: 'gen-test',
      validate: (body) => ({ ok: true, params: { prompt: body.prompt as string } }),
      cacheKeyParams: (p) => ({ prompt: (p as { prompt: string }).prompt }),
      execute: async () => { throw new Error('DB error: postgres://secret@host/db'); },
    });

    const res = await cachedHandler(makeRequest({ prompt: 'test prompt' }));
    expect(res.status).toBe(500);
    const data = await res.json();
    // The cached-path catch site must scrub the message too — a DB DSN would
    // otherwise leak credentials to the client.
    expect(data.error).not.toContain('postgres://');
    expect(data.error).not.toContain('secret@host');
    expect(data.error).toBe(GENERIC_500);
    expect((mockCapture.mock.calls.at(-1)?.[0] as Error).message).toContain('postgres://secret@host');
  });

  it('does not refund when usageId is undefined (BYOK)', async () => {
    mockResolve.mockResolvedValue({ type: 'byok', key: 'user-key', metered: false });
    const failHandler = createGenerationHandler({
      route: '/api/generate/test',
      provider: 'elevenlabs',
      operation: 'test_generation',
      rateLimitKey: 'gen-test',
      validate: (body) => ({ ok: true, params: { prompt: body.prompt as string } }),
      execute: async () => { throw new Error('Provider error'); },
    });

    const res = await failHandler(makeRequest({ prompt: 'test prompt' }));
    expect(res.status).toBe(500);
    expect(mockRefund).not.toHaveBeenCalled();
  });

  it('passes userId and tier to execute context', async () => {
    const executeSpy = vi.fn().mockResolvedValue({ ok: true });
    const handler = createGenerationHandler({
      route: '/api/generate/test',
      provider: 'elevenlabs',
      operation: 'test_generation',
      rateLimitKey: 'gen-test',
      validate: (body) => ({ ok: true, params: { prompt: body.prompt as string } }),
      execute: executeSpy,
    });

    await handler(makeRequest({ prompt: 'test prompt' }));
    expect(executeSpy).toHaveBeenCalledWith(
      { prompt: 'test prompt' },
      'test-key',
      expect.objectContaining({ userId: 'user-1', tier: 'pro', usageId: 'usage-1', tokenCost: 10 }),
    );
  });

  it('calls aggregate rate limit before per-route rate limit', async () => {
    const callOrder: string[] = [];
    mockAggRateLimit.mockImplementation(async () => {
      callOrder.push('aggregate');
      return { allowed: true, remaining: 29, resetAt: Date.now() + 900000 };
    });
    mockRateLimit.mockImplementation(async () => {
      callOrder.push('per-route');
      return { allowed: true, remaining: 9, resetAt: Date.now() + 300000 };
    });

    await testHandler(makeRequest({ prompt: 'test prompt' }));
    expect(callOrder).toEqual(['aggregate', 'per-route']);
    expect(mockAggRateLimit).toHaveBeenCalledWith('user-1');
  });

  it('uses dynamic tokenCost when provided', async () => {
    const executeSpy = vi.fn().mockResolvedValue({ ok: true });
    const handler = createGenerationHandler({
      route: '/api/generate/test',
      provider: 'elevenlabs',
      operation: 'test_generation',
      rateLimitKey: 'gen-test',
      tokenCost: (params) => (params as { count: number }).count * 5,
      validate: (body) => ({ ok: true, params: { prompt: body.prompt as string, count: (body.count as number) ?? 1 } }),
      execute: executeSpy,
    });

    await handler(makeRequest({ prompt: 'test prompt', count: 4 }));
    expect(executeSpy).toHaveBeenCalledWith(
      expect.anything(),
      'test-key',
      expect.objectContaining({ tokenCost: 20 }),
    );
  });

  it('skips content safety when configured', async () => {
    const handler = createGenerationHandler({
      route: '/api/generate/test',
      provider: 'elevenlabs',
      operation: 'test_generation',
      rateLimitKey: 'gen-test',
      skipContentSafety: true,
      validate: (body) => ({ ok: true, params: { data: body.data as string } }),
      execute: async () => ({ ok: true }),
    });

    await handler(makeRequest({ data: 'binary data' }));
    expect(mockSanitize).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // #8650 — secondary free-text fields must run through the content-safety
  // filter, not just the primary promptField.
  // -------------------------------------------------------------------------

  const secondaryHandler = () =>
    createGenerationHandler({
      route: '/api/generate/test',
      provider: 'elevenlabs',
      operation: 'test_generation',
      rateLimitKey: 'gen-test',
      secondaryPromptFields: ['negativePrompt', 'artStyle'],
      validate: (body) => ({
        ok: true,
        params: {
          prompt: body.prompt as string,
          negativePrompt: body.negativePrompt as string | undefined,
          artStyle: body.artStyle as string | undefined,
        },
      }),
      execute: async () => ({ ok: true }),
    });

  it('runs content safety on every secondary prompt field (#8650)', async () => {
    const handler = secondaryHandler();
    await handler(makeRequest({
      prompt: 'a friendly robot',
      negativePrompt: 'blurry, low quality',
      artStyle: 'realistic',
    }));

    expect(mockSanitize).toHaveBeenCalledWith('a friendly robot');
    expect(mockSanitize).toHaveBeenCalledWith('blurry, low quality');
    expect(mockSanitize).toHaveBeenCalledWith('realistic');
  });

  it('rejects 422 when a secondary field fails the safety filter (#8650)', async () => {
    // Primary prompt is clean; the injection lives in negativePrompt.
    mockSanitize.mockImplementation((p: string) =>
      p === 'malicious payload'
        ? { safe: false, reason: 'Unsafe content', filtered: undefined }
        : { safe: true, filtered: p },
    );

    const handler = secondaryHandler();
    const res = await handler(makeRequest({
      prompt: 'a friendly robot',
      negativePrompt: 'malicious payload',
    }));

    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.error).toContain('Unsafe content');
  });

  it('only screens secondary fields that are present and non-empty (#8650)', async () => {
    const handler = secondaryHandler();
    await handler(makeRequest({ prompt: 'a friendly robot' }));

    // Absent secondary fields are not screened.
    expect(mockSanitize).toHaveBeenCalledWith('a friendly robot');
    expect(mockSanitize).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // PF-916 / #8826 — factory contract pins (regression guards)
  //
  // These tests pin EXISTING behavior: they pass against current code by
  // design. Their job is to lock behavior this PR must not change, not to
  // fail first. Any RED result is a real bug — fix the code, never the test.
  // -------------------------------------------------------------------------

  it('passes filtered prompt text to both execute and billingMetadata (primary + secondary fields) (#8826 pin)', async () => {
    const executeSpy = vi.fn().mockResolvedValue({ ok: true });
    const billingMetadataSpy = vi.fn().mockImplementation((p: unknown) => p as Record<string, unknown>);

    mockSanitize.mockImplementation((p: string) => ({ safe: true, filtered: `filtered(${p})` }));

    const handler = createGenerationHandler({
      route: '/api/generate/test',
      provider: 'elevenlabs',
      operation: 'test_generation',
      rateLimitKey: 'gen-test',
      secondaryPromptFields: ['negativePrompt'],
      billingMetadata: billingMetadataSpy,
      validate: (body) => ({
        ok: true,
        params: { prompt: body.prompt as string, negativePrompt: body.negativePrompt as string },
      }),
      execute: executeSpy,
    });

    await handler(makeRequest({ prompt: 'raw prompt', negativePrompt: 'raw negative' }));

    // params is mutated in-place by the content-safety loop before execute and
    // billingMetadata are called, so both receive the filtered versions.
    expect(executeSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'filtered(raw prompt)',
        negativePrompt: 'filtered(raw negative)',
      }),
      expect.any(String),
      expect.anything(),
    );
    expect(billingMetadataSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'filtered(raw prompt)',
        negativePrompt: 'filtered(raw negative)',
      }),
    );
  });

  it('returns 500 "Internal pricing error" and captures when tokenCost fn returns NaN (#8826 pin)', async () => {
    const handler = createGenerationHandler({
      route: '/api/generate/test',
      provider: 'elevenlabs',
      operation: 'test_generation',
      rateLimitKey: 'gen-test',
      tokenCost: () => NaN,
      validate: (body) => ({ ok: true, params: { prompt: body.prompt as string } }),
      execute: async () => ({ ok: true }),
    });

    const res = await handler(makeRequest({ prompt: 'test prompt' }));
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toBe('Internal pricing error');
    expect(mockCapture).toHaveBeenCalled();
  });

  it('returns 500 "Internal pricing error" and captures when tokenCost fn returns a negative value (#8826 pin)', async () => {
    const handler = createGenerationHandler({
      route: '/api/generate/test',
      provider: 'elevenlabs',
      operation: 'test_generation',
      rateLimitKey: 'gen-test',
      tokenCost: () => -5,
      validate: (body) => ({ ok: true, params: { prompt: body.prompt as string } }),
      execute: async () => ({ ok: true }),
    });

    const res = await handler(makeRequest({ prompt: 'test prompt' }));
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toBe('Internal pricing error');
    expect(mockCapture).toHaveBeenCalled();
  });

  it('returns 500 "Internal pricing error" via resolve_billing_params branch when tokenCost fn throws (#8826 pin)', async () => {
    const handler = createGenerationHandler({
      route: '/api/generate/test',
      provider: 'elevenlabs',
      operation: 'test_generation',
      rateLimitKey: 'gen-test',
      tokenCost: () => { throw new Error('pricing service unavailable'); },
      validate: (body) => ({ ok: true, params: { prompt: body.prompt as string } }),
      execute: async () => ({ ok: true }),
    });

    const res = await handler(makeRequest({ prompt: 'test prompt' }));
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toBe('Internal pricing error');
    expect(mockCapture).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ action: 'resolve_billing_params' }),
    );
  });

  it('calls refundTokens and returns GENERIC_500 on cached-path execute failure (#8826 pin)', async () => {
    const handler = createGenerationHandler({
      route: '/api/generate/test',
      provider: 'elevenlabs',
      operation: 'test_generation',
      rateLimitKey: 'gen-test',
      cacheKeyParams: (p) => ({ prompt: (p as { prompt: string }).prompt }),
      validate: (body) => ({ ok: true, params: { prompt: body.prompt as string } }),
      execute: async () => { throw new Error('cached provider failure'); },
    });

    const res = await handler(makeRequest({ prompt: 'test prompt' }));
    expect(res.status).toBe(500);
    expect(mockRefund).toHaveBeenCalledWith('user-1', 'usage-1');
    const data = await res.json();
    expect(data.error).toBe(GENERIC_500);
  });

  it('skips resolveApiKey, deductTokens and QStash publish on a cache HIT; sets X-Cache: HIT header (#8826 pin)', async () => {
    mockCachedGenerate.mockResolvedValueOnce({ result: { ok: true }, cached: true });

    const handler = createGenerationHandler({
      route: '/api/generate/test',
      provider: 'elevenlabs',
      operation: 'test_generation',
      rateLimitKey: 'gen-test',
      cacheKeyParams: (p) => ({ prompt: (p as { prompt: string }).prompt }),
      validate: (body) => ({ ok: true, params: { prompt: body.prompt as string } }),
      execute: vi.fn().mockResolvedValue({ ok: true }),
    });

    const res = await handler(makeRequest({ prompt: 'test prompt' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Cache')).toBe('HIT');
    expect(mockResolve).not.toHaveBeenCalled();
  });

  it('returns opaque 500 and captures with refund context even when refundTokens itself throws (#8826 pin)', async () => {
    mockRefund.mockRejectedValue(new Error('refund service unavailable'));

    const handler = createGenerationHandler({
      route: '/api/generate/test',
      provider: 'elevenlabs',
      operation: 'test_generation',
      rateLimitKey: 'gen-test',
      validate: (body) => ({ ok: true, params: { prompt: body.prompt as string } }),
      execute: async () => { throw new Error('provider failure triggering refund'); },
    });

    const res = await handler(makeRequest({ prompt: 'test prompt' }));
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toBe(GENERIC_500);
    expect(mockCapture).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ action: 'refund', usageId: 'usage-1' }),
    );
  });

  // -------------------------------------------------------------------------
  // PF-916 / #8826 — Dispatch 2: factory contract pins (tests 6–10)
  // -------------------------------------------------------------------------

  it('returns 401 without calling either rate limiter (auth before rate limit) (#8826 pin)', async () => {
    // The factory returns from auth (step 1) before reaching the aggregate or
    // per-route rate limiters (step 2a/2b). A 401 must consume zero budget.
    mockAuth.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    });
    const res = await testHandler(makeRequest({ prompt: 'test prompt' }));
    expect(res.status).toBe(401);
    expect(mockAggRateLimit).not.toHaveBeenCalled();
    expect(mockRateLimit).not.toHaveBeenCalled();
  });

  it('registers no after() callbacks for a non-async route (dormant after, part 1 of 2) (#8826 pin)', async () => {
    // testHandler has no asyncJob — the `if (asyncJob && isQstashConfigured())`
    // gate short-circuits on asyncJob === undefined, so after() is never reached.
    const res = await testHandler(makeRequest({ prompt: 'test prompt' }));
    expect(res.status).toBe(200);
    expect(afterCallbacks).toHaveLength(0);
  });

  it('registers no after() callbacks for an async route when QStash is unconfigured (dormant after, part 2 of 2) (#8826 pin)', async () => {
    // mockConfigured.mockReturnValue(false) is set by beforeEach: QStash env unset.
    // Even with asyncJob declared, isQstashConfigured() returning false means the
    // gate `asyncJob && isQstashConfigured()` evaluates to false → after() is never called.
    const asyncHandler = createGenerationHandler<{ prompt: string }, { jobId: string; status: string }>({
      route: '/api/generate/model',
      provider: 'elevenlabs',
      operation: 'model_generation',
      rateLimitKey: 'gen-model',
      validate: (body) => ({ ok: true, params: { prompt: body.prompt as string } }),
      execute: async () => ({ jobId: 'task-1', status: 'pending' }),
      asyncJob: {
        type: 'model',
        providerJobId: (r) => r.jobId,
      },
    });
    const res = await asyncHandler(makeRequest({ prompt: 'test prompt' }));
    expect(res.status).toBe(200);
    expect(afterCallbacks).toHaveLength(0);
  });

  it('passes validated params directly as billingMetadata when billingMetadata config is omitted (#8826 pin)', async () => {
    // Factory lines 384 and 437: `const metadata = billingMetadataFn
    //   ? billingMetadataFn(params) : (params as Record<string, unknown>)`.
    // Omitting billingMetadata → resolveApiKey receives the full params object.
    const handler = createGenerationHandler({
      route: '/api/generate/test',
      provider: 'elevenlabs',
      operation: 'test_generation',
      rateLimitKey: 'gen-test',
      // No billingMetadata — params is passed through unchanged.
      validate: (body) => ({
        ok: true,
        params: { prompt: body.prompt as string, count: body.count as number },
      }),
      execute: async () => ({ ok: true }),
    });

    await handler(makeRequest({ prompt: 'test prompt', count: 3 }));

    // Content safety replaces prompt with the filtered value ('test prompt' → 'test prompt'
    // per the mock, same value). count is a number; the type guard skips it unchanged.
    expect(mockResolve).toHaveBeenCalledWith(
      'user-1',
      'elevenlabs',
      10,
      'test_generation',
      { prompt: 'test prompt', count: 3 },
    );
  });

  it('uses custom status code from validate failure and falls back to 422 (pins status ?? 422) (#8826 pin)', async () => {
    // Factory line 320: `{ status: validation.status ?? 422 }`.
    // A validate result carrying status: 418 must produce a 418 response.
    const handler = createGenerationHandler({
      route: '/api/generate/test',
      provider: 'elevenlabs',
      operation: 'test_generation',
      rateLimitKey: 'gen-test',
      validate: () => ({ ok: false as const, error: 'I am a teapot', status: 418 }),
      execute: async () => ({ ok: true }),
    });

    const res = await handler(makeRequest({ prompt: 'test prompt' }));
    expect(res.status).toBe(418);
    const data = await res.json();
    expect(data.error).toBe('I am a teapot');
  });

  it('skips non-string secondaryPromptField values without throwing (pins lenient safety loop) (#8826 pin)', async () => {
    // Factory line 338: `if (typeof value === 'string' && value.length > 0)`.
    // A numeric value (e.g. count: 5) in a secondaryPromptFields entry must be
    // silently skipped — no TypeError, no 422, no call to sanitizePrompt.
    const handler = createGenerationHandler({
      route: '/api/generate/test',
      provider: 'elevenlabs',
      operation: 'test_generation',
      rateLimitKey: 'gen-test',
      secondaryPromptFields: ['count'],
      validate: (body) => ({
        ok: true,
        params: { prompt: body.prompt as string, count: body.count as number },
      }),
      execute: async () => ({ ok: true }),
    });

    const res = await handler(makeRequest({ prompt: 'test prompt', count: 5 }));
    expect(res.status).toBe(200);
    // sanitizePrompt called once (primary prompt only); numeric count is bypassed.
    expect(mockSanitize).toHaveBeenCalledTimes(1);
    expect(mockSanitize).toHaveBeenCalledWith('test prompt');
  });
});
