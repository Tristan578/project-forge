vi.mock('server-only', () => ({}));
vi.mock('@/lib/db/client');
vi.mock('@/lib/api/middleware');
vi.mock('@/lib/monitoring/sentry-server', () => ({
  captureException: vi.fn(),
}));
vi.mock('@/lib/db/schema', () => ({
  generationJobs: {
    userId: 'userId',
    status: 'status',
    createdAt: 'createdAt',
  },
}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db/client';
import { withApiMiddleware } from '@/lib/api/middleware';

describe('/api/jobs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(withApiMiddleware).mockResolvedValue({
      error: null,
      authContext: { clerkId: 'clerk_1', user: { id: 'u1', tier: 'creator' } },
      userId: 'u1',
    } as never);
  });

  describe('POST', () => {
    it('should return 401 when not authenticated', async () => {
      vi.mocked(withApiMiddleware).mockResolvedValue({
        error: new Response('Unauthorized', { status: 401 }),
        authContext: null,
        userId: null,
      } as never);

      const { POST } = await import('./route');
      const req = new NextRequest('http://localhost:3000/api/jobs', {
        method: 'POST',
        body: JSON.stringify({ providerJobId: 'j1', provider: 'meshy', type: 'model3d', prompt: 'a sword' }),
      });
      const res = await POST(req);
      expect(res.status).toBe(401);
    });

    it('should return 400 for missing required fields', async () => {
      const { POST } = await import('./route');
      const req = new NextRequest('http://localhost:3000/api/jobs', {
        method: 'POST',
        body: JSON.stringify({ providerJobId: 'j1' }),
      });
      const res = await POST(req);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('Missing required fields');
    });

    it('should create a job and return 201', async () => {
      const mockDb = {
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ id: 'job-1' }]),
          }),
        }),
      };
      vi.mocked(getDb).mockReturnValue(mockDb as never);

      const { POST } = await import('./route');
      const req = new NextRequest('http://localhost:3000/api/jobs', {
        method: 'POST',
        body: JSON.stringify({
          providerJobId: 'pj-1',
          provider: 'meshy',
          type: 'model3d',
          prompt: 'a medieval sword',
          tokenCost: 50,
        }),
      });
      const res = await POST(req);
      const body = await res.json();

      expect(res.status).toBe(201);
      expect(body.job.id).toBe('job-1');
    });
  });

  describe('GET', () => {
    it('should return 401 when not authenticated', async () => {
      vi.mocked(withApiMiddleware).mockResolvedValue({
        error: new Response('Unauthorized', { status: 401 }),
        authContext: null,
        userId: null,
      } as never);

      const { GET } = await import('./route');
      const req = new NextRequest('http://localhost:3000/api/jobs');
      const res = await GET(req);
      expect(res.status).toBe(401);
    });

    it('should return jobs list', async () => {
      const now = new Date();
      const mockDb = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([
                  {
                    id: 'job-1',
                    providerJobId: 'pj-1',
                    provider: 'meshy',
                    type: 'model3d',
                    prompt: 'a sword',
                    parameters: {},
                    status: 'completed',
                    progress: 100,
                    errorMessage: null,
                    resultUrl: 'https://example.com/model.glb',
                    resultMeta: null,
                    imported: 1,
                    tokenCost: 50,
                    tokenUsageId: null,
                    entityId: null,
                    createdAt: now,
                    updatedAt: now,
                    completedAt: now,
                  },
                ]),
              }),
            }),
          }),
        }),
      };
      vi.mocked(getDb).mockReturnValue(mockDb as never);

      const { GET } = await import('./route');
      const req = new NextRequest('http://localhost:3000/api/jobs?status=all');
      const res = await GET(req);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.jobs).toHaveLength(1);
      expect(body.jobs[0].id).toBe('job-1');
      expect(body.jobs[0].imported).toBe(true);
      expect(body.jobs[0].createdAt).toBe(now.toISOString());
    });
  });
});
