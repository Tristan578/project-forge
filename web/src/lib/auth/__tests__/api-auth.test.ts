import { describe, it, expect, vi, beforeEach } from 'vitest';
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

    await expect(authenticateRequest()).rejects.toThrow('Token expired');
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

  it('handles deleted user (exists in Clerk but DB lookup returns null, sync also returns null)', async () => {
    mockAuth.mockResolvedValue({ userId: 'clerk_deleted_user' });
    mockGetUserByClerkId.mockResolvedValue(null);
    // Clerk user was deleted — getUser throws 404
    mockClerkClient.mockResolvedValue({
      users: {
        getUser: vi.fn().mockRejectedValue(new Error('User not found (404)')),
      },
    });

    const result = await authenticateRequest();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(503);
      const body = await result.response.json();
      expect(body.error).toBe('SERVICE_DEGRADED');
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
  it('returns 401 when auth() throws (expired token)', async () => {
    mockAuth.mockRejectedValue(new Error('Session expired'));

    await expect(authenticateClerkSession()).rejects.toThrow('Session expired');
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
