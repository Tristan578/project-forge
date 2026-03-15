vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db/client';

vi.mock('@/lib/db/client');
vi.mock('@/lib/db/schema', () => ({
  marketplaceAssets: {
    id: 'id', name: 'name', description: 'description', category: 'category',
    priceTokens: 'priceTokens', license: 'license', previewUrl: 'previewUrl',
    assetFileSize: 'assetFileSize', downloadCount: 'downloadCount', avgRating: 'avgRating',
    ratingCount: 'ratingCount', tags: 'tags', aiGenerated: 'aiGenerated', aiProvider: 'aiProvider',
    metadataJson: 'metadataJson', createdAt: 'createdAt', sellerId: 'sellerId',
  },
  sellerProfiles: { userId: 'userId', displayName: 'displayName', bio: 'bio', portfolioUrl: 'portfolioUrl' },
  assetReviews: { id: 'id', rating: 'rating', content: 'content', createdAt: 'createdAt', assetId: 'assetId', userId: 'userId' },
  users: { id: 'id', displayName: 'displayName' },
}));

describe('GET /api/marketplace/assets/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return asset with reviews', async () => {
    const assetData = [{
      id: 'asset-1',
      name: 'Model',
      description: 'A model',
      category: 'model_3d',
      priceTokens: 50,
      license: 'standard',
      previewUrl: null,
      assetFileSize: 1024,
      downloadCount: 10,
      avgRating: 400,
      ratingCount: 5,
      tags: ['3d'],
      aiGenerated: 1,
      aiProvider: 'meshy',
      metadataJson: null,
      createdAt: new Date('2025-01-01'),
      sellerId: 'seller-1',
      sellerName: 'Seller',
      sellerBio: 'A seller',
      sellerPortfolio: null,
    }];

    const reviewsData = [{
      id: 'r1',
      rating: 5,
      content: 'Great asset',
      createdAt: new Date('2025-02-01'),
      userName: 'Reviewer',
    }];

    const assetChain = {
      from: vi.fn().mockReturnThis(),
      leftJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue(assetData),
    };
    const reviewsChain = {
      from: vi.fn().mockReturnThis(),
      leftJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue(reviewsData),
    };

    const mockDb = {
      select: vi.fn()
        .mockReturnValueOnce(assetChain)
        .mockReturnValueOnce(reviewsChain),
    };
    vi.mocked(getDb).mockReturnValue(mockDb as never);

    const { GET } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/marketplace/assets/asset-1');
    const res = await GET(req, { params: Promise.resolve({ id: 'asset-1' }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.asset.name).toBe('Model');
    expect(body.asset.avgRating).toBe(4); // 400/100
    expect(body.asset.aiGenerated).toBe(true);
    expect(body.asset.seller.name).toBe('Seller');
    expect(body.reviews).toHaveLength(1);
  });

  it('should return 404 when asset not found', async () => {
    const assetChain = {
      from: vi.fn().mockReturnThis(),
      leftJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    };
    const mockDb = {
      select: vi.fn().mockReturnValue(assetChain),
    };
    vi.mocked(getDb).mockReturnValue(mockDb as never);

    const { GET } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/marketplace/assets/missing');
    const res = await GET(req, { params: Promise.resolve({ id: 'missing' }) });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe('Asset not found');
  });

  it('should return 500 on database error', async () => {
    vi.mocked(getDb).mockImplementation(() => { throw new Error('DB error'); });

    const { GET } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/marketplace/assets/asset-1');
    const res = await GET(req, { params: Promise.resolve({ id: 'asset-1' }) });
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBe('Failed to fetch asset');
  });
});
