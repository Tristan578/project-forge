vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { getDb } from '@/lib/db/client';

vi.mock('@/lib/auth/api-auth');
vi.mock('@/lib/db/client');
vi.mock('@/lib/monitoring/sentry-server', () => ({ captureException: vi.fn() }));
vi.mock('@/lib/db/schema', () => ({
  marketplaceAssets: { id: 'id', sellerId: 'sellerId' },
}));
vi.mock('drizzle-orm', () => ({
  eq: vi.fn(),
  and: vi.fn(),
}));

const mockUploadToR2 = vi.fn();
vi.mock('@/lib/storage/r2', () => ({
  uploadToR2: (...args: unknown[]) => mockUploadToR2(...args),
  buildAssetKey: vi.fn(
    (sellerId: string, assetId: string, filename: string, type: string) =>
      `assets/${sellerId}/${assetId}/${type}/${filename}`
  ),
}));

describe('POST /api/marketplace/seller/assets/[id]/upload', () => {
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
    vi.mocked(getDb).mockReturnValue({ select: vi.fn().mockReturnValue(selectChain) } as never);

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
    vi.mocked(getDb).mockReturnValue({ select: vi.fn().mockReturnValue(selectChain) } as never);

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

  it('should return 400 for invalid file types', async () => {
    const selectChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ id: 'a1', sellerId: 'user_1' }]),
    };
    vi.mocked(getDb).mockReturnValue({ select: vi.fn().mockReturnValue(selectChain) } as never);

    const { POST } = await import('./route');
    const formData = new FormData();
    formData.append('preview', new File(['data'], 'evil.exe', { type: 'application/x-executable' }));
    const req = new NextRequest('http://localhost:3000/api/marketplace/seller/assets/a1/upload', {
      method: 'POST',
    });
    vi.spyOn(req, 'formData').mockResolvedValue(formData);
    const res = await POST(req, { params: Promise.resolve({ id: 'a1' }) });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('Validation failed');
    expect(body.details[0]).toContain('not allowed');
  });

  it('should upload to R2 and return CDN URLs', async () => {
    const selectChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ id: 'a1', sellerId: 'user_1' }]),
    };
    const updateChain = {
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{
            id: 'a1',
            previewUrl: 'https://cdn.spawnforge.ai/assets/user_1/a1/preview/thumb.png',
          }]),
        }),
      }),
    };
    vi.mocked(getDb).mockReturnValue({
      select: vi.fn().mockReturnValue(selectChain),
      update: vi.fn().mockReturnValue(updateChain),
    } as never);

    mockUploadToR2.mockResolvedValue({
      url: 'https://cdn.spawnforge.ai/assets/user_1/a1/preview/thumb.png',
      key: 'assets/user_1/a1/preview/thumb.png',
    });

    const { POST } = await import('./route');
    const formData = new FormData();
    formData.append('preview', new File(['imgdata'], 'thumb.png', { type: 'image/png' }));
    const req = new NextRequest('http://localhost:3000/api/marketplace/seller/assets/a1/upload', {
      method: 'POST',
    });
    vi.spyOn(req, 'formData').mockResolvedValue(formData);
    const res = await POST(req, { params: Promise.resolve({ id: 'a1' }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.uploaded.preview).toContain('cdn.spawnforge.ai');
    expect(mockUploadToR2).toHaveBeenCalled();
  });

  it('should return 500 when R2 upload fails', async () => {
    const selectChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ id: 'a1', sellerId: 'user_1' }]),
    };
    vi.mocked(getDb).mockReturnValue({ select: vi.fn().mockReturnValue(selectChain) } as never);

    mockUploadToR2.mockRejectedValue(new Error('R2 connection failed'));

    const { POST } = await import('./route');
    const formData = new FormData();
    formData.append('preview', new File(['imgdata'], 'thumb.png', { type: 'image/png' }));
    const req = new NextRequest('http://localhost:3000/api/marketplace/seller/assets/a1/upload', {
      method: 'POST',
    });
    vi.spyOn(req, 'formData').mockResolvedValue(formData);
    const res = await POST(req, { params: Promise.resolve({ id: 'a1' }) });

    expect(res.status).toBe(500);
  });
});
