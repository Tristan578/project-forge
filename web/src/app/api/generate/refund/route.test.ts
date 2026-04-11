vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { POST } from './route';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { rateLimit } from '@/lib/rateLimit';
import { refundTokens } from '@/lib/tokens/service';
import type { User } from '@/lib/db/schema';

vi.mock('@/lib/auth/api-auth');
vi.mock('@/lib/rateLimit', () => ({
  rateLimit: vi.fn(),
  rateLimitResponse: vi.fn(() => new Response('Rate limited', { status: 429 })),
}));
vi.mock('@/lib/monitoring/sentry-server');
vi.mock('@/lib/tokens/service', () => ({
  refundTokens: vi.fn().mockResolvedValue({ refunded: true }),
}));

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://test/api/generate/refund', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

describe('POST /api/generate/refund', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authenticateRequest).mockResolvedValue({
      ok: true as const,
      ctx: { clerkId: 'clerk_1', user: { id: 'user_1', tier: 'creator' } as unknown as User },
    });
    vi.mocked(rateLimit).mockResolvedValue({ allowed: true, remaining: 2, resetAt: Date.now() + 60000 });
    vi.mocked(refundTokens).mockResolvedValue({ refunded: true });
  });

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({
      ok: false as const,
      response: new NextResponse('Unauthorized', { status: 401 }),
    });

    const res = await POST(makeRequest({ usageId: 'usage-1' }));
    expect(res.status).toBe(401);
  });

  it('returns 429 when rate limited', async () => {
    vi.mocked(rateLimit).mockResolvedValue({ allowed: false, remaining: 0, resetAt: Date.now() + 60000 });

    const res = await POST(makeRequest({ usageId: 'usage-1' }));
    expect(res.status).toBe(429);
  });

  it('returns 400 for invalid JSON', async () => {
    const req = new NextRequest('http://test/api/generate/refund', {
      method: 'POST',
      body: 'not json',
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('Invalid JSON body');
  });

  it('returns 422 when usageId is missing', async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.error).toBe('Validation failed');
    expect(data.code).toBe('VALIDATION_ERROR');
  });

  it('returns 500 when refund fails', async () => {
    vi.mocked(refundTokens).mockRejectedValue(new Error('Refund failed'));

    const res = await POST(makeRequest({ usageId: 'usage-1' }));
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toBe('Refund failed');
  });

  it('returns 200 on successful refund', async () => {
    const res = await POST(makeRequest({ usageId: 'usage-1' }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(refundTokens).toHaveBeenCalledWith('user_1', 'usage-1');
  });
});
