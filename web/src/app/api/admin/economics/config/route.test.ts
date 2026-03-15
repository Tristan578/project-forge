vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { authenticateRequest, assertAdmin } from '@/lib/auth/api-auth';
import { getDb } from '@/lib/db/client';

vi.mock('@/lib/auth/api-auth');
vi.mock('@/lib/db/client');
vi.mock('@/lib/db/schema', () => ({
  tokenConfig: { id: 'id', tokenCost: 'tokenCost', estimatedCostCents: 'estimatedCostCents', active: 'active', updatedAt: 'updatedAt' },
  tierConfig: { id: 'id', monthlyTokens: 'monthlyTokens', maxProjects: 'maxProjects', maxPublished: 'maxPublished', priceCentsMonthly: 'priceCentsMonthly', updatedAt: 'updatedAt' },
}));

describe('PUT /api/admin/economics/config', () => {
  beforeEach(() => {
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
      body: JSON.stringify({ type: 'token_config', id: 'tc1', tokenCost: 10 }),
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
