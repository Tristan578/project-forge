// @vitest-environment node
/**
 * Sanctions check at fulfilment (#9331). The purchase routes let a buyer with
 * an unknown country through to Checkout, which collects the billing address;
 * the webhook must then grant nothing to a listed address (or, for a token
 * pack, a listed card country), refund the payment and cancel a subscription.
 * Runs the real webhook route and the real `sanctionsFulfilment` module
 * against a mocked Stripe client.
 */
vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  constructEvent: vi.fn(),
  customersRetrieve: vi.fn(),
  paymentIntentsRetrieve: vi.fn(),
  chargesUpdate: vi.fn(),
  refundsCreate: vi.fn(),
  subscriptionsRetrieve: vi.fn(),
  subscriptionsCancel: vi.fn(),
  invoicePaymentsList: vi.fn(),
  claimEvent: vi.fn(),
  releaseEvent: vi.fn(),
  finalizeEvent: vi.fn(),
  creditAddonTokens: vi.fn(),
  isCheckoutHeldForReview: vi.fn(),
  handleSubscriptionCreated: vi.fn(),
  handleSubscriptionUpdated: vi.fn(),
  handleEntitlementsUpdated: vi.fn(),
  handleChargeRefunded: vi.fn(),
}));

vi.mock('stripe', () => {
  function StripeMock() {
    return {
      webhooks: { constructEvent: h.constructEvent },
      customers: { retrieve: h.customersRetrieve },
      paymentIntents: { retrieve: h.paymentIntentsRetrieve },
      charges: { update: h.chargesUpdate },
      refunds: { create: h.refundsCreate },
      subscriptions: { retrieve: h.subscriptionsRetrieve, cancel: h.subscriptionsCancel },
      invoicePayments: { list: h.invoicePaymentsList },
    };
  }
  return { default: StripeMock };
});

