/**
 * Tests for /api/jobs route — POST and GET handlers,
 * auth, rate limiting, validation, DB interactions.
 *
 * @vitest-environment node
 */

vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Mock dependencies before importing route
vi.mock('@/lib/db/client', () => ({
  queryWithResilience: vi.fn((fn: () => unknown) => fn()),
  getDb: vi.fn(),
}));

vi.mock('@/lib/db/schema', () => ({
  generationJobs: {
    userId: 'userId',
    status: 'status',
    createdAt: 'createdAt',
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((...args: unknown[]) => ({ type: 'eq', args })),
  and: vi.fn((...args: unknown[]) => ({ type: 'and', args })),
  inArray: vi.fn((...args: unknown[]) => ({ type: 'inArray', args })),
  desc: vi.fn((col: unknown) => ({ type: 'desc', col })),
}));

vi.mock('@/lib/auth/api-auth', () => ({
  authenticateRequest: vi.fn(),
}));

vi.mock('@/lib/rateLimit', () => ({
  rateLimit: vi.fn().mockResolvedValue({ allowed: true, remaining: 29, resetAt: Date.now() + 60000 }),
  rateLimitResponse: vi.fn(() => new Response(JSON.stringify({ error: 'Rate limited' }), { status: 429 })),
}));

import { POST, GET } from '../route';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { rateLimit } from '@/lib/rateLimit';
import { getDb } from '@/lib/db/client';

const mockInsertReturning = vi.fn();
const mockSelectFrom = vi.fn();

function setupDb() {
  const insertChain = {
    values: vi.fn().mockReturnThis(),
    returning: mockInsertReturning,
  };
  const selectChain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: mockSelectFrom,
  };
  vi.mocked(getDb).mockReturnValue({
    insert: vi.fn(() => insertChain),
    select: vi.fn(() => selectChain),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
  return { insertChain, selectChain };
}

function mockAuth(ok = true) {
  if (ok) {
    vi.mocked(authenticateRequest).mockResolvedValue({
      ok: true,
      ctx: { user: { id: 'user-123' } },
    } as ReturnType<typeof authenticateRequest> extends Promise<infer T> ? T : never);
  } else {
    vi.mocked(authenticateRequest).mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }),
    } as ReturnType<typeof authenticateRequest> extends Promise<infer T> ? T : never);
  }
}

describe('/api/jobs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── POST ──────────────────────────────────────────────────────────────

  describe('POST', () => {
    it('returns 401 when not authenticated', async () => {
      mockAuth(false);
      const req = new NextRequest('http://localhost/api/jobs', {
        method: 'POST',
        body: JSON.stringify({}),
      });

      const response = await POST(req);
      expect(response.status).toBe(401);
    });

    it('returns 429 when rate limited', async () => {
      mockAuth(true);
      vi.mocked(rateLimit).mockResolvedValueOnce({ allowed: false, remaining: 0, resetAt: Date.now() + 60000 });

      const req = new NextRequest('http://localhost/api/jobs', {
        method: 'POST',
        body: JSON.stringify({}),
      });

      const response = await POST(req);
      expect(response.status).toBe(429);
    });

    it('returns 422 when required fields missing', async () => {
      mockAuth(true);
      setupDb();

      const req = new NextRequest('http://localhost/api/jobs', {
        method: 'POST',
        body: JSON.stringify({ providerJobId: 'j-1' }),
      });

      const response = await POST(req);
      const body = await response.json();

      expect(response.status).toBe(422);
      expect(body.error).toBe('Validation failed');
    });

    it('creates job and returns 201', async () => {
      mockAuth(true);
      const { insertChain } = setupDb();
      mockInsertReturning.mockResolvedValueOnce([{ id: 'job-abc' }]);

      const req = new NextRequest('http://localhost/api/jobs', {
        method: 'POST',
        body: JSON.stringify({
          providerJobId: 'j-1',
          provider: 'meshy',
          type: 'model',
          prompt: 'A red cube',
          tokenCost: 10,
        }),
      });

      const response = await POST(req);
      const body = await response.json();

      expect(response.status).toBe(201);
      expect(body.job.id).toBe('job-abc');
      expect(insertChain.values).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-123',
          providerJobId: 'j-1',
          provider: 'meshy',
          type: 'model',
          prompt: 'A red cube',
          tokenCost: 10,
        }),
      );
    });

    it('truncates prompt to 500 chars', async () => {
      mockAuth(true);
      const { insertChain } = setupDb();
      mockInsertReturning.mockResolvedValueOnce([{ id: 'job-xyz' }]);

      const longPrompt = 'x'.repeat(600);
      const req = new NextRequest('http://localhost/api/jobs', {
        method: 'POST',
        body: JSON.stringify({
          providerJobId: 'j-2',
          provider: 'meshy',
          type: 'model',
          prompt: longPrompt,
        }),
      });

      await POST(req);

      expect(insertChain.values).toHaveBeenCalledWith(
        expect.objectContaining({ prompt: 'x'.repeat(500) }),
      );
    });

    it('returns 500 on DB error', async () => {
      mockAuth(true);
      setupDb();
      mockInsertReturning.mockRejectedValueOnce(new Error('DB down'));

      const req = new NextRequest('http://localhost/api/jobs', {
        method: 'POST',
        body: JSON.stringify({
          providerJobId: 'j-3',
          provider: 'meshy',
          type: 'model',
          prompt: 'test',
        }),
      });

      const response = await POST(req);
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body.error).toBe('Failed to create job');
    });
  });

  // ── GET ───────────────────────────────────────────────────────────────

  describe('GET', () => {
    it('returns 401 when not authenticated', async () => {
      mockAuth(false);
      const req = new NextRequest('http://localhost/api/jobs');

      const response = await GET(req);
      expect(response.status).toBe(401);
    });

    it('returns jobs list on success', async () => {
      mockAuth(true);
      setupDb();
      const now = new Date();
      mockSelectFrom.mockResolvedValueOnce([
        {
          id: 'job-1',
          providerJobId: 'pj-1',
          provider: 'meshy',
          type: 'model',
          prompt: 'A cube',
          parameters: {},
          status: 'completed',
          progress: 100,
          errorMessage: null,
          resultUrl: 'https://cdn.example.com/model.glb',
          resultMeta: null,
          imported: 1,
          tokenCost: 5,
          tokenUsageId: null,
          entityId: null,
          createdAt: now,
          updatedAt: now,
          completedAt: now,
        },
      ]);

      const req = new NextRequest('http://localhost/api/jobs');
      const response = await GET(req);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.jobs).toHaveLength(1);
      expect(body.jobs[0].id).toBe('job-1');
      expect(body.jobs[0].imported).toBe(true);
      expect(body.jobs[0].createdAt).toBe(now.toISOString());
    });

    it('filters by active status', async () => {
      mockAuth(true);
      setupDb();
      mockSelectFrom.mockResolvedValueOnce([]);

      const req = new NextRequest('http://localhost/api/jobs?status=active');
      const response = await GET(req);

      expect(response.status).toBe(200);
    });

    it('filters by specific status', async () => {
      mockAuth(true);
      setupDb();
      mockSelectFrom.mockResolvedValueOnce([]);

      const req = new NextRequest('http://localhost/api/jobs?status=failed');
      const response = await GET(req);

      expect(response.status).toBe(200);
    });

    it('returns 500 on DB error', async () => {
      mockAuth(true);
      setupDb();
      mockSelectFrom.mockRejectedValueOnce(new Error('DB down'));

      const req = new NextRequest('http://localhost/api/jobs');
      const response = await GET(req);
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body.error).toBe('Failed to fetch jobs');
    });
  });
});
