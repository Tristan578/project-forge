vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { getUsageHistory } from '@/lib/tokens/service';

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

describe('GET /api/tokens/usage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authenticateRequest).mockResolvedValue({
      ok: true as const,
      ctx: { clerkId: 'clerk_1', user: { id: 'user_1', tier: 'creator' } as never },
    });
  });

  it('should return 401 when not authenticated', async () => {
    const mockResponse = new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    vi.mocked(authenticateRequest).mockResolvedValue({
      ok: false as const,
      response: mockResponse as never,
    });

    const { GET } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/tokens/usage');
    const res = await GET(req);

    expect(res.status).toBe(401);
  });

  it('should return usage history with default days', async () => {
    vi.mocked(getUsageHistory).mockResolvedValue([
      { date: '2025-01-01', tokens: 100 },
    ] as never);

    const { GET } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/tokens/usage');
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.usage).toHaveLength(1);
    expect(getUsageHistory).toHaveBeenCalledWith('user_1', 30);
  });

  it('should respect days param capped at 90', async () => {
    vi.mocked(getUsageHistory).mockResolvedValue([] as never);

    const { GET } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/tokens/usage?days=365');
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(getUsageHistory).toHaveBeenCalledWith('user_1', 90);
  });
});
