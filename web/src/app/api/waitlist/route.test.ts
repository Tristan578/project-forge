vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/rateLimit', () => ({
  rateLimitPublicRoute: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/db/client', () => ({
  getDb: vi.fn(),
  queryWithResilience: vi.fn((fn: () => unknown) => fn()),
}));

vi.mock('@/lib/monitoring/sentry-server', () => ({
  captureException: vi.fn(),
}));

import { rateLimitPublicRoute } from '@/lib/rateLimit';
import { getDb } from '@/lib/db/client';
import { captureException } from '@/lib/monitoring/sentry-server';
import { waitlistSignups } from '@/lib/db/schema';

const BASE_URL = 'http://localhost:3000/api/waitlist';

function makeReq(body: unknown) {
  return new NextRequest(BASE_URL, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Builds the standard getDb mock for the insert→values→onConflictDoNothing chain. */
function mockInsertChain() {
  const onConflictDoNothing = vi.fn().mockResolvedValue(undefined);
  const values = vi.fn().mockReturnValue({ onConflictDoNothing });
  const insert = vi.fn().mockReturnValue({ values });
  vi.mocked(getDb).mockReturnValue({ insert } as never);
  return { insert, values, onConflictDoNothing };
}

describe('POST /api/waitlist', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(rateLimitPublicRoute).mockResolvedValue(null);
  });

  it('returns 200 and inserts the normalized email for a fresh signup', async () => {
    const { insert, values } = mockInsertChain();
    const { POST } = await import('./route');

    const res = await POST(makeReq({ email: '  User@Example.COM ' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(insert).toHaveBeenCalledWith(waitlistSignups);
    // Server-side normalization: trim + lowercase BEFORE insert, so the plain
    // unique index on email is a sufficient ON CONFLICT arbiter.
    expect(values).toHaveBeenCalledWith({ email: 'user@example.com' });
  });

  it('inserts for the real browser payload — empty-string honeypot is NOT a bot', async () => {
    // SignUpClient always submits { email, website: '' } (the hidden honeypot
    // field serializes as an empty string). This pins the cross-seam contract:
    // an empty-string honeypot must be treated as a legitimate signup, or every
    // real browser submission would be silently dropped with a fake success.
    const { insert, values } = mockInsertChain();
    const { POST } = await import('./route');

    const res = await POST(makeReq({ email: 'user@example.com', website: '' }));

    expect(res.status).toBe(200);
    expect(insert).toHaveBeenCalledTimes(1);
    expect(values).toHaveBeenCalledWith({ email: 'user@example.com' });
  });

  it('inserts when the honeypot is explicitly null (null is the legit carve-out, not a bot)', async () => {
    // The honeypot check deliberately exempts null alongside undefined: a
    // client serializing the untouched field as null is not bot behaviour.
    const { insert } = mockInsertChain();
    const { POST } = await import('./route');

    const res = await POST(makeReq({ email: 'user@example.com', website: null }));

    expect(res.status).toBe(200);
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it('is idempotent via onConflictDoNothing on the named unique index', async () => {
    const { onConflictDoNothing } = mockInsertChain();
    const { POST } = await import('./route');

    const res = await POST(makeReq({ email: 'dup@example.com' }));

    expect(res.status).toBe(200);
    expect(onConflictDoNothing).toHaveBeenCalledWith({
      target: waitlistSignups.email,
    });
  });

  it('returns a duplicate-signup response indistinguishable from a fresh one (no enumeration oracle)', async () => {
    mockInsertChain();
    const { POST } = await import('./route');
    const fresh = await POST(makeReq({ email: 'fresh@example.com' }));
    const freshBody = await fresh.json();

    // Duplicate: PG reports 0 inserted rows; route must not branch on it.
    const onConflictDoNothing = vi.fn().mockResolvedValue([]);
    const values = vi.fn().mockReturnValue({ onConflictDoNothing });
    vi.mocked(getDb).mockReturnValue({ insert: vi.fn().mockReturnValue({ values }) } as never);

    const dup = await POST(makeReq({ email: 'fresh@example.com' }));
    const dupBody = await dup.json();

    expect(dup.status).toBe(fresh.status);
    expect(dupBody).toEqual(freshBody);
  });

  it('awaits rateLimitPublicRoute and returns its 429 when the limit is exceeded', async () => {
    const { insert } = mockInsertChain();
    const limited = new Response(JSON.stringify({ error: 'Rate limit exceeded' }), { status: 429 });
    // Resolved (not returned) value: only an awaited call can surface this 429 —
    // a missing await would hand back a pending Promise, not a Response.
    vi.mocked(rateLimitPublicRoute).mockResolvedValue(limited as never);
    const { POST } = await import('./route');

    const res = await POST(makeReq({ email: 'user@example.com' }));

    expect(rateLimitPublicRoute).toHaveBeenCalledTimes(1);
    // Literal limits pin the abuse budget (repo convention — see the
    // marketplace/assets and community/games route suites): a silent bump of
    // WAITLIST_RATE_LIMIT_MAX or the window must fail this test.
    expect(rateLimitPublicRoute).toHaveBeenCalledWith(
      expect.anything(),
      'waitlist',
      10,
      60_000
    );
    expect(res.status).toBe(429);
    expect(insert).not.toHaveBeenCalled();
  });

  it('returns the standard success response WITHOUT inserting when the honeypot is filled', async () => {
    const { insert } = mockInsertChain();
    const { POST } = await import('./route');
    const realRes = await POST(makeReq({ email: 'real@example.com' }));
    const realBody = await realRes.json();
    expect(insert).toHaveBeenCalledTimes(1);

    insert.mockClear();
    const botRes = await POST(makeReq({ email: 'bot@example.com', website: 'https://spam.example' }));
    const botBody = await botRes.json();

    expect(botRes.status).toBe(realRes.status);
    expect(botBody).toEqual(realBody);
    expect(insert).not.toHaveBeenCalled();
  });

  it('treats a non-string honeypot value as a bot', async () => {
    const { insert } = mockInsertChain();
    const { POST } = await import('./route');

    const res = await POST(makeReq({ email: 'bot@example.com', website: 42 }));

    expect(res.status).toBe(200);
    expect(insert).not.toHaveBeenCalled();
  });

  it('accepts an email at exactly the RFC 5321 max length (254 chars)', async () => {
    // Boundary pin: 242 + '@example.com' (12) = 254. The cap is `> 254`,
    // not `>= 254` — an off-by-one here silently rejects valid maximal
    // addresses, and only an accept case at the exact boundary catches it.
    const email = `${'a'.repeat(242)}@example.com`;
    expect(email).toHaveLength(254);
    const { insert } = mockInsertChain();
    const { POST } = await import('./route');

    const res = await POST(makeReq({ email }));

    expect(res.status).toBe(200);
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it('rejects an email one char over the RFC 5321 max length (255 chars)', async () => {
    const email = `${'a'.repeat(243)}@example.com`;
    expect(email).toHaveLength(255);
    const { insert } = mockInsertChain();
    const { POST } = await import('./route');

    const res = await POST(makeReq({ email }));

    expect(res.status).toBe(400);
    expect(insert).not.toHaveBeenCalled();
  });

  it.each([
    ['missing email', {}],
    ['non-string email', { email: 42 }],
    ['empty email', { email: '   ' }],
    ['no @', { email: 'not-an-email' }],
    ['no TLD', { email: 'user@localhost' }],
    ['embedded whitespace', { email: 'us er@example.com' }],
    ['over 254 chars', { email: `${'a'.repeat(250)}@example.com` }],
  ])('returns 400 for %s', async (_label, body) => {
    const { insert } = mockInsertChain();
    const { POST } = await import('./route');

    const res = await POST(makeReq(body));

    expect(res.status).toBe(400);
    expect(insert).not.toHaveBeenCalled();
  });

  it('returns 400 for malformed JSON', async () => {
    const { insert } = mockInsertChain();
    const { POST } = await import('./route');
    const req = new NextRequest(BASE_URL, {
      method: 'POST',
      body: 'not-json{{{',
      headers: { 'Content-Type': 'application/json' },
    });

    const res = await POST(req);

    expect(res.status).toBe(400);
    expect(insert).not.toHaveBeenCalled();
  });

  it.each([
    ['array body', ['user@example.com']],
    ['string body', 'user@example.com'],
    ['null body', null],
  ])('returns 400 for non-object JSON (%s)', async (_label, body) => {
    const { insert } = mockInsertChain();
    const { POST } = await import('./route');

    const res = await POST(makeReq(body));

    expect(res.status).toBe(400);
    expect(insert).not.toHaveBeenCalled();
  });

  it('returns 500 and reports to Sentry when the insert fails', async () => {
    const onConflictDoNothing = vi.fn().mockRejectedValue(new Error('connection refused'));
    const values = vi.fn().mockReturnValue({ onConflictDoNothing });
    vi.mocked(getDb).mockReturnValue({ insert: vi.fn().mockReturnValue({ values }) } as never);
    const { POST } = await import('./route');

    const res = await POST(makeReq({ email: 'user@example.com' }));

    expect(res.status).toBe(500);
    expect(captureException).toHaveBeenCalledTimes(1);
    // The client body is generic — the raw driver error ('connection refused')
    // must never leak to the caller as an internal-detail oracle.
    const body = await res.json();
    expect(body.error).toMatch(/something went wrong/i);
    expect(body.error).not.toMatch(/connection refused/i);
    // Sentry receives the real Error plus route/method tags for triage.
    expect(captureException).toHaveBeenCalledWith(expect.any(Error), {
      route: '/api/waitlist',
      method: 'POST',
    });
  });
});
