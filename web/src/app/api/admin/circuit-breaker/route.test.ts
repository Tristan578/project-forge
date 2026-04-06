vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/api-auth');
vi.mock('@/lib/api/middleware');
vi.mock('@/lib/rateLimit', () => ({
  rateLimitAdminRoute: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/lib/providers/circuitBreaker');
vi.mock('@/lib/monitoring/sentry-server', () => ({
  captureException: vi.fn(),
}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { assertAdmin } from '@/lib/auth/api-auth';
import { withApiMiddleware } from '@/lib/api/middleware';
import { getAllBreakerStats, resetProviderBreaker, resetAllBreakers } from '@/lib/providers/circuitBreaker';

describe('/api/admin/circuit-breaker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(withApiMiddleware).mockResolvedValue({
      error: null,
      authContext: { clerkId: 'admin_1', user: { id: 'u1', tier: 'pro' } },
    } as never);
    vi.mocked(assertAdmin).mockReturnValue(null);
  });

  describe('GET', () => {
    it('should return circuit breaker stats', async () => {
      vi.mocked(getAllBreakerStats).mockReturnValue([
        { provider: 'anthropic', state: 'CLOSED', failCount: 0, lastFailure: null },
        { provider: 'openai', state: 'OPEN', failCount: 5, lastFailure: new Date().toISOString() },
      ] as never);

      const { GET } = await import('./route');
      const req = new NextRequest('http://localhost:3000/api/admin/circuit-breaker');
      const res = await GET(req);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.summary.total).toBe(2);
      expect(body.summary.healthy).toBe(1);
      expect(body.summary.open).toBe(1);
      expect(body.providers).toHaveLength(2);
    });

    it('should return 401 when not authenticated', async () => {
      vi.mocked(withApiMiddleware).mockResolvedValue({
        error: new Response('Unauthorized', { status: 401 }),
        authContext: null,
      } as never);

      const { GET } = await import('./route');
      const req = new NextRequest('http://localhost:3000/api/admin/circuit-breaker');
      const res = await GET(req);
      expect(res.status).toBe(401);
    });

    it('should return 403 when not admin', async () => {
      vi.mocked(assertAdmin).mockReturnValue(
        new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { 'Content-Type': 'application/json' } }) as never
      );

      const { GET } = await import('./route');
      const req = new NextRequest('http://localhost:3000/api/admin/circuit-breaker');
      const res = await GET(req);
      expect(res.status).toBe(403);
    });
  });

  describe('POST', () => {
    it('should reset all breakers', async () => {
      const { POST } = await import('./route');
      const req = new NextRequest('http://localhost:3000/api/admin/circuit-breaker', {
        method: 'POST',
        body: JSON.stringify({ action: 'reset_all' }),
      });
      const res = await POST(req);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(resetAllBreakers).toHaveBeenCalled();
    });

    it('should reset a specific provider', async () => {
      const { POST } = await import('./route');
      const req = new NextRequest('http://localhost:3000/api/admin/circuit-breaker', {
        method: 'POST',
        body: JSON.stringify({ action: 'reset_provider', provider: 'anthropic' }),
      });
      const res = await POST(req);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(resetProviderBreaker).toHaveBeenCalledWith('anthropic');
    });

    it('should return 400 for missing provider on reset_provider', async () => {
      const { POST } = await import('./route');
      const req = new NextRequest('http://localhost:3000/api/admin/circuit-breaker', {
        method: 'POST',
        body: JSON.stringify({ action: 'reset_provider' }),
      });
      const res = await POST(req);
      expect(res.status).toBe(400);
    });

    it('should return 400 for unknown action', async () => {
      const { POST } = await import('./route');
      const req = new NextRequest('http://localhost:3000/api/admin/circuit-breaker', {
        method: 'POST',
        body: JSON.stringify({ action: 'unknown' }),
      });
      const res = await POST(req);
      expect(res.status).toBe(400);
    });

    it('should return 400 for invalid JSON', async () => {
      const { POST } = await import('./route');
      const req = new NextRequest('http://localhost:3000/api/admin/circuit-breaker', {
        method: 'POST',
        body: 'not json',
        headers: { 'Content-Type': 'application/json' },
      });
      const res = await POST(req);
      expect(res.status).toBe(400);
    });

    it('should return 400 for unknown provider name', async () => {
      const { POST } = await import('./route');
      const req = new NextRequest('http://localhost:3000/api/admin/circuit-breaker', {
        method: 'POST',
        body: JSON.stringify({ action: 'reset_provider', provider: 'nonexistent' }),
      });
      const res = await POST(req);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('Unknown provider');
    });
  });
});
