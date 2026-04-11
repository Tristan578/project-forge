import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NextResponse } from 'next/server';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockAuth = vi.fn();
const mockClerkClient = vi.fn();
const mockGetUserByClerkId = vi.fn();
const mockSyncUserFromClerk = vi.fn();

vi.mock('@clerk/nextjs/server', () => ({
  auth: () => mockAuth(),
  clerkClient: () => mockClerkClient(),
}));

vi.mock('@/lib/auth/user-service', () => ({
  getUserByClerkId: (...args: unknown[]) => mockGetUserByClerkId(...args),
  syncUserFromClerk: (...args: unknown[]) => mockSyncUserFromClerk(...args),
}));

// ---------------------------------------------------------------------------
// Import module under test AFTER mocks
// ---------------------------------------------------------------------------
import { authenticateRequest, authenticateClerkSession, assertAdmin, assertTier } from '../api-auth';
import type { User } from '@/lib/db/schema';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-uuid-1',
    clerkId: 'clerk_abc',
    email: 'test@example.com',
    displayName: 'Test User',
    tier: 'creator',
    monthlyTokens: 1000,
    monthlyTokensUsed: 0,
    addonTokens: 0,
    earnedCredits: 0,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    billingCycleStart: null,
    banned: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as User;
}

function setClerkConfigured(configured: boolean) {
  if (configured) {
    process.env.CLERK_SECRET_KEY = 'sk_test_abc';
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = 'pk_test_abc';
  } else {
    delete process.env.CLERK_SECRET_KEY;
    delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  setClerkConfigured(true);
});

// ---------------------------------------------------------------------------
// authenticateRequest — happy path
// ---------------------------------------------------------------------------

describe('authenticateRequest', () => {
  it('returns user when found in DB', async () => {
    const user = makeUser();
    mockAuth.mockResolvedValue({ userId: 'clerk_abc' });
    mockGetUserByClerkId.mockResolvedValue(user);

    const result = await authenticateRequest();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.ctx.user.id).toBe('user-uuid-1');
      expect(result.ctx.clerkId).toBe('clerk_abc');
    }
  });

  it('returns 401 when Clerk is not configured', async () => {
    setClerkConfigured(false);

    const result = await authenticateRequest();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(401);
    }
  });

  it('returns 401 when no Clerk session', async () => {
    mockAuth.mockResolvedValue({ userId: null });

    const result = await authenticateRequest();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(401);
    }
  });

  // -----------------------------------------------------------------------
  // PF-474: Retry on sync failure
  // -----------------------------------------------------------------------

  it('syncs user from Clerk when not in DB', async () => {
    const syncedUser = makeUser();
    mockAuth.mockResolvedValue({ userId: 'clerk_abc' });
    mockGetUserByClerkId.mockResolvedValue(null);
    mockClerkClient.mockResolvedValue({
      users: {
        getUser: vi.fn().mockResolvedValue({
          emailAddresses: [{ emailAddress: 'test@example.com' }],
          firstName: 'Test',
          lastName: 'User',
        }),
      },
    });
    mockSyncUserFromClerk.mockResolvedValue(syncedUser);

    const result = await authenticateRequest();
    expect(result.ok).toBe(true);
    expect(mockSyncUserFromClerk).toHaveBeenCalledOnce();
  });

  it('retries sync once on transient failure then succeeds', async () => {
    const syncedUser = makeUser();
    mockAuth.mockResolvedValue({ userId: 'clerk_abc' });
    mockGetUserByClerkId.mockResolvedValue(null);

    const mockGetUser = vi.fn()
      .mockRejectedValueOnce(new Error('transient network error'))
      .mockResolvedValueOnce({
        emailAddresses: [{ emailAddress: 'test@example.com' }],
        firstName: 'Test',
        lastName: 'User',
      });
    mockClerkClient.mockResolvedValue({ users: { getUser: mockGetUser } });
    mockSyncUserFromClerk.mockResolvedValue(syncedUser);

    const result = await authenticateRequest();
    expect(result.ok).toBe(true);
    // Clerk getUser was called twice: once failed, once succeeded
    expect(mockGetUser).toHaveBeenCalledTimes(2);
  });

  it('returns 503 after both sync attempts fail (degraded mode denial)', async () => {
    mockAuth.mockResolvedValue({ userId: 'clerk_abc' });
    mockGetUserByClerkId.mockResolvedValue(null);

    const mockGetUser = vi.fn().mockRejectedValue(new Error('persistent failure'));
    mockClerkClient.mockResolvedValue({ users: { getUser: mockGetUser } });

    const result = await authenticateRequest();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(503);
      const body = await result.response.json();
      expect(body.error).toBe('SERVICE_DEGRADED');
    }
    // Called twice: initial + 1 retry
    expect(mockGetUser).toHaveBeenCalledTimes(2);
  });

  it('returns 503 when syncUserFromClerk itself fails on both attempts', async () => {
    mockAuth.mockResolvedValue({ userId: 'clerk_abc' });
    mockGetUserByClerkId.mockResolvedValue(null);

    mockClerkClient.mockResolvedValue({
      users: {
        getUser: vi.fn().mockResolvedValue({
          emailAddresses: [{ emailAddress: 'test@example.com' }],
          firstName: 'Test',
          lastName: 'User',
        }),
      },
    });
    mockSyncUserFromClerk.mockRejectedValue(new Error('DB write failed'));

    const result = await authenticateRequest();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(503);
    }
  });
});

