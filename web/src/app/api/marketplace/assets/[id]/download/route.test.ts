vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { getDb } from '@/lib/db/client';

vi.mock('@/lib/auth/api-auth');
vi.mock('@/lib/db/client');
vi.mock('@/lib/monitoring/sentry-server', () => ({ captureException: vi.fn() }));
vi.mock('@/lib/db/schema', () => ({
  marketplaceAssets: { id: 'id', sellerId: 'sellerId', assetFileUrl: 'assetFileUrl' },
  assetPurchases: { buyerId: 'buyerId', assetId: 'assetId', priceTokens: 'priceTokens' },
  creditTransactions: { id: 'id', userId: 'userId', source: 'source', referenceId: 'referenceId' },
}));
vi.mock('drizzle-orm', () => ({
  eq: vi.fn(),
  and: vi.fn(),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values })),
}));

const mockGetSignedDownloadUrl = vi.fn();
vi.mock('@/lib/storage/r2', () => ({
  getSignedDownloadUrl: (...args: unknown[]) => mockGetSignedDownloadUrl(...args),
}));

// The route runs the real withApiMiddleware, which applies an in-memory
// rate limit keyed on the (single) authenticated user. Without stubbing it,
// running >max requests for user_1 across this suite trips a 429. Always
// allow so the suite tests the route's own authorization logic, not the limiter.
vi.mock('@/lib/rateLimit', () => ({
  rateLimit: vi.fn().mockResolvedValue({ allowed: true, remaining: 99, resetAt: 0 }),
  getClientIp: vi.fn().mockReturnValue('127.0.0.1'),
  rateLimitResponse: vi.fn(),
}));

