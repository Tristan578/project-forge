/**
 * Regression tests for POST /api/marketplace/assets/[id]/purchase
 *
 * Covers the downloadCount double-increment bug:
 *   - When a purchase INSERT conflicts (retry), downloadCount must NOT increment.
 *   - When a purchase INSERT succeeds (first attempt), downloadCount increments once.
 *
 * @see PR #8262 — Boy Scout Rule fix for downloadCount idempotency
 */
vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockInsert = vi.fn();
const mockUpdate = vi.fn();
const mockSelect = vi.fn();

vi.mock('@/lib/db/client', () => ({
  queryWithResilience: vi.fn((fn: () => unknown) => fn()),
  getDb: vi.fn(() => ({
    insert: mockInsert,
    update: mockUpdate,
    select: mockSelect,
  })),
}));

vi.mock('@/lib/api/middleware', () => ({
  withApiMiddleware: vi.fn().mockResolvedValue({
    error: undefined,
    userId: 'buyer-1',
    authContext: {
      user: {
        id: 'buyer-1',
        monthlyTokens: 1000,
        monthlyTokensUsed: 0,
        addonTokens: 0,
        earnedCredits: 500,
      },
    },
    body: undefined,
  }),
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(): NextRequest {
  return new NextRequest('http://localhost:3000/api/marketplace/assets/asset-1/purchase', {
    method: 'POST',
  });
}

const freeAsset = {
  id: 'asset-1',
  sellerId: 'seller-1',
  status: 'published',
  priceTokens: 0,
  license: 'standard',
  assetFileUrl: 'https://cdn.example.com/file.glb',
  downloadCount: 10,
};

const paidAsset = {
  ...freeAsset,
  priceTokens: 100,
};

const seller = {
  id: 'seller-1',
  earnedCredits: 200,
  addonTokens: 0,
  monthlyTokens: 0,
  monthlyTokensUsed: 0,
};

/** Wire up a chain of select/insert/update calls in sequence. */
function setupDbChain(calls: Array<{ type: 'select' | 'insert' | 'update'; result: unknown }>) {
  let selectIdx = 0;
  let insertIdx = 0;
  let updateIdx = 0;

  const selectResults = calls.filter(c => c.type === 'select').map(c => c.result);
  const insertResults = calls.filter(c => c.type === 'insert').map(c => c.result);
  const updateResults = calls.filter(c => c.type === 'update').map(c => c.result);

  // Each mock returns a chainable object that ultimately resolves to the result
  const makeChain = (resultFn: () => unknown) => {
    const chain: Record<string, unknown> = {};
    const handler: ProxyHandler<Record<string, unknown>> = {
      get(_target, prop) {
        if (prop === 'then') {
          // Make it thenable — resolve to the result
          const result = resultFn();
          return (resolve: (v: unknown) => void) => resolve(result);
        }
        // All other method calls return the proxy
        return () => new Proxy(chain, handler);
      },
    };
    return new Proxy(chain, handler);
  };

  mockSelect.mockImplementation(() => makeChain(() => selectResults[selectIdx++] ?? []));
  mockInsert.mockImplementation(() => makeChain(() => insertResults[insertIdx++] ?? []));
  mockUpdate.mockImplementation(() => makeChain(() => updateResults[updateIdx++] ?? []));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/marketplace/assets/[id]/purchase — downloadCount idempotency', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('increments downloadCount on first free purchase (insert succeeds)', async () => {
    setupDbChain([
      { type: 'select', result: [freeAsset] },       // get asset
      { type: 'select', result: [] },                 // check existing purchase
      { type: 'insert', result: [{ id: 'purchase-1' }] }, // purchase INSERT succeeds
      { type: 'update', result: [freeAsset] },        // downloadCount increment
    ]);

    const { POST } = await import('@/app/api/marketplace/assets/[id]/purchase/route');
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'asset-1' }) });
    const body = await res.json();

    expect(body.success).toBe(true);
    // update was called (downloadCount increment)
    expect(mockUpdate).toHaveBeenCalled();
  });

  it('does NOT increment downloadCount on retry free purchase (insert conflicts)', async () => {
    setupDbChain([
      { type: 'select', result: [freeAsset] },       // get asset
      { type: 'select', result: [] },                 // check existing purchase (race: not found yet)
      { type: 'insert', result: [] },                 // purchase INSERT conflicts — empty returning
    ]);

    const { POST } = await import('@/app/api/marketplace/assets/[id]/purchase/route');
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'asset-1' }) });
    const body = await res.json();

    expect(body.success).toBe(true);
    // update was NOT called — downloadCount should not increment on retry
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('increments downloadCount on first paid purchase (insert succeeds)', async () => {
    setupDbChain([
      { type: 'select', result: [paidAsset] },       // get asset
      { type: 'select', result: [] },                 // check existing purchase
      { type: 'insert', result: [{ id: 'purchase-1' }] }, // purchase INSERT succeeds (idempotency gate)
      { type: 'select', result: [seller] },           // get seller
      { type: 'update', result: [{ id: 'buyer-1' }] }, // buyer balance deduction
      { type: 'update', result: [{ earnedCredits: 270 }] }, // seller balance credit
      { type: 'select', result: [{ earnedCredits: 400, addonTokens: 0, monthlyTokens: 1000, monthlyTokensUsed: 100 }] }, // buyer balance read
      { type: 'update', result: [paidAsset] },        // downloadCount increment
      { type: 'insert', result: [{ id: 'txn-1' }] }, // buyer transaction
      { type: 'insert', result: [{ id: 'txn-2' }] }, // seller transaction
    ]);

    const { POST } = await import('@/app/api/marketplace/assets/[id]/purchase/route');
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'asset-1' }) });
    const body = await res.json();

    expect(body.success).toBe(true);
    // 3 updates total: buyer balance, seller balance, downloadCount
    expect(mockUpdate).toHaveBeenCalledTimes(3);
  });

  it('returns 409 on retry paid purchase when credit_transaction exists (fully completed)', async () => {
    setupDbChain([
      { type: 'select', result: [paidAsset] },       // get asset
      { type: 'select', result: [] },                 // check existing purchase (race: not found yet)
      { type: 'insert', result: [] },                 // purchase INSERT conflicts — idempotency gate
      { type: 'select', result: [{ id: 'txn-existing' }] }, // credit_transaction EXISTS → fully completed
    ]);

    const { POST } = await import('@/app/api/marketplace/assets/[id]/purchase/route');
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'asset-1' }) });

    expect(res.status).toBe(409);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('returns 409 on orphan purchase row (insert committed but balance never deducted)', async () => {
    // When the purchase INSERT conflicts but no credit_transaction exists,
    // the route returns 409 "Purchase in progress, please retry" so the
    // client retries safely. It does NOT attempt to complete the charge
    // inline — another request may be in-flight.
    setupDbChain([
      { type: 'select', result: [paidAsset] },       // get asset
      { type: 'select', result: [] },                 // check existing purchase (race: not found yet)
      { type: 'insert', result: [] },                 // purchase INSERT conflicts — orphan row
      { type: 'select', result: [] },                 // credit_transaction NOT found → orphan
    ]);

    const { POST } = await import('@/app/api/marketplace/assets/[id]/purchase/route');
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'asset-1' }) });
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toBe('Purchase in progress, please retry');
    // No balance mutations should have happened
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
