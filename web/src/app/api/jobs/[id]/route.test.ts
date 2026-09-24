vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { getDb } from '@/lib/db/client';
import { rateLimit } from '@/lib/rateLimit';
import { captureException } from '@/lib/monitoring/sentry-server';
vi.mock('@/lib/rateLimit', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/rateLimit')>()), rateLimit: vi.fn() }));
vi.mock('@/lib/monitoring/sentry-server', () => ({ captureException: vi.fn() }));

vi.mock('@/lib/auth/api-auth');
vi.mock('@/lib/db/client');
vi.mock('@/lib/db/schema', () => ({
  generationJobs: { id: 'id', userId: 'userId' },
}));

describe('PATCH /api/jobs/[id]', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.mocked(rateLimit).mockResolvedValue({ allowed: true, remaining: 59, resetAt: 0 });
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

  it('should return 422 for invalid status', async () => {
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
    const dataStatus = await res.json();
    expect(res.status).toBe(422);
    expect(dataStatus.error).toBe('Validation failed');
    expect(JSON.stringify(dataStatus.details)).toContain('status');
  });

  it('should return 422 for negative progress', async () => {
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
    const dataProgress = await res.json();
    expect(res.status).toBe(422);
    expect(dataProgress.error).toBe('Validation failed');
    expect(JSON.stringify(dataProgress.details)).toContain('progress');
  });

  it('should return 422 for progress > 100', async () => {
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
    const dataProgressHigh = await res.json();
    expect(res.status).toBe(422);
    expect(JSON.stringify(dataProgressHigh.details)).toContain('progress');
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
  it('syncs large bounded PNG artifacts after import', async () => {
    const set = vi.fn().mockReturnThis();
    vi.mocked(getDb).mockReturnValue({
      select: vi.fn(() => ({ from: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValue([{ id: 'sync-job' }]) })),
      update: vi.fn(() => ({ set, where: vi.fn().mockResolvedValue(undefined) })),
    } as never);
    const { PATCH } = await import('./route');
    const resultUrl = 'data:image/png;base64,' + 'A'.repeat(4096);
    const res = await PATCH(new NextRequest('http://localhost/api/jobs/sync-job', { method: 'PATCH', body: JSON.stringify({ status: 'completed', resultUrl, imported: true }) }), { params: Promise.resolve({ id: 'sync-job' }) });
    expect(res.status).toBe(200);
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ resultUrl, imported: 1 }));
  });

  it('never downgrades imported: imported:false is ignored, imported:true latches (#8892)', async () => {
    // Two unordered client PATCHes race on a settled durable row. If the
    // imported:false one lands last, an unconditional write would reset the
    // row to imported = 0 and the list route would resurface it on every load.
    const set = vi.fn().mockReturnThis();
    vi.mocked(getDb).mockReturnValue({
      select: vi.fn(() => ({ from: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValue([{ id: 'sync-job' }]) })),
      update: vi.fn(() => ({ set, where: vi.fn().mockResolvedValue(undefined) })),
    } as never);
    const { PATCH } = await import('./route');
    const patch = (body: Record<string, unknown>) =>
      PATCH(new NextRequest('http://localhost/api/jobs/sync-job', { method: 'PATCH', body: JSON.stringify(body) }), { params: Promise.resolve({ id: 'sync-job' }) });

    expect((await patch({ status: 'failed', errorMessage: 'Provider rejected the prompt', imported: false })).status).toBe(200);
    expect((await patch({ imported: true })).status).toBe(200);

    expect(set).toHaveBeenCalledTimes(2);
    const [downgrade, latch] = set.mock.calls.map((c) => c[0] as Record<string, unknown>);
    // The status still lands; only the imported downgrade is dropped.
    expect(downgrade).toMatchObject({ status: 'failed', errorMessage: 'Provider rejected the prompt' });
    expect(Object.prototype.hasOwnProperty.call(downgrade, 'imported')).toBe(false);
    expect(latch).toMatchObject({ imported: 1 });
  });

  it('returns one owned inline artifact and constrains the ownership query', async () => {
    const resultUrl = 'data:image/png;base64,' + 'A'.repeat(4096);
    const where = vi.fn().mockReturnThis();
    const select = vi.fn(() => ({ from: vi.fn().mockReturnThis(), where, limit: vi.fn().mockResolvedValue([{ resultUrl }]) }));
    vi.mocked(getDb).mockReturnValue({ select } as never);
    const { GET } = await import('./route');
    const response = await GET(new NextRequest('http://localhost/api/jobs/sync-job'), { params: Promise.resolve({ id: 'sync-job' }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ resultUrl });
    // Both the requested id and authenticated internal user must constrain SQL.
    const condition = JSON.stringify(where.mock.calls[0][0]);
    expect(condition).toContain('sync-job');
    expect(condition).toContain('user_1');
  });

  it('returns the whole owned row in the list shape, for durable-completion sync (#8892)', async () => {
    const now = new Date('2026-09-23T12:00:00Z');
    const row = {
      id: 'sync-job', providerJobId: 'pj-1', provider: 'meshy', type: 'texture', prompt: 'wood',
      parameters: { durable: true }, status: 'completed', progress: 100, errorMessage: null,
      resultUrl: 'https://cdn.example.com/x.png', resultMeta: { albedo: 'https://cdn.example.com/a.png' },
      imported: 0, tokenCost: 5, tokenUsageId: 'usage-1', entityId: null,
      createdAt: now, updatedAt: now, completedAt: now,
    };
    vi.mocked(getDb).mockReturnValue({ select: vi.fn(() => ({ from: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValue([row]) })) } as never);
    const { GET } = await import('./route');
    const response = await GET(new NextRequest('http://localhost/api/jobs/sync-job'), { params: Promise.resolve({ id: 'sync-job' }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      id: 'sync-job', providerJobId: 'pj-1', provider: 'meshy', type: 'texture', prompt: 'wood',
      parameters: { durable: true }, status: 'completed', progress: 100, errorMessage: null,
      resultUrl: 'https://cdn.example.com/x.png', resultMeta: { albedo: 'https://cdn.example.com/a.png' },
      imported: false, tokenCost: 5, tokenUsageId: 'usage-1', entityId: null,
      createdAt: now.toISOString(), updatedAt: now.toISOString(), completedAt: now.toISOString(),
    });
  });

  it('returns a failed row with resultUrl null instead of treating "no artifact" as an invalid one', async () => {
    vi.mocked(getDb).mockReturnValue({ select: vi.fn(() => ({ from: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValue([{ id: 'sync-job', status: 'failed', resultUrl: null, errorMessage: 'Provider rejected the prompt', imported: 0 }]) })) } as never);
    const { GET } = await import('./route');
    const response = await GET(new NextRequest('http://localhost/api/jobs/sync-job'), { params: Promise.resolve({ id: 'sync-job' }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'failed', resultUrl: null, errorMessage: 'Provider rejected the prompt', imported: false });
  });

  it("does not return another user's or missing artifact", async () => {
    vi.mocked(getDb).mockReturnValue({ select: vi.fn(() => ({ from: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValue([]) })) } as never);
    const { GET } = await import('./route');
    const response = await GET(new NextRequest('http://localhost/api/jobs/other-job'), { params: Promise.resolve({ id: 'other-job' }) });
    expect(response.status).toBe(404);
  });

  it('requires authentication before retrieving saved image data', async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: false, response: new Response('{}', { status: 401 }) as never });
    const { GET } = await import('./route');
    expect((await GET(new NextRequest('http://localhost/api/jobs/sync-job'), { params: Promise.resolve({ id: 'sync-job' }) })).status).toBe(401);
  });

  it('rejects an oversized historical artifact before returning it', async () => {
    vi.mocked(getDb).mockReturnValue({ select: vi.fn(() => ({ from: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValue([{ resultUrl: 'data:image/png;base64,' + 'A'.repeat(4 * 1024 * 1024) }]) })) } as never);
    const { GET } = await import('./route');
    expect((await GET(new NextRequest('http://localhost/api/jobs/sync-job'), { params: Promise.resolve({ id: 'sync-job' }) })).status).toBe(422);
  });

  it('rate limits artifact reads before accessing the database', async () => {
    vi.mocked(rateLimit).mockResolvedValueOnce({ allowed: false, remaining: 0, resetAt: 0 });
    vi.mocked(getDb).mockClear();
    const { GET } = await import('./route');
    expect((await GET(new NextRequest('http://localhost/api/jobs/sync-job'), { params: Promise.resolve({ id: 'sync-job' }) })).status).toBe(429);
    expect(getDb).not.toHaveBeenCalled();
  });

  it('returns a fixed server error when artifact lookup fails', async () => {
    vi.mocked(getDb).mockImplementationOnce(() => { throw new Error('database secret must stay private'); });
    const { GET } = await import('./route');
    const response = await GET(new NextRequest('http://localhost/api/jobs/sync-job'), { params: Promise.resolve({ id: 'sync-job' }) });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Failed to fetch saved artifact' });
    expect(captureException).toHaveBeenCalledWith(expect.any(Error), { route: '/api/jobs/[id]', method: 'GET' });
  });

});
