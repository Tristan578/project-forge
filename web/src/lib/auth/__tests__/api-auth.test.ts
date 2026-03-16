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
