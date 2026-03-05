import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { rateLimit } from '@/lib/rateLimit';
import { getDb } from '@/lib/db/client';

vi.mock('@/lib/auth/api-auth');
vi.mock('@/lib/rateLimit', () => ({
  rateLimit: vi.fn(),
  rateLimitResponse: vi.fn(() => new Response('Rate limited', { status: 429 })),
}));
vi.mock('@/lib/db/client');
vi.mock('@/lib/db/schema', () => ({
  generationJobs: {
    id: 'id', userId: 'userId', providerJobId: 'providerJobId', provider: 'provider',
    type: 'type', prompt: 'prompt', parameters: 'parameters', status: 'status',
    progress: 'progress', errorMessage: 'errorMessage', resultUrl: 'resultUrl',
    resultMeta: 'resultMeta', imported: 'imported', tokenCost: 'tokenCost',
    tokenUsageId: 'tokenUsageId', entityId: 'entityId', createdAt: 'createdAt',
    updatedAt: 'updatedAt', completedAt: 'completedAt',
  },
}));

describe('POST /api/jobs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authenticateRequest).mockResolvedValue({
      ok: true as const,
      ctx: { clerkId: 'clerk_1', user: { id: 'user_1', tier: 'creator' } as never },
    });
    vi.mocked(rateLimit).mockReturnValue({ allowed: true, remaining: 29, resetAt: Date.now() + 60000 });
  });

  it('should return 401 when not authenticated', async () => {
    const mockResponse = new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    vi.mocked(authenticateRequest).mockResolvedValue({
      ok: false as const,
      response: mockResponse as never,
    });

    const { POST } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/jobs', {
      method: 'POST',
      body: JSON.stringify({ providerJobId: 'j1', provider: 'meshy', type: '3d', prompt: 'A cat' }),
    });
    const res = await POST(req);

    expect(res.status).toBe(401);
  });

  it('should return 429 when rate limited', async () => {
    vi.mocked(rateLimit).mockReturnValue({ allowed: false, remaining: 0, resetAt: Date.now() + 60000 });

    const { POST } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/jobs', {
      method: 'POST',
      body: JSON.stringify({ providerJobId: 'j1', provider: 'meshy', type: '3d', prompt: 'A cat' }),
    });
    const res = await POST(req);

    expect(res.status).toBe(429);
  });

  it('should return 400 for missing required fields', async () => {
    const mockDb = { insert: vi.fn() };
    vi.mocked(getDb).mockReturnValue(mockDb as never);

    const { POST } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/jobs', {
      method: 'POST',
      body: JSON.stringify({ providerJobId: 'j1' }),
    });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('Missing required fields');
  });

  it('should create job and return 201', async () => {
    const mockDb = {
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([{ id: 'job-new' }]),
      }),
    };
    vi.mocked(getDb).mockReturnValue(mockDb as never);

    const { POST } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/jobs', {
      method: 'POST',
      body: JSON.stringify({
        providerJobId: 'prov-1',
        provider: 'meshy',
        type: 'model_3d',
        prompt: 'A cute cat',
        tokenCost: 50,
      }),
    });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.job.id).toBe('job-new');
  });
});

describe('GET /api/jobs', () => {
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

    const { GET } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/jobs');
    const res = await GET(req);

    expect(res.status).toBe(401);
  });

  it('should return jobs list', async () => {
    const jobsData = [{
      id: 'j1',
      providerJobId: 'prov-1',
      provider: 'meshy',
      type: 'model_3d',
      prompt: 'A cat',
      parameters: {},
      status: 'completed',
      progress: 100,
      errorMessage: null,
      resultUrl: 'https://cdn.example.com/model.glb',
      resultMeta: null,
      imported: 0,
      tokenCost: 50,
      tokenUsageId: null,
      entityId: null,
      createdAt: new Date('2025-01-01'),
      updatedAt: new Date('2025-01-01'),
      completedAt: new Date('2025-01-01'),
    }];

    const selectChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue(jobsData),
    };
    const mockDb = {
      select: vi.fn().mockReturnValue(selectChain),
    };
    vi.mocked(getDb).mockReturnValue(mockDb as never);

    const { GET } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/jobs');
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.jobs).toHaveLength(1);
    expect(body.jobs[0].imported).toBe(false);
  });
});
