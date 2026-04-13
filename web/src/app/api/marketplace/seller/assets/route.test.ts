vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { getDb } from '@/lib/db/client';

vi.mock('@/lib/auth/api-auth');
vi.mock('@/lib/db/client');
vi.mock('@/lib/db/schema', () => ({
  marketplaceAssets: {
    id: 'id', name: 'name', description: 'description', category: 'category',
    status: 'status', priceTokens: 'priceTokens', license: 'license',
    downloadCount: 'downloadCount', avgRating: 'avgRating', ratingCount: 'ratingCount',
    createdAt: 'createdAt', sellerId: 'sellerId', tags: 'tags',
  },
}));

describe('GET /api/marketplace/seller/assets', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.mocked(authenticateRequest).mockResolvedValue({
      ok: true as const,
      ctx: { clerkId: 'clerk_1', user: { id: 'user_1', tier: 'creator' } as never },
    });
  });

  it('should return 401 when not authenticated', async () => {
    const mockResponse = new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    vi.mocked(authenticateRequest).mockResolvedValue({
      ok: false as const,
      response: mockResponse as never,
    });

    const { GET } = await import('./route');
    const res = await GET(new NextRequest('http://localhost/api/marketplace/seller/assets'));

    expect(res.status).toBe(401);
  });

  it('should return seller assets', async () => {
    const assetsData = [{
      id: 'a1',
      name: 'My Asset',
      description: 'An asset',
      category: 'model_3d',
      status: 'draft',
      priceTokens: 100,
      license: 'standard',
      downloadCount: 5,
      avgRating: 450,
      ratingCount: 3,
      createdAt: new Date('2025-01-01'),
    }];
    const selectChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue(assetsData),
    };
    const mockDb = {
      select: vi.fn().mockReturnValue(selectChain),
    };
    vi.mocked(getDb).mockReturnValue(mockDb as never);

    const { GET } = await import('./route');
    const res = await GET(new NextRequest('http://localhost/api/marketplace/seller/assets'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.assets).toHaveLength(1);
    expect(body.assets[0].avgRating).toBe(4.5); // 450/100
  });
});

describe('POST /api/marketplace/seller/assets', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.mocked(authenticateRequest).mockResolvedValue({
      ok: true as const,
      ctx: { clerkId: 'clerk_1', user: { id: 'user_1', tier: 'creator' } as never },
    });
  });

  it('should return 401 when not authenticated', async () => {
    const mockResponse = new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    vi.mocked(authenticateRequest).mockResolvedValue({
      ok: false as const,
      response: mockResponse as never,
    });

    const { POST } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/marketplace/seller/assets', {
      method: 'POST',
      body: JSON.stringify({ name: 'Test', description: 'Desc', category: 'sprite' }),
    });
    const res = await POST(req);

    expect(res.status).toBe(401);
  });

  it('should return 422 for missing required fields', async () => {
    const mockDb = { insert: vi.fn() };
    vi.mocked(getDb).mockReturnValue(mockDb as never);

    const { POST } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/marketplace/seller/assets', {
      method: 'POST',
      body: JSON.stringify({ name: 'Test' }),
    });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(422);
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  it('should create a new asset listing', async () => {
    const insertedAsset = { id: 'a-new', name: 'New Asset', status: 'draft' };
    const mockDb = {
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([insertedAsset]),
      }),
    };
    vi.mocked(getDb).mockReturnValue(mockDb as never);

    const { POST } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/marketplace/seller/assets', {
      method: 'POST',
      body: JSON.stringify({ name: 'New Asset', description: 'A new asset', category: 'sprite', priceTokens: 50 }),
    });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.asset.id).toBe('a-new');
  });
});
