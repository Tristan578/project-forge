import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Mocks must be declared before any imports that reference the mocked modules.
// ---------------------------------------------------------------------------

const mockAuthenticateRequest = vi.fn();
vi.mock('@/lib/auth/api-auth', () => ({
  authenticateRequest: () => mockAuthenticateRequest(),
}));

const mockDistributedRateLimit = vi.fn();
vi.mock('@/lib/rateLimit/distributed', () => ({
  distributedRateLimit: (...args: unknown[]) => mockDistributedRateLimit(...args),
}));

const mockRateLimit = vi.fn();
const mockRateLimitResponse = vi.fn();
const mockGetClientIp = vi.fn();
vi.mock('@/lib/rateLimit', () => ({
  rateLimit: (...args: unknown[]) => mockRateLimit(...args),
  rateLimitResponse: (...args: unknown[]) => mockRateLimitResponse(...args),
  getClientIp: (_req: unknown) => mockGetClientIp(_req),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { withApiMiddleware } from '@/lib/api/middleware';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(headers: Record<string, string> = {}): NextRequest {
  const req = {
    headers: {
      get: (key: string) => headers[key] ?? null,
    },
  } as unknown as NextRequest;
  return req;
}

const mockUser = { id: 'user-1', tier: 'hobbyist' };
const mockAuthContext = { user: mockUser, clerkId: 'clerk-1' };

function allowedRlResult() {
  return { allowed: true, remaining: 9, resetAt: Date.now() + 60_000 };
}

function deniedRlResult() {
  return { allowed: false, remaining: 0, resetAt: Date.now() + 30_000 };
}

const rl429 = { status: 429 } as ReturnType<typeof mockRateLimitResponse>;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('withApiMiddleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetClientIp.mockReturnValue('1.2.3.4');
    mockRateLimitResponse.mockReturnValue(rl429);
  });

  // -----------------------------------------------------------------------
  // Auth-only (no rate limit)
  // -----------------------------------------------------------------------

  describe('authentication', () => {
    it('returns authContext when auth succeeds and no rate-limit requested', async () => {
      mockAuthenticateRequest.mockResolvedValue({ ok: true, ctx: mockAuthContext });

      const result = await withApiMiddleware(makeRequest(), { requireAuth: true });

      expect(result.error).toBeUndefined();
      expect(result.userId).toBe('user-1');
      expect(result.authContext).toEqual(mockAuthContext);
    });

    it('returns error response when auth fails', async () => {
      const authError = { status: 401 };
      mockAuthenticateRequest.mockResolvedValue({ ok: false, response: authError });

      const result = await withApiMiddleware(makeRequest(), { requireAuth: true });

      expect(result.error).toBe(authError);
      expect(result.userId).toBeNull();
    });

    it('skips auth when requireAuth = false', async () => {
      const result = await withApiMiddleware(makeRequest(), { requireAuth: false });

      expect(mockAuthenticateRequest).not.toHaveBeenCalled();
      expect(result.error).toBeUndefined();
      expect(result.userId).toBeNull();
      expect(result.authContext).toBeNull();
    });

    it('defaults to requireAuth = true', async () => {
      mockAuthenticateRequest.mockResolvedValue({ ok: true, ctx: mockAuthContext });

      await withApiMiddleware(makeRequest());

      expect(mockAuthenticateRequest).toHaveBeenCalledOnce();
    });
  });

  // -----------------------------------------------------------------------
  // Rate limiting — distributed (default)
  // -----------------------------------------------------------------------

  describe('distributed rate limiting', () => {
    it('allows request when distributed limiter allows', async () => {
      mockAuthenticateRequest.mockResolvedValue({ ok: true, ctx: mockAuthContext });
      mockDistributedRateLimit.mockResolvedValue(allowedRlResult());

      const result = await withApiMiddleware(makeRequest(), {
        requireAuth: true,
        rateLimit: true,
        rateLimitConfig: { key: (id) => `test:${id}`, max: 10, windowSeconds: 60 },
      });

      expect(result.error).toBeUndefined();
      expect(mockDistributedRateLimit).toHaveBeenCalledWith('test:user-1', 10, 60);
    });

    it('returns 429 when distributed limiter denies', async () => {
      mockAuthenticateRequest.mockResolvedValue({ ok: true, ctx: mockAuthContext });
      mockDistributedRateLimit.mockResolvedValue(deniedRlResult());

      const result = await withApiMiddleware(makeRequest(), {
        requireAuth: true,
        rateLimit: true,
        rateLimitConfig: { key: (id) => `test:${id}`, max: 10, windowSeconds: 60 },
      });

      expect(result.error).toBe(rl429);
    });

    it('uses client IP as identifier when useIp = true', async () => {
      mockGetClientIp.mockReturnValue('5.6.7.8');
      mockDistributedRateLimit.mockResolvedValue(allowedRlResult());

      await withApiMiddleware(makeRequest(), {
        requireAuth: false,
        rateLimit: true,
        rateLimitConfig: { key: (ip) => `public:health:${ip}`, max: 60, windowSeconds: 60, useIp: true },
      });

      expect(mockDistributedRateLimit).toHaveBeenCalledWith('public:health:5.6.7.8', 60, 60);
    });
  });

  // -----------------------------------------------------------------------
  // Rate limiting — in-memory fallback
  // -----------------------------------------------------------------------

  describe('in-memory rate limiting', () => {
    it('uses in-memory limiter when distributed = false', async () => {
      mockAuthenticateRequest.mockResolvedValue({ ok: true, ctx: mockAuthContext });
      mockRateLimit.mockResolvedValue(allowedRlResult());

      const result = await withApiMiddleware(makeRequest(), {
        requireAuth: true,
        rateLimit: true,
        rateLimitConfig: { key: (id) => `test:${id}`, max: 5, windowSeconds: 30, distributed: false },
      });

      expect(result.error).toBeUndefined();
      // windowSeconds * 1000 because in-memory rateLimit takes windowMs
      expect(mockRateLimit).toHaveBeenCalledWith('test:user-1', 5, 30_000);
      expect(mockDistributedRateLimit).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // Pipeline ordering: auth before rate-limit
  // -----------------------------------------------------------------------

  describe('pipeline ordering', () => {
    it('runs auth before rate-limit and skips rate-limit on auth failure', async () => {
      const authError = { status: 401 };
      mockAuthenticateRequest.mockResolvedValue({ ok: false, response: authError });

      await withApiMiddleware(makeRequest(), {
        requireAuth: true,
        rateLimit: true,
        rateLimitConfig: { key: (id) => `test:${id}`, max: 10, windowSeconds: 60 },
      });

      // Rate-limit must NOT have been called after auth failure
      expect(mockDistributedRateLimit).not.toHaveBeenCalled();
      expect(mockRateLimit).not.toHaveBeenCalled();
    });

    it('skips rate-limit entirely when rateLimit = false', async () => {
      mockAuthenticateRequest.mockResolvedValue({ ok: true, ctx: mockAuthContext });

      await withApiMiddleware(makeRequest(), { requireAuth: true, rateLimit: false });

      expect(mockDistributedRateLimit).not.toHaveBeenCalled();
      expect(mockRateLimit).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // No-options defaults
  // -----------------------------------------------------------------------

  describe('defaults', () => {
    it('defaults rateLimit to false so no Redis call is made', async () => {
      mockAuthenticateRequest.mockResolvedValue({ ok: true, ctx: mockAuthContext });

      await withApiMiddleware(makeRequest());

      expect(mockDistributedRateLimit).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // Handler-wrapping overload — rollback (handler never called on failure)
  // -----------------------------------------------------------------------

  describe('handler-wrapping overload rollback', () => {
    it('returns 401 and never calls handler when auth fails', async () => {
      const authError = NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      mockAuthenticateRequest.mockResolvedValue({ ok: false, response: authError });
      const handlerFn = vi.fn(async () => NextResponse.json({ ok: true }));

      const wrapped = withApiMiddleware(handlerFn, { requireAuth: true });
      const res = await wrapped(new NextRequest('http://localhost/api/test'));

      expect(res.status).toBe(401);
      expect(handlerFn).not.toHaveBeenCalled();
    });

    it('returns 429 and never calls handler when rate limit denies', async () => {
      mockAuthenticateRequest.mockResolvedValue({ ok: true, ctx: mockAuthContext });
      mockDistributedRateLimit.mockResolvedValue(deniedRlResult());
      mockRateLimitResponse.mockReturnValue(
        NextResponse.json({ error: 'Too many requests' }, { status: 429 }),
      );
      const handlerFn = vi.fn(async () => NextResponse.json({ ok: true }));

      const wrapped = withApiMiddleware(handlerFn, {
        requireAuth: true,
        rateLimit: true,
        rateLimitConfig: { key: (id) => `test:${id}`, max: 5, windowSeconds: 60 },
      });
      const res = await wrapped(new NextRequest('http://localhost/api/test'));

      expect(res.status).toBe(429);
      expect(handlerFn).not.toHaveBeenCalled();
    });

    it('returns 400 and never calls handler for unparseable JSON body', async () => {
      const handlerFn = vi.fn(async () => NextResponse.json({ ok: true }));

      const wrapped = withApiMiddleware(handlerFn, {
        requireAuth: false,
        validate: z.object({ name: z.string() }),
      });

      const req = new NextRequest('http://localhost/api/test', {
        method: 'POST',
        body: 'not-json',
        headers: { 'Content-Type': 'application/json' },
      });
      const res = await wrapped(req);

      expect(res.status).toBe(400);
      expect(handlerFn).not.toHaveBeenCalled();
    });

    it('calls handler with parsed body and userId on success', async () => {
      mockAuthenticateRequest.mockResolvedValue({ ok: true, ctx: mockAuthContext });
      const handlerFn = vi.fn(async (_req: NextRequest, ctx: { userId: string | null; body: unknown }) =>
        NextResponse.json({ userId: ctx.userId, body: ctx.body }),
      );

      const wrapped = withApiMiddleware(handlerFn, {
        requireAuth: true,
        validate: z.object({ action: z.string() }),
      });

      const req = new NextRequest('http://localhost/api/test', {
        method: 'POST',
        body: JSON.stringify({ action: 'reset' }),
        headers: { 'Content-Type': 'application/json' },
      });
      const res = await wrapped(req);

      expect(res.status).toBe(200);
      expect(handlerFn).toHaveBeenCalledOnce();
      const resBody = await res.json();
      expect(resBody.userId).toBe('user-1');
      expect(resBody.body).toEqual({ action: 'reset' });
    });
  });

  // -----------------------------------------------------------------------
  // Zod validation (Plan E task E2)
  // -----------------------------------------------------------------------

  describe('validate option', () => {
    it('validates request body with Zod schema and passes parsed body to handler', async () => {
      const handler = withApiMiddleware(
        async (_req, { body }) => NextResponse.json({ received: body }),
        {
          requireAuth: false,
          validate: z.object({ name: z.string(), count: z.number() }),
        },
      );

      const req = new NextRequest('http://localhost/api/test', {
        method: 'POST',
        body: JSON.stringify({ name: 'test', count: 5 }),
        headers: { 'Content-Type': 'application/json' },
      });

      const res = await handler(req);
      expect(res.status).toBe(200);
      const resBody = await res.json();
      expect(resBody.received).toEqual({ name: 'test', count: 5 });
    });

    it('returns 422 for invalid body', async () => {
      const handler = withApiMiddleware(
        async () => NextResponse.json({ ok: true }),
        {
          requireAuth: false,
          validate: z.object({ name: z.string() }),
        },
      );

      const req = new NextRequest('http://localhost/api/test', {
        method: 'POST',
        body: JSON.stringify({ name: 123 }), // wrong type
        headers: { 'Content-Type': 'application/json' },
      });

      const res = await handler(req);
      expect(res.status).toBe(422);
    });

    it('does not leak Zod details in production environment', async () => {
      // Regression test for security audit finding: Zod's formatted error tree
      // discloses server-side schema field paths. Production responses must
      // carry only the fixed 'Validation failed' + code, with no details tree.
      const originalEnv = process.env.NODE_ENV;
      try {
        // @ts-expect-error — test override of readonly NODE_ENV
        process.env.NODE_ENV = 'production';
        const handler = withApiMiddleware(
          async () => NextResponse.json({ ok: true }),
          {
            requireAuth: false,
            validate: z.object({ secretInternalField: z.string() }),
          },
        );
        const req = new NextRequest('http://localhost/api/test', {
          method: 'POST',
          body: JSON.stringify({ wrongField: 'x' }),
          headers: { 'Content-Type': 'application/json' },
        });
        const res = await handler(req);
        expect(res.status).toBe(422);
        const body = await res.json();
        expect(body.error).toBe('Validation failed');
        expect(body.code).toBe('VALIDATION_ERROR');
        expect(body.details).toBeUndefined();
        // Field name must NOT appear anywhere in the response body
        expect(JSON.stringify(body)).not.toContain('secretInternalField');
      } finally {
        // @ts-expect-error — restore readonly NODE_ENV
        process.env.NODE_ENV = originalEnv;
      }
    });

    it('includes Zod details in development environment', async () => {
      const originalEnv = process.env.NODE_ENV;
      try {
        // @ts-expect-error — test override of readonly NODE_ENV
        process.env.NODE_ENV = 'development';
        const handler = withApiMiddleware(
          async () => NextResponse.json({ ok: true }),
          {
            requireAuth: false,
            validate: z.object({ name: z.string() }),
          },
        );
        const req = new NextRequest('http://localhost/api/test', {
          method: 'POST',
          body: JSON.stringify({ name: 123 }),
          headers: { 'Content-Type': 'application/json' },
        });
        const res = await handler(req);
        const body = await res.json();
        expect(res.status).toBe(422);
        expect(body.details).toBeDefined();
      } finally {
        // @ts-expect-error — restore readonly NODE_ENV
        process.env.NODE_ENV = originalEnv;
      }
    });

    it('does not run validation when validate option is not provided', async () => {
      const handlerFn = vi.fn(async () => NextResponse.json({ ok: true }));
      const handler = withApiMiddleware(handlerFn, { requireAuth: false });

      const req = new NextRequest('http://localhost/api/test', {
        method: 'POST',
        body: JSON.stringify({ anything: true }),
        headers: { 'Content-Type': 'application/json' },
      });

      const res = await handler(req);
      expect(res.status).toBe(200);
      expect(handlerFn).toHaveBeenCalled();
    });
  });
});
