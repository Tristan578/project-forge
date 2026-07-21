/**
 * Tests for the Stripe billing-meters usage reporter (PF-978 / #8970).
 *
 * Covers the full skip/emit matrix from specs/stripe-billing-meters.md's
 * acceptance criteria: flag disabled, BYOK (unmetered), missing usageId,
 * non-finite/non-positive tokenCost, missing stripeCustomerId, the
 * claim-before-emit protocol (claim win vs already-attempted), Stripe
 * success, Stripe failure with best-effort claim release, and a failure of
 * the release itself.
 */

// @vitest-environment node

vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

type WhereOutcome = { kind: 'resolve' } | { kind: 'reject'; error: unknown };

const whereCalls: unknown[] = [];
const setCalls: unknown[] = [];
let claimReturning: { id: string }[] = [];
let whereOutcomes: WhereOutcome[] = [];

const mockReturning = vi.fn(() => Promise.resolve(claimReturning));

// The real drizzle query builder is a thenable when awaited directly
// (confirm/clear updates) but also exposes `.returning()` (claim update).
// This double-duty object satisfies both call shapes.
const mockWhere = vi.fn((cond: unknown) => {
  whereCalls.push(cond);
  return {
    returning: mockReturning,
    then: (resolve: (v: unknown) => void, reject: (e: unknown) => void) => {
      const outcome = whereOutcomes.shift() ?? { kind: 'resolve' as const };
      if (outcome.kind === 'reject') reject(outcome.error);
      else resolve(undefined);
    },
  };
});

const mockSet = vi.fn((vals: unknown) => {
  setCalls.push(vals);
  return { where: mockWhere };
});

const mockUpdate = vi.fn(() => ({ set: mockSet }));

const mockDb = { update: mockUpdate };

vi.mock('@/lib/db/client', () => ({
  getDb: vi.fn(() => mockDb),
  queryWithResilience: vi.fn(<T>(op: () => Promise<T>) => op()),
}));

const meterEventsCreate = vi.fn();

vi.mock('../stripe-client', () => ({
  getStripe: vi.fn(() => ({
    billing: { meterEvents: { create: meterEventsCreate } },
  })),
}));

vi.mock('@/lib/monitoring/sentry-server', () => ({
  captureException: vi.fn(),
}));

import { getStripe } from '../stripe-client';
import { captureException } from '@/lib/monitoring/sentry-server';
import {
  reportGenerationUsage,
  isBillingMetersEnabled,
  METER_EVENT_NAME,
  type ReportGenerationUsageArgs,
} from '../meterEvents';

const baseArgs: ReportGenerationUsageArgs = {
  stripeCustomerId: 'cus_123',
  usageId: 'usage_1',
  tokenCost: 42,
  operation: 'sprite_generate',
  metered: true,
};

function setEnabled(value: string | undefined) {
  if (value === undefined) {
    delete process.env.BILLING_METERS_ENABLED;
  } else {
    process.env.BILLING_METERS_ENABLED = value;
  }
}

describe('isBillingMetersEnabled', () => {
  const original = process.env.BILLING_METERS_ENABLED;
  afterEach(() => setEnabled(original));

  it('is true only for the exact string "true"', () => {
    setEnabled('true');
    expect(isBillingMetersEnabled()).toBe(true);
  });

  it('is false when unset', () => {
    setEnabled(undefined);
    expect(isBillingMetersEnabled()).toBe(false);
  });

  it.each(['false', '1', 'TRUE', 'yes', ''])('is false for %j', (value) => {
    setEnabled(value);
    expect(isBillingMetersEnabled()).toBe(false);
  });
});