// ---------------------------------------------------------------------------
// authenticateClerkSession
// ---------------------------------------------------------------------------

describe('authenticateClerkSession', () => {
  it('returns clerkId on valid session', async () => {
    mockAuth.mockResolvedValue({ userId: 'clerk_abc' });

    const result = await authenticateClerkSession();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.clerkId).toBe('clerk_abc');
    }
  });

  it('returns 401 when Clerk is not configured', async () => {
    setClerkConfigured(false);

    const result = await authenticateClerkSession();
    expect(result.ok).toBe(false);
  });

  it('returns 401 when no session', async () => {
    mockAuth.mockResolvedValue({ userId: null });

    const result = await authenticateClerkSession();
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// assertAdmin
// ---------------------------------------------------------------------------

describe('assertAdmin', () => {
  it('returns null for admin user', () => {
    process.env.ADMIN_USER_IDS = 'clerk_abc,clerk_def';
    expect(assertAdmin('clerk_abc')).toBeNull();
  });

  it('returns 403 for non-admin', () => {
    process.env.ADMIN_USER_IDS = 'clerk_abc';
    const response = assertAdmin('clerk_xyz');
    expect(response).toBeInstanceOf(NextResponse);
    expect(response?.status).toBe(403);
  });

  it('returns 403 when ADMIN_USER_IDS is empty', () => {
    process.env.ADMIN_USER_IDS = '';
    const response = assertAdmin('clerk_abc');
    expect(response?.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// assertTier
// ---------------------------------------------------------------------------

describe('assertTier', () => {
  it('returns null when user tier is in required list', () => {
    const user = makeUser({ tier: 'creator' });
    expect(assertTier(user, ['creator', 'pro'])).toBeNull();
  });

  it('returns 403 when user tier is not in required list', () => {
    const user = makeUser({ tier: 'starter' });
    const response = assertTier(user, ['creator', 'pro']);
    expect(response?.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Edge Cases: Expired tokens, banned users, tier downgrades, etc. (PF-686)
// ---------------------------------------------------------------------------

describe('authenticateRequest — edge cases', () => {
  it('returns 401 when auth() throws (expired/invalid token)', async () => {
    mockAuth.mockRejectedValue(new Error('Token expired'));

    const result = await authenticateRequest();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(401);
      const body = await result.response.json();
      // The `reason` sub-code distinguishes a provider outage from a
      // routine missing-session 401 for on-call observability.
      expect(body.reason).toBe('AUTH_PROVIDER_ERROR');
    }
    // Ensure the throw did NOT propagate — it must be caught and converted to 401.
    expect(mockGetUserByClerkId).not.toHaveBeenCalled();
  });

  it('returns 401 NO_SESSION reason when userId is missing (distinguishable from provider error)', async () => {
    mockAuth.mockResolvedValue({ userId: null });

    const result = await authenticateRequest();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(401);
      const body = await result.response.json();
      expect(body.reason).toBe('NO_SESSION');
    }
  });

  it('returns 401 when auth() throws a malformed-JWT error', async () => {
    mockAuth.mockRejectedValue(new Error('Invalid JWT format'));

    const result = await authenticateRequest();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(401);
    }
  });

  it('returns 403 ACCOUNT_BANNED for a banned user loaded from DB', async () => {
    const bannedUser = makeUser({ banned: 1 });
    mockAuth.mockResolvedValue({ userId: 'clerk_abc' });
    mockGetUserByClerkId.mockResolvedValue(bannedUser);

    const result = await authenticateRequest();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(403);
      const body = await result.response.json();
      expect(body.error).toBe('ACCOUNT_BANNED');
      expect(body.message).toContain('suspended');
      // Must give users a next step for appeals — silent bans create
      // support ticket sprawl and silent churn.
      expect(body.message).toMatch(/support@spawnforge\.ai/);
    }
  });

  it('returns 403 ACCOUNT_BANNED when sync returns a banned user', async () => {
    // DB is empty, sync completes successfully, but the freshly synced
    // record is already flagged banned — must still reject.
    const bannedSynced = makeUser({ banned: 1 });
    mockAuth.mockResolvedValue({ userId: 'clerk_abc' });
    mockGetUserByClerkId.mockResolvedValue(null);
    mockClerkClient.mockResolvedValue({
      users: {
        getUser: vi.fn().mockResolvedValue({
          emailAddresses: [{ emailAddress: 'test@example.com' }],
          firstName: 'Test',
          lastName: 'User',
        }),
      },
    });
    mockSyncUserFromClerk.mockResolvedValue(bannedSynced);

    const result = await authenticateRequest();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(403);
      const body = await result.response.json();
      expect(body.error).toBe('ACCOUNT_BANNED');
    }
  });

  it('allows access when banned=0 (unbanned user)', async () => {
    const normalUser = makeUser({ banned: 0 });
    mockAuth.mockResolvedValue({ userId: 'clerk_abc' });
    mockGetUserByClerkId.mockResolvedValue(normalUser);

    const result = await authenticateRequest();
    expect(result.ok).toBe(true);
  });

  it('returns 401 STALE_SESSION on Clerk 404 (no retry, no 500ms wait)', async () => {
    // When Clerk returns 404, the session token is stale. Return 401
    // (not 503) so client SDKs refresh the token, and skip the 500ms
    // retry so timing can't distinguish a deleted user from a DB flake.
    mockAuth.mockResolvedValue({ userId: 'clerk_deleted' });
    mockGetUserByClerkId.mockResolvedValue(null);
    const mockGetUser = vi.fn().mockRejectedValue(
      Object.assign(new Error('User not found'), { status: 404 }),
    );
    mockClerkClient.mockResolvedValue({ users: { getUser: mockGetUser } });

    const start = Date.now();
    const result = await authenticateRequest();
    const elapsed = Date.now() - start;

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(401);
      const body = await result.response.json();
      expect(body.reason).toBe('STALE_SESSION');
    }
    // Retry adds a 500ms delay — a 404-aware early return must not wait.
    expect(elapsed).toBeLessThan(400);
    // getUser was called exactly once (no retry).
    expect(mockGetUser).toHaveBeenCalledTimes(1);
    // syncUserFromClerk was never called — we short-circuited on the
    // Clerk fetch, so the DB write path didn't execute.
    expect(mockSyncUserFromClerk).not.toHaveBeenCalled();
  });

  it('detects Clerk 404 by message substring when status field is absent', async () => {
    mockAuth.mockResolvedValue({ userId: 'clerk_deleted' });
    mockGetUserByClerkId.mockResolvedValue(null);
    const mockGetUser = vi.fn().mockRejectedValue(new Error('user not found (404)'));
    mockClerkClient.mockResolvedValue({ users: { getUser: mockGetUser } });

    const result = await authenticateRequest();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(401);
    }
    expect(mockGetUser).toHaveBeenCalledTimes(1);
  });

  it('does NOT fast-exit when syncUserFromClerk throws a generic "record not found" DB error', async () => {
    // Regression guard: the old broad `/not[_ ]?found/i` regex would
    // have misclassified a DB error like "record not found" as a Clerk
    // 404 and fast-exited. After narrowing the regex AND restricting
    // isClerk404 to only the Clerk fetch path, a DB-side "not found"
    // must go through the normal retry + degraded flow.
    mockAuth.mockResolvedValue({ userId: 'clerk_abc' });
    mockGetUserByClerkId.mockResolvedValue(null);
    mockClerkClient.mockResolvedValue({
      users: {
        getUser: vi.fn().mockResolvedValue({
          emailAddresses: [{ emailAddress: 'test@example.com' }],
          firstName: 'Test',
          lastName: 'User',
        }),
      },
    });
    mockSyncUserFromClerk.mockRejectedValue(new Error('record not found in table users'));

    const result = await authenticateRequest();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Degraded (503), NOT STALE_SESSION — the user exists in Clerk,
      // the DB write just failed twice.
      expect(result.response.status).toBe(503);
      const body = await result.response.json();
      expect(body.error).toBe('SERVICE_DEGRADED');
    }
    // syncUserFromClerk must have been retried: initial + 1 retry = 2.
    expect(mockSyncUserFromClerk).toHaveBeenCalledTimes(2);
  });

  it('returns 401 when auth() returns empty object (no userId key)', async () => {
    mockAuth.mockResolvedValue({});

    const result = await authenticateRequest();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(401);
    }
  });

  it('returns 401 when auth() returns undefined userId', async () => {
    mockAuth.mockResolvedValue({ userId: undefined });

    const result = await authenticateRequest();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(401);
    }
  });

  it('returns 401 when auth() returns empty string userId', async () => {
    mockAuth.mockResolvedValue({ userId: '' });

    const result = await authenticateRequest();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(401);
    }
  });

  it('returns 401 when Clerk secret key has wrong prefix', async () => {
    process.env.CLERK_SECRET_KEY = 'wrong_prefix_abc';
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = 'pk_test_abc';

    const result = await authenticateRequest();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(401);
    }
  });

  it('returns 401 when publishable key has wrong prefix', async () => {
    process.env.CLERK_SECRET_KEY = 'sk_test_abc';
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = 'wrong_prefix_abc';

    const result = await authenticateRequest();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(401);
    }
  });

  it('handles deleted Clerk user as 401 STALE_SESSION (not 503)', async () => {
    mockAuth.mockResolvedValue({ userId: 'clerk_deleted_user' });
    mockGetUserByClerkId.mockResolvedValue(null);
    mockClerkClient.mockResolvedValue({
      users: {
        getUser: vi.fn().mockRejectedValue(new Error('User not found (404)')),
      },
    });

    const result = await authenticateRequest();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(401);
      const body = await result.response.json();
      expect(body.reason).toBe('STALE_SESSION');
    }
  });

  it('handles syncUserFromClerk returning null (user cannot be synced)', async () => {
    mockAuth.mockResolvedValue({ userId: 'clerk_abc' });
    mockGetUserByClerkId.mockResolvedValue(null);
    mockClerkClient.mockResolvedValue({
      users: {
        getUser: vi.fn().mockResolvedValue({
          emailAddresses: [{ emailAddress: 'test@example.com' }],
          firstName: 'Test',
          lastName: 'User',
        }),
      },
    });
    mockSyncUserFromClerk.mockResolvedValue(null);

    const result = await authenticateRequest();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(503);
    }
  });
});

