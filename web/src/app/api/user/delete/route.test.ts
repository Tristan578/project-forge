vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './route';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { deleteUserAccount } from '@/lib/auth/user-service';
import { clerkClient } from '@clerk/nextjs/server';
import { captureException } from '@/lib/monitoring/sentry-server';
import { makeUser, mockNextResponse } from '@/test/utils/apiTestUtils';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth/api-auth');
vi.mock('@/lib/auth/user-service');
vi.mock('@clerk/nextjs/server', () => ({ clerkClient: vi.fn() }));
vi.mock('@/lib/monitoring/sentry-server', () => ({ captureException: vi.fn() }));
// Always allow through the rate limiter so account-delete tests don't share a
// per-user bucket across cases.
vi.mock('@/lib/rateLimit/distributed', () => ({
  distributedRateLimit: vi.fn().mockResolvedValue({ allowed: true, remaining: 5, resetAt: 0 }),
  aggregateGenerationRateLimit: vi.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mockClerk(deleteUser: ReturnType<typeof vi.fn>): any {
  return { users: { deleteUser } };
}

describe('POST /api/user/delete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: a working Clerk client so the happy path doesn't hit the error branch.
    vi.mocked(clerkClient).mockResolvedValue(mockClerk(vi.fn()));
  });

  it('returns 401 if unauthenticated', async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({
      ok: false,
      response: mockNextResponse({ error: 'Unauthorized' }, { status: 401 }),
    });

    const res = await POST(new NextRequest('http://localhost/api/user/delete'));
    expect(res.status).toBe(401);
  });

  it('deletes user account successfully', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: '123', user } });
    vi.mocked(deleteUserAccount).mockResolvedValue(undefined);

    const res = await POST(new NextRequest('http://localhost/api/user/delete'));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.deleted).toBe(true);
    expect(deleteUserAccount).toHaveBeenCalledWith(user.id);
  });

  it('returns 500 if DB deletion fails', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: '123', user } });
    vi.mocked(deleteUserAccount).mockRejectedValue(new Error('DB connection failed'));

    const res = await POST(new NextRequest('http://localhost/api/user/delete'));
    const data = await res.json();

    expect(res.status).toBe(500);
    expect(data.error).toBe('Failed to delete account');
    expect(captureException).toHaveBeenCalled();
  });

  it('does not delete the Clerk identity when the DB purge fails (#8606)', async () => {
    // If the DB delete throws, we must NOT delete the Clerk user — otherwise the
    // user is locked out of an account whose data still exists.
    const user = makeUser({ id: 'u-del-guard' });
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: 'clerk-guard', user } });
    vi.mocked(deleteUserAccount).mockRejectedValue(new Error('DB connection failed'));
    const deleteUser = vi.fn();
    vi.mocked(clerkClient).mockResolvedValue(mockClerk(deleteUser));

    const res = await POST(new NextRequest('http://localhost/api/user/delete'));
    expect(res.status).toBe(500);
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it('deletes the orphaned Clerk identity AFTER purging the DB account (#8606)', async () => {
    // The DB purge alone leaves the Clerk session/user intact; the next
    // authenticated request re-syncs a fresh empty DB user from Clerk, silently
    // resurrecting the "deleted" account. The route must delete the Clerk user
    // too — and only after the DB data is gone.
    const user = makeUser({ id: 'u-del-1' });
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: 'clerk-del-1', user } });

    const order: string[] = [];
    vi.mocked(deleteUserAccount).mockImplementation(async () => { order.push('db'); });
    const deleteUser = vi.fn().mockImplementation(async () => { order.push('clerk'); });
    vi.mocked(clerkClient).mockResolvedValue(mockClerk(deleteUser));

    const res = await POST(new NextRequest('http://localhost/api/user/delete'));

    expect(res.status).toBe(200);
    expect(deleteUserAccount).toHaveBeenCalledWith('u-del-1');
    expect(deleteUser).toHaveBeenCalledWith('clerk-del-1');
    expect(order).toEqual(['db', 'clerk']);
  });

  it('still returns 200 and captures to Sentry when Clerk deletion fails after the DB purge (#8606)', async () => {
    const user = makeUser({ id: 'u-del-2' });
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: 'clerk-del-2', user } });
    vi.mocked(deleteUserAccount).mockResolvedValue(undefined);
    const deleteUser = vi.fn().mockRejectedValue(new Error('Clerk API 503'));
    vi.mocked(clerkClient).mockResolvedValue(mockClerk(deleteUser));

    const res = await POST(new NextRequest('http://localhost/api/user/delete'));
    const data = await res.json();

    // The destructive DB delete already committed — a Clerk-side failure must not
    // surface as a 500 (which would imply nothing was deleted). Report success
    // and alert Sentry so the orphaned Clerk identity can be cleaned up manually.
    expect(res.status).toBe(200);
    expect(data.deleted).toBe(true);
    expect(captureException).toHaveBeenCalled();
  });
});
