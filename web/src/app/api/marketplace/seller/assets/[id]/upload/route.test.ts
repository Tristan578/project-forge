import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { getDb } from '@/lib/db/client';

vi.mock('@/lib/auth/api-auth');
vi.mock('@/lib/db/client');
vi.mock('@/lib/db/schema', () => ({
  marketplaceAssets: { id: 'id', sellerId: 'sellerId' },
}));
vi.mock('drizzle-orm', () => ({
  eq: vi.fn(),
  and: vi.fn(),
}));

describe('POST /api/marketplace/seller/assets/[id]/upload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authenticateRequest).mockResolvedValue({
      ok: true as const,
      ctx: { clerkId: 'clerk_1', user: { id: 'user_1', tier: 'creator' } as never },
    });
    delete process.env.ASSET_STORAGE_TYPE;
  });

  it('should return 401 when not authenticated', async () => {
    const mockResponse = new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    vi.mocked(authenticateRequest).mockResolvedValue({
      ok: false as const,
      response: mockResponse as never,
    });

    const { POST } = await import('./route');
    const formData = new FormData();
    const req = new NextRequest('http://localhost:3000/api/marketplace/seller/assets/a1/upload', {
      method: 'POST',
      body: formData,
    });
    const res = await POST(req, { params: Promise.resolve({ id: 'a1' }) });

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

    const { POST } = await import('./route');
    const formData = new FormData();
    formData.append('preview', new File(['data'], 'preview.png', { type: 'image/png' }));
    const req = new NextRequest('http://localhost:3000/api/marketplace/seller/assets/missing/upload', {
      method: 'POST',
      body: formData,
    });
    const res = await POST(req, { params: Promise.resolve({ id: 'missing' }) });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toContain('Asset not found');
  });

  it('should return 400 when no files provided', async () => {
    const selectChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ id: 'a1', sellerId: 'user_1' }]),
    };
    const mockDb = {
      select: vi.fn().mockReturnValue(selectChain),
    };
    vi.mocked(getDb).mockReturnValue(mockDb as never);

    const { POST } = await import('./route');
    const formData = new FormData();
    const req = new NextRequest('http://localhost:3000/api/marketplace/seller/assets/a1/upload', {
      method: 'POST',
      body: formData,
    });
    const res = await POST(req, { params: Promise.resolve({ id: 'a1' }) });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain('No files provided');
  });

  it('should return 501 when storage not configured', async () => {
    const selectChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ id: 'a1', sellerId: 'user_1' }]),
    };
    const mockDb = {
      select: vi.fn().mockReturnValue(selectChain),
    };
    vi.mocked(getDb).mockReturnValue(mockDb as never);

    const { POST } = await import('./route');
    const formData = new FormData();
    formData.append('preview', new File(['data'], 'preview.png', { type: 'image/png' }));
    const req = new NextRequest('http://localhost:3000/api/marketplace/seller/assets/a1/upload', {
      method: 'POST',
    });
    // Bypass Node's undici FormData parser which rejects jsdom File objects
    vi.spyOn(req, 'formData').mockResolvedValue(formData);
    const res = await POST(req, { params: Promise.resolve({ id: 'a1' }) });
    const body = await res.json();

    expect(res.status).toBe(501);
    expect(body.error).toBe('File storage not configured');
    expect(body.validated.preview).toBeDefined();
  });
});
