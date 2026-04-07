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
    error: null,
    authContext: {
      user: { ...mockUser },
    },
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
    vi.clearAllMocks();

    // Reset withApiMiddleware to default (authenticated user)
    vi.mocked(withApiMiddleware).mockResolvedValue({
      error: undefined,
      authContext: { user: { ...mockUser } },
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

  it('should return 409 when already purchased', async () => {
    mockSelect
      .mockReturnValueOnce(selectChain([{ id: 'a1', status: 'published', sellerId: 'other-user', priceTokens: 100, assetFileUrl: 'url', license: 'standard', downloadCount: 0 }]))
      .mockReturnValueOnce(selectChain([{ id: 'p1' }]));

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
    mockInsert.mockReturnValueOnce(insertChain([{ id: 'purchase-1' }]));

    const { POST } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/marketplace/assets/a1/purchase');
    const res = await POST(req, { params: Promise.resolve({ id: 'a1' }) });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe('Seller not found');
  });

  it('should return 409 and rollback purchase when balance changed during deduction', async () => {
    mockSelect
      .mockReturnValueOnce(selectChain([{ id: 'a1', status: 'published', sellerId: 'other', priceTokens: 100, assetFileUrl: 'url', license: 'standard', downloadCount: 0 }]))
      .mockReturnValueOnce(selectChain([]))  // no existing purchase
      .mockReturnValueOnce(selectChain([{ id: 'seller-1', earnedCredits: 200, addonTokens: 0, monthlyTokens: 0, monthlyTokensUsed: 0 }])); // seller found
    mockInsert.mockReturnValueOnce(insertChain([{ id: 'purchase-1' }]));
    // buyer balance UPDATE returns [] — WHERE guard failed (balance changed)
    mockUpdate.mockReturnValueOnce(updateChain([]));
    // delete chain for rollback
    mockDelete.mockReturnValueOnce({
      where: vi.fn().mockResolvedValue(undefined),
    });

    const { POST } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/marketplace/assets/a1/purchase');
    const res = await POST(req, { params: Promise.resolve({ id: 'a1' }) });
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toBe('Balance changed, please retry');
    expect(mockDelete).toHaveBeenCalled();
  });
});
