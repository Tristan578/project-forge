vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET, PATCH } from './route';
import { authenticateRequest, assertAdmin } from '@/lib/auth/api-auth';
import { getDb } from '@/lib/db/client';
import { applyAdminTierChange } from '@/lib/billing/admin-tier-grant';
import { makeUser, mockNextResponse } from '@/test/utils/apiTestUtils';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth/api-auth');
vi.mock('@/lib/db/client');
vi.mock('@/lib/billing/admin-tier-grant');

/** getDb mock whose select().from().where() resolves each call in sequence. */
function mockSelectSequence(...resultsPerCall: unknown[][]) {
  const where = vi.fn();
  for (const rows of resultsPerCall) where.mockResolvedValueOnce(rows);
  const selectChain = { from: vi.fn().mockReturnThis(), where };
  return { select: vi.fn().mockReturnValue(selectChain) };
}

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

  it('returns 422 for invalid tier', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: 'admin_123', user } });
    vi.mocked(assertAdmin).mockReturnValue(null);

    const res = await PATCH(makeReq('http://localhost/api/admin/users/user-uuid-1', 'PATCH', { tier: 'enterprise' }), PARAMS);
    const data422a = await res.json();
    expect(res.status).toBe(422);
    expect(data422a.error).toBe('Validation failed');
    expect(JSON.stringify(data422a.details)).toContain('tier');
  });

  it('returns 422 if no valid fields provided', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: 'admin_123', user } });
    vi.mocked(assertAdmin).mockReturnValue(null);

    const res = await PATCH(makeReq('http://localhost/api/admin/users/user-uuid-1', 'PATCH', { foo: 'bar' }), PARAMS);
    const data422b = await res.json();
    expect(res.status).toBe(422);
    expect(data422b.error).toBe('Validation failed');
    expect(data422b.details).toBeDefined();
  });

  it('returns 404 if user not found', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: 'admin_123', user } });
    vi.mocked(assertAdmin).mockReturnValue(null);

    // Read-first: the missing row surfaces on the initial select, before any
    // grant or update is attempted.
    vi.mocked(getDb).mockReturnValue(
      mockSelectSequence([]) as unknown as ReturnType<typeof getDb>,
    );

    const res = await PATCH(makeReq('http://localhost/api/admin/users/user-uuid-1', 'PATCH', { tier: 'pro' }), PARAMS);
    expect(res.status).toBe(404);
    expect(applyAdminTierChange).not.toHaveBeenCalled();
  });

  it('grants the new tier allocation when the tier actually changes', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: 'admin_123', user } });
    vi.mocked(assertAdmin).mockReturnValue(null);
    vi.mocked(applyAdminTierChange).mockResolvedValue(undefined);

    // First select = current row (starter); second select = post-grant re-read.
    vi.mocked(getDb).mockReturnValue(
      mockSelectSequence(
        [makeUser({ tier: 'starter' })],
        [makeUser({ tier: 'pro', monthlyTokens: 3000 })],
      ) as unknown as ReturnType<typeof getDb>,
    );

    const res = await PATCH(makeReq('http://localhost/api/admin/users/user-uuid-1', 'PATCH', { tier: 'pro' }), PARAMS);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.user.tier).toBe('pro');
    expect(data.user.monthlyTokens).toBe(3000);
    // The grant ran with the previous tier + the acting admin's clerk id.
    expect(applyAdminTierChange).toHaveBeenCalledWith('user-uuid-1', 'pro', {
      previousTier: 'starter',
      grantedByClerkId: 'admin_123',
      banned: undefined,
    });
  });

  it('folds a ban into the grant when tier and banned change together', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: 'admin_123', user } });
    vi.mocked(assertAdmin).mockReturnValue(null);
    vi.mocked(applyAdminTierChange).mockResolvedValue(undefined);

    vi.mocked(getDb).mockReturnValue(
      mockSelectSequence(
        [makeUser({ tier: 'starter' })],
        [makeUser({ tier: 'creator' })],
      ) as unknown as ReturnType<typeof getDb>,
    );

    const res = await PATCH(
      makeReq('http://localhost/api/admin/users/user-uuid-1', 'PATCH', { tier: 'creator', banned: true }),
      PARAMS,
    );
    expect(res.status).toBe(200);
    expect(applyAdminTierChange).toHaveBeenCalledWith('user-uuid-1', 'creator', {
      previousTier: 'starter',
      grantedByClerkId: 'admin_123',
      banned: true,
    });
  });

  it('does NOT grant tokens when the tier is unchanged (same-tier PATCH)', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: 'admin_123', user } });
    vi.mocked(assertAdmin).mockReturnValue(null);

    const selectMock = mockSelectSequence([makeUser({ tier: 'starter' })]);
    const updateChain = {
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([makeUser({ tier: 'starter' })]),
    };
    vi.mocked(getDb).mockReturnValue({
      ...selectMock,
      update: vi.fn().mockReturnValue(updateChain),
    } as unknown as ReturnType<typeof getDb>);

    const res = await PATCH(makeReq('http://localhost/api/admin/users/user-uuid-1', 'PATCH', { tier: 'starter' }), PARAMS);
    expect(res.status).toBe(200);
    expect(applyAdminTierChange).not.toHaveBeenCalled();
  });

  it('bans a user successfully (plain update, no token grant)', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: 'admin_123', user } });
    vi.mocked(assertAdmin).mockReturnValue(null);

    const selectMock = mockSelectSequence([makeUser()]);
    const updateChain = {
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([{ ...makeUser(), banned: 1 }]),
    };
    vi.mocked(getDb).mockReturnValue({
      ...selectMock,
      update: vi.fn().mockReturnValue(updateChain),
    } as unknown as ReturnType<typeof getDb>);

    const res = await PATCH(makeReq('http://localhost/api/admin/users/user-uuid-1', 'PATCH', { banned: true }), PARAMS);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.user.banned).toBe(1);
    expect(applyAdminTierChange).not.toHaveBeenCalled();
  });

  it('unbans a user successfully (plain update, no token grant)', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: 'admin_123', user } });
    vi.mocked(assertAdmin).mockReturnValue(null);

    const selectMock = mockSelectSequence([{ ...makeUser(), banned: 1 }]);
    const updateChain = {
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([{ ...makeUser(), banned: 0 }]),
    };
    vi.mocked(getDb).mockReturnValue({
      ...selectMock,
      update: vi.fn().mockReturnValue(updateChain),
    } as unknown as ReturnType<typeof getDb>);

    const res = await PATCH(makeReq('http://localhost/api/admin/users/user-uuid-1', 'PATCH', { banned: false }), PARAMS);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.user.banned).toBe(0);
    expect(applyAdminTierChange).not.toHaveBeenCalled();
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