vi.mock('@/lib/db/client', () => ({
  queryWithResilience: vi.fn((fn: () => unknown) => fn()),
  getDb: vi.fn(() => ({
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn(() => Promise.resolve([])),
  })),
}));
vi.mock('@/lib/db/schema', () => ({ users: {}, webhookEvents: { eventId: 'eventId' } }));
vi.mock('drizzle-orm', () => ({ eq: vi.fn(), and: vi.fn(), gt: vi.fn(), lt: vi.fn(), sql: vi.fn() }));
vi.mock('@/lib/tokens/service', () => ({ creditAddonTokens: h.creditAddonTokens }));
vi.mock('@/lib/auth/user-service', () => ({ updateUserStripe: vi.fn() }));
vi.mock('@/lib/monitoring/sentry-server', () => ({
  captureException: vi.fn(),
  sentryLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('@/lib/billing/webhookIdempotency', () => ({
  claimEvent: h.claimEvent,
  releaseEvent: h.releaseEvent,
  finalizeEvent: h.finalizeEvent,
}));
vi.mock('@/lib/billing/subscription-lifecycle', () => ({
  handleSubscriptionCreated: h.handleSubscriptionCreated,
  handleSubscriptionUpdated: h.handleSubscriptionUpdated,
  handleSubscriptionDeleted: vi.fn(),
  handleInvoicePaid: vi.fn(),
  handleInvoicePaymentFailed: vi.fn(),
  handleChargeRefunded: h.handleChargeRefunded,
  handleEntitlementsUpdated: h.handleEntitlementsUpdated,
}));
vi.mock('@/lib/billing/radar-review', () => ({
  isCheckoutHeldForReview: h.isCheckoutHeldForReview,
  handleReviewOpened: vi.fn(),
  handleReviewClosed: vi.fn(),
  handleDisputeCreated: vi.fn(),
}));

import { POST } from '../route';
import { SANCTIONS_REFUND_METADATA_KEY } from '@/lib/billing/sanctionsFulfilment';

function deliver(type: string, object: unknown): Promise<Response> {
  h.constructEvent.mockReturnValue({ id: `evt_${type}`, type, data: { object } });
  return POST(new Request('http://localhost/api/stripe/webhook', {
    method: 'POST',
    body: '{}',
    headers: { 'stripe-signature': 'sig' },
  }));
}

function tokenSession(address: Record<string, unknown> | null) {
  return {
    id: 'cs_tok',
    mode: 'payment',
    payment_intent: 'pi_tok',
    customer: 'cus_1',
    customer_details: { address },
    metadata: { userId: 'user_1', package: 'spark' },
  };
}

function piWithCard(country: string | null, extra: Record<string, unknown> = {}) {
  return {
    id: 'pi_tok',
    latest_charge: { id: 'ch_tok', refunded: false, metadata: {}, payment_method_details: { card: { country } }, ...extra },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
  process.env.STRIPE_SECRET_KEY = 'sk_test';
  process.env.STRIPE_PRICE_STARTER = 'price_starter';
  process.env.STRIPE_PRICE_CREATOR = 'price_creator';
  process.env.STRIPE_PRICE_STUDIO = 'price_studio';
  h.claimEvent.mockResolvedValue(true);
  h.isCheckoutHeldForReview.mockResolvedValue(false);
  h.paymentIntentsRetrieve.mockResolvedValue(piWithCard('US'));
  h.chargesUpdate.mockResolvedValue({});
  h.refundsCreate.mockResolvedValue({ id: 're_1' });
  h.customersRetrieve.mockResolvedValue({ id: 'cus_1', address: { country: 'US', state: 'NE' } });
  h.subscriptionsRetrieve.mockResolvedValue({ id: 'sub_1', status: 'active' });
  h.subscriptionsCancel.mockResolvedValue({ id: 'sub_1', status: 'canceled' });
  h.invoicePaymentsList.mockResolvedValue({ data: [{ payment: { type: 'payment_intent', payment_intent: 'pi_sub' } }] });
});

describe('token pack (checkout.session.completed, mode payment)', () => {
  it('credits a buyer whose billing address and card are unlisted', async () => {
    const res = await deliver('checkout.session.completed', tokenSession({ country: 'US', state: 'NE' }));
    expect(res.status).toBe(200);
    expect(h.creditAddonTokens).toHaveBeenCalledWith('user_1', 'spark', 'pi_tok');
    expect(h.refundsCreate).not.toHaveBeenCalled();
  });

  it('refunds instead of crediting when the billing address is listed', async () => {
    const res = await deliver('checkout.session.completed', tokenSession({ country: 'IR', state: null }));
    expect(res.status).toBe(200);
    expect(h.creditAddonTokens).not.toHaveBeenCalled();
    // The charge is marked first, so the charge.refunded it causes claws back nothing.
    expect(h.chargesUpdate).toHaveBeenCalledWith('ch_tok', { metadata: { [SANCTIONS_REFUND_METADATA_KEY]: 'IR' } });
    expect(h.refundsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ payment_intent: 'pi_tok' }),
      { idempotencyKey: 'sanctions-refund:pi_tok' },
    );
    expect(h.chargesUpdate.mock.invocationCallOrder[0]).toBeLessThan(h.refundsCreate.mock.invocationCallOrder[0]);
  });

  it('refunds a listed Ukrainian region named in the address, and credits Kyiv', async () => {
    await deliver('checkout.session.completed', tokenSession({ country: 'UA', state: 'Avtonomna Respublika Krym' }));
    expect(h.refundsCreate).toHaveBeenCalledTimes(1);
    expect(h.creditAddonTokens).not.toHaveBeenCalled();

    vi.clearAllMocks();
    h.claimEvent.mockResolvedValue(true);
    h.paymentIntentsRetrieve.mockResolvedValue(piWithCard('UA'));
    await deliver('checkout.session.completed', tokenSession({ country: 'UA', state: 'Kyiv' }));
    expect(h.refundsCreate).not.toHaveBeenCalled();
    expect(h.creditAddonTokens).toHaveBeenCalledTimes(1);
  });

  it('refunds when the address is unlisted but the card was issued in a listed country', async () => {
    h.paymentIntentsRetrieve.mockResolvedValue(piWithCard('RU'));
    await deliver('checkout.session.completed', tokenSession({ country: 'US', state: 'NE' }));
    expect(h.creditAddonTokens).not.toHaveBeenCalled();
    expect(h.refundsCreate).toHaveBeenCalledTimes(1);
  });

  it('credits when nothing is known (no address, card lookup fails): unknown is not refused', async () => {
    h.paymentIntentsRetrieve.mockRejectedValue(new Error('stripe down'));
    const res = await deliver('checkout.session.completed', tokenSession(null));
    expect(res.status).toBe(200);
    expect(h.creditAddonTokens).toHaveBeenCalledTimes(1);
    expect(h.refundsCreate).not.toHaveBeenCalled();
  });

  it('answers 500 and releases the event when the refund fails, so Stripe redelivers', async () => {
    h.refundsCreate.mockRejectedValue(Object.assign(new Error('api error'), { code: 'api_error' }));
    const res = await deliver('checkout.session.completed', tokenSession({ country: 'KP', state: null }));
    expect(res.status).toBe(500);
    expect(h.releaseEvent).toHaveBeenCalled();
    expect(h.creditAddonTokens).not.toHaveBeenCalled();
  });

  it('treats an already-refunded charge as done on redelivery', async () => {
    h.refundsCreate.mockRejectedValue(Object.assign(new Error('already'), { code: 'charge_already_refunded' }));
    const res = await deliver('checkout.session.completed', tokenSession({ country: 'KP', state: null }));
    expect(res.status).toBe(200);
    expect(h.creditAddonTokens).not.toHaveBeenCalled();
  });
});

describe('subscription (checkout.session.completed, mode subscription)', () => {
  const subSession = (country: string) => ({
    id: 'cs_sub',
    mode: 'subscription',
    subscription: 'sub_1',
    invoice: 'in_1',
    customer: 'cus_1',
    customer_details: { address: { country, state: null } },
    metadata: { userId: 'user_1', tier: 'creator' },
  });

  it('cancels the subscription and refunds its first invoice for a listed address', async () => {
    const res = await deliver('checkout.session.completed', subSession('CU'));
    expect(res.status).toBe(200);
    expect(h.subscriptionsCancel).toHaveBeenCalledWith('sub_1', expect.anything());
    expect(h.invoicePaymentsList).toHaveBeenCalledWith({ invoice: 'in_1', status: 'paid' });
    expect(h.refundsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ payment_intent: 'pi_sub' }),
      { idempotencyKey: 'sanctions-refund:pi_sub' },
    );
  });

  it('does not cancel an already-cancelled subscription again on redelivery', async () => {
    h.subscriptionsRetrieve.mockResolvedValue({ id: 'sub_1', status: 'canceled' });
    await deliver('checkout.session.completed', subSession('CU'));
    expect(h.subscriptionsCancel).not.toHaveBeenCalled();
    expect(h.refundsCreate).toHaveBeenCalledTimes(1);
  });

  it('leaves an unlisted subscription alone', async () => {
    await deliver('checkout.session.completed', subSession('GB'));
    expect(h.subscriptionsCancel).not.toHaveBeenCalled();
    expect(h.refundsCreate).not.toHaveBeenCalled();
  });
});

