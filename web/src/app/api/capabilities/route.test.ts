vi.mock('@/lib/rateLimit', () => ({
  rateLimitPublicRoute: vi.fn().mockResolvedValue(null),
}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { rateLimitPublicRoute } from '@/lib/rateLimit';

describe('GET /api/capabilities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('should return 200 with capabilities list', async () => {
    const { GET } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/capabilities');
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.capabilities).toBeInstanceOf(Array);
    expect(body.capabilities.length).toBe(10);
    expect(body.available).toBeInstanceOf(Array);
    expect(body.unavailable).toBeInstanceOf(Array);
  });

  it('should mark capability as unavailable when env var is missing', async () => {
    vi.stubEnv('PLATFORM_MESHY_KEY', '');
    const { GET } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/capabilities');
    const res = await GET(req);
    const body = await res.json();

    const model3d = body.capabilities.find((c: { capability: string }) => c.capability === 'model3d');
    expect(model3d.available).toBe(false);
    expect(model3d.requiredProviders).toContain('Meshy');
    expect(model3d.hint).toBeDefined();
    vi.unstubAllEnvs();
  });

  it('should mark capability as available when env var is set', async () => {
    vi.stubEnv('PLATFORM_MESHY_KEY', 'test-key');
    const { GET } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/capabilities');
    const res = await GET(req);
    const body = await res.json();

    const model3d = body.capabilities.find((c: { capability: string }) => c.capability === 'model3d');
    expect(model3d.available).toBe(true);
    expect(model3d.requiredProviders).toBeUndefined();
    vi.unstubAllEnvs();
  });

  it('should return rate limit response when rate limited', async () => {
    vi.mocked(rateLimitPublicRoute).mockResolvedValue(
      new Response('Rate limited', { status: 429 }) as never
    );
    const { GET } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/capabilities');
    const res = await GET(req);

    expect(res.status).toBe(429);
  });

  it('should set cache headers on successful response', async () => {
    vi.mocked(rateLimitPublicRoute).mockResolvedValue(null);
    const { GET } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/capabilities');
    const res = await GET(req);

    // NextResponse.json() + headers.set — cache-control may be lowercased
    const cc = res.headers.get('Cache-Control') ?? res.headers.get('cache-control');
    expect(cc).toBe('public, max-age=60, s-maxage=300');
  });
});
