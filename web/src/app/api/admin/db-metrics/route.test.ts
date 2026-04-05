vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from './route';
import { authenticateRequest, assertAdmin } from '@/lib/auth/api-auth';
import { rateLimitAdminRoute } from '@/lib/rateLimit';
import { getMetrics } from '@/lib/db/queryMonitor';
import { makeUser, mockNextResponse } from '@/test/utils/apiTestUtils';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth/api-auth');
vi.mock('@/lib/rateLimit', () => ({
  rateLimitAdminRoute: vi.fn(),
}));
vi.mock('@/lib/db/queryMonitor');
vi.mock('@/lib/monitoring/sentry-server', () => ({
  captureException: vi.fn(),
}));

const ADMIN_CLERK_ID = 'clerk_admin';

describe('GET /api/admin/db-metrics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const user = makeUser({ tier: 'pro' });
    vi.mocked(authenticateRequest).mockResolvedValue({
      ok: true as const,
      ctx: { clerkId: ADMIN_CLERK_ID, user },
    });
    vi.mocked(assertAdmin).mockReturnValue(null as never);
    vi.mocked(rateLimitAdminRoute).mockResolvedValue(null);
    vi.mocked(getMetrics).mockReturnValue({
      avgQueryTimeMs: 12.5,
      slowQueryCount: 2,
      totalQueryCount: 150,
      top5Slowest: [],
      queryCountByRoute: { '/api/projects': 50 },
      windowStartMs: Date.now() - 300_000,
      windowEndMs: Date.now(),
    });
  });

  it('returns 401 if unauthenticated', async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({
      ok: false as const,
      response: mockNextResponse({ error: 'Unauthorized' }, { status: 401 }),
    });

    const res = await GET(new NextRequest('http://localhost/api/admin/db-metrics'));
    expect(res.status).toBe(401);
  });

  it('returns 403 if not admin', async () => {
    vi.mocked(assertAdmin).mockReturnValue(
      mockNextResponse({ error: 'Admin access required' }, { status: 403 })
    );

    const res = await GET(new NextRequest('http://localhost/api/admin/db-metrics'));
    expect(res.status).toBe(403);
  });

  it('returns 429 if rate limited', async () => {
    vi.mocked(rateLimitAdminRoute).mockResolvedValue(
      mockNextResponse({ error: 'Too many requests' }, { status: 429 })
    );

    const res = await GET(new NextRequest('http://localhost/api/admin/db-metrics'));
    expect(res.status).toBe(429);
  });

  it('returns metrics on success', async () => {
    const res = await GET(new NextRequest('http://localhost/api/admin/db-metrics'));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.avgQueryTimeMs).toBe(12.5);
    expect(data.slowQueryCount).toBe(2);
    expect(data.totalQueryCount).toBe(150);
  });

  it('returns 500 on internal error', async () => {
    vi.mocked(getMetrics).mockImplementation(() => {
      throw new Error('Query monitor failed');
    });

    const res = await GET(new NextRequest('http://localhost/api/admin/db-metrics'));
    expect(res.status).toBe(500);
  });
});
