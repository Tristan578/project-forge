// @vitest-environment node
/**
 * Real-DB behavioural tests for the Stripe Radar fraud-review hold (PF-913 / #8823).
 *
 * The capability is "defer the token credit grant until a flagged review clears."
 * These tests prove the OUTCOME on real Postgres (PGlite + production migration
 * schema), not query substrings:
 *
 *   - Feature flag OFF  → every handler is inert (no credit, no hold, no reversal).
 *   - isCheckoutHeldForReview → true only when Radar positively flags the PI/charge;
 *     false (credit-now) when not flagged or on a Stripe read error (fail-open).
 *   - handleReviewClosed(approved) → releases the held grant via the idempotent
 *     creditAddonTokens (addon_tokens increases by the package amount, exactly once
 *     across redelivery). Non-approved close reasons grant nothing.
 *   - handleDisputeCreated → claws back granted tokens proportionally.
 *
 * Stripe API reads (paymentIntents/charges retrieve) are faked; all crediting and
 * clawback runs against the real DB through creditAddonTokens / reverseAddonTokens.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type Stripe from 'stripe';
import type { NeonSqlAdapter, TestHarness } from '@/lib/db/__tests__/pgliteHarness';

const harnessRef = vi.hoisted(() => ({ current: null as TestHarness | null }));
function harness(): TestHarness {
  const h = harnessRef.current;
  if (!h) throw new Error('PGlite harness not initialised');
  return h;
}

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db/client', () => ({
  getNeonSql: () => harness().neonSql,
  getDb: () => harness().db,
  queryWithResilience: <T>(operation: () => Promise<T>): Promise<T> => operation(),
}));
vi.mock('@/lib/monitoring/sentry-server', () => ({
  captureException: vi.fn(),
}));

import { createTestHarness, getUserRow, seedUser } from '@/lib/db/__tests__/pgliteHarness';
import { TOKEN_PACKAGES } from '@/lib/tokens/pricing';
import {
  isRadarReviewHoldEnabled,
  isCheckoutHeldForReview,
  handleReviewClosed,
  handleDisputeCreated,
} from '../radar-review';

const FLAG = 'STRIPE_RADAR_REVIEW_HOLD';

// Use vi.stubEnv (not direct process.env mutation) — vitest.config.ts runs with
// pool: 'threads', where workers share one process object and direct reassignment
// races. stubEnv is restored per-test via vi.unstubAllEnvs() in beforeEach.
function enableFlag() {
  vi.stubEnv(FLAG, 'true');
}
function disableFlag() {
  vi.stubEnv(FLAG, '');
}

async function seedPurchase(
  sql: NeonSqlAdapter,
  over: { userId: string; paymentIntent: string; tokens: number; amountCents: number },
): Promise<void> {
  await sql`
    INSERT INTO token_purchases (user_id, stripe_payment_intent, package, tokens, amount_cents, refunded_cents)
    VALUES (${over.userId}, ${over.paymentIntent}, 'blaze', ${over.tokens}, ${over.amountCents}, 0)
  `;
}

// ── Fake Stripe surface — only the methods these handlers touch ──────────────
type FakeStripe = {
  paymentIntents: { retrieve: ReturnType<typeof vi.fn> };
  charges: { retrieve: ReturnType<typeof vi.fn> };
};

function fakeStripe(over?: {
  paymentIntent?: Partial<Stripe.PaymentIntent> | (() => never);
  charge?: Partial<Stripe.Charge>;
}): FakeStripe {
  return {
    paymentIntents: {
      retrieve: vi.fn(async () => {
        if (typeof over?.paymentIntent === 'function') over.paymentIntent();
        return over?.paymentIntent ?? {};
      }),
    },
    charges: {
      retrieve: vi.fn(async () => over?.charge ?? {}),
    },
  };
}

beforeAll(async () => {
  harnessRef.current = await createTestHarness();
});
afterAll(async () => {
  await harnessRef.current?.close();
});
beforeEach(async () => {
  vi.unstubAllEnvs();
  disableFlag();
  await harness().truncateAll();
});

describe('isRadarReviewHoldEnabled', () => {
  it('is off unless the flag is exactly "true"', () => {
    disableFlag();
    expect(isRadarReviewHoldEnabled()).toBe(false);
    vi.stubEnv(FLAG, 'TRUE');
    expect(isRadarReviewHoldEnabled()).toBe(false);
    vi.stubEnv(FLAG, '1');
    expect(isRadarReviewHoldEnabled()).toBe(false);
    enableFlag();
    expect(isRadarReviewHoldEnabled()).toBe(true);
  });
});

describe('isCheckoutHeldForReview', () => {
  it('returns false (credit now) when the flag is off — even if the PI is flagged', async () => {
    disableFlag();
    const stripe = fakeStripe({ paymentIntent: { review: 'prv_1' } });
    expect(await isCheckoutHeldForReview('pi_1', stripe as unknown as Stripe)).toBe(false);
    expect(stripe.paymentIntents.retrieve).not.toHaveBeenCalled();
  });

  it('holds when paymentIntent.review is set', async () => {
    enableFlag();
    const stripe = fakeStripe({ paymentIntent: { review: 'prv_1', latest_charge: null } });
    expect(await isCheckoutHeldForReview('pi_1', stripe as unknown as Stripe)).toBe(true);
  });

  it('holds when latest_charge.review is set', async () => {
    enableFlag();
    const stripe = fakeStripe({
      paymentIntent: { review: null, latest_charge: { review: 'prv_2' } as Stripe.Charge },
    });
    expect(await isCheckoutHeldForReview('pi_1', stripe as unknown as Stripe)).toBe(true);
  });

  it('holds when latest_charge.outcome.type is manual_review', async () => {
    enableFlag();
    const stripe = fakeStripe({
      paymentIntent: {
        review: null,
        latest_charge: { review: null, outcome: { type: 'manual_review' } } as Stripe.Charge,
      },
    });
    expect(await isCheckoutHeldForReview('pi_1', stripe as unknown as Stripe)).toBe(true);
  });

  it('does NOT hold an unflagged payment', async () => {
    enableFlag();
    const stripe = fakeStripe({
      paymentIntent: {
        review: null,
        latest_charge: { review: null, outcome: { type: 'authorized' } } as Stripe.Charge,
      },
    });
    expect(await isCheckoutHeldForReview('pi_1', stripe as unknown as Stripe)).toBe(false);
  });

  it('fails open (does NOT hold) when the Stripe read throws', async () => {
    enableFlag();
    const stripe = fakeStripe({
      paymentIntent: () => {
        throw new Error('stripe down');
      },
    });
    expect(await isCheckoutHeldForReview('pi_1', stripe as unknown as Stripe)).toBe(false);
  });
});

describe('handleReviewClosed', () => {
  const pkgTokens = TOKEN_PACKAGES.blaze.tokens;

  function reviewClosed(reason: Stripe.Review.ClosedReason, pi = 'pi_held'): Stripe.Review {
    return {
      id: 'prv_close',
      object: 'review',
      closed_reason: reason,
      open: false,
      payment_intent: pi,
    } as unknown as Stripe.Review;
  }

  it('no-ops when the flag is off', async () => {
    disableFlag();
    const { neonSql } = harness();
    const user = await seedUser(neonSql, { addonTokens: 0 });
    const stripe = fakeStripe({ paymentIntent: { metadata: { userId: user.id, package: 'blaze' } } });

    await handleReviewClosed(reviewClosed('approved'), stripe as unknown as Stripe);

    expect(stripe.paymentIntents.retrieve).not.toHaveBeenCalled();
    const row = await getUserRow(neonSql, user.id);
    expect(Number(row?.addon_tokens)).toBe(0);
  });

  it('releases the held grant when closed as approved', async () => {
    enableFlag();
    const { neonSql } = harness();
    const user = await seedUser(neonSql, { addonTokens: 0 });
    const stripe = fakeStripe({
      paymentIntent: { metadata: { userId: user.id, package: 'blaze' } },
    });

    await handleReviewClosed(reviewClosed('approved'), stripe as unknown as Stripe);

    const row = await getUserRow(neonSql, user.id);
    expect(Number(row?.addon_tokens)).toBe(pkgTokens);
  });

  it('persists stripe_customer_id on the approved path so the clawback can find the user', async () => {
    // Data-integrity regression (PF-913 / #8823): the held→approved grant must
    // write the Stripe customer id, otherwise a first-time buyer (no prior
    // stripe_customer_id) is unreachable by the refund/dispute clawback, which
    // resolves the user SOLELY via findUserByStripeCustomer.
    enableFlag();
    const { neonSql } = harness();
    const user = await seedUser(neonSql, { addonTokens: 0, stripeCustomerId: null });
    const stripe = fakeStripe({
      paymentIntent: { metadata: { userId: user.id, package: 'blaze' }, customer: 'cus_held' },
    });

    await handleReviewClosed(reviewClosed('approved'), stripe as unknown as Stripe);

    const row = await getUserRow(neonSql, user.id);
    expect(Number(row?.addon_tokens)).toBe(pkgTokens);
    expect(row?.stripe_customer_id).toBe('cus_held');

    // End-to-end: the clawback path must now resolve this user by customer id
    // and reverse the credit (a later dispute on the approved charge). The
    // approved grant above already created the token_purchases row for
    // pi_held, so no extra seeding is needed.
    const disputeStripe = fakeStripe({
      charge: {
        customer: 'cus_held',
        payment_intent: 'pi_held',
        amount: TOKEN_PACKAGES.blaze.priceCents,
      } as Stripe.Charge,
    });
    await handleDisputeCreated(
      { id: 'dp_held', object: 'dispute', charge: 'ch_held', amount: TOKEN_PACKAGES.blaze.priceCents } as unknown as Stripe.Dispute,
      disputeStripe as unknown as Stripe,
    );

    const afterDispute = await getUserRow(neonSql, user.id);
    expect(Number(afterDispute?.addon_tokens)).toBe(0);
  });

  it('does not overwrite an existing stripe_customer_id on the approved path', async () => {
    enableFlag();
    const { neonSql } = harness();
    const user = await seedUser(neonSql, { addonTokens: 0, stripeCustomerId: 'cus_existing' });
    const stripe = fakeStripe({
      paymentIntent: { metadata: { userId: user.id, package: 'blaze' }, customer: 'cus_other' },
    });

    await handleReviewClosed(reviewClosed('approved'), stripe as unknown as Stripe);

    const row = await getUserRow(neonSql, user.id);
    expect(row?.stripe_customer_id).toBe('cus_existing');
  });

  it('is idempotent across review.closed redelivery (grants exactly once)', async () => {
    enableFlag();
    const { neonSql } = harness();
    const user = await seedUser(neonSql, { addonTokens: 0 });
    const stripe = fakeStripe({
      paymentIntent: { metadata: { userId: user.id, package: 'blaze' } },
    });

    await handleReviewClosed(reviewClosed('approved'), stripe as unknown as Stripe);
    await handleReviewClosed(reviewClosed('approved'), stripe as unknown as Stripe);

    const row = await getUserRow(neonSql, user.id);
    expect(Number(row?.addon_tokens)).toBe(pkgTokens);
  });

  it('grants nothing when closed as refunded_as_fraud', async () => {
    enableFlag();
    const { neonSql } = harness();
    const user = await seedUser(neonSql, { addonTokens: 0 });
    const stripe = fakeStripe({
      paymentIntent: { metadata: { userId: user.id, package: 'blaze' } },
    });

    await handleReviewClosed(reviewClosed('refunded_as_fraud'), stripe as unknown as Stripe);

    expect(stripe.paymentIntents.retrieve).not.toHaveBeenCalled();
    const row = await getUserRow(neonSql, user.id);
    expect(Number(row?.addon_tokens)).toBe(0);
  });

  it('grants nothing when the PI carries no token-pack metadata', async () => {
    enableFlag();
    const { neonSql } = harness();
    const user = await seedUser(neonSql, { addonTokens: 0 });
    const stripe = fakeStripe({ paymentIntent: { metadata: {} } });

    await handleReviewClosed(reviewClosed('approved'), stripe as unknown as Stripe);

    const row = await getUserRow(neonSql, user.id);
    expect(Number(row?.addon_tokens)).toBe(0);
  });
});

describe('handleDisputeCreated', () => {
  function dispute(over: { charge: string; amount: number }): Stripe.Dispute {
    return { id: 'dp_1', object: 'dispute', charge: over.charge, amount: over.amount } as unknown as Stripe.Dispute;
  }

  it('no-ops when the flag is off', async () => {
    disableFlag();
    const { neonSql } = harness();
    const user = await seedUser(neonSql, { addonTokens: 5000, stripeCustomerId: 'cus_d' });
    await seedPurchase(neonSql, { userId: user.id, paymentIntent: 'pi_d', tokens: 5000, amountCents: 4900 });
    const stripe = fakeStripe({
      charge: { customer: 'cus_d', payment_intent: 'pi_d', amount: 4900 } as Stripe.Charge,
    });

    await handleDisputeCreated(dispute({ charge: 'ch_d', amount: 4900 }), stripe as unknown as Stripe);

    const row = await getUserRow(neonSql, user.id);
    expect(Number(row?.addon_tokens)).toBe(5000);
  });

  it('claws back the full granted amount on a full dispute', async () => {
    enableFlag();
    const { neonSql } = harness();
    const user = await seedUser(neonSql, { addonTokens: 5000, stripeCustomerId: 'cus_d2' });
    await seedPurchase(neonSql, { userId: user.id, paymentIntent: 'pi_d2', tokens: 5000, amountCents: 4900 });
    const stripe = fakeStripe({
      charge: { customer: 'cus_d2', payment_intent: 'pi_d2', amount: 4900 } as Stripe.Charge,
    });

    await handleDisputeCreated(dispute({ charge: 'ch_d2', amount: 4900 }), stripe as unknown as Stripe);

    const row = await getUserRow(neonSql, user.id);
    expect(Number(row?.addon_tokens)).toBe(0);
  });

  it('does nothing for an unknown customer', async () => {
    enableFlag();
    const stripe = fakeStripe({
      charge: { customer: 'cus_unknown', payment_intent: 'pi_x', amount: 4900 } as Stripe.Charge,
    });
    // Should resolve without throwing and credit nothing.
    await expect(
      handleDisputeCreated(dispute({ charge: 'ch_x', amount: 4900 }), stripe as unknown as Stripe),
    ).resolves.toBeUndefined();
  });
});
