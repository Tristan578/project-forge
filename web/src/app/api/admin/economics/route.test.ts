vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from './route';
import { authenticateRequest, assertAdmin } from '@/lib/auth/api-auth';
import { getDb } from '@/lib/db/client';
import { makeUser, mockNextResponse } from '@/test/utils/apiTestUtils';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth/api-auth');
vi.mock('@/lib/db/client');

describe('GET /api/admin/economics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 if unauthenticated', async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({
      ok: false,
      response: mockNextResponse({ error: 'Unauthorized' }, { status: 401 }),
    });

    const res = await GET(new NextRequest('http://localhost/api/admin/economics'));
    expect(res.status).toBe(401);
  });

  it('returns 403 if not admin', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: '123', user } });
    vi.mocked(assertAdmin).mockReturnValue(mockNextResponse({ error: 'Forbidden' }, { status: 403 }));

    const res = await GET(new NextRequest('http://localhost/api/admin/economics'));
    expect(res.status).toBe(403);
  });

  it('returns economics dashboard data for admins', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: 'admin_123', user } });
    vi.mocked(assertAdmin).mockReturnValue(null);

    // Make a resilient chain mock for each select call
    const chainMock = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      groupBy: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
      then: function(resolve: (v: unknown) => void) { resolve([]); },
    };
    
    // For userStats we need to return an array with one element
    const userStatsChain = { ...chainMock, then: function(resolve: (v: unknown) => void) { resolve([{ totalUsers: 10 }]); } };
    
    vi.mocked(getDb).mockReturnValue({
      select: vi.fn()
        .mockReturnValueOnce(userStatsChain) // userStats
        .mockReturnValueOnce(chainMock)      // costSummary
        .mockReturnValueOnce(chainMock)      // recentTransactions
        .mockReturnValueOnce(chainMock)      // tokenConfigs
        .mockReturnValueOnce(chainMock)      // tierConfigs
    } as unknown as ReturnType<typeof getDb>);

    const res = await GET(new NextRequest('http://localhost/api/admin/economics'));
    const data = await res.json();
    
    expect(res.status).toBe(200);
    expect(data.userStats.totalUsers).toBe(10);
    expect(data.costSummary).toBeDefined();
    expect(data.recentTransactions).toBeDefined();
  });
});
