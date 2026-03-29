vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { getDb } from '@/lib/db/client';

vi.mock('@/lib/auth/api-auth');
vi.mock('@/lib/db/client');
vi.mock('@/lib/db/schema', () => ({
  generationJobs: { id: 'id', userId: 'userId' },
}));

describe('PATCH /api/jobs/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authenticateRequest).mockResolvedValue({
      ok: true as const,
      ctx: { clerkId: 'clerk_1', user: { id: 'user_1', tier: 'creator' } as never },
    });
  });

  it('should return 401 when not authenticated', async () => {
    const mockResponse = new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    vi.mocked(authenticateRequest).mockResolvedValue({
      ok: false as const,
      response: mockResponse as never,
    });

    const { PATCH } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/jobs/j1', {
      method: 'PATCH',
      body: JSON.stringify({ status: 'completed' }),
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: 'j1' }) });

    expect(res.status).toBe(401);
  });

  it('should return 404 when job not found', async () => {
    const selectChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    };
    const mockDb = {
      select: vi.fn().mockReturnValue(selectChain),
    };
    vi.mocked(getDb).mockReturnValue(mockDb as never);

    const { PATCH } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/jobs/missing', {
      method: 'PATCH',
      body: JSON.stringify({ status: 'completed' }),
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: 'missing' }) });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe('Job not found');
  });

  it('should update job and return success', async () => {
    const selectChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ id: 'j1' }]),
    };
    const mockDb = {
      select: vi.fn().mockReturnValue(selectChain),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue(undefined),
      }),
    };
    vi.mocked(getDb).mockReturnValue(mockDb as never);

    const { PATCH } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/jobs/j1', {
      method: 'PATCH',
      body: JSON.stringify({ status: 'completed', progress: 100 }),
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: 'j1' }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.updated).toBe(true);
  });

  it('should return 400 for invalid status', async () => {
    const mockDb = {
      select: vi.fn().mockReturnThis(), from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValue([{ id: 'j1' }]),
    };
    vi.mocked(getDb).mockReturnValue(mockDb as never);

    const { PATCH } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/jobs/j1', {
      method: 'PATCH',
      body: JSON.stringify({ status: 'hacked' }),
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: 'j1' }) });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Invalid status');
  });

  it('should return 400 for negative progress', async () => {
    const mockDb = {
      select: vi.fn().mockReturnThis(), from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValue([{ id: 'j1' }]),
    };
    vi.mocked(getDb).mockReturnValue(mockDb as never);

    const { PATCH } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/jobs/j1', {
      method: 'PATCH',
      body: JSON.stringify({ progress: -5 }),
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: 'j1' }) });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('progress');
  });

  it('should return 400 for progress > 100', async () => {
    const mockDb = {
      select: vi.fn().mockReturnThis(), from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValue([{ id: 'j1' }]),
    };
    vi.mocked(getDb).mockReturnValue(mockDb as never);

    const { PATCH } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/jobs/j1', {
      method: 'PATCH',
      body: JSON.stringify({ progress: 150 }),
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: 'j1' }) });
    expect(res.status).toBe(400);
  });

  it('should silently ignore refunded field', async () => {
    const mockSet = vi.fn().mockReturnThis();
    const mockUpdateWhere = vi.fn().mockResolvedValue(undefined);
    const mockDb = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([{ id: 'j1' }]),
      }),
      update: vi.fn().mockReturnValue({
        set: mockSet.mockReturnValue({ where: mockUpdateWhere }),
        where: mockUpdateWhere,
      }),
    };
    vi.mocked(getDb).mockReturnValue(mockDb as never);

    const { PATCH } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/jobs/j1', {
      method: 'PATCH',
      body: JSON.stringify({ refunded: true }),
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: 'j1' }) });
    expect(res.status).toBe(200);
    // Verify refunded was not included in the set() call
    const setCall = mockSet.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
    expect(setCall?.refunded).toBeUndefined();
  });

  it('should return 500 on database error', async () => {
    vi.mocked(getDb).mockImplementation(() => { throw new Error('DB error'); });

    const { PATCH } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/jobs/j1', {
      method: 'PATCH',
      body: JSON.stringify({ status: 'failed' }),
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: 'j1' }) });
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBe('Failed to update job');
  });
});
