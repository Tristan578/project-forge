vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { authenticateRequest, assertAdmin } from '@/lib/auth/api-auth';
import { getDb } from '@/lib/db/client';

vi.mock('@/lib/auth/api-auth');
vi.mock('@/lib/db/client');
vi.mock('@/lib/rateLimit', () => ({
  rateLimitAdminRoute: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/lib/monitoring/sentry-server', () => ({
  captureException: vi.fn(),
}));
vi.mock('@/lib/db/schema', () => ({
  tokenConfig: { id: 'id', tokenCost: 'tokenCost', estimatedCostCents: 'estimatedCostCents', active: 'active', updatedAt: 'updatedAt' },
  tierConfig: { id: 'id', monthlyTokens: 'monthlyTokens', maxProjects: 'maxProjects', maxPublished: 'maxPublished', priceCentsMonthly: 'priceCentsMonthly', updatedAt: 'updatedAt' },
}));

describe('PUT /api/admin/economics/config', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.mocked(authenticateRequest).mockResolvedValue({
      ok: true as const,
      ctx: { clerkId: 'admin_clerk', user: { id: 'admin_1', tier: 'pro' } as never },
    });
    vi.mocked(assertAdmin).mockReturnValue(null);
  });

  it('should return 401 when not authenticated', async () => {
    const mockResponse = new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    vi.mocked(authenticateRequest).mockResolvedValue({
      ok: false as const,
      response: mockResponse as never,
    });

    const { PUT } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/admin/economics/config', {
      method: 'PUT',
      body: JSON.stringify({ type: 'token_config', id: 'tc1', tokenCost: 10 }),
    });
    const res = await PUT(req);

    expect(res.status).toBe(401);
  });

  it('should return 403 when not admin', async () => {
    const adminResponse = new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
    vi.mocked(assertAdmin).mockReturnValue(adminResponse as never);

    const { PUT } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/admin/economics/config', {
      method: 'PUT',
      body: JSON.stringify({ type: 'token_config', id: 'tc1', tokenCost: 10, estimatedCostCents: 5 }),
    });
    const res = await PUT(req);

    expect(res.status).toBe(403);
  });

  it('should update token config', async () => {
    const mockDb = {
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue(undefined),
      }),
    };
    vi.mocked(getDb).mockReturnValue(mockDb as never);

    const { PUT } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/admin/economics/config', {
      method: 'PUT',
      body: JSON.stringify({ type: 'token_config', id: 'tc1', tokenCost: 15, estimatedCostCents: 5, active: true }),
    });
    const res = await PUT(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
  });

  it('omits `active` from UPDATE when the field is not provided', async () => {
    const setSpy = vi.fn().mockReturnThis();
    const mockDb = {
      update: vi.fn().mockReturnValue({
        set: setSpy,
        where: vi.fn().mockResolvedValue(undefined),
      }),
    };
    vi.mocked(getDb).mockReturnValue(mockDb as never);

    const { PUT } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/admin/economics/config', {
      method: 'PUT',
      // `active` intentionally omitted.
      body: JSON.stringify({ type: 'token_config', id: 'tc1', tokenCost: 15, estimatedCostCents: 5 }),
    });
    const res = await PUT(req);
    expect(res.status).toBe(200);
    expect(setSpy).toHaveBeenCalledTimes(1);
    const setArg = setSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(setArg).not.toHaveProperty('active');
    expect(setArg.tokenCost).toBe(15);
    expect(setArg.estimatedCostCents).toBe(5);
  });

  it('includes `active: 0` when explicitly set to false', async () => {
    const setSpy = vi.fn().mockReturnThis();
    const mockDb = {
      update: vi.fn().mockReturnValue({
        set: setSpy,
        where: vi.fn().mockResolvedValue(undefined),
      }),
    };
    vi.mocked(getDb).mockReturnValue(mockDb as never);

    const { PUT } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/admin/economics/config', {
      method: 'PUT',
      body: JSON.stringify({ type: 'token_config', id: 'tc1', tokenCost: 15, estimatedCostCents: 5, active: false }),
    });
    const res = await PUT(req);
    expect(res.status).toBe(200);
    const setArg = setSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(setArg.active).toBe(0);
  });

  it('should return 422 for missing id', async () => {
    const { PUT } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/admin/economics/config', {
      method: 'PUT',
      body: JSON.stringify({ type: 'token_config', tokenCost: 10, estimatedCostCents: 5 }),
    });
    const res = await PUT(req);
    const data = await res.json();
    expect(res.status).toBe(422);
    expect(data.error).toBe('Validation failed');
    expect(JSON.stringify(data.details)).toContain('id');
  });

  it('should return 422 for negative tokenCost', async () => {
    const { PUT } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/admin/economics/config', {
      method: 'PUT',
      body: JSON.stringify({ type: 'token_config', id: 'tc1', tokenCost: -5, estimatedCostCents: 5 }),
    });
    const res = await PUT(req);
    const data = await res.json();
    expect(res.status).toBe(422);
    expect(data.error).toBe('Validation failed');
    expect(JSON.stringify(data.details)).toContain('tokenCost');
  });

  it('should return 422 for NaN tokenCost', async () => {
    const { PUT } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/admin/economics/config', {
      method: 'PUT',
      body: JSON.stringify({ type: 'token_config', id: 'tc1', tokenCost: 'abc', estimatedCostCents: 5 }),
    });
    const res = await PUT(req);
    const data = await res.json();
    expect(res.status).toBe(422);
    expect(data.error).toBe('Validation failed');
    expect(JSON.stringify(data.details)).toContain('tokenCost');
  });

  it('should return 422 for unknown type', async () => {
    const { PUT } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/admin/economics/config', {
      method: 'PUT',
      body: JSON.stringify({ type: 'unknown_config', id: 'x' }),
    });
    const res = await PUT(req);
    const data = await res.json();
    expect(res.status).toBe(422);
    expect(data.error).toBe('Validation failed');
    expect(JSON.stringify(data.details)).toContain('type');
  });

  it('should update tier config', async () => {
    const mockDb = {
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue(undefined),
      }),
    };
    vi.mocked(getDb).mockReturnValue(mockDb as never);

    const { PUT } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/admin/economics/config', {
      method: 'PUT',
      body: JSON.stringify({ type: 'tier_config', id: 'tier1', monthlyTokens: 5000, maxProjects: 50, maxPublished: 10, priceCentsMonthly: 999 }),
    });
    const res = await PUT(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
  });
});
