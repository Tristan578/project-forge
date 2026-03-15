vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { getDb } from '@/lib/db/client';

vi.mock('@/lib/auth/api-auth');
vi.mock('@/lib/db/client');
vi.mock('@/lib/db/schema', () => ({
  marketplaceAssets: { id: 'id', sellerId: 'sellerId', status: 'status' },
}));

describe('PATCH /api/marketplace/seller/assets/[id]', () => {
  beforeEach(() => {
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

    const { PATCH } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/marketplace/seller/assets/a1', {
      method: 'PATCH',
      body: JSON.stringify({ name: 'Updated' }),
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: 'a1' }) });

    expect(res.status).toBe(401);
  });

  it('should return 404 when asset not found or not owned', async () => {
    const selectChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    };
    const mockDb = {
      select: vi.fn().mockReturnValue(selectChain),
    };
    vi.mocked(getDb).mockReturnValue(mockDb as never);

    const { PATCH } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/marketplace/seller/assets/missing', {
      method: 'PATCH',
      body: JSON.stringify({ name: 'Updated' }),
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: 'missing' }) });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe('Asset not found');
  });

  it('should return 400 for invalid status transition', async () => {
    const selectChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ id: 'a1', status: 'published', sellerId: 'user_1' }]),
    };
    const mockDb = {
      select: vi.fn().mockReturnValue(selectChain),
    };
    vi.mocked(getDb).mockReturnValue(mockDb as never);

    const { PATCH } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/marketplace/seller/assets/a1', {
      method: 'PATCH',
      body: JSON.stringify({ status: 'draft' }),
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: 'a1' }) });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain('Cannot transition');
  });

  it('should update asset successfully', async () => {
    const selectChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ id: 'a1', status: 'draft', sellerId: 'user_1' }]),
    };
    const mockDb = {
      select: vi.fn().mockReturnValue(selectChain),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue(undefined),
      }),
    };
    vi.mocked(getDb).mockReturnValue(mockDb as never);

    const { PATCH } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/marketplace/seller/assets/a1', {
      method: 'PATCH',
      body: JSON.stringify({ name: 'Updated Name', priceTokens: 200 }),
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: 'a1' }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
  });

  it('should allow draft to pending_review transition', async () => {
    const selectChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ id: 'a1', status: 'draft', sellerId: 'user_1' }]),
    };
    const mockDb = {
      select: vi.fn().mockReturnValue(selectChain),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue(undefined),
      }),
    };
    vi.mocked(getDb).mockReturnValue(mockDb as never);

    const { PATCH } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/marketplace/seller/assets/a1', {
      method: 'PATCH',
      body: JSON.stringify({ status: 'pending_review' }),
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: 'a1' }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
  });
});