describe('GET /api/marketplace/assets/[id]/download', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.mocked(authenticateRequest).mockResolvedValue({
      ok: true as const,
      ctx: { clerkId: 'clerk_1', user: { id: 'user_1', tier: 'creator' } as never },
    });
    // Set allowed hosts for URL validation
    process.env.ASSET_CDN_HOSTS = 'cdn.example.com,localhost';
    delete process.env.CDN_URL;
  });

  it('should return 401 when not authenticated', async () => {
    const mockResponse = new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    vi.mocked(authenticateRequest).mockResolvedValue({
      ok: false as const,
      response: mockResponse as never,
    });

    const { GET } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/marketplace/assets/a1/download');
    const res = await GET(req, { params: Promise.resolve({ id: 'a1' }) });

    expect(res.status).toBe(401);
  });

  it('should return 404 when asset not found', async () => {
    const assetChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    };
    const mockDb = {
      select: vi.fn().mockReturnValue(assetChain),
    };
    vi.mocked(getDb).mockReturnValue(mockDb as never);

    const { GET } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/marketplace/assets/missing/download');
    const res = await GET(req, { params: Promise.resolve({ id: 'missing' }) });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe('Asset not found');
  });

  it('should return 403 when not purchased and not owner', async () => {
    const assetChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ id: 'a1', sellerId: 'other-user', assetFileUrl: 'https://cdn.example.com/file' }]),
    };
    const purchaseChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    };
    const mockDb = {
      select: vi.fn()
        .mockReturnValueOnce(assetChain)
        .mockReturnValueOnce(purchaseChain),
    };
    vi.mocked(getDb).mockReturnValue(mockDb as never);

    const { GET } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/marketplace/assets/a1/download');
    const res = await GET(req, { params: Promise.resolve({ id: 'a1' }) });
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toBe('Not authorized to download');
  });

  it('should return 404 when no file available', async () => {
    const assetChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ id: 'a1', sellerId: 'user_1', assetFileUrl: null }]),
    };
    const mockDb = {
      select: vi.fn().mockReturnValue(assetChain),
    };
    vi.mocked(getDb).mockReturnValue(mockDb as never);

    const { GET } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/marketplace/assets/a1/download');
    const res = await GET(req, { params: Promise.resolve({ id: 'a1' }) });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe('No file available');
  });

  it('should redirect to signed URL when asset has CDN URL', async () => {
    process.env.CDN_URL = 'cdn.spawnforge.ai';
    const assetChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{
        id: 'a1',
        sellerId: 'user_1',
        assetFileUrl: 'https://cdn.spawnforge.ai/assets/user_1/a1/file/model.glb',
      }]),
    };
    // update chain is needed for the atomic downloadCount increment (PF-7507)
    const updateChain = {
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([]),
    };
    const mockDb = {
      select: vi.fn().mockReturnValue(assetChain),
      update: vi.fn().mockReturnValue(updateChain),
    };
    vi.mocked(getDb).mockReturnValue(mockDb as never);
    mockGetSignedDownloadUrl.mockResolvedValue('https://signed.r2.example.com/assets/user_1/a1/file/model.glb?sig=abc');

    const { GET } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/marketplace/assets/a1/download');
    const res = await GET(req, { params: Promise.resolve({ id: 'a1' }) });

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('signed.r2.example.com');
    expect(mockGetSignedDownloadUrl).toHaveBeenCalledWith('assets/user_1/a1/file/model.glb');
  });

  it('should redirect to asset URL for allowed non-CDN hosts', async () => {
    const assetChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{
        id: 'a1',
        sellerId: 'user_1',
        assetFileUrl: 'https://cdn.example.com/files/model.glb',
      }]),
    };
    // update chain is needed for the atomic downloadCount increment (PF-7507)
    const updateChain = {
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([]),
    };
    const mockDb = {
      select: vi.fn().mockReturnValue(assetChain),
      update: vi.fn().mockReturnValue(updateChain),
    };
    vi.mocked(getDb).mockReturnValue(mockDb as never);

    const { GET } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/marketplace/assets/a1/download');
    const res = await GET(req, { params: Promise.resolve({ id: 'a1' }) });

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('https://cdn.example.com/files/model.glb');
  });

  it('returns 403 when a paid purchase has no completed deduction transaction (orphan row, #8636)', async () => {
    // Asset belongs to another seller; buyer holds a paid purchase row but the
    // balance deduction never landed (crash between INSERT and UPDATE).
    const assetChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ id: 'a1', sellerId: 'other-user', assetFileUrl: 'https://cdn.example.com/file' }]),
    };
    const purchaseChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ id: 'p1', priceTokens: 500 }]),
    };
    const deductionChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]), // no marketplace_purchase transaction
    };
    const mockDb = {
      select: vi.fn()
        .mockReturnValueOnce(assetChain)
        .mockReturnValueOnce(purchaseChain)
        .mockReturnValueOnce(deductionChain),
    };
    vi.mocked(getDb).mockReturnValue(mockDb as never);

    const { GET } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/marketplace/assets/a1/download');
    const res = await GET(req, { params: Promise.resolve({ id: 'a1' }) });
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toContain('Purchase incomplete');
  });

  it('allows download when a paid purchase has a completed deduction transaction (#8636)', async () => {
    const assetChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ id: 'a1', sellerId: 'other-user', assetFileUrl: 'https://cdn.example.com/files/model.glb' }]),
    };
    const purchaseChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ id: 'p1', priceTokens: 500 }]),
    };
    const deductionChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ id: 'txn-1' }]), // completed charge
    };
    const updateChain = {
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([]),
    };
    const mockDb = {
      select: vi.fn()
        .mockReturnValueOnce(assetChain)
        .mockReturnValueOnce(purchaseChain)
        .mockReturnValueOnce(deductionChain),
      update: vi.fn().mockReturnValue(updateChain),
    };
    vi.mocked(getDb).mockReturnValue(mockDb as never);

    const { GET } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/marketplace/assets/a1/download');
    const res = await GET(req, { params: Promise.resolve({ id: 'a1' }) });

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('https://cdn.example.com/files/model.glb');
  });

  it('allows download for a free purchase (priceTokens 0) with no transaction', async () => {
    const assetChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ id: 'a1', sellerId: 'other-user', assetFileUrl: 'https://cdn.example.com/files/free.glb' }]),
    };
    const purchaseChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ id: 'p1', priceTokens: 0 }]),
    };
    const updateChain = {
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([]),
    };
    // Only two selects expected — the deduction gate is skipped for free assets.
    const mockDb = {
      select: vi.fn()
        .mockReturnValueOnce(assetChain)
        .mockReturnValueOnce(purchaseChain),
      update: vi.fn().mockReturnValue(updateChain),
    };
    vi.mocked(getDb).mockReturnValue(mockDb as never);

    const { GET } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/marketplace/assets/a1/download');
    const res = await GET(req, { params: Promise.resolve({ id: 'a1' }) });

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('https://cdn.example.com/files/free.glb');
  });

  it('allows owner download without a purchase or transaction', async () => {
    const assetChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ id: 'a1', sellerId: 'user_1', assetFileUrl: 'https://cdn.example.com/files/owned.glb' }]),
    };
    const purchaseChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]), // owner never purchased
    };
    const updateChain = {
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([]),
    };
    const mockDb = {
      select: vi.fn()
        .mockReturnValueOnce(assetChain)
        .mockReturnValueOnce(purchaseChain),
      update: vi.fn().mockReturnValue(updateChain),
    };
    vi.mocked(getDb).mockReturnValue(mockDb as never);

    const { GET } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/marketplace/assets/a1/download');
    const res = await GET(req, { params: Promise.resolve({ id: 'a1' }) });

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('https://cdn.example.com/files/owned.glb');
  });

  it('should return 400 for disallowed hosts', async () => {
    const assetChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{
        id: 'a1',
        sellerId: 'user_1',
        assetFileUrl: 'https://evil.attacker.com/malware.exe',
      }]),
    };
    const purchaseChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ id: 'p1' }]),
    };
    // update chain is needed for the atomic downloadCount increment (PF-7507)
    const updateChain = {
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([]),
    };
    const mockDb = {
      select: vi.fn()
        .mockReturnValueOnce(assetChain)
        .mockReturnValueOnce(purchaseChain),
      update: vi.fn().mockReturnValue(updateChain),
    };
    vi.mocked(getDb).mockReturnValue(mockDb as never);

    const { GET } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/marketplace/assets/a1/download');
    const res = await GET(req, { params: Promise.resolve({ id: 'a1' }) });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('Invalid file URL');
  });
});
