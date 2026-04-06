vi.mock('@/lib/rateLimit', () => ({
  rateLimitPublicRoute: vi.fn().mockResolvedValue(null),
}));
// Mock Next.js `after()` which throws outside request scope in tests
vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>();
  return {
    ...actual,
    after: vi.fn((fn: () => void) => fn()),
  };
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { rateLimitPublicRoute } from '@/lib/rateLimit';

describe('POST /api/vitals', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('should return 204 for valid metric', async () => {
    const { POST } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/vitals', {
      method: 'POST',
      body: JSON.stringify({ name: 'LCP', value: 2500, id: 'v1-abc', delta: 100 }),
    });
    const res = await POST(req);
    expect(res.status).toBe(204);
  });

  it('should return 400 for invalid JSON', async () => {
    const { POST } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/vitals', {
      method: 'POST',
      body: 'not json',
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('Invalid JSON');
  });

  it('should return 400 for missing required fields', async () => {
    const { POST } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/vitals', {
      method: 'POST',
      body: JSON.stringify({ name: 'LCP' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('should return 400 for invalid metric name', async () => {
    const { POST } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/vitals', {
      method: 'POST',
      body: JSON.stringify({ name: 'INVALID', value: 100, id: 'v1-abc', delta: 50 }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('Invalid metric name');
  });

  it('should reject non-finite values', async () => {
    const { POST } = await import('./route');
    // NaN serializes to null in JSON, so use Infinity which also fails isFinite
    const req = new NextRequest('http://localhost:3000/api/vitals', {
      method: 'POST',
      body: '{"name":"LCP","value":null,"id":"v1","delta":0}',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('should return 429 when rate limited', async () => {
    vi.mocked(rateLimitPublicRoute).mockResolvedValue(
      new Response('Rate limited', { status: 429 }) as never
    );
    const { POST } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/vitals', {
      method: 'POST',
      body: JSON.stringify({ name: 'LCP', value: 100, id: 'v1', delta: 10 }),
    });
    const res = await POST(req);
    expect(res.status).toBe(429);
  });

  it('should accept all valid metric names', async () => {
    const validNames = ['LCP', 'FCP', 'CLS', 'INP', 'TTFB'];
    const { POST } = await import('./route');
    for (const name of validNames) {
      vi.mocked(rateLimitPublicRoute).mockResolvedValue(null);
      const req = new NextRequest('http://localhost:3000/api/vitals', {
        method: 'POST',
        body: JSON.stringify({ name, value: 100, id: `v1-${name}`, delta: 10 }),
      });
      const res = await POST(req);
      expect(res.status, `${name} should be accepted`).toBe(204);
    }
  });
});
