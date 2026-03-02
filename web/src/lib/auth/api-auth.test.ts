import { describe, it, expect, vi, afterEach } from 'vitest';

// Mock next/server before importing the module under test
vi.mock('next/server', () => ({
  NextResponse: {
    json: vi.fn((body: unknown, init?: { status?: number }) => ({ body, status: init?.status ?? 200 })),
  },
}));

// Mock clerk auth
vi.mock('@clerk/nextjs/server', () => ({
  auth: vi.fn(),
}));

// Mock user-service
vi.mock('./user-service', () => ({
  getUserByClerkId: vi.fn(),
}));

import { authenticateRequest, assertAdmin, assertTier } from './api-auth';
import type { User } from '../db/schema';

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-uuid-1',
    clerkId: 'clerk_abc',
    email: 'test@example.com',
    displayName: 'Test User',
    tier: 'starter',
    monthlyTokens: 50,
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

type AuthResult = Awaited<ReturnType<typeof authenticateRequest>>;

function expectUnauthorized(result: AuthResult): void {
  expect(result.ok).toBe(false);
  expect((result as { ok: false; response: { status: number } }).response.status).toBe(401);
}

describe('authenticateRequest', () => {
  const originalSecretKey = process.env.CLERK_SECRET_KEY;
  const originalPublishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

  afterEach(() => {
    // Restore env vars
    if (originalSecretKey === undefined) {
      delete process.env.CLERK_SECRET_KEY;
    } else {
      process.env.CLERK_SECRET_KEY = originalSecretKey;
    }
    if (originalPublishableKey === undefined) {
      delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
    } else {
      process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = originalPublishableKey;
    }
    vi.resetAllMocks();
  });

  it('returns 401 without calling auth() when Clerk keys are absent (CI/E2E passthrough mode)', async () => {
    delete process.env.CLERK_SECRET_KEY;
    delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

    const { auth } = await import('@clerk/nextjs/server');
    const result = await authenticateRequest();

    expectUnauthorized(result);
    expect(auth).not.toHaveBeenCalled();
  });

  it('returns 401 without calling auth() when secret key has invalid prefix', async () => {
    process.env.CLERK_SECRET_KEY = 'invalid_key';
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = 'pk_test_valid';

    const { auth } = await import('@clerk/nextjs/server');
    const result = await authenticateRequest();

    expectUnauthorized(result);
    expect(auth).not.toHaveBeenCalled();
  });

  it('returns 401 when Clerk keys are valid but auth() returns no userId', async () => {
    process.env.CLERK_SECRET_KEY = 'sk_test_valid';
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = 'pk_test_valid';

    const { auth } = await import('@clerk/nextjs/server');
    vi.mocked(auth).mockResolvedValue({ userId: null } as never);

    expectUnauthorized(await authenticateRequest());
  });

  it('returns 404 when Clerk keys are valid, userId exists, but user not found in DB', async () => {
    process.env.CLERK_SECRET_KEY = 'sk_test_valid';
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = 'pk_test_valid';

    const { auth } = await import('@clerk/nextjs/server');
    vi.mocked(auth).mockResolvedValue({ userId: 'clerk_user_123' } as never);

    const { getUserByClerkId } = await import('./user-service');
    vi.mocked(getUserByClerkId).mockResolvedValue(null);

    const result = await authenticateRequest();
    expect(result.ok).toBe(false);
    expect((result as { ok: false; response: { status: number } }).response.status).toBe(404);
  });

  it('returns ok context when Clerk keys are valid and user is found', async () => {
    process.env.CLERK_SECRET_KEY = 'sk_test_valid';
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = 'pk_test_valid';

    const { auth } = await import('@clerk/nextjs/server');
    vi.mocked(auth).mockResolvedValue({ userId: 'clerk_user_123' } as never);

    const { getUserByClerkId } = await import('./user-service');
    const fakeUser = makeUser({ clerkId: 'clerk_user_123' });
    vi.mocked(getUserByClerkId).mockResolvedValue(fakeUser);

    const result = await authenticateRequest();

    expect(result.ok).toBe(true);
    const ctx = (result as { ok: true; ctx: { clerkId: string; user: User } }).ctx;
    expect(ctx.clerkId).toBe('clerk_user_123');
    expect(ctx.user).toEqual(fakeUser);
  });
});

describe('assertAdmin', () => {
  const originalEnv = process.env.ADMIN_USER_IDS;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.ADMIN_USER_IDS;
    } else {
      process.env.ADMIN_USER_IDS = originalEnv;
    }
  });

  it('returns null for a clerk ID that is in ADMIN_USER_IDS', () => {
    process.env.ADMIN_USER_IDS = 'admin_1,admin_2,admin_3';
    const result = assertAdmin('admin_2');
    expect(result).toBeNull();
  });

  it('returns null for the only admin ID', () => {
    process.env.ADMIN_USER_IDS = 'solo_admin';
    const result = assertAdmin('solo_admin');
    expect(result).toBeNull();
  });

  it('returns 403 response for a non-admin clerk ID', () => {
    process.env.ADMIN_USER_IDS = 'admin_1,admin_2';
    const result = assertAdmin('regular_user');
    expect(result).not.toBeNull();
    expect(result?.status).toBe(403);
  });

  it('returns 403 when ADMIN_USER_IDS is empty', () => {
    process.env.ADMIN_USER_IDS = '';
    const result = assertAdmin('anyone');
    expect(result).not.toBeNull();
    expect(result?.status).toBe(403);
  });

  it('returns 403 when ADMIN_USER_IDS is not set', () => {
    delete process.env.ADMIN_USER_IDS;
    const result = assertAdmin('anyone');
    expect(result).not.toBeNull();
    expect(result?.status).toBe(403);
  });

  it('handles whitespace around admin IDs', () => {
    process.env.ADMIN_USER_IDS = ' admin_1 , admin_2 ';
    const result = assertAdmin('admin_1');
    expect(result).toBeNull();
  });
});

describe('assertTier', () => {
  it('returns null when user tier is in required tiers', () => {
    const user = makeUser({ tier: 'creator' });
    const result = assertTier(user, ['creator', 'pro']);
    expect(result).toBeNull();
  });

  it('returns null when user tier exactly matches single required tier', () => {
    const user = makeUser({ tier: 'pro' });
    const result = assertTier(user, ['pro']);
    expect(result).toBeNull();
  });

  it('returns null for starter tier when starter is allowed', () => {
    const user = makeUser({ tier: 'starter' });
    const result = assertTier(user, ['starter', 'hobbyist', 'creator', 'pro']);
    expect(result).toBeNull();
  });

  it('returns 403 when user tier is not in required tiers', () => {
    const user = makeUser({ tier: 'starter' });
    const result = assertTier(user, ['creator', 'pro']);
    expect(result).not.toBeNull();
    expect(result?.status).toBe(403);
  });

  it('returns 403 with error body containing TIER_REQUIRED', () => {
    const user = makeUser({ tier: 'hobbyist' });
    const result = assertTier(user, ['pro']);
    expect(result).not.toBeNull();
    // The mock NextResponse.json stores body on the object
    const response = result as unknown as { body: { error: string; currentTier: string } };
    expect(response.body.error).toBe('TIER_REQUIRED');
    expect(response.body.currentTier).toBe('hobbyist');
  });

  it('returns 403 for hobbyist when only pro is required', () => {
    const user = makeUser({ tier: 'hobbyist' });
    const result = assertTier(user, ['pro']);
    expect(result?.status).toBe(403);
  });
});
