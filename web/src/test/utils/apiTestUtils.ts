import { vi } from 'vitest';
import type { User } from '@/lib/db/schema';

/**
 * Creates a mock User object for API tests.
 */
export function makeUser(overrides: Partial<User> = {}): User {
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

/**
 * Mocks a fetch response.
 */
export function mockFetchResponse(data: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  });
}

/**
 * Mocks a failed fetch (network error).
 */
export function mockFetchError(message = 'Network Error') {
  return vi.fn().mockRejectedValue(new Error(message));
}
