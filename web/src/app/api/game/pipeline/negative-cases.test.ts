vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { withApiMiddleware } from '@/lib/api/middleware';
import { reserveTokenBudget } from '@/lib/tokens/budget';

vi.mock('@/lib/api/middleware');
vi.mock('@/lib/tokens/budget');
vi.mock('@/lib/monitoring/sentry-server', () => ({
  captureException: vi.fn(),
}));

const BASE_URL = 'http://localhost:3000/api/game/pipeline';

function makeReq(body: string) {
  return new NextRequest(BASE_URL, {
    method: 'POST',
    body,
    headers: { 'Content-Type': 'application/json' },
  });
}

function mockMiddlewareSuccess(userId = 'user_1') {
  vi.mocked(withApiMiddleware).mockResolvedValue({
    error: undefined,
    userId,
    authContext: { clerkId: 'clerk_1', user: { id: userId, tier: 'creator' } as never },
    body: undefined,
  });
}

function mockMiddlewareError(status: number, error: string) {
  const mockResponse = new Response(JSON.stringify({ error }), { status });
  vi.mocked(withApiMiddleware).mockResolvedValue({
    error: mockResponse as never,
    userId: null,
    authContext: null,
    body: undefined,
  });
}

describe('PF-675: Negative cases for /api/game/pipeline', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockMiddlewareSuccess();
  });

  describe('auth & rate limiting', () => {
    it('returns 401 when unauthenticated', async () => {
      mockMiddlewareError(401, 'Unauthorized');

      const { POST } = await import('./route');
      const res = await POST(makeReq(JSON.stringify({ action: 'reserve', estimatedTotal: 100 })));

      expect(res.status).toBe(401);
    });

    it('returns 429 when rate limited', async () => {
      mockMiddlewareError(429, 'Rate limited');

      const { POST } = await import('./route');
      const res = await POST(makeReq(JSON.stringify({ action: 'reserve', estimatedTotal: 100 })));

      expect(res.status).toBe(429);
    });
  });

  describe('JSON parsing', () => {
    it('returns 400 for malformed JSON', async () => {
      const { POST } = await import('./route');
      const req = new NextRequest(BASE_URL, {
        method: 'POST',
        body: 'not json at all',
        headers: { 'Content-Type': 'application/json' },
      });
      const res = await POST(req);
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.error).toBe('validation_error');
      expect(body.details).toContain('Invalid JSON body');
    });

    it('returns 400 for empty body', async () => {
      const { POST } = await import('./route');
      const req = new NextRequest(BASE_URL, {
        method: 'POST',
        body: '',
        headers: { 'Content-Type': 'application/json' },
      });
      const res = await POST(req);

      expect(res.status).toBe(400);
    });
  });

  describe('discriminated union validation', () => {
    it('returns 400 for unknown action value', async () => {
      const { POST } = await import('./route');
      const res = await POST(makeReq(JSON.stringify({ action: 'destroy' })));
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.error).toBe('validation_error');
    });

    it('returns 400 for missing action field', async () => {
      const { POST } = await import('./route');
      const res = await POST(makeReq(JSON.stringify({ estimatedTotal: 100 })));
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.error).toBe('validation_error');
    });

    it('returns 400 when action is null', async () => {
      const { POST } = await import('./route');
      const res = await POST(makeReq(JSON.stringify({ action: null })));

      expect(res.status).toBe(400);
    });
  });

  describe('reserve action — validation', () => {
    it('returns 400 for negative estimatedTotal', async () => {
      const { POST } = await import('./route');
      const res = await POST(makeReq(JSON.stringify({ action: 'reserve', estimatedTotal: -1 })));
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.error).toBe('validation_error');
    });

    it('returns 400 for estimatedTotal exceeding MAX_PIPELINE_TOKENS', async () => {
      const { POST } = await import('./route');
      const res = await POST(makeReq(JSON.stringify({ action: 'reserve', estimatedTotal: 1_000_001 })));
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.error).toBe('validation_error');
    });

    it('returns 400 for float estimatedTotal', async () => {
      const { POST } = await import('./route');
      const res = await POST(makeReq(JSON.stringify({ action: 'reserve', estimatedTotal: 100.5 })));
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.error).toBe('validation_error');
    });

    it('returns 400 for string estimatedTotal', async () => {
      const { POST } = await import('./route');
      const res = await POST(makeReq(JSON.stringify({ action: 'reserve', estimatedTotal: '100' })));

      expect(res.status).toBe(400);
    });

    it('returns 402 when user has insufficient tokens', async () => {
      vi.mocked(reserveTokenBudget).mockResolvedValue({
        success: false,
        balance: 50,
        cost: 1000,
      } as never);

      const { POST } = await import('./route');
      const res = await POST(makeReq(JSON.stringify({ action: 'reserve', estimatedTotal: 1000 })));
      const body = await res.json();

      expect(res.status).toBe(402);
      expect(body.error).toBe('insufficient_tokens');
      expect(body.balance).toBe(50);
      expect(body.cost).toBe(1000);
    });
  });

  describe('record_step action — validation', () => {
    it('returns 400 for invalid UUID in reservationId', async () => {
      const { POST } = await import('./route');
      const res = await POST(makeReq(JSON.stringify({
        action: 'record_step',
        reservationId: 'not-a-uuid',
        stepId: 'step1',
        tokensUsed: 10,
      })));
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.error).toBe('validation_error');
    });

    it('returns 400 for empty stepId', async () => {
      const { POST } = await import('./route');
      const res = await POST(makeReq(JSON.stringify({
        action: 'record_step',
        reservationId: '550e8400-e29b-41d4-a716-446655440000',
        stepId: '',
        tokensUsed: 10,
      })));

      expect(res.status).toBe(400);
    });

    it('returns 400 for negative tokensUsed', async () => {
      const { POST } = await import('./route');
      const res = await POST(makeReq(JSON.stringify({
        action: 'record_step',
        reservationId: '550e8400-e29b-41d4-a716-446655440000',
        stepId: 'step1',
        tokensUsed: -5,
      })));

      expect(res.status).toBe(400);
    });
  });

  describe('release action — validation', () => {
    it('returns 400 for missing reservationId', async () => {
      const { POST } = await import('./route');
      const res = await POST(makeReq(JSON.stringify({
        action: 'release',
        actualUsed: 50,
      })));

      expect(res.status).toBe(400);
    });

    it('returns 400 for negative actualUsed', async () => {
      const { POST } = await import('./route');
      const res = await POST(makeReq(JSON.stringify({
        action: 'release',
        reservationId: '550e8400-e29b-41d4-a716-446655440000',
        actualUsed: -10,
      })));

      expect(res.status).toBe(400);
    });

    it('returns 400 for actualUsed exceeding MAX_PIPELINE_TOKENS', async () => {
      const { POST } = await import('./route');
      const res = await POST(makeReq(JSON.stringify({
        action: 'release',
        reservationId: '550e8400-e29b-41d4-a716-446655440000',
        actualUsed: 2_000_000,
      })));

      expect(res.status).toBe(400);
    });
  });
});