describe('plan grants for a customer with a listed saved address', () => {
  const sub = { id: 'sub_1', customer: 'cus_1', status: 'active', items: { data: [{ price: { id: 'price_studio' } }] } };

  it('customer.subscription.created grants no plan', async () => {
    h.customersRetrieve.mockResolvedValue({ id: 'cus_1', address: { country: 'SY', state: null } });
    expect((await deliver('customer.subscription.created', sub)).status).toBe(200);
    expect(h.handleSubscriptionCreated).not.toHaveBeenCalled();
  });

  it('customer.subscription.created grants the plan for an unlisted address, and when the lookup fails', async () => {
    await deliver('customer.subscription.created', sub);
    expect(h.handleSubscriptionCreated).toHaveBeenCalledTimes(1);
    h.customersRetrieve.mockRejectedValue(new Error('stripe down'));
    await deliver('customer.subscription.created', sub);
    expect(h.handleSubscriptionCreated).toHaveBeenCalledTimes(2);
  });

  it('customer.subscription.updated refuses an upgrade for a listed address', async () => {
    h.customersRetrieve.mockResolvedValue({ id: 'cus_1', address: { country: 'VE', state: null } });
    await deliver('customer.subscription.updated', sub);
    const options = h.handleSubscriptionUpdated.mock.lastCall?.[4] as { refuseUpgrade: () => Promise<boolean> };
    await expect(options.refuseUpgrade()).resolves.toBe(true);
    h.customersRetrieve.mockResolvedValue({ id: 'cus_1', address: { country: 'US', state: null } });
    await expect(options.refuseUpgrade()).resolves.toBe(false);
  });

  it('entitlements: a non-empty summary is not applied for a listed address; an empty one always is', async () => {
    h.customersRetrieve.mockResolvedValue({ id: 'cus_1', address: { country: 'BY', state: null } });
    await deliver('entitlements.active_entitlement_summary.updated', { customer: 'cus_1', entitlements: { data: [{ lookup_key: 'ai' }] } });
    expect(h.handleEntitlementsUpdated).not.toHaveBeenCalled();
    await deliver('entitlements.active_entitlement_summary.updated', { customer: 'cus_1', entitlements: { data: [] } });
    expect(h.handleEntitlementsUpdated).toHaveBeenCalledTimes(1);
  });
});

describe('charge.refunded', () => {
  const charge = (metadata: Record<string, string>) => ({
    id: 'ch_1', customer: 'cus_1', payment_intent: 'pi_1', amount: 999, amount_refunded: 999, metadata,
  });

  it('claws back nothing for a sanctions refund (nothing was granted)', async () => {
    await deliver('charge.refunded', charge({ [SANCTIONS_REFUND_METADATA_KEY]: 'IR' }));
    expect(h.handleChargeRefunded).not.toHaveBeenCalled();
  });

  it('reverses as before for any other refund', async () => {
    await deliver('charge.refunded', charge({}));
    expect(h.handleChargeRefunded).toHaveBeenCalledTimes(1);
  });
});
