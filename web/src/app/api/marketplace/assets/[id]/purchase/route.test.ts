vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// Mocks — must match the actual imports in route.ts
// ---------------------------------------------------------------------------

const mockInsert = vi.fn();
const mockUpdate = vi.fn();
const mockSelect = vi.fn();
const mockDelete = vi.fn();

// Records each neonSql.transaction([...]) call. Each element is the array of
// statements passed to that transaction. mockTransactionResults supplies the
// resolved value (first statement's RETURNING) per invocation.
const mockTransactionCalls: unknown[][] = [];
let mockTransactionResults: unknown[][] = [];
let mockTransactionIdx = 0;

// A neonSql tagged-template stub: neonSql`...` returns a marker object; the
// route never inspects the SQL text in these unit tests — only the atomic
// grouping (single transaction call) matters for the regression assertion.
const mockNeonSql = Object.assign(
  vi.fn((strings: TemplateStringsArray, ..._vals: unknown[]) => ({ sql: strings.join('?') })),
  {
    transaction: vi.fn((statements: unknown[]) => {
      mockTransactionCalls.push(statements);
      const result = mockTransactionResults[mockTransactionIdx++] ?? [];
      return Promise.resolve(result);
    }),
  },
);

const mockUser = {
  id: 'user_1',
  tier: 'creator',
  displayName: 'Test',
  monthlyTokens: 1000,
  monthlyTokensUsed: 0,
  addonTokens: 500,
  earnedCredits: 200,
  stripeCustomerId: null,
  email: 'test@test.com',
};

vi.mock('@/lib/api/middleware', () => ({
  withApiMiddleware: vi.fn().mockResolvedValue({
    error: undefined,
    userId: 'buyer-1',
    authContext: {
      user: { ...mockUser },
    },
    body: undefined,
  }),
}));

vi.mock('@/lib/db/client', () => ({
  queryWithResilience: vi.fn((fn: () => unknown) => fn()),
  getDb: vi.fn(() => ({
    insert: mockInsert,
    update: mockUpdate,
    select: mockSelect,
    delete: mockDelete,
  })),
  getNeonSql: vi.fn(() => mockNeonSql),
}));

vi.mock('@/lib/monitoring/sentry-server', () => ({
  captureException: vi.fn(),
}));

vi.mock('@/lib/api/errors', () => ({
  validationError: vi.fn((msg: string) => new Response(JSON.stringify({ error: msg }), { status: 400 })),
  conflict: vi.fn((msg: string) => new Response(JSON.stringify({ error: msg }), { status: 409 })),
  forbidden: vi.fn((msg: string) => new Response(JSON.stringify({ error: msg }), { status: 403 })),
  paymentRequired: vi.fn((msg: string) => new Response(JSON.stringify({ error: msg }), { status: 402 })),
  internalError: vi.fn((msg: string) => new Response(JSON.stringify({ error: msg }), { status: 500 })),
}));

vi.mock('@/lib/db/schema', () => ({
  users: { id: 'id', earnedCredits: 'earnedCredits', addonTokens: 'addonTokens', monthlyTokens: 'monthlyTokens', monthlyTokensUsed: 'monthlyTokensUsed' },
  marketplaceAssets: { id: 'id', sellerId: 'sellerId', status: 'status', priceTokens: 'priceTokens', downloadCount: 'downloadCount', assetFileUrl: 'assetFileUrl', license: 'license' },
  assetPurchases: { id: 'id', buyerId: 'buyerId', assetId: 'assetId', priceTokens: 'priceTokens', license: 'license' },
  creditTransactions: { id: 'id', userId: 'userId', transactionType: 'transactionType', amount: 'amount', balanceAfter: 'balanceAfter', source: 'source', referenceId: 'referenceId' },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((_col, val) => ({ type: 'eq', val })),
  and: vi.fn((...args: unknown[]) => ({ type: 'and', args })),
  sql: Object.assign(
    vi.fn((...args: unknown[]) => ({ type: 'sql', args })),
    { raw: vi.fn((s: string) => ({ type: 'sql_raw', s })) },
  ),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function selectChain(results: unknown[]) {
  return {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(results),
  };
}

function insertChain(returning: unknown[] = []) {
  return {
    values: vi.fn().mockReturnValue({
      onConflictDoNothing: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue(returning),
      }),
    }),
  };
}

function updateChain(returning: unknown[] = [{ id: 'ok' }]) {
  return {
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue(returning),
      }),
    }),
  };
}