describe('reportGenerationUsage', () => {
  const originalFlag = process.env.BILLING_METERS_ENABLED;

  beforeEach(() => {
    vi.clearAllMocks();
    whereCalls.length = 0;
    setCalls.length = 0;
    claimReturning = [{ id: baseArgs.usageId as string }];
    whereOutcomes = [];
    meterEventsCreate.mockResolvedValue({ identifier: baseArgs.usageId });
    setEnabled('true');
  });

  afterEach(() => {
    setEnabled(originalFlag);
    vi.useRealTimers();
  });

  it('is a no-op when BILLING_METERS_ENABLED is not the exact string "true"', async () => {
    setEnabled('1');

    await reportGenerationUsage(baseArgs);

    expect(mockUpdate).not.toHaveBeenCalled();
    expect(meterEventsCreate).not.toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();
  });

  it('skips BYOK usage (metered: false) even with the flag on', async () => {
    await reportGenerationUsage({ ...baseArgs, metered: false });

    expect(mockUpdate).not.toHaveBeenCalled();
    expect(meterEventsCreate).not.toHaveBeenCalled();
  });

  it('skips when usageId is missing', async () => {
    await reportGenerationUsage({ ...baseArgs, usageId: undefined });

    expect(mockUpdate).not.toHaveBeenCalled();
    expect(meterEventsCreate).not.toHaveBeenCalled();
  });

  it.each([0, -5, NaN, Infinity])('skips when tokenCost is %j', async (tokenCost) => {
    await reportGenerationUsage({ ...baseArgs, tokenCost });

    expect(mockUpdate).not.toHaveBeenCalled();
    expect(meterEventsCreate).not.toHaveBeenCalled();
  });

  it('reports missing stripeCustomerId as an anomaly and never claims the row', async () => {
    await reportGenerationUsage({ ...baseArgs, stripeCustomerId: null });

    expect(captureException).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('stripe_customer_id') }),
      { action: 'meter_event', usageId: baseArgs.usageId }
    );
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(meterEventsCreate).not.toHaveBeenCalled();
  });

  it('skips emitting when the claim is already attempted (empty .returning())', async () => {
    claimReturning = [];

    await reportGenerationUsage(baseArgs);

    // Only the claim UPDATE ran; no confirm/clear follow-up.
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(meterEventsCreate).not.toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();
  });

  it('claims, emits to Stripe with the correct shape, then confirms metered_at', async () => {
    vi.useFakeTimers({ now: new Date('2026-07-13T12:00:00Z') });

    await reportGenerationUsage(baseArgs);

    expect(meterEventsCreate).toHaveBeenCalledWith({
      event_name: METER_EVENT_NAME,
      identifier: baseArgs.usageId,
      timestamp: Math.floor(new Date('2026-07-13T12:00:00Z').getTime() / 1000),
      payload: {
        value: String(baseArgs.tokenCost),
        stripe_customer_id: baseArgs.stripeCustomerId,
        operation: baseArgs.operation,
      },
    });

    // Claim then confirm: two update() calls, second sets meteredAt.
    expect(mockUpdate).toHaveBeenCalledTimes(2);
    expect(setCalls[0]).toEqual(expect.objectContaining({ meterAttemptedAt: expect.any(Date) }));
    expect(setCalls[1]).toEqual(expect.objectContaining({ meteredAt: expect.any(Date) }));
    expect(captureException).not.toHaveBeenCalled();
  });

  it('clamps a far-past createdAt to the max-past-days window', async () => {
    vi.useFakeTimers({ now: new Date('2026-07-13T12:00:00Z') });
    const farPast = new Date('2020-01-01T00:00:00Z');

    await reportGenerationUsage({ ...baseArgs, createdAt: farPast });

    const call = meterEventsCreate.mock.calls[0][0] as { timestamp: number };
    const nowSeconds = Math.floor(new Date('2026-07-13T12:00:00Z').getTime() / 1000);
    // Must be clamped well inside Stripe's 35-day window, not the raw 2020 date.
    expect(call.timestamp).toBeGreaterThan(nowSeconds - 35 * 24 * 60 * 60);
    expect(call.timestamp).toBeLessThan(nowSeconds);
  });

  it('clamps a far-future createdAt to the max-future-minutes window', async () => {
    vi.useFakeTimers({ now: new Date('2026-07-13T12:00:00Z') });
    const farFuture = new Date('2030-01-01T00:00:00Z');

    await reportGenerationUsage({ ...baseArgs, createdAt: farFuture });

    const call = meterEventsCreate.mock.calls[0][0] as { timestamp: number };
    const nowSeconds = Math.floor(new Date('2026-07-13T12:00:00Z').getTime() / 1000);
    // Must be clamped well inside Stripe's 5-minute future allowance.
    expect(call.timestamp).toBeGreaterThan(nowSeconds);
    expect(call.timestamp).toBeLessThan(nowSeconds + 5 * 60);
  });

  it('captures the Stripe failure and best-effort clears the claim so a retry can re-attempt', async () => {
    const stripeError = new Error('stripe unavailable');
    meterEventsCreate.mockRejectedValueOnce(stripeError);

    await reportGenerationUsage(baseArgs);

    expect(captureException).toHaveBeenCalledWith(stripeError, {
      action: 'meter_event',
      usageId: baseArgs.usageId,
    });

    // Claim, then the best-effort clear — no confirm (Stripe never succeeded).
    expect(mockUpdate).toHaveBeenCalledTimes(2);
    expect(setCalls[1]).toEqual(expect.objectContaining({ meterAttemptedAt: null }));
  });

  it('captures a second exception if the best-effort claim release itself fails', async () => {
    const stripeError = new Error('stripe unavailable');
    meterEventsCreate.mockRejectedValueOnce(stripeError);
    const clearError = new Error('db unavailable');
    whereOutcomes = [{ kind: 'reject', error: clearError }];

    await reportGenerationUsage(baseArgs);

    expect(captureException).toHaveBeenCalledWith(stripeError, {
      action: 'meter_event',
      usageId: baseArgs.usageId,
    });
    expect(captureException).toHaveBeenCalledWith(clearError, {
      action: 'meter_event_clear_claim',
      usageId: baseArgs.usageId,
    });
    // Never throws out of the fire-and-forget function.
  });

  it('never throws even when getStripe() itself throws', async () => {
    vi.mocked(getStripe).mockImplementationOnce(() => {
      throw new Error('STRIPE_SECRET_KEY unset');
    });

    await expect(reportGenerationUsage(baseArgs)).resolves.toBeUndefined();
    expect(captureException).toHaveBeenCalled();
  });
});
