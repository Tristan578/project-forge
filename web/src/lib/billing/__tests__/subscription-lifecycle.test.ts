/**
 * Smoke tests for subscription-lifecycle module exports.
 *
 * The in-memory claimEvent / releaseEvent idempotency guards were removed from
 * this module in PF-313 and replaced by the DB-backed webhookIdempotency
 * service. Comprehensive handler tests live in:
 *   - subscriptionLifecycle.test.ts  (DB mock integration)
 *   - subscriptionLifecycle.db.test.ts  (deeper DB-level assertions)
 *
 * This file verifies the module can be imported and that the expected
 * named exports are present after the PF-313 refactor.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('server-only', () => ({}));

vi.mock('@/lib/db/client', () => ({
  getDb: vi.fn(() => ({
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockResolvedValue(undefined),
    }),
  })),
}));

vi.mock('@/lib/auth/user-service', () => ({
  updateUserTier: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/tokens/pricing', () => ({
  TIER_MONTHLY_TOKENS: {
    starter: 0,
    hobbyist: 300,
    creator: 1000,
    pro: 3000,
  },
}));

import {
  findUserByStripeCustomer,
  handleSubscriptionCreated,
  handleSubscriptionUpdated,
  handleSubscriptionDeleted,
  handleInvoicePaid,
  handleInvoicePaymentFailed,
} from '../subscription-lifecycle';

describe('subscription-lifecycle module exports (PF-313 post-refactor)', () => {
  it('exports findUserByStripeCustomer as a function', () => {
    expect(typeof findUserByStripeCustomer).toBe('function');
  });

  it('exports handleSubscriptionCreated as a function', () => {
    expect(typeof handleSubscriptionCreated).toBe('function');
  });

  it('exports handleSubscriptionUpdated as a function', () => {
    expect(typeof handleSubscriptionUpdated).toBe('function');
  });

  it('exports handleSubscriptionDeleted as a function', () => {
    expect(typeof handleSubscriptionDeleted).toBe('function');
  });

  it('exports handleInvoicePaid as a function', () => {
    expect(typeof handleInvoicePaid).toBe('function');
  });

  it('exports handleInvoicePaymentFailed as a function', () => {
    expect(typeof handleInvoicePaymentFailed).toBe('function');
  });

  it('findUserByStripeCustomer returns null for unknown customer', async () => {
    const result = await findUserByStripeCustomer('cus_unknown');
    expect(result).toBeNull();
  });

  it('handleSubscriptionDeleted resolves without error when user not found', async () => {
    await expect(
      handleSubscriptionDeleted('cus_unknown', 'sub_unknown')
    ).resolves.toBeUndefined();
  });

  it('handleInvoicePaymentFailed resolves without error when user not found', async () => {
    await expect(
      handleInvoicePaymentFailed('cus_unknown', 'inv_unknown', 1, null)
    ).resolves.toBeUndefined();
  });
});
