vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db/client';

vi.mock('@/lib/db/client');
vi.mock('@/lib/rateLimit', () => ({
  rateLimitPublicRoute: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/lib/db/schema', () => ({
  marketplaceAssets: {
    id: 'id', name: 'name', description: 'description', category: 'category',
    priceTokens: 'priceTokens', license: 'license', previewUrl: 'previewUrl',
    downloadCount: 'downloadCount', avgRating: 'avgRating', ratingCount: 'ratingCount',
    tags: 'tags', aiGenerated: 'aiGenerated', createdAt: 'createdAt',
    sellerId: 'sellerId', status: 'status',
  },
  sellerProfiles: { userId: 'userId', displayName: 'displayName' },
}));

function mockDbChain(data: unknown[] = []) {
  return {
    from: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    offset: vi.fn().mockResolvedValue(data),
  };
}

describe('GET /api/marketplace/assets', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('should return assets with default pagination', async () => {
    const assetData = [{
      id: 'asset-1',
      name: 'Cool Model',
      description: 'A 3D model',
      category: 'model_3d',
      priceTokens: 100,
      license: 'standard',
      previewUrl: 'https://example.com/preview.png',
      downloadCount: 50,
      avgRating: 450,
      ratingCount: 10,
      tags: ['3d', 'model'],
      aiGenerated: 0,
      createdAt: new Date('2025-01-01'),
      sellerId: 'seller-1',
      sellerName: 'SellerUser',
    }];

    const mockDb = {
      select: vi.fn().mockReturnValue(mockDbChain(assetData)),
    };
    vi.mocked(getDb).mockReturnValue(mockDb as never);

    const { GET } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/marketplace/assets');
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.assets).toHaveLength(1);
    expect(body.assets[0].name).toBe('Cool Model');
    expect(body.assets[0].avgRating).toBe(4.5); // 450/100
    expect(body.assets[0].aiGenerated).toBe(false);
    expect(body.hasMore).toBe(false);
  });

  it('should filter by category', async () => {
    const mockDb = {
      select: vi.fn().mockReturnValue(mockDbChain([])),
    };
    vi.mocked(getDb).mockReturnValue(mockDb as never);

    const { GET } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/marketplace/assets?category=sprite');
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.assets).toEqual([]);
  });

  it('should cap limit to 100', async () => {
    const chain = mockDbChain([]);
    const mockDb = {
      select: vi.fn().mockReturnValue(chain),
    };
    vi.mocked(getDb).mockReturnValue(mockDb as never);

    const { GET } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/marketplace/assets?limit=500');
    await GET(req);

    expect(chain.limit).toHaveBeenCalledWith(101); // 100 + 1
  });

  it('should return 500 on database error', async () => {
    vi.mocked(getDb).mockImplementation(() => { throw new Error('DB error'); });

    const { GET } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/marketplace/assets');
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBe('Failed to fetch assets');
  });
});
