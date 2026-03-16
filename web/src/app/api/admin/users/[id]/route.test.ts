vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET, PATCH } from './route';
import { authenticateRequest, assertAdmin } from '@/lib/auth/api-auth';
import { getDb } from '@/lib/db/client';
import { makeUser, mockNextResponse } from '@/test/utils/apiTestUtils';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth/api-auth');
vi.mock('@/lib/db/client');

const PARAMS = { params: Promise.resolve({ id: 'user-uuid-1' }) };

function makeReq(url = 'http://localhost/api/admin/users/user-uuid-1', method = 'GET', body?: unknown): NextRequest {
  if (body !== undefined) {
    return new NextRequest(url, {
      method,
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    });
  }
  return new NextRequest(url, { method });
}

describe('GET /api/admin/users/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 if unauthenticated', async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({
      ok: false,
      response: mockNextResponse({ error: 'Unauthorized' }, { status: 401 }),
    });

    const res = await GET(makeReq(), PARAMS);
    expect(res.status).toBe(401);
  });

  it('returns 403 if not admin', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: 'user_123', user } });
    vi.mocked(assertAdmin).mockReturnValue(mockNextResponse({ error: 'Forbidden' }, { status: 403 }));

    const res = await GET(makeReq(), PARAMS);
    expect(res.status).toBe(403);
  });

  it('returns 404 if user not found', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: 'admin_123', user } });
    vi.mocked(assertAdmin).mockReturnValue(null);

    const chain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([]),
    };
    vi.mocked(getDb).mockReturnValue({ select: vi.fn().mockReturnValue(chain) } as unknown as ReturnType<typeof getDb>);

    const res = await GET(makeReq(), PARAMS);
    expect(res.status).toBe(404);
  });

  it('returns user details for admins', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: 'admin_123', user } });
    vi.mocked(assertAdmin).mockReturnValue(null);

    const dbUser = makeUser({ id: 'user-uuid-1', email: 'alice@example.com' });
    const chain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([dbUser]),
    };
    vi.mocked(getDb).mockReturnValue({ select: vi.fn().mockReturnValue(chain) } as unknown as ReturnType<typeof getDb>);

    const res = await GET(makeReq(), PARAMS);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.user.email).toBe('alice@example.com');
  });
});

describe('PATCH /api/admin/users/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 if unauthenticated', async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({
      ok: false,
      response: mockNextResponse({ error: 'Unauthorized' }, { status: 401 }),
    });

    const res = await PATCH(makeReq('http://localhost/api/admin/users/user-uuid-1', 'PATCH', { tier: 'pro' }), PARAMS);
    expect(res.status).toBe(401);
  });

  it('returns 403 if not admin', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: 'user_123', user } });
    vi.mocked(assertAdmin).mockReturnValue(mockNextResponse({ error: 'Forbidden' }, { status: 403 }));

    const res = await PATCH(makeReq('http://localhost/api/admin/users/user-uuid-1', 'PATCH', { tier: 'pro' }), PARAMS);
    expect(res.status).toBe(403);
  });

  it('returns 400 for invalid tier', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: 'admin_123', user } });
    vi.mocked(assertAdmin).mockReturnValue(null);

    const res = await PATCH(makeReq('http://localhost/api/admin/users/user-uuid-1', 'PATCH', { tier: 'enterprise' }), PARAMS);
    expect(res.status).toBe(400);
  });

  it('returns 400 if no valid fields provided', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: 'admin_123', user } });
    vi.mocked(assertAdmin).mockReturnValue(null);

    const res = await PATCH(makeReq('http://localhost/api/admin/users/user-uuid-1', 'PATCH', { foo: 'bar' }), PARAMS);
    expect(res.status).toBe(400);
  });

  it('returns 404 if user not found', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: 'admin_123', user } });
    vi.mocked(assertAdmin).mockReturnValue(null);

    const updateChain = {
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([]),
    };
    vi.mocked(getDb).mockReturnValue({ update: vi.fn().mockReturnValue(updateChain) } as unknown as ReturnType<typeof getDb>);

    const res = await PATCH(makeReq('http://localhost/api/admin/users/user-uuid-1', 'PATCH', { tier: 'pro' }), PARAMS);
    expect(res.status).toBe(404);
  });

  it('updates user tier successfully', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: 'admin_123', user } });
    vi.mocked(assertAdmin).mockReturnValue(null);

    const updatedUser = makeUser({ tier: 'pro' });
    const updateChain = {
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([updatedUser]),
    };
    vi.mocked(getDb).mockReturnValue({ update: vi.fn().mockReturnValue(updateChain) } as unknown as ReturnType<typeof getDb>);

    const res = await PATCH(makeReq('http://localhost/api/admin/users/user-uuid-1', 'PATCH', { tier: 'pro' }), PARAMS);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.user.tier).toBe('pro');
  });

  it('bans a user successfully', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: 'admin_123', user } });
    vi.mocked(assertAdmin).mockReturnValue(null);

    const updatedUser = { ...makeUser(), banned: 1 };
    const updateChain = {
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([updatedUser]),
    };
    vi.mocked(getDb).mockReturnValue({ update: vi.fn().mockReturnValue(updateChain) } as unknown as ReturnType<typeof getDb>);

    const res = await PATCH(makeReq('http://localhost/api/admin/users/user-uuid-1', 'PATCH', { banned: true }), PARAMS);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.user.banned).toBe(1);
  });

  it('unbans a user successfully', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: 'admin_123', user } });
    vi.mocked(assertAdmin).mockReturnValue(null);

    const updatedUser = { ...makeUser(), banned: 0 };
    const updateChain = {
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([updatedUser]),
    };
    vi.mocked(getDb).mockReturnValue({ update: vi.fn().mockReturnValue(updateChain) } as unknown as ReturnType<typeof getDb>);

    const res = await PATCH(makeReq('http://localhost/api/admin/users/user-uuid-1', 'PATCH', { banned: false }), PARAMS);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.user.banned).toBe(0);
  });

  it('returns 400 for invalid JSON body', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: 'admin_123', user } });
    vi.mocked(assertAdmin).mockReturnValue(null);

    const req = new NextRequest('http://localhost/api/admin/users/user-uuid-1', {
      method: 'PATCH',
      body: 'not-json',
      headers: { 'content-type': 'application/json' },
    });
    const res = await PATCH(req, PARAMS);
    expect(res.status).toBe(400);
  });
});
