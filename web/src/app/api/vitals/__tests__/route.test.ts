import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Mock next/server: execute after() callbacks synchronously so tests can
// assert on side effects (logging) without needing to flush microtasks.
vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>();
  return {
    ...actual,
    after: vi.fn((cb: () => void) => { cb(); }),
  };
});

// Mock rateLimit module
vi.mock('@/lib/rateLimit', () => {
  const mockRateLimitPublicRoute = vi.fn().mockResolvedValue(null);
  return {
    rateLimitPublicRoute: mockRateLimitPublicRoute,
    rateLimit: vi.fn(),
    getClientIp: vi.fn().mockReturnValue('127.0.0.1'),
    rateLimitResponse: vi.fn(),
    rateLimitAdminRoute: vi.fn(),
  };
});

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/vitals', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function makeRawRequest(body: string): NextRequest {
  return new NextRequest('http://localhost:3000/api/vitals', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
}

describe('POST /api/vitals', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('accepts valid LCP metric and returns 204', async () => {
    const { POST } = await import('@/app/api/vitals/route');
    const req = makeRequest({ name: 'LCP', value: 2500, id: 'v4-abc', delta: 2500 });
    const res = await POST(req);
    expect(res.status).toBe(204);
  });

  it('accepts valid FCP metric', async () => {
    const { POST } = await import('@/app/api/vitals/route');
    const req = makeRequest({ name: 'FCP', value: 1200, id: 'v4-def', delta: 1200 });
    const res = await POST(req);
    expect(res.status).toBe(204);
  });

  it('accepts valid CLS metric', async () => {
    const { POST } = await import('@/app/api/vitals/route');
    const req = makeRequest({ name: 'CLS', value: 0.05, id: 'v4-ghi', delta: 0.01 });
    const res = await POST(req);
    expect(res.status).toBe(204);
  });

  it('accepts valid INP metric', async () => {
    const { POST } = await import('@/app/api/vitals/route');
    const req = makeRequest({ name: 'INP', value: 200, id: 'v4-jkl', delta: 200 });
    const res = await POST(req);
    expect(res.status).toBe(204);
  });

  it('accepts valid TTFB metric', async () => {
    const { POST } = await import('@/app/api/vitals/route');
    const req = makeRequest({ name: 'TTFB', value: 800, id: 'v4-mno', delta: 800 });
    const res = await POST(req);
    expect(res.status).toBe(204);
  });

  it('rejects invalid metric name with 400', async () => {
    const { POST } = await import('@/app/api/vitals/route');
    const req = makeRequest({ name: 'INVALID', value: 100, id: 'v4-xxx', delta: 100 });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('Invalid metric name');
  });

  it('rejects missing name field with 400', async () => {
    const { POST } = await import('@/app/api/vitals/route');
    const req = makeRequest({ value: 100, id: 'v4-xxx', delta: 100 });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('Missing or invalid required fields');
  });

  it('rejects missing value field with 400', async () => {
    const { POST } = await import('@/app/api/vitals/route');
    const req = makeRequest({ name: 'LCP', id: 'v4-xxx', delta: 100 });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('rejects missing id field with 400', async () => {
    const { POST } = await import('@/app/api/vitals/route');
    const req = makeRequest({ name: 'LCP', value: 100, delta: 100 });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('rejects missing delta field with 400', async () => {
    const { POST } = await import('@/app/api/vitals/route');
    const req = makeRequest({ name: 'LCP', value: 100, id: 'v4-xxx' });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('rejects non-finite value with 400', async () => {
    const { POST } = await import('@/app/api/vitals/route');
    const req = makeRequest({ name: 'LCP', value: Infinity, id: 'v4-xxx', delta: 100 });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('invalid required fields');
  });

  it('rejects non-finite delta with 400', async () => {
    const { POST } = await import('@/app/api/vitals/route');
    const req = makeRequest({ name: 'LCP', value: 100, id: 'v4-xxx', delta: NaN });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('invalid required fields');
  });

  it('rejects invalid JSON with 400', async () => {
    const { POST } = await import('@/app/api/vitals/route');
    const req = makeRawRequest('not-json{');
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('Invalid JSON');
  });

  it('returns 429 when rate limited', async () => {
    const { NextResponse } = await import('next/server');
    const rateLimitMod = await import('@/lib/rateLimit');
    const mockFn = rateLimitMod.rateLimitPublicRoute as ReturnType<typeof vi.fn>;
    mockFn.mockResolvedValueOnce(
      NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    );

    const { POST } = await import('@/app/api/vitals/route');
    const req = makeRequest({ name: 'LCP', value: 100, id: 'v4-xxx', delta: 100 });
    const res = await POST(req);
    expect(res.status).toBe(429);
  });

  it('logs structured JSON in production via after()', async () => {
    const originalEnv = process.env.NODE_ENV;
    // @ts-expect-error -- override for test
    process.env.NODE_ENV = 'production';

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const { POST } = await import('@/app/api/vitals/route');
    const req = makeRequest({ name: 'LCP', value: 2500, id: 'v4-abc', delta: 2500 });
    await POST(req);

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('"type":"web-vital"')
    );
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('"metric":"LCP"')
    );

    consoleSpy.mockRestore();
    // @ts-expect-error -- restore
    process.env.NODE_ENV = originalEnv;
  });

  it('schedules logging via after() so response is not blocked', async () => {
    const { after } = await import('next/server');
    const afterMock = after as ReturnType<typeof vi.fn>;
    afterMock.mockClear();

    const { POST } = await import('@/app/api/vitals/route');
    const req = makeRequest({ name: 'FCP', value: 1500, id: 'v4-after', delta: 1500 });
    const res = await POST(req);

    // Response must be 204 before after() callback runs
    expect(res.status).toBe(204);
    // after() must have been called once to schedule the logging callback
    expect(afterMock).toHaveBeenCalledTimes(1);
  });
});