const { withApiMiddleware } = await import('@/lib/api/middleware');

describe('POST /api/marketplace/assets/[id]/purchase', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    mockTransactionCalls.length = 0;
    mockTransactionResults = [];
    mockTransactionIdx = 0;

    // Reset withApiMiddleware to default (authenticated user)
    vi.mocked(withApiMiddleware).mockResolvedValue({
      error: undefined,
      userId: 'buyer-1',
      authContext: { user: { ...mockUser } },
      body: undefined,
    } as never);
  });

  it('should return 401 when not authenticated', async () => {
    vi.mocked(withApiMiddleware).mockResolvedValue({
      error: new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }),
      authContext: null,
    } as never);

    const { POST } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/marketplace/assets/a1/purchase');
    const res = await POST(req, { params: Promise.resolve({ id: 'a1' }) });

    expect(res.status).toBe(401);
  });

  it('should return 429 when rate limited', async () => {
    vi.mocked(withApiMiddleware).mockResolvedValue({
      error: new Response(JSON.stringify({ error: 'Rate limited' }), { status: 429 }),
      authContext: null,
    } as never);

    const { POST } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/marketplace/assets/a1/purchase');
    const res = await POST(req, { params: Promise.resolve({ id: 'a1' }) });

    expect(res.status).toBe(429);
  });

  it('should return 404 when asset not found', async () => {
    mockSelect.mockReturnValueOnce(selectChain([]));

    const { POST } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/marketplace/assets/missing/purchase');
    const res = await POST(req, { params: Promise.resolve({ id: 'missing' }) });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe('Asset not found');
  });

  it('should return 409 when already purchased (paid, deduction txn exists)', async () => {
    mockSelect
      .mockReturnValueOnce(selectChain([{ id: 'a1', status: 'published', sellerId: 'other-user', priceTokens: 100, assetFileUrl: 'url', license: 'standard', downloadCount: 0 }]))
      .mockReturnValueOnce(selectChain([{ priceTokens: 100 }]))  // existing purchase row (paid)
      .mockReturnValueOnce(selectChain([{ id: 'txn-existing' }])); // completed deduction txn → fully charged

    const { POST } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/marketplace/assets/a1/purchase');
    const res = await POST(req, { params: Promise.resolve({ id: 'a1' }) });
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toBe('Already purchased');
    // No charge attempted — already complete.
    expect(mockNeonSql.transaction).not.toHaveBeenCalled();
  });

  it('should return 409 when already purchased (free asset, row exists)', async () => {
    mockSelect
      .mockReturnValueOnce(selectChain([{ id: 'a1', status: 'published', sellerId: 'other-user', priceTokens: 0, assetFileUrl: 'url', license: 'standard', downloadCount: 0 }]))
      .mockReturnValueOnce(selectChain([{ priceTokens: 0 }]));  // existing free purchase row

    const { POST } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/marketplace/assets/a1/purchase');
    const res = await POST(req, { params: Promise.resolve({ id: 'a1' }) });
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toBe('Already purchased');
  });

  it('should return 403 when buying own asset', async () => {
    mockSelect
      .mockReturnValueOnce(selectChain([{ id: 'a1', status: 'published', sellerId: 'user_1', priceTokens: 100 }]))
      .mockReturnValueOnce(selectChain([]));

    const { POST } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/marketplace/assets/a1/purchase');
    const res = await POST(req, { params: Promise.resolve({ id: 'a1' }) });
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toBe('Cannot purchase your own asset');
  });

  it('should handle free asset purchase', async () => {
    mockSelect
      .mockReturnValueOnce(selectChain([{ id: 'a1', status: 'published', sellerId: 'other', priceTokens: 0, assetFileUrl: 'https://cdn.example.com/file', license: 'standard', downloadCount: 5 }]))
      .mockReturnValueOnce(selectChain([]));
    mockInsert.mockReturnValueOnce(insertChain([{ id: 'purchase-1' }]));
    mockUpdate.mockReturnValueOnce(updateChain());

    const { POST } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/marketplace/assets/a1/purchase');
    const res = await POST(req, { params: Promise.resolve({ id: 'a1' }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.downloadUrl).toBe('https://cdn.example.com/file');
  });

  it('should return 400 when asset is not published', async () => {
    mockSelect
      .mockReturnValueOnce(selectChain([{ id: 'a1', status: 'draft', sellerId: 'other', priceTokens: 100 }]));

    const { POST } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/marketplace/assets/a1/purchase');
    const res = await POST(req, { params: Promise.resolve({ id: 'a1' }) });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('Asset not available');
  });

  it('should return 404 when seller not found (paid asset)', async () => {
    mockSelect
      .mockReturnValueOnce(selectChain([{ id: 'a1', status: 'published', sellerId: 'ghost-seller', priceTokens: 100, assetFileUrl: 'url', license: 'standard', downloadCount: 0 }]))
      .mockReturnValueOnce(selectChain([]))  // no existing purchase
      .mockReturnValueOnce(selectChain([])); // seller not found

    const { POST } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/marketplace/assets/a1/purchase');
    const res = await POST(req, { params: Promise.resolve({ id: 'a1' }) });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe('Seller not found');
    // No money moved — bailed before the atomic transaction.
    expect(mockNeonSql.transaction).not.toHaveBeenCalled();
  });

  it('completes a paid purchase via ONE atomic neonSql.transaction', async () => {
    mockSelect
      .mockReturnValueOnce(selectChain([{ id: 'a1', status: 'published', sellerId: 'other', priceTokens: 100, assetFileUrl: 'https://cdn.example.com/f.glb', license: 'standard', downloadCount: 0 }]))
      .mockReturnValueOnce(selectChain([]))  // no existing purchase
      .mockReturnValueOnce(selectChain([{ id: 'seller-1', earnedCredits: 200, addonTokens: 0, monthlyTokens: 0, monthlyTokensUsed: 0 }])); // seller found
    // The buyer-charge statement RETURNS the buyer row id → fully committed.
    mockTransactionResults = [[[{ id: 'buyer-1' }], [], []]];

    const { POST } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/marketplace/assets/a1/purchase');
    const res = await POST(req, { params: Promise.resolve({ id: 'a1' }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.tokensCharged).toBe(100);
    expect(body.sellerEarnings).toBe(70);

    // REGRESSION (#8636): the deduction + assetPurchases insert + balance
    // mutation must all run inside a SINGLE neonSql.transaction([...]) so a
    // crash can never leave a charged buyer with no deduction row. The old
    // code issued these as separate getDb() statements — assert the atomic
    // grouping AND that no per-statement getDb() write path was used for the
    // money movement.
    expect(mockNeonSql.transaction).toHaveBeenCalledTimes(1);
    expect(mockTransactionCalls[0].length).toBeGreaterThanOrEqual(3);
    // No standalone balance UPDATE, deduction INSERT, or rollback DELETE.
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('deducts marketplace purchases earned_credits → addon_tokens → monthly (regression #8782)', async () => {
    // The #8636 atomic rewrite accidentally flipped the buyer deduction order to
    // monthly→addon→earned, the INVERSE of the original route. earned_credits is
    // a marketplace-local currency, so a buyer must spend it FIRST on purchases
    // (before paid subscription tokens). Assert the priority encoded in the
    // buyer-charge SQL so the order can never silently flip again. The neonSql
    // stub records each statement's text (template strings joined with '?'), so
    // the first transaction statement IS the buyer charge.
    mockSelect
      .mockReturnValueOnce(selectChain([{ id: 'a1', status: 'published', sellerId: 'other', priceTokens: 100, assetFileUrl: 'https://cdn.example.com/f.glb', license: 'standard', downloadCount: 0 }]))
      .mockReturnValueOnce(selectChain([]))  // no existing purchase
      .mockReturnValueOnce(selectChain([{ id: 'seller-1', earnedCredits: 200, addonTokens: 0, monthlyTokens: 0, monthlyTokensUsed: 0 }])); // seller found
    mockTransactionResults = [[[{ id: 'buyer-1' }], [], []]];

    const { POST } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/marketplace/assets/a1/purchase');
    const res = await POST(req, { params: Promise.resolve({ id: 'a1' }) });
    expect(res.status).toBe(200);

    const buyerSql = (mockTransactionCalls[0][0] as { sql: string }).sql;
    const earnedAt = buyerSql.indexOf('earned_credits = earned_credits');
    const addonAt = buyerSql.indexOf('addon_tokens = addon_tokens');
    const monthlyAt = buyerSql.indexOf('monthly_tokens_used = monthly_tokens_used');

    // All three pools are mutated.
    expect(earnedAt).toBeGreaterThanOrEqual(0);
    expect(addonAt).toBeGreaterThanOrEqual(0);
    expect(monthlyAt).toBeGreaterThanOrEqual(0);
    // Priority order, top to bottom: earned FIRST, then addon, then monthly.
    expect(earnedAt).toBeLessThan(addonAt);
    expect(addonAt).toBeLessThan(monthlyAt);
    // earned_credits takes first dibs on the full price (no leftover gate).
    expect(buyerSql).toMatch(/earned_credits = earned_credits\s*- LEAST\(\?, earned_credits\)/);
    // monthly is the LAST resort — gated on the leftover after BOTH earned + addon.
    expect(buyerSql).toMatch(/\? - earned_credits - addon_tokens/);
    // The pre-fix monthly-first signature must be gone.
    expect(buyerSql).not.toMatch(/monthly_tokens_used = monthly_tokens_used\s*\+ LEAST\(\?, GREATEST/);
  });

  it('returns 409 (no partial charge) when the atomic transaction commits nothing', async () => {
    // Buyer balance changed after the pre-check OR the idempotency gate
    // conflicted: the first transaction statement RETURNS no row. Because the
    // whole charge is atomic there is no orphan purchase row to roll back —
    // and crucially no balance was deducted, so the buyer can safely retry.
    mockSelect
      .mockReturnValueOnce(selectChain([{ id: 'a1', status: 'published', sellerId: 'other', priceTokens: 100, assetFileUrl: 'url', license: 'standard', downloadCount: 0 }]))
      .mockReturnValueOnce(selectChain([]))  // no existing purchase
      .mockReturnValueOnce(selectChain([{ id: 'seller-1', earnedCredits: 200, addonTokens: 0, monthlyTokens: 0, monthlyTokensUsed: 0 }])) // seller found
      .mockReturnValueOnce(selectChain([])); // no completed deduction txn → safe to retry
    mockTransactionResults = [[[], [], []]]; // buyer-charge statement returned no row

    const { POST } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/marketplace/assets/a1/purchase');
    const res = await POST(req, { params: Promise.resolve({ id: 'a1' }) });
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toBe('Balance changed, please retry');
    // The atomic transaction is the ONLY write path — no manual rollback DELETE.
    expect(mockNeonSql.transaction).toHaveBeenCalledTimes(1);
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('recovers a pre-fix ORPHAN purchase row (charged buyer can finally complete)', async () => {
    // #8636 core scenario: a prior interrupted purchase left an asset_purchases
    // row WITHOUT a deduction credit_transaction. Old code 409'd "Already
    // purchased" forever. The fix must fall through and re-attempt the charge
    // idempotently when no completed deduction exists.
    mockSelect
      .mockReturnValueOnce(selectChain([{ id: 'a1', status: 'published', sellerId: 'other', priceTokens: 100, assetFileUrl: 'https://cdn.example.com/f.glb', license: 'standard', downloadCount: 0 }]))
      .mockReturnValueOnce(selectChain([{ priceTokens: 100 }]))  // ORPHAN purchase row exists
      .mockReturnValueOnce(selectChain([]))  // no completed deduction txn → orphan, recover
      .mockReturnValueOnce(selectChain([{ id: 'seller-1', earnedCredits: 200, addonTokens: 0, monthlyTokens: 0, monthlyTokensUsed: 0 }])); // seller found
    mockTransactionResults = [[[{ id: 'buyer-1' }], [], []]]; // charge now completes

    const { POST } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/marketplace/assets/a1/purchase');
    const res = await POST(req, { params: Promise.resolve({ id: 'a1' }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(mockNeonSql.transaction).toHaveBeenCalledTimes(1);
  });
});
