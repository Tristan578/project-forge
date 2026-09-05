vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { POST } from './route';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { rateLimit } from '@/lib/rateLimit';
import { resolveApiKey, ApiKeyError } from '@/lib/keys/resolver';
import { getTokenCost } from '@/lib/tokens/pricing';
import { SunoClient } from '@/lib/generate/sunoClient';
import { refundTokens } from '@/lib/tokens/service';
import type { User } from '@/lib/db/schema';

vi.mock('@/lib/auth/api-auth');
vi.mock('@/lib/rateLimit', () => ({
  rateLimit: vi.fn(),
  rateLimitResponse: vi.fn(() => new Response('Rate limited', { status: 429 })),
}));
vi.mock('@/lib/monitoring/sentry-server');
vi.mock('@/lib/keys/resolver', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/keys/resolver')>();
  return { ...mod, resolveApiKey: vi.fn() };
});
vi.mock('@/lib/tokens/pricing');
vi.mock('@/lib/generate/sunoClient', () => ({
  SunoClient: vi.fn(() => ({
    createMusic: vi.fn().mockResolvedValue({ taskId: 'task-1' }),
  })),
}));
vi.mock('@/lib/rateLimit/distributed', () => ({
  distributedRateLimit: vi.fn().mockResolvedValue({ allowed: true, remaining: 9, resetAt: Date.now() + 300000 }),
  aggregateGenerationRateLimit: vi.fn().mockResolvedValue({ allowed: true, remaining: 29, resetAt: Date.now() + 900000 }),
}));
vi.mock('@/lib/ai/contentSafety', () => ({
  sanitizePrompt: vi.fn((p: string) => ({ safe: true, filtered: p })),
}));
vi.mock('@/lib/tokens/service', () => ({
  refundTokens: vi.fn().mockResolvedValue({ refunded: true }),
}));

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://test/api/generate/music', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

describe('POST /api/generate/music', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.mocked(authenticateRequest).mockResolvedValue({
      ok: true as const,
      ctx: { clerkId: 'clerk_1', user: { id: 'user_1', tier: 'creator' } as unknown as User },
    });
    vi.mocked(rateLimit).mockResolvedValue({ allowed: true, remaining: 9, resetAt: Date.now() + 300000 });
    vi.mocked(resolveApiKey).mockResolvedValue({ type: 'platform', key: 'test-key', metered: true, usageId: 'usage-1' });
    vi.mocked(getTokenCost).mockReturnValue(100);
    vi.mocked(SunoClient).mockImplementation(
      function (this: InstanceType<typeof SunoClient>) {
        this.createMusic = vi.fn().mockResolvedValue({ taskId: 'task-1' });
      } as unknown as typeof SunoClient
    );
  });

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({
      ok: false as const,
      response: new NextResponse('Unauthorized', { status: 401 }),
    });

    const res = await POST(makeRequest({ prompt: 'epic battle theme', durationSeconds: 30 }));
    expect(res.status).toBe(401);
  });

  it('refuses 503 before consuming any rate-limit budget (#9117 gate precedes 2a/2b)', async () => {
    const { distributedRateLimit } = await import('@/lib/rateLimit/distributed');
    vi.mocked(distributedRateLimit).mockResolvedValue({ allowed: false, remaining: 0, resetAt: Date.now() + 300000 });

    const res = await POST(makeRequest({ prompt: 'epic battle theme', durationSeconds: 30 }));
    expect(res.status).toBe(503);
    expect(vi.mocked(distributedRateLimit)).not.toHaveBeenCalled();
  });

  // Body parsing and validation sit BELOW the #9117 gate, so a malformed body
  // is also answered 503 while music is declared unavailable: the route spends
  // nothing on parsing a request it can never serve. The 400/422 cases return
  // with #9522.
  it('refuses 503 even for a malformed body (gate precedes parsing and validation)', async () => {
    const req = new NextRequest('http://test/api/generate/music', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    });
    const res = await POST(req);
    expect(res.status).toBe(503);
    const short = await POST(makeRequest({ prompt: 'ab', durationSeconds: 30 }));
    expect(short.status).toBe(503);
  });

  // #9117 / #9522: music is declared unavailable (UNAVAILABLE_CAPABILITIES)
  // because Suno has no public API. A valid, authenticated, safe request is
  // refused 503 BEFORE the key resolves, before any deduction, and before the
  // provider client is even constructed — so there is nothing to refund and
  // no 402/500 path to reach. The 402/500/refund cases return with #9522.
  it('refuses every valid request 503 SERVICE_UNAVAILABLE before resolving a key or charging', async () => {
    const res = await POST(makeRequest({ prompt: 'epic battle theme', durationSeconds: 30 }));
    expect(res.status).toBe(503);
    const data = await res.json();
    expect(data.code).toBe('SERVICE_UNAVAILABLE');
    expect(data.error).toMatch(/not available yet/i);
    expect(data.error).not.toMatch(/#\d+|PLATFORM_|Suno/);
    expect(data.details).toEqual({ capability: 'music', issue: 9522 });
    expect(vi.mocked(resolveApiKey)).not.toHaveBeenCalled();
    expect(vi.mocked(refundTokens)).not.toHaveBeenCalled();
    expect(vi.mocked(SunoClient)).not.toHaveBeenCalled();
  });

  it('still refuses 503 when the resolver would have thrown INSUFFICIENT_TOKENS (gate precedes billing)', async () => {
    vi.mocked(resolveApiKey).mockRejectedValue(
      new ApiKeyError('INSUFFICIENT_TOKENS', 'Not enough tokens')
    );
    const res = await POST(makeRequest({ prompt: 'epic battle theme', durationSeconds: 30 }));
    expect(res.status).toBe(503);
    expect(vi.mocked(resolveApiKey)).not.toHaveBeenCalled();
  });
});
