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

import { assertAdmin, assertTier } from './api-auth';
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
