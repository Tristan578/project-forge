vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET, PATCH } from './route';
import { authenticateRequest, assertAdmin } from '@/lib/auth/api-auth';
import { getDb } from '@/lib/db/client';
import { rateLimitAdminRoute } from '@/lib/rateLimit';
import { applyAdminTierChange } from '@/lib/billing/admin-tier-grant';
import { makeUser, mockNextResponse } from '@/test/utils/apiTestUtils';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth/api-auth');
vi.mock('@/lib/db/client');
vi.mock('@/lib/billing/admin-tier-grant');
vi.mock('@/lib/monitoring/sentry-server', () => ({ captureException: vi.fn() }));
// The admin route calls rateLimitAdminRoute directly (not via the middleware).
// Mock it so every test starts from "allowed" (null) — otherwise the REAL
// in-memory limiter accumulates across the sequentially-run cases that share one
// userId and the 11th request returns 429 where the test expects another status.
// Individual tests override with mockResolvedValueOnce to exercise the 429 path.
vi.mock('@/lib/rateLimit', () => ({ rateLimitAdminRoute: vi.fn().mockResolvedValue(null) }));

/** getDb mock whose select().from().where() resolves each call in sequence. */
function mockSelectSequence(...resultsPerCall: unknown[][]) {
  const where = vi.fn();
  for (const rows of resultsPerCall) where.mockResolvedValueOnce(rows);
  const selectChain = { from: vi.fn().mockReturnThis(), where };
  return { select: vi.fn().mockReturnValue(selectChain) };
}

// `users.id` is a uuid column, so route params + assertions use a real UUID —
// the route's UUID_RE guard rejects anything else with a 404 before any DB read.
const USER_ID = '11111111-1111-4111-8111-111111111111';
const PARAMS = { params: Promise.resolve({ id: USER_ID }) };

function makeReq(url = `http://localhost/api/admin/users/${USER_ID}`, method = 'GET', body?: unknown): NextRequest {
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
    expect(applyAdminTierChange).toHaveBeenCalledWith(USER_ID, 'pro', {
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
    expect(applyAdminTierChange).toHaveBeenCalledWith(USER_ID, 'creator', {
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

  it('returns 404 when the row vanishes between read and plain update (TOCTOU)', async () => {
    // The banned-only / same-tier path reads the row, then UPDATEs. If the row is
    // hard-deleted between those two statements, `.returning()` is empty and the
    // route must 404 (not 200 with { user: undefined }) — the no-grant analogue of
    // the post-grant re-read guard.
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: 'admin_123', user } });
    vi.mocked(assertAdmin).mockReturnValue(null);

    const selectMock = mockSelectSequence([makeUser({ tier: 'starter' })]);
    const updateChain = {
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([]), // row gone between read and write
    };
    vi.mocked(getDb).mockReturnValue({
      ...selectMock,
      update: vi.fn().mockReturnValue(updateChain),
    } as unknown as ReturnType<typeof getDb>);

    const res = await PATCH(makeReq('http://localhost/api/admin/users/user-uuid-1', 'PATCH', { banned: true }), PARAMS);
    expect(res.status).toBe(404);
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

    const req = new NextRequest(`http://localhost/api/admin/users/${USER_ID}`, {
      method: 'PATCH',
      body: 'not-json',
      headers: { 'content-type': 'application/json' },
    });
    const res = await PATCH(req, PARAMS);
    expect(res.status).toBe(400);
  });

  it('returns 429 when the admin rate limit is exceeded (no grant attempted)', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: 'admin_123', user } });
    vi.mocked(assertAdmin).mockReturnValue(null);
    vi.mocked(rateLimitAdminRoute).mockResolvedValueOnce(
      mockNextResponse({ error: 'Too many requests' }, { status: 429 }),
    );

    const res = await PATCH(makeReq(`http://localhost/api/admin/users/${USER_ID}`, 'PATCH', { tier: 'pro' }), PARAMS);
    expect(res.status).toBe(429);
    expect(applyAdminTierChange).not.toHaveBeenCalled();
  });

  it('returns 404 when the [id] param is not a valid UUID (before any DB read)', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: 'admin_123', user } });
    vi.mocked(assertAdmin).mockReturnValue(null);

    const res = await PATCH(
      makeReq('http://localhost/api/admin/users/not-a-uuid', 'PATCH', { tier: 'pro' }),
      { params: Promise.resolve({ id: 'not-a-uuid' }) },
    );
    expect(res.status).toBe(404);
    expect(applyAdminTierChange).not.toHaveBeenCalled();
    expect(getDb).not.toHaveBeenCalled();
  });

  it('returns 403 when an admin targets their own account (self-comp blocked)', async () => {
    // The acting admin's own users.id equals the target [id] → self-modification.
    const user = makeUser({ id: USER_ID });
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: 'admin_123', user } });
    vi.mocked(assertAdmin).mockReturnValue(null);

    const res = await PATCH(makeReq(`http://localhost/api/admin/users/${USER_ID}`, 'PATCH', { tier: 'pro' }), PARAMS);
    const data = await res.json();

    expect(res.status).toBe(403);
    expect(data.code).toBe('SELF_MODIFICATION_FORBIDDEN');
    expect(applyAdminTierChange).not.toHaveBeenCalled();
    expect(getDb).not.toHaveBeenCalled();
  });

  it('returns 500 when applyAdminTierChange throws (error is captured)', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: 'admin_123', user } });
    vi.mocked(assertAdmin).mockReturnValue(null);
    vi.mocked(applyAdminTierChange).mockRejectedValueOnce(new Error('db error'));

    // current row found → tier changes → grant invoked → rejects → catch → 500.
    vi.mocked(getDb).mockReturnValue(
      mockSelectSequence([makeUser({ tier: 'starter' })]) as unknown as ReturnType<typeof getDb>,
    );

    const res = await PATCH(makeReq(`http://localhost/api/admin/users/${USER_ID}`, 'PATCH', { tier: 'pro' }), PARAMS);
    expect(res.status).toBe(500);
  });

  it('returns 500 when the post-grant re-read finds no row', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: 'admin_123', user } });
    vi.mocked(assertAdmin).mockReturnValue(null);
    vi.mocked(applyAdminTierChange).mockResolvedValue(undefined);

    // First select = current row (grant proceeds); second select (re-read) = [].
    vi.mocked(getDb).mockReturnValue(
      mockSelectSequence([makeUser({ tier: 'starter' })], []) as unknown as ReturnType<typeof getDb>,
    );

    const res = await PATCH(makeReq(`http://localhost/api/admin/users/${USER_ID}`, 'PATCH', { tier: 'pro' }), PARAMS);
    expect(res.status).toBe(500);
    expect(applyAdminTierChange).toHaveBeenCalled();
  });
});
