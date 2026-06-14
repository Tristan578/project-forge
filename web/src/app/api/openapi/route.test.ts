import { NextRequest, NextResponse } from 'next/server';
vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockReadFileSync = vi.fn();
const mockExistsSync = vi.fn();
const mockCaptureException = vi.fn();
const mockRateLimitPublicRoute = vi.fn();

vi.mock('fs', () => ({
  readFileSync: mockReadFileSync,
  existsSync: mockExistsSync,
  default: { readFileSync: mockReadFileSync, existsSync: mockExistsSync },
}));

vi.mock('@/lib/rateLimit', () => ({
  rateLimitPublicRoute: mockRateLimitPublicRoute,
}));

vi.mock('@/lib/monitoring/sentry-server', () => ({
  captureException: mockCaptureException,
}));

describe('GET /api/openapi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    // Default: not rate limited, file exists and returns valid content.
    // clearAllMocks() wipes call history but NOT implementations — re-assert the
    // resolved value each test so a prior mockResolvedValueOnce can't bleed through.
    mockRateLimitPublicRoute.mockResolvedValue(null);
    mockExistsSync.mockReturnValue(true);
  });

  it('should return OpenAPI spec as JSON', async () => {
    const mockSpec = { openapi: '3.1.0', info: { title: 'SpawnForge API', version: '1.0.0' } };
    mockReadFileSync.mockReturnValue(JSON.stringify(mockSpec));

    const { GET } = await import('./route');
    const res = await GET(new NextRequest('http://localhost/test'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.openapi).toBe('3.1.0');
    expect(body.info.title).toBe('SpawnForge API');
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=3600');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('should short-circuit with the rate-limit response without reading the spec', async () => {
    // A non-null return from rateLimitPublicRoute means the caller is throttled;
    // the handler must return it verbatim and never touch the filesystem. Guards
    // against a future refactor dropping the `if (limited) return limited` check
    // (or the `await`, which would make `limited` a truthy Promise every time).
    const limitResponse = NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    mockRateLimitPublicRoute.mockResolvedValueOnce(limitResponse);

    const { GET } = await import('./route');
    const res = await GET(new NextRequest('http://localhost/test'));

    expect(res.status).toBe(429);
    expect(mockExistsSync).not.toHaveBeenCalled();
    expect(mockReadFileSync).not.toHaveBeenCalled();
  });

  it('should return 404 when spec file does not exist', async () => {
    mockExistsSync.mockReturnValue(false);

    const { GET } = await import('./route');
    const res = await GET(new NextRequest('http://localhost/test'));
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe('OpenAPI spec not yet generated');
    // A missing spec is an expected "not generated yet" state, not a server error.
    expect(mockCaptureException).not.toHaveBeenCalled();
  });

  it('should return 404 (generic) when readFileSync throws ENOENT after existsSync passed', async () => {
    // TOCTOU: existsSync passes, then the file vanishes before readFileSync. The
    // catch block must classify ENOENT as a 404 (not a 500) and NOT report to Sentry.
    const enoent = new Error('ENOENT: no such file or directory');
    (enoent as NodeJS.ErrnoException).code = 'ENOENT';
    mockReadFileSync.mockImplementation(() => {
      throw enoent;
    });

    const { GET } = await import('./route');
    const res = await GET(new NextRequest('http://localhost/test'));
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toContain('Run the spec generation script');
    expect(mockCaptureException).not.toHaveBeenCalled();
  });

  it('should return 500 with a generic body (no parse internals) when spec file has invalid JSON', async () => {
    mockReadFileSync.mockReturnValue('not valid json {{{');

    const { GET } = await import('./route');
    const res = await GET(new NextRequest('http://localhost/test'));
    const body = await res.json();

    expect(res.status).toBe(500);
    // Body is a fixed, generic message — never the raw SyntaxError, which names a
    // byte offset in the spec and would leak internals to an unauthenticated caller.
    expect(body.error).toBe('Failed to load the OpenAPI specification.');
    expect(JSON.stringify(body)).not.toMatch(/Unexpected token|position|JSON\.parse|not valid json/i);
    // The real error still reaches Sentry so the malformed spec is observable.
    expect(mockCaptureException).toHaveBeenCalledTimes(1);
    expect(mockCaptureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ route: '/api/openapi' })
    );
  });
});
