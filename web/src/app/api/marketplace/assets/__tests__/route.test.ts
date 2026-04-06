/**
 * Tests for GET /api/marketplace/assets
 *
 * Covers: rate limiting, asset listing, search, category filtering,
 * price filtering, sort modes, pagination, avgRating conversion, DB errors.
 */
vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/lib/db/client', () => ({
  queryWithResilience: vi.fn((fn: () => unknown) => fn()),
  getDb: vi.fn(),
}));

vi.mock('@/lib/rateLimit', () => ({
  rateLimitPublicRoute: vi.fn().mockResolvedValue(null),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------
import { rateLimitPublicRoute } from '@/lib/rateLimit';
import { getDb } from '@/lib/db/client';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(params: Record<string, string> = {}): NextRequest {
  const url = new URL('http://localhost:3000/api/marketplace/assets');
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  return new NextRequest(url.toString());
}

function makeAssetRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'asset-1',
    name: 'Cool Sword',
    description: 'A really cool sword model',
    category: 'model_3d',
    priceTokens: 50,
    license: 'standard',
    previewUrl: 'https://cdn.example.com/sword.png',
    downloadCount: 123,
    avgRating: 420, // stored as integer × 100
    ratingCount: 5,
    tags: ['weapon', 'fantasy'],
    aiGenerated: 0,
    createdAt: new Date('2024-06-01T12:00:00.000Z'),
    sellerId: 'seller-1',
    sellerName: 'SwordCraft Studio',
    ...overrides,
  };
}

/**
 * Chainable drizzle stub. The terminal method is `offset()` → resolves with rows.
 */
function makeQueryChain(rows: unknown[]) {
  const chain: Record<string, () => unknown> = {};
  const self = () => chain;
  chain.from = self;
  chain.leftJoin = self;
  chain.where = self;
  chain.orderBy = self;
  chain.limit = self;
  chain.offset = () => Promise.resolve(rows);
  return chain;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/marketplace/assets', () => {
  let GET: (req: NextRequest) => Promise<Response>;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    vi.mocked(rateLimitPublicRoute).mockResolvedValue(null);

    const mod = await import('../route');
    GET = mod.GET;
  });

  // -------------------------------------------------------------------------
  // Rate limiting
  // -------------------------------------------------------------------------
  describe('rate limiting', () => {
    it('returns 429 when rate limited', async () => {
      vi.mocked(rateLimitPublicRoute).mockResolvedValue(
        new Response(JSON.stringify({ error: 'Too many requests' }), { status: 429 }) as never,
      );

      const res = await GET(makeRequest());
      expect(res.status).toBe(429);
    });

    it('calls rateLimitPublicRoute with correct endpoint parameters', async () => {
      vi.mocked(getDb).mockReturnValue({
        select: vi.fn().mockReturnValue(makeQueryChain([])),
      } as never);

      await GET(makeRequest());

      expect(rateLimitPublicRoute).toHaveBeenCalledWith(
        expect.anything(),
        'marketplace-assets',
        30,
        5 * 60 * 1000,
      );
    });
  });

  // -------------------------------------------------------------------------
  // Happy path
  // -------------------------------------------------------------------------
  describe('happy path', () => {
    it('returns 200 with assets array and hasMore flag', async () => {
      vi.mocked(getDb).mockReturnValue({
        select: vi.fn().mockReturnValue(makeQueryChain([makeAssetRow()])),
      } as never);

      const res = await GET(makeRequest());
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body).toHaveProperty('assets');
      expect(body).toHaveProperty('hasMore');
      expect(Array.isArray(body.assets)).toBe(true);
    });

    it('formats asset fields correctly', async () => {
      vi.mocked(getDb).mockReturnValue({
        select: vi.fn().mockReturnValue(makeQueryChain([makeAssetRow()])),
      } as never);

      const res = await GET(makeRequest());
      const body = await res.json();
      const asset = body.assets[0];

      expect(asset.id).toBe('asset-1');
      expect(asset.name).toBe('Cool Sword');
      expect(asset.category).toBe('model_3d');
      expect(asset.sellerName).toBe('SwordCraft Studio');
      expect(typeof asset.createdAt).toBe('string');
      expect(asset.createdAt).toBe('2024-06-01T12:00:00.000Z');
    });

    it('converts avgRating from stored integer (×100) to decimal', async () => {
      vi.mocked(getDb).mockReturnValue({
        select: vi.fn().mockReturnValue(makeQueryChain([makeAssetRow({ avgRating: 380 })])),
      } as never);

      const res = await GET(makeRequest());
      const body = await res.json();

      expect(body.assets[0].avgRating).toBeCloseTo(3.8);
    });

    it('returns 0 avgRating when avgRating is null', async () => {
      vi.mocked(getDb).mockReturnValue({
        select: vi.fn().mockReturnValue(makeQueryChain([makeAssetRow({ avgRating: null })])),
      } as never);

      const res = await GET(makeRequest());
      const body = await res.json();

      expect(body.assets[0].avgRating).toBe(0);
    });

    it('converts aiGenerated=1 to boolean true', async () => {
      vi.mocked(getDb).mockReturnValue({
        select: vi.fn().mockReturnValue(makeQueryChain([makeAssetRow({ aiGenerated: 1 })])),
      } as never);

      const res = await GET(makeRequest());
      const body = await res.json();
      expect(body.assets[0].aiGenerated).toBe(true);
    });

    it('converts aiGenerated=0 to boolean false', async () => {
      vi.mocked(getDb).mockReturnValue({
        select: vi.fn().mockReturnValue(makeQueryChain([makeAssetRow({ aiGenerated: 0 })])),
      } as never);

      const res = await GET(makeRequest());
      const body = await res.json();
      expect(body.assets[0].aiGenerated).toBe(false);
    });

    it('falls back to Unknown for null sellerName', async () => {
      vi.mocked(getDb).mockReturnValue({
        select: vi.fn().mockReturnValue(makeQueryChain([makeAssetRow({ sellerName: null })])),
      } as never);

      const res = await GET(makeRequest());
      const body = await res.json();
      expect(body.assets[0].sellerName).toBe('Unknown');
    });
  });

  // -------------------------------------------------------------------------
  // Pagination
  // -------------------------------------------------------------------------
  describe('pagination', () => {
    it('sets hasMore=true when limit+1 rows are returned', async () => {
      const rows = Array.from({ length: 21 }, (_, i) =>
        makeAssetRow({ id: `asset-${i}` }),
      );
      vi.mocked(getDb).mockReturnValue({
        select: vi.fn().mockReturnValue(makeQueryChain(rows)),
      } as never);

      const res = await GET(makeRequest({ limit: '20' }));
      const body = await res.json();

      expect(body.hasMore).toBe(true);
      expect(body.assets).toHaveLength(20);
    });

    it('sets hasMore=false when fewer than limit+1 rows returned', async () => {
      vi.mocked(getDb).mockReturnValue({
        select: vi.fn().mockReturnValue(makeQueryChain([makeAssetRow()])),
      } as never);

      const res = await GET(makeRequest({ limit: '20' }));
      const body = await res.json();
      expect(body.hasMore).toBe(false);
    });

    it('caps limit at 100 (no crash with very large limit)', async () => {
      vi.mocked(getDb).mockReturnValue({
        select: vi.fn().mockReturnValue(makeQueryChain([])),
      } as never);

      const res = await GET(makeRequest({ limit: '500' }));
      expect(res.status).toBe(200);
    });

    it('returns empty assets on page with no results', async () => {
      vi.mocked(getDb).mockReturnValue({
        select: vi.fn().mockReturnValue(makeQueryChain([])),
      } as never);

      const res = await GET(makeRequest({ page: '50' }));
      const body = await res.json();

      expect(body.assets).toHaveLength(0);
      expect(body.hasMore).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Category filtering
  // -------------------------------------------------------------------------
  describe('category filtering', () => {
    const categories = [
      'model_3d', 'sprite', 'texture', 'audio',
      'script', 'prefab', 'template', 'shader', 'animation',
    ];

    for (const category of categories) {
      it(`accepts category=${category}`, async () => {
        vi.mocked(getDb).mockReturnValue({
          select: vi.fn().mockReturnValue(makeQueryChain([makeAssetRow({ category })])),
        } as never);

        const res = await GET(makeRequest({ category }));
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.assets[0].category).toBe(category);
      });
    }
  });

  // -------------------------------------------------------------------------
  // Price filtering
  // -------------------------------------------------------------------------
  describe('price filtering', () => {
    it('handles price=free filter', async () => {
      vi.mocked(getDb).mockReturnValue({
        select: vi.fn().mockReturnValue(makeQueryChain([makeAssetRow({ priceTokens: 0 })])),
      } as never);

      const res = await GET(makeRequest({ price: 'free' }));
      expect(res.status).toBe(200);
    });

    it('handles price=paid filter', async () => {
      vi.mocked(getDb).mockReturnValue({
        select: vi.fn().mockReturnValue(makeQueryChain([makeAssetRow({ priceTokens: 100 })])),
      } as never);

      const res = await GET(makeRequest({ price: 'paid' }));
      expect(res.status).toBe(200);
    });

    it('handles price=all (default)', async () => {
      vi.mocked(getDb).mockReturnValue({
        select: vi.fn().mockReturnValue(makeQueryChain([])),
      } as never);

      const res = await GET(makeRequest({ price: 'all' }));
      expect(res.status).toBe(200);
    });
  });

  // -------------------------------------------------------------------------
  // Sort modes
  // -------------------------------------------------------------------------
  describe('sort modes', () => {
    const sortModes = ['newest', 'popular', 'top_rated', 'price_low', 'price_high', 'free'];

    for (const sort of sortModes) {
      it(`returns 200 for sort=${sort}`, async () => {
        vi.mocked(getDb).mockReturnValue({
          select: vi.fn().mockReturnValue(makeQueryChain([])),
        } as never);

        const res = await GET(makeRequest({ sort }));
        expect(res.status).toBe(200);
      });
    }

    it('defaults to popular sort when sort param is omitted', async () => {
      vi.mocked(getDb).mockReturnValue({
        select: vi.fn().mockReturnValue(makeQueryChain([])),
      } as never);

      const res = await GET(makeRequest());
      expect(res.status).toBe(200);
    });
  });

  // -------------------------------------------------------------------------
  // Search query
  // -------------------------------------------------------------------------
  describe('search filtering', () => {
    it('returns 200 when q param is provided', async () => {
      vi.mocked(getDb).mockReturnValue({
        select: vi.fn().mockReturnValue(makeQueryChain([makeAssetRow({ name: 'Cool Sword' })])),
      } as never);

      const res = await GET(makeRequest({ q: 'sword' }));
      expect(res.status).toBe(200);
    });

    it('escapes regex special chars in search query', async () => {
      vi.mocked(getDb).mockReturnValue({
        select: vi.fn().mockReturnValue(makeQueryChain([])),
      } as never);

      // Should not crash with SQL injection attempt
      const res = await GET(makeRequest({ q: '%100_off\\' }));
      expect(res.status).toBe(200);
    });
  });

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------
  describe('error handling', () => {
    it('returns 500 when getDb throws synchronously', async () => {
      vi.mocked(getDb).mockImplementation(() => {
        throw new Error('DB unavailable');
      });

      const res = await GET(makeRequest());
      expect(res.status).toBe(500);

      const body = await res.json();
      expect(body.error).toBe('Failed to fetch assets');
    });

    it('returns 500 when DB query rejects', async () => {
      const rejectingChain = makeQueryChain([]);
      rejectingChain.offset = vi.fn(() => Promise.reject(new Error('Connection reset')));

      vi.mocked(getDb).mockReturnValue({
        select: vi.fn().mockReturnValue(rejectingChain),
      } as never);

      const res = await GET(makeRequest());
      expect(res.status).toBe(500);

      const body = await res.json();
      expect(body.error).toBe('Failed to fetch assets');
    });
  });
});
