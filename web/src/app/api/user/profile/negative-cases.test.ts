vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { withApiMiddleware } from '@/lib/api/middleware';
import { updateDisplayName } from '@/lib/auth/user-service';

vi.mock('@/lib/api/middleware');
vi.mock('@/lib/auth/user-service');
vi.mock('@/lib/monitoring/sentry-server', () => ({
  captureException: vi.fn(),
}));

const BASE_URL = 'http://localhost:3000/api/user/profile';

function makeReq(method: string, body?: string) {
  if (body) {
    return new NextRequest(BASE_URL, {
      method,
      body,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return new NextRequest(BASE_URL, { method });
}

function mockMiddlewareSuccess(
  userId = 'user_1',
  body: unknown = undefined,
) {
  vi.mocked(withApiMiddleware).mockResolvedValue({
    error: undefined,
    userId,
    authContext: {
      clerkId: 'clerk_1',
      user: {
        id: userId,
        tier: 'creator',
        displayName: 'Existing Name',
        email: 'user@example.com',
        createdAt: new Date('2026-01-01'),
      } as never,
    },
    body,
  });
}

function mockMiddlewareError(status: number, error: string, code?: string) {
  const respBody: Record<string, unknown> = { error };
  if (code) respBody.code = code;
  const mockResponse = new Response(JSON.stringify(respBody), { status });
  vi.mocked(withApiMiddleware).mockResolvedValue({
    error: mockResponse as never,
    userId: null,
    authContext: null,
    body: undefined,
  });
}

describe('PF-675: Negative cases for /api/user/profile', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  describe('GET — error paths', () => {
    it('returns 401 when middleware rejects unauthenticated request', async () => {
      mockMiddlewareError(401, 'Unauthorized', 'UNAUTHORIZED');

      const { GET } = await import('./route');
      const res = await GET(makeReq('GET'));

      expect(res.status).toBe(401);
    });

    it('returns 429 when middleware rejects rate-limited request', async () => {
      mockMiddlewareError(429, 'Rate limited');

      const { GET } = await import('./route');
      const res = await GET(makeReq('GET'));

      expect(res.status).toBe(429);
    });
  });

  describe('PUT — input validation', () => {
    it('returns 400 when middleware rejects malformed JSON', async () => {
      mockMiddlewareError(400, 'Invalid JSON body', 'BAD_REQUEST');

      const { PUT } = await import('./route');
      const res = await PUT(makeReq('PUT', '{bad json'));

      expect(res.status).toBe(400);
    });

    it('returns 422 when middleware rejects displayName > 100 chars', async () => {
      mockMiddlewareError(422, 'Validation failed', 'VALIDATION_ERROR');

      const { PUT } = await import('./route');
      const longName = 'X'.repeat(101);
      const res = await PUT(makeReq('PUT', JSON.stringify({ displayName: longName })));
      const body = await res.json();

      expect(res.status).toBe(422);
      expect(body.code).toBe('VALIDATION_ERROR');
    });

    it('returns 422 when displayName is null', async () => {
      mockMiddlewareError(422, 'Validation failed', 'VALIDATION_ERROR');

      const { PUT } = await import('./route');
      const res = await PUT(makeReq('PUT', JSON.stringify({ displayName: null })));

      expect(res.status).toBe(422);
    });

    it('returns 422 when displayName is a number', async () => {
      mockMiddlewareError(422, 'Validation failed', 'VALIDATION_ERROR');

      const { PUT } = await import('./route');
      const res = await PUT(makeReq('PUT', JSON.stringify({ displayName: 42 })));

      expect(res.status).toBe(422);
    });

    it('returns 422 when body contains extra fields but displayName is missing', async () => {
      mockMiddlewareError(422, 'Validation failed', 'VALIDATION_ERROR');

      const { PUT } = await import('./route');
      const res = await PUT(makeReq('PUT', JSON.stringify({ email: 'hacker@evil.com' })));

      expect(res.status).toBe(422);
    });
  });

  describe('PUT — service errors', () => {
    it('returns 500 when updateDisplayName throws a DB error', async () => {
      mockMiddlewareSuccess('user_1', { displayName: 'Valid Name' });
      vi.mocked(updateDisplayName).mockRejectedValue(new Error('connection reset'));

      const { PUT } = await import('./route');
      const res = await PUT(makeReq('PUT', JSON.stringify({ displayName: 'Valid Name' })));
      const body = await res.json();

      expect(res.status).toBe(500);
      expect(body.code).toBe('INTERNAL_ERROR');
    });

    it('returns 500 when updateDisplayName throws a non-Error value', async () => {
      mockMiddlewareSuccess('user_1', { displayName: 'Valid Name' });
      vi.mocked(updateDisplayName).mockRejectedValue(null);

      const { PUT } = await import('./route');
      const res = await PUT(makeReq('PUT', JSON.stringify({ displayName: 'Valid Name' })));

      expect(res.status).toBe(500);
    });

    it('does not leak internal error details to the client', async () => {
      mockMiddlewareSuccess('user_1', { displayName: 'Valid Name' });
      vi.mocked(updateDisplayName).mockRejectedValue(
        new Error('FATAL: password authentication failed for user "spawnforge_rw"')
      );

      const { PUT } = await import('./route');
      const res = await PUT(makeReq('PUT', JSON.stringify({ displayName: 'Valid Name' })));
      const body = await res.json();

      expect(res.status).toBe(500);
      // Error message must be generic, not the internal DB error
      expect(body.error).not.toContain('password');
      expect(body.error).not.toContain('spawnforge_rw');
    });
  });
});
