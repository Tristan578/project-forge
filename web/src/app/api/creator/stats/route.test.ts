vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from './route';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { getCreatorStats } from '@/lib/projects/creatorStats';
import { distributedRateLimit } from '@/lib/rateLimit/distributed';
import { captureException } from '@/lib/monitoring/sentry-server';
import { makeUser, mockNextResponse } from '@/test/utils/apiTestUtils';

vi.mock('@/lib/auth/api-auth');
vi.mock('@/lib/projects/creatorStats');
vi.mock('@/lib/monitoring/sentry-server', () => ({ captureException: vi.fn() }));
vi.mock('@/lib/rateLimit', () => ({
  rateLimit: vi.fn().mockResolvedValue({ allowed: true, remaining: 29, resetAt: Date.now() + 60000 }),
  // What the middleware returns when the limiter says no. A bare vi.fn() here
  // returns undefined, which the middleware reads as "no error" and lets the
  // request through, so a 429 test against it could never fail.
  rateLimitResponse: vi.fn(() => new Response(JSON.stringify({ error: 'Too many requests' }), { status: 429 })),
  getClientIp: vi.fn().mockReturnValue('127.0.0.1'),
}));
vi.mock('@/lib/rateLimit/distributed', () => ({
  distributedRateLimit: vi.fn(),
}));

const req = () => new NextRequest('http://localhost:3000/api/creator/stats');

const STATS = {
  totalPublishedGames: 3,
  totalPlays: 15,
  games: [
    { id: 'a', title: 'Crystal Run', slug: 'crystal-run', status: 'published' as const, playCount: 10, createdAt: '2026-09-01T10:00:00.000Z' },
    { id: 'b', title: 'Lava Caves', slug: 'lava-caves', status: 'published' as const, playCount: 5, createdAt: '2026-09-02T10:00:00.000Z' },
    { id: 'c', title: 'Sky Hop', slug: 'sky-hop', status: 'published' as const, playCount: 0, createdAt: '2026-09-03T10:00:00.000Z' },
  ],
  tokenUsage: { monthlyUsed: 250, monthlyTotal: 1000, addon: 40 },
};

describe('GET /api/creator/stats', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(distributedRateLimit).mockResolvedValue({
      allowed: true,
      remaining: 29,
      resetAt: Date.now() + 300_000,
    });
  });

  it('returns the signed-in creator\'s stats, looked up by their own id', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: 'clerk_1', user } });
    vi.mocked(getCreatorStats).mockResolvedValue(STATS);

    const res = await GET(req());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(STATS);
    expect(getCreatorStats).toHaveBeenCalledWith(user.id);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
  });

  it('returns 401 and runs no stats query without a session', async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({
      ok: false,
      response: mockNextResponse({ error: 'Unauthorized' }, { status: 401 }),
    });

    const res = await GET(req());

    expect(res.status).toBe(401);
    expect(getCreatorStats).not.toHaveBeenCalled();
  });

  it('returns 429 and runs no stats query once the per-user limit is spent', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: 'clerk_1', user } });
    vi.mocked(distributedRateLimit).mockResolvedValue({
      allowed: false,
      remaining: 0,
      resetAt: Date.now() + 300_000,
    });

    const res = await GET(req());

    expect(res.status).toBe(429);
    expect(getCreatorStats).not.toHaveBeenCalled();
    // The bucket is per user and is this route's own: 30 per 5 minutes.
    expect(distributedRateLimit).toHaveBeenCalledWith(`user:creator-stats:${user.id}`, 30, 300);
  });

  it('returns 503 with a generic message and reports once when the query fails', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: 'clerk_1', user } });
    vi.mocked(getCreatorStats).mockRejectedValue(new Error('connect ECONNREFUSED 10.0.0.5:5432'));

    const res = await GET(req());

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe('Creator stats are unavailable right now');
    expect(JSON.stringify(body)).not.toContain('ECONNREFUSED');
    expect(captureException).toHaveBeenCalledTimes(1);
  });
});
