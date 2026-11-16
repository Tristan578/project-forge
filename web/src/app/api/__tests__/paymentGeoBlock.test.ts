// @vitest-environment node
/**
 * Every route that sells or licenses something refuses a buyer known to be in
 * a sanctioned jurisdiction itself (#9331). Site content is open to everyone,
 * so this is the only up-front refusal there is. The set of purchase routes is
 * DERIVED from the tree: every `app/api/**\/route.ts` that exports a mutating
 * handler and either imports the Stripe client or sits under a `purchase`
 * directory, minus the bypass paths (the Stripe webhook, which checks the
 * billing address at fulfilment instead). A new purchase route therefore joins
 * this suite without anyone remembering to add it, and fails until it calls
 * `sanctionsPurchaseBlock()`.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { GEO_BLOCK_BYPASS_PATHS, SANCTIONS_BLOCK_CODE } from '@/lib/security/sanctionsGeoBlock';
import { makeUser } from '@/test/utils/apiTestUtils';

vi.mock('server-only', () => ({}));

vi.hoisted(() => {
  process.env.STRIPE_PRICE_CREATOR = 'price_creator_mock';
  process.env.STRIPE_PRICE_TOKEN_SPARK = 'price_spark_mock';
});

const { withApiMiddleware, getStripe, checkBotIdGate, requireStepUp, sessionsCreate, portalCreate } = vi.hoisted(() => ({
  withApiMiddleware: vi.fn(),
  getStripe: vi.fn(),
  checkBotIdGate: vi.fn(),
  requireStepUp: vi.fn(),
  sessionsCreate: vi.fn(),
  portalCreate: vi.fn(),
}));

vi.mock('@/lib/api/middleware', () => ({ withApiMiddleware }));
vi.mock('@/lib/billing/stripe-client', () => ({ getStripe }));
vi.mock('@/lib/security/botId', () => ({ checkBotIdGate }));
vi.mock('@/lib/auth/step-up', () => ({ requireStepUp }));
vi.mock('@/lib/db/client', () => ({
  getDb: vi.fn(() => { throw new Error('db must not be reached'); }),
  getNeonSql: vi.fn(() => { throw new Error('db must not be reached'); }),
  queryWithResilience: vi.fn(() => { throw new Error('db must not be reached'); }),
}));
vi.mock('@/lib/monitoring/sentry-server', () => ({ captureException: vi.fn() }));

const apiDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name !== '__tests__') out.push(...walk(full));
    } else if (/^route\.(ts|tsx|js|jsx|mjs)$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

function urlPathOf(file: string): string {
  const rel = path.relative(apiDir, path.dirname(file)).split(path.sep).join('/');
  return `/api/${rel}`.replace(/\[([^\]]+)\]/g, 'x');
}

const PURCHASE_ROUTES = walk(apiDir)
  .filter((file) => {
    const src = readFileSync(file, 'utf8');
    const mutating = /^export const (POST|PUT|PATCH)\b/m.test(src);
    const stripe = /from '@\/lib\/billing\/stripe-client'/.test(src);
    const purchase = path.dirname(file).split(path.sep).includes('purchase');
    return mutating && (stripe || purchase);
  })
  .filter((file) => !GEO_BLOCK_BYPASS_PATHS.some((p) => urlPathOf(file) === p || urlPathOf(file).startsWith(`${p}/`)))
  .map((file) => ({ file, urlPath: urlPathOf(file) }));

type Handler = (req: NextRequest, ctx: unknown) => Promise<Response>;
const ctx = { params: Promise.resolve({ id: 'asset-1' }) };

function reqFrom(urlPath: string, country?: string, body: unknown = {}): NextRequest {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (country) headers['x-vercel-ip-country'] = country;
  return new NextRequest(`https://www.spawnforge.ai${urlPath}`, { method: 'POST', body: JSON.stringify(body), headers });
}

async function load(file: string): Promise<Handler> {
  return ((await import(file)) as { POST: Handler }).POST;
}

function signedIn(user: ReturnType<typeof makeUser>, body?: unknown) {
  withApiMiddleware.mockResolvedValue({ authContext: { user, clerkId: user.clerkId }, body });
}

describe('purchase routes refuse a buyer known to be in a sanctioned jurisdiction (#9331)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    withApiMiddleware.mockResolvedValue({ error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) });
    checkBotIdGate.mockResolvedValue(null);
    requireStepUp.mockResolvedValue({ ok: true });
    sessionsCreate.mockResolvedValue({ id: 'cs_1', url: 'https://checkout.stripe.test/cs_1' });
    portalCreate.mockResolvedValue({ url: 'https://billing.stripe.test/p_1' });
    getStripe.mockReturnValue({
      checkout: { sessions: { create: sessionsCreate } },
      billingPortal: { sessions: { create: portalCreate } },
    });
  });

  it('derives the purchase surface it is meant to cover (vacuity guard)', () => {
    expect(PURCHASE_ROUTES.map((r) => r.urlPath).sort()).toEqual([
      '/api/billing/checkout',
      '/api/billing/portal',
      '/api/marketplace/assets/x/purchase',
      '/api/tokens/purchase',
    ]);
  });

  it.each(PURCHASE_ROUTES.map((r) => [r.urlPath, r.file] as const))(
    '%s answers 451 "purchases are not available" for a listed country, before auth, Stripe or the database',
    async (urlPath, file) => {
      const res = await (await load(file))(reqFrom(urlPath, 'IR'), ctx);
      expect(res.status).toBe(451);
      expect(await res.json()).toEqual({ error: 'Purchases are not available in your region.', code: SANCTIONS_BLOCK_CODE });
      expect(withApiMiddleware).not.toHaveBeenCalled();
      expect(getStripe).not.toHaveBeenCalled();
      expect(checkBotIdGate).not.toHaveBeenCalled();
    },
  );

  it.each(PURCHASE_ROUTES.map((r) => [r.urlPath, r.file] as const))(
    '%s still reaches its normal checks for an allowed country (control)',
    async (urlPath, file) => {
      const res = await (await load(file))(reqFrom(urlPath, 'US'), ctx);
      expect(res.status).not.toBe(451);
      expect(withApiMiddleware).toHaveBeenCalledTimes(1);
    },
  );

  it.each(PURCHASE_ROUTES.map((r) => [r.urlPath, r.file] as const))(
    '%s does NOT refuse a buyer with no country header (unknown is not restricted)',
    async (urlPath, file) => {
      const res = await (await load(file))(reqFrom(urlPath), ctx);
      expect(res.status).not.toBe(451);
      expect(withApiMiddleware).toHaveBeenCalledTimes(1);
    },
  );
});

describe('billing portal: the cancel flow stays open to every country', () => {
  const portal = () => load(path.join(apiDir, 'billing/portal/route.ts'));

  beforeEach(() => {
    vi.clearAllMocks();
    requireStepUp.mockResolvedValue({ ok: true });
    portalCreate.mockResolvedValue({ url: 'https://billing.stripe.test/p_1' });
    getStripe.mockReturnValue({ billingPortal: { sessions: { create: portalCreate } } });
  });

  it('opens the cancel deep link for a customer in a listed country', async () => {
    signedIn(makeUser({ stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_1' }));
    const res = await (await portal())(reqFrom('/api/billing/portal?flow=cancel', 'IR'), ctx);
    expect(res.status).toBe(200);
    expect(portalCreate).toHaveBeenCalledWith(
      expect.objectContaining({ flow_data: expect.objectContaining({ type: 'subscription_cancel' }) }),
    );
  });

  it('refuses the cancel link when it would open the portal home (no subscription to cancel)', async () => {
    signedIn(makeUser({ stripeCustomerId: 'cus_1', stripeSubscriptionId: null }));
    const res = await (await portal())(reqFrom('/api/billing/portal?flow=cancel', 'IR'), ctx);
    expect(res.status).toBe(451);
    expect(portalCreate).not.toHaveBeenCalled();
  });

  it('refuses the portal home (plan switching) for a listed country, and opens it for an unlisted one', async () => {
    signedIn(makeUser({ stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_1' }));
    expect((await (await portal())(reqFrom('/api/billing/portal', 'RU'), ctx)).status).toBe(451);
    expect(portalCreate).not.toHaveBeenCalled();
    expect((await (await portal())(reqFrom('/api/billing/portal', 'US'), ctx)).status).toBe(200);
    expect(portalCreate).toHaveBeenCalledTimes(1);
  });
});

describe('Checkout always collects the billing address the webhook checks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    checkBotIdGate.mockResolvedValue(null);
    requireStepUp.mockResolvedValue({ ok: true });
    sessionsCreate.mockResolvedValue({ id: 'cs_1', url: 'https://checkout.stripe.test/cs_1' });
    getStripe.mockReturnValue({ checkout: { sessions: { create: sessionsCreate } } });
  });

  it('subscription checkout requires the address and saves it on the customer', async () => {
    signedIn(makeUser({ stripeCustomerId: 'cus_1' }), { tier: 'creator' });
    const res = await (await load(path.join(apiDir, 'billing/checkout/route.ts')))(reqFrom('/api/billing/checkout', undefined, { tier: 'creator' }), ctx);
    expect(res.status).toBe(200);
    expect(sessionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ billing_address_collection: 'required', customer_update: expect.objectContaining({ address: 'auto' }) }),
    );
  });

  it('token checkout requires the address; saves it only on an existing customer', async () => {
    const tokens = await load(path.join(apiDir, 'tokens/purchase/route.ts'));
    signedIn(makeUser({ tier: 'creator', stripeCustomerId: 'cus_1' }), { package: 'spark' });
    expect((await tokens(reqFrom('/api/tokens/purchase', undefined, { package: 'spark' }), ctx)).status).toBe(200);
    expect(sessionsCreate).toHaveBeenLastCalledWith(
      expect.objectContaining({ billing_address_collection: 'required', customer: 'cus_1', customer_update: { address: 'auto' } }),
    );

    signedIn(makeUser({ tier: 'creator', stripeCustomerId: null }), { package: 'spark' });
    expect((await tokens(reqFrom('/api/tokens/purchase', undefined, { package: 'spark' }), ctx)).status).toBe(200);
    const params = sessionsCreate.mock.lastCall?.[0] as Record<string, unknown>;
    expect(params.billing_address_collection).toBe('required');
    expect(params).not.toHaveProperty('customer_update');
  });
});