describe('authenticateClerkSession — edge cases', () => {
  it('returns 401 AUTH_PROVIDER_ERROR when auth() throws (expired token)', async () => {
    mockAuth.mockRejectedValue(new Error('Session expired'));

    const result = await authenticateClerkSession();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(401);
      const body = await result.response.json();
      expect(body.reason).toBe('AUTH_PROVIDER_ERROR');
    }
    // Throw must be caught, not propagated.
    expect(mockGetUserByClerkId).not.toHaveBeenCalled();
  });

  it('returns 401 when auth() throws a malformed-JWT error', async () => {
    mockAuth.mockRejectedValue(new Error('Invalid JWT format'));

    const result = await authenticateClerkSession();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(401);
    }
  });

  it('returns 401 when auth() returns empty object', async () => {
    mockAuth.mockResolvedValue({});

    const result = await authenticateClerkSession();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(401);
    }
  });

  it('returns 401 when both Clerk env vars are missing', async () => {
    delete process.env.CLERK_SECRET_KEY;
    delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

    const result = await authenticateClerkSession();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(401);
    }
  });

  it('returns 403 ACCOUNT_BANNED for a banned user', async () => {
    // authenticateClerkSession skips the full sync path, but it MUST still
    // reject banned users when the DB row exists — otherwise a banned user
    // can access any route that uses this lighter helper.
    const bannedUser = makeUser({ banned: 1 });
    mockAuth.mockResolvedValue({ userId: 'clerk_abc' });
    mockGetUserByClerkId.mockResolvedValue(bannedUser);

    const result = await authenticateClerkSession();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(403);
      const body = await result.response.json();
      expect(body.error).toBe('ACCOUNT_BANNED');
    }
  });

  it('allows access when the DB row is missing (unsynced degraded path)', async () => {
    // Caller-side degraded mode: if the user row does not exist yet, this
    // helper returns ok so the caller can decide how to handle it.
    mockAuth.mockResolvedValue({ userId: 'clerk_new' });
    mockGetUserByClerkId.mockResolvedValue(null);

    const result = await authenticateClerkSession();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.clerkId).toBe('clerk_new');
    }
  });

  it('allows access for unbanned user (banned=0)', async () => {
    const normalUser = makeUser({ banned: 0 });
    mockAuth.mockResolvedValue({ userId: 'clerk_abc' });
    mockGetUserByClerkId.mockResolvedValue(normalUser);

    const result = await authenticateClerkSession();
    expect(result.ok).toBe(true);
  });

  it('degrades gracefully when the DB is unavailable during the banned check', async () => {
    // queryWithResilience throws when the DB is unreachable. authenticateClerkSession
    // must catch this and allow the caller's degraded-mode path to handle it —
    // crashing with a 500 breaks the contract for routes that use this lighter helper.
    mockAuth.mockResolvedValue({ userId: 'clerk_abc' });
    mockGetUserByClerkId.mockRejectedValue(new Error('DB connection refused'));

    const result = await authenticateClerkSession();
    // Should degrade gracefully: ok=true (banned check skipped), no thrown exception.
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.clerkId).toBe('clerk_abc');
    }
  });
});

