vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from './route';
import { authenticateRequest, assertAdmin } from '@/lib/auth/api-auth';
import { getDb } from '@/lib/db/client';
import { makeUser, mockNextResponse } from '@/test/utils/apiTestUtils';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth/api-auth');
vi.mock('@/lib/db/client');

function makeReq(url = 'http://localhost/api/admin/users'): NextRequest {
  return new NextRequest(url);
}

function makeChain(result: unknown[] = []) {
  return {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    offset: vi.fn().mockResolvedValue(result),
    select: vi.fn().mockReturnThis(),
  };
}

describe('GET /api/admin/users', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 if unauthenticated', async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({
      ok: false,
      response: mockNextResponse({ error: 'Unauthorized' }, { status: 401 }),
    });

    const res = await GET(makeReq());
    expect(res.status).toBe(401);
  });

  it('returns 403 if not admin', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: 'user_123', user } });
    vi.mocked(assertAdmin).mockReturnValue(mockNextResponse({ error: 'Forbidden' }, { status: 403 }));

    const res = await GET(makeReq());
    expect(res.status).toBe(403);
  });

  it('returns paginated user list for admins', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: 'admin_123', user } });
    vi.mocked(assertAdmin).mockReturnValue(null);

    const fakeUsers = [
      { id: 'u1', email: 'alice@example.com', clerkId: 'clerk_a', displayName: 'Alice', tier: 'pro', monthlyTokens: 1000, monthlyTokensUsed: 200, addonTokens: 0, banned: 0, createdAt: new Date() },
      { id: 'u2', email: 'bob@example.com', clerkId: 'clerk_b', displayName: 'Bob', tier: 'starter', monthlyTokens: 50, monthlyTokensUsed: 10, addonTokens: 0, banned: 0, createdAt: new Date() },
    ];

    const chain = makeChain(fakeUsers);
    vi.mocked(getDb).mockReturnValue({ select: vi.fn().mockReturnValue(chain) } as unknown as ReturnType<typeof getDb>);

    const res = await GET(makeReq());
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.users).toHaveLength(2);
    expect(data.users[0].email).toBe('alice@example.com');
    expect(data.limit).toBe(50);
    expect(data.offset).toBe(0);
  });

  it('passes limit and offset query params', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: 'admin_123', user } });
    vi.mocked(assertAdmin).mockReturnValue(null);

    const chain = makeChain([]);
    vi.mocked(getDb).mockReturnValue({ select: vi.fn().mockReturnValue(chain) } as unknown as ReturnType<typeof getDb>);

    const res = await GET(makeReq('http://localhost/api/admin/users?limit=10&offset=20'));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.limit).toBe(10);
    expect(data.offset).toBe(20);
  });

  it('caps limit at 200', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: 'admin_123', user } });
    vi.mocked(assertAdmin).mockReturnValue(null);

    const chain = makeChain([]);
    vi.mocked(getDb).mockReturnValue({ select: vi.fn().mockReturnValue(chain) } as unknown as ReturnType<typeof getDb>);

    const res = await GET(makeReq('http://localhost/api/admin/users?limit=9999'));
    const data = await res.json();

    expect(data.limit).toBe(200);
  });

  it('filters by search query', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: 'admin_123', user } });
    vi.mocked(assertAdmin).mockReturnValue(null);

    const fakeUsers = [{ id: 'u1', email: 'alice@example.com', clerkId: 'clerk_a', displayName: 'Alice', tier: 'starter', monthlyTokens: 50, monthlyTokensUsed: 0, addonTokens: 0, banned: 0, createdAt: new Date() }];
    const chain = makeChain(fakeUsers);
    vi.mocked(getDb).mockReturnValue({ select: vi.fn().mockReturnValue(chain) } as unknown as ReturnType<typeof getDb>);

    const res = await GET(makeReq('http://localhost/api/admin/users?search=alice'));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.users).toHaveLength(1);
  });
});
