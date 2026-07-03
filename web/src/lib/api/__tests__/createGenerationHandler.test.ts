import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

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
import { createGenerationHandler } from '../createGenerationHandler';

const mockAuth = vi.mocked(authenticateRequest);
const mockResolve = vi.mocked(resolveApiKey);
const mockRateLimit = vi.mocked(distributedRateLimit);
const mockAggRateLimit = vi.mocked(aggregateGenerationRateLimit);
const mockSanitize = vi.mocked(sanitizePrompt);
const mockRefund = vi.mocked(refundTokens);
const mockCapture = vi.mocked(captureException);

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
    mockAuth.mockResolvedValue({
      ok: true,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ctx: { user: { id: 'user-1', tier: 'pro' } as any, clerkId: 'clerk-1' },
    });
    mockAggRateLimit.mockResolvedValue({ allowed: true, remaining: 29, resetAt: Date.now() + 900000 });
    mockRateLimit.mockResolvedValue({ allowed: true, remaining: 9, resetAt: Date.now() + 300000 });
    mockResolve.mockResolvedValue({ type: 'platform', key: 'test-key', metered: true, usageId: 'usage-1' });
    mockSanitize.mockReturnValue({ safe: true, filtered: 'test prompt' });
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
});