describe('assertAdmin — edge cases', () => {
  it('returns 403 when ADMIN_USER_IDS env var is not set', () => {
    delete process.env.ADMIN_USER_IDS;
    const response = assertAdmin('clerk_abc');
    expect(response?.status).toBe(403);
  });

  it('handles whitespace in ADMIN_USER_IDS', () => {
    process.env.ADMIN_USER_IDS = ' clerk_abc , clerk_def ';
    expect(assertAdmin('clerk_abc')).toBeNull();
    expect(assertAdmin('clerk_def')).toBeNull();
  });

  it('returns 403 for partial ID match (not substring)', () => {
    process.env.ADMIN_USER_IDS = 'clerk_abc';
    const response = assertAdmin('clerk_ab');
    expect(response?.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Schema-locking test: guarantees a future refactor of syncUserFromClerk
// cannot silently unban users by adding `banned` to the onConflictDoUpdate
// .set() block. A partial set on ON CONFLICT DO UPDATE preserves unset
// columns, so omitting `banned` is load-bearing security behavior.
// ---------------------------------------------------------------------------

describe('syncUserFromClerk — schema lock', () => {
  it('does NOT include `banned` in the onConflictDoUpdate set block', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/lib/auth/user-service.ts'),
      'utf8',
    );
    const conflictBlockMatch = source.match(/\.onConflictDoUpdate\(\s*\{[\s\S]*?set:\s*\{([\s\S]*?)\}/);
    expect(
      conflictBlockMatch,
      'onConflictDoUpdate.set block not found in user-service.ts — schema-lock guard is broken. ' +
        'Verify syncUserFromClerk still uses onConflictDoUpdate AND that `banned` is still excluded ' +
        'from its set block (omitting banned is load-bearing security: partial set on ON CONFLICT ' +
        'DO UPDATE preserves unset columns, so listing banned would silently unban users on re-sync).',
    ).not.toBeNull();
    const setBlock = conflictBlockMatch![1];
    expect(
      /\bbanned\b/.test(setBlock),
      'banned must NOT appear in syncUserFromClerk.onConflictDoUpdate.set — a partial set clause ' +
        'preserves unset columns, so adding `banned` here would reset it to the default (0) on every ' +
        're-sync, silently unbanning previously-suspended users. Keep it out of the set block.',
    ).toBe(false);
  });
});

describe('assertTier — edge cases (PF-686)', () => {
  it('allows starter tier when starter is in required list', () => {
    const user = makeUser({ tier: 'starter' });
    expect(assertTier(user, ['starter'])).toBeNull();
  });

  it('allows hobbyist tier when hobbyist is in required list', () => {
    const user = makeUser({ tier: 'hobbyist' });
    expect(assertTier(user, ['hobbyist', 'creator', 'pro'])).toBeNull();
  });

  it('allows pro tier when pro is in required list', () => {
    const user = makeUser({ tier: 'pro' });
    expect(assertTier(user, ['pro'])).toBeNull();
  });

  it('denies hobbyist when only pro and creator required', () => {
    const user = makeUser({ tier: 'hobbyist' });
    const response = assertTier(user, ['creator', 'pro']);
    expect(response?.status).toBe(403);
  });

  it('includes currentTier and message in 403 response body', async () => {
    const user = makeUser({ tier: 'starter' });
    const response = assertTier(user, ['pro']);
    expect(response).not.toBeNull();
    const body = await response!.json();
    expect(body.error).toBe('TIER_REQUIRED');
    expect(body.currentTier).toBe('starter');
    expect(body.message).toContain('pro');
  });

  it('reflects tier downgrade — user was creator, downgraded to starter', () => {
    // Simulates a mid-session tier downgrade: the DB record now says 'starter'
    // even though the user's session may have been established as 'creator'
    const user = makeUser({ tier: 'starter' });
    const response = assertTier(user, ['creator', 'pro']);
    expect(response?.status).toBe(403);
  });

  it('allows single-tier required list', () => {
    const user = makeUser({ tier: 'creator' });
    expect(assertTier(user, ['creator'])).toBeNull();
  });

  it('allows when all tiers are in required list', () => {
    const user = makeUser({ tier: 'starter' });
    expect(assertTier(user, ['starter', 'hobbyist', 'creator', 'pro'])).toBeNull();
  });
});
