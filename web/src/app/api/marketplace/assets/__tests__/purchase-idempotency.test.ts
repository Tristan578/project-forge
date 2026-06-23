/**
 * Regression tests for POST /api/marketplace/assets/[id]/purchase
 *
 * Covers:
 *   - downloadCount double-increment idempotency on the FREE path (PR #8262).
 *   - Atomic paid purchase: the deduction credit_transaction, asset_purchases
 *     idempotency-gate row, and balance mutations all commit inside ONE
 *     neonSql.transaction([...]) so a crash can never leave a charged buyer
 *     with no deduction row (the download gate keys off that row) — #8636.
 *
 * @see PR #8262 — downloadCount idempotency
 * @see #8636 — non-atomic purchase left buyers charged-but-can-never-download
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
const mockDelete = vi.fn();

// Atomic transaction recorder (paid path).
const mockTransactionCalls: unknown[][] = [];
let mockTransactionResults: unknown[][] = [];
let mockTransactionIdx = 0;

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

describe('POST /api/marketplace/assets/[id]/purchase — downloadCount idempotency (free path)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockTransactionCalls.length = 0;
    mockTransactionResults = [];
    mockTransactionIdx = 0;
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
});

describe('POST /api/marketplace/assets/[id]/purchase — atomic paid charge (#8636)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockTransactionCalls.length = 0;
    mockTransactionResults = [];
    mockTransactionIdx = 0;
  });

  it('runs the deduction, gate insert, and balance update in ONE neonSql.transaction', async () => {
    setupDbChain([
      { type: 'select', result: [paidAsset] }, // get asset
      { type: 'select', result: [] },          // check existing purchase
      { type: 'select', result: [seller] },    // get seller
    ]);
    // Buyer-charge statement RETURNS the buyer row id → fully committed.
    mockTransactionResults = [[[{ id: 'buyer-1' }], [], []]];

    const { POST } = await import('@/app/api/marketplace/assets/[id]/purchase/route');
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'asset-1' }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);

    // The whole charge is atomic — exactly one transaction, no per-statement
    // getDb() writes that could partially commit on a crash.
    expect(mockNeonSql.transaction).toHaveBeenCalledTimes(1);
    expect(mockTransactionCalls[0].length).toBeGreaterThanOrEqual(3);
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('returns 409 (Already purchased) when a completed deduction txn already exists', async () => {
    setupDbChain([
      { type: 'select', result: [paidAsset] },              // get asset
      { type: 'select', result: [{ priceTokens: 100 }] },   // existing purchase row
      { type: 'select', result: [{ id: 'txn-existing' }] }, // completed deduction → already charged
    ]);

    const { POST } = await import('@/app/api/marketplace/assets/[id]/purchase/route');
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'asset-1' }) });

    expect(res.status).toBe(409);
    // No re-charge attempted.
    expect(mockNeonSql.transaction).not.toHaveBeenCalled();
  });

  it('returns 409 with no partial charge when the atomic transaction commits nothing', async () => {
    setupDbChain([
      { type: 'select', result: [paidAsset] }, // get asset
      { type: 'select', result: [] },          // no existing purchase
      { type: 'select', result: [seller] },    // get seller
      { type: 'select', result: [] },          // no completed deduction → safe to retry
    ]);
    mockTransactionResults = [[[], [], []]]; // buyer-charge statement returned no row

    const { POST } = await import('@/app/api/marketplace/assets/[id]/purchase/route');
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'asset-1' }) });
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toBe('Balance changed, please retry');
    // Atomic transaction is the only write path — no manual rollback DELETE.
    expect(mockDelete).not.toHaveBeenCalled();
  });
});
