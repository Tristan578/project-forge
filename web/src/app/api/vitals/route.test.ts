vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/rateLimit', () => ({
  rateLimitPublicRoute: vi.fn().mockResolvedValue(null),
}));

// Mock next/server's `after` — no-op since it's fire-and-forget
vi.mock('next/server', async () => {
  const actual = await vi.importActual('next/server');
  return { ...actual, after: () => {} };
});

import { rateLimitPublicRoute } from '@/lib/rateLimit';

const BASE_URL = 'http://localhost:3000/api/vitals';

function makeReq(body: unknown) {
  return new NextRequest(BASE_URL, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('POST /api/vitals', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(rateLimitPublicRoute).mockResolvedValue(null);
  });

  it('returns 204 for valid LCP metric', async () => {
    const { POST } = await import('./route');
    const req = makeReq({ name: 'LCP', value: 2500, id: 'v1-abc', delta: 100 });
    const res = await POST(req);

    expect(res.status).toBe(204);
  });

  it('returns 204 for valid CLS metric', async () => {
    const { POST } = await import('./route');
    const req = makeReq({ name: 'CLS', value: 0.1, id: 'v1-cls', delta: 0.05 });
    const res = await POST(req);

    expect(res.status).toBe(204);
  });

  it('accepts all valid metric names', async () => {
    const { POST } = await import('./route');
    for (const name of ['LCP', 'FCP', 'CLS', 'INP', 'TTFB']) {
      const req = makeReq({ name, value: 100, id: `v1-${name}`, delta: 10 });
      const res = await POST(req);
      expect(res.status).toBe(204);
    }
  });

  it('returns 400 for invalid metric name', async () => {
    const { POST } = await import('./route');
    const req = makeReq({ name: 'INVALID', value: 100, id: 'v1', delta: 10 });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain('Invalid metric name');
    expect(body.error).toContain('LCP');
  });

  it('returns 400 for missing required fields', async () => {
    const { POST } = await import('./route');
    const req = makeReq({ name: 'LCP' }); // missing value, id, delta
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain('Missing or invalid required fields');
  });

  it('returns 400 for non-finite value', async () => {
    const { POST } = await import('./route');
    const req = makeReq({ name: 'LCP', value: Infinity, id: 'v1', delta: 10 });
    const res = await POST(req);

    expect(res.status).toBe(400);
  });

  it('returns 400 for non-finite delta', async () => {
    const { POST } = await import('./route');
    const req = makeReq({ name: 'LCP', value: 100, id: 'v1', delta: NaN });
    const res = await POST(req);

    expect(res.status).toBe(400);
  });

  it('returns 400 for malformed JSON', async () => {
    const { POST } = await import('./route');
    const req = new NextRequest(BASE_URL, {
      method: 'POST',
      body: 'not json',
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain('Invalid JSON');
  });

  it('returns 400 for empty id string', async () => {
    const { POST } = await import('./route');
    const req = makeReq({ name: 'LCP', value: 100, id: '', delta: 10 });
    const res = await POST(req);

    expect(res.status).toBe(400);
  });

  it('returns rate limit response when limited', async () => {
    vi.mocked(rateLimitPublicRoute).mockResolvedValue(
      new Response(JSON.stringify({ error: 'Rate limited' }), { status: 429 }) as never
    );

    const { POST } = await import('./route');
    const req = makeReq({ name: 'LCP', value: 100, id: 'v1', delta: 10 });
    const res = await POST(req);

    expect(res.status).toBe(429);
  });

  it('returns 400 for id exceeding max length', async () => {
    const { POST } = await import('./route');
    const req = makeReq({ name: 'LCP', value: 100, id: 'x'.repeat(201), delta: 10 });
    const res = await POST(req);

    expect(res.status).toBe(400);
  });
});
