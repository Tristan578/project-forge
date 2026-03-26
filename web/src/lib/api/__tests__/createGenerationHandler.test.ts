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
}));
vi.mock('@/lib/ai/contentSafety', () => ({
  sanitizePrompt: vi.fn((p: string) => ({ safe: true, filtered: p })),
}));
vi.mock('@/lib/tokens/service', () => ({
  refundTokens: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/db/client', () => ({
  getDb: vi.fn().mockReturnValue({}),
  getNeonSql: vi.fn().mockReturnValue(
    Object.assign(vi.fn(), { transaction: vi.fn().mockResolvedValue([]) }),
  ),
}));

import { authenticateRequest } from '@/lib/auth/api-auth';
import { resolveApiKey } from '@/lib/keys/resolver';
import { distributedRateLimit } from '@/lib/rateLimit/distributed';
import { sanitizePrompt } from '@/lib/ai/contentSafety';
import { refundTokens } from '@/lib/tokens/service';
import { captureException } from '@/lib/monitoring/sentry-server';
import { createGenerationHandler } from '../createGenerationHandler';

const mockAuth = vi.mocked(authenticateRequest);
const mockResolve = vi.mocked(resolveApiKey);
const mockRateLimit = vi.mocked(distributedRateLimit);
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
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({
      ok: true,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ctx: { user: { id: 'user-1', tier: 'pro' } as any, clerkId: 'clerk-1' },
    });
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

  it('returns 429 when rate limited', async () => {
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
      execute: async () => { throw new Error('Provider timeout'); },
    });

    const res = await failHandler(makeRequest({ prompt: 'test prompt' }));
    expect(res.status).toBe(500);
    expect(mockRefund).toHaveBeenCalledWith('user-1', 'usage-1');
    expect(mockCapture).toHaveBeenCalled();
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
});
