vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from './route';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { getTokenBalance } from '@/lib/tokens/service';
import { makeUser, mockNextResponse } from '@/test/utils/apiTestUtils';

vi.mock('@/lib/auth/api-auth');
vi.mock('@/lib/tokens/service');
vi.mock('@/lib/rateLimit', () => ({
  rateLimit: vi.fn().mockResolvedValue({ allowed: true, remaining: 29, resetAt: Date.now() + 60000 }),
  rateLimitResponse: vi.fn(),
  getClientIp: vi.fn().mockReturnValue('127.0.0.1'),
}));
vi.mock('@/lib/rateLimit/distributed', () => ({
  distributedRateLimit: vi.fn().mockResolvedValue({ allowed: true, remaining: 29, resetAt: Date.now() + 60000 }),
}));

const req = new NextRequest('http://localhost:3000/api/tokens/balance');

describe('GET /api/tokens/balance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 if unauthenticated', async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({
      ok: false,
      response: mockNextResponse({ error: 'Unauthorized' }, { status: 401 }),
    });

    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it('returns token balance', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: '123', user } });
    vi.mocked(getTokenBalance).mockResolvedValue({
      monthlyRemaining: 40,
      monthlyTotal: 50,
      addon: 60,
      total: 100,
      nextRefillDate: null,
    });

    const res = await GET(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.total).toBe(100);
    expect(getTokenBalance).toHaveBeenCalledWith(user.id);
  });
});
