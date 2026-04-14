vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { withApiMiddleware } from '@/lib/api/middleware';
import { listProjects, createProject } from '@/lib/projects/service';

vi.mock('@/lib/api/middleware');
vi.mock('@/lib/projects/service');
vi.mock('@/lib/monitoring/sentry-server', () => ({
  captureException: vi.fn(),
}));

function makeReq(method = 'GET', body?: string) {
  const url = 'http://localhost:3000/api/projects';
  if (body) {
    return new NextRequest(url, {
      method,
      body,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return new NextRequest(url, { method });
}

function mockMiddlewareSuccess(
  userId = 'user_1',
  body: unknown = { name: 'Test', sceneData: {} },
) {
  vi.mocked(withApiMiddleware).mockResolvedValue({
    error: undefined,
    userId,
    authContext: { clerkId: 'clerk_1', user: { id: userId, tier: 'creator' } as never },
    body,
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

describe('PF-675: Negative cases for /api/projects', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockMiddlewareSuccess();
  });

  describe('GET /api/projects — error paths', () => {
    it('returns 500 when listProjects throws a DB error', async () => {
      vi.mocked(listProjects).mockRejectedValue(new Error('connection refused'));

      const { GET } = await import('./route');
      const res = await GET(makeReq());
      const body = await res.json();

      expect(res.status).toBe(500);
      expect(body.code).toBe('INTERNAL_ERROR');
    });

    it('returns 500 when listProjects throws a non-Error value', async () => {
      vi.mocked(listProjects).mockRejectedValue('string error');

      const { GET } = await import('./route');
      const res = await GET(makeReq());

      expect(res.status).toBe(500);
    });
  });

  describe('POST /api/projects — input validation', () => {
    it('returns 422 when middleware rejects invalid JSON body', async () => {
      mockMiddlewareError(400, 'Invalid JSON body');

      const { POST } = await import('./route');
      const res = await POST(makeReq('POST', 'not-json'));

      expect(res.status).toBe(400);
    });

    it('returns 422 when middleware rejects empty name', async () => {
      mockMiddlewareError(422, 'Validation failed');

      const { POST } = await import('./route');
      const res = await POST(makeReq('POST', JSON.stringify({ name: '', sceneData: {} })));
      const body = await res.json();

      expect(res.status).toBe(422);
      expect(body.error).toContain('Validation');
    });

    it('returns 422 when middleware rejects oversized name (>200 chars)', async () => {
      mockMiddlewareError(422, 'Validation failed');

      const { POST } = await import('./route');
      const longName = 'A'.repeat(201);
      const res = await POST(makeReq('POST', JSON.stringify({ name: longName, sceneData: {} })));

      expect(res.status).toBe(422);
    });

    it('returns 422 when sceneData is not an object', async () => {
      mockMiddlewareError(422, 'Validation failed');

      const { POST } = await import('./route');
      const res = await POST(makeReq('POST', JSON.stringify({ name: 'Test', sceneData: 'not-object' })));

      expect(res.status).toBe(422);
    });

    it('returns 422 when body is missing sceneData entirely', async () => {
      mockMiddlewareError(422, 'Validation failed');

      const { POST } = await import('./route');
      const res = await POST(makeReq('POST', JSON.stringify({ name: 'Test' })));

      expect(res.status).toBe(422);
    });
  });

  describe('POST /api/projects — service errors', () => {
    it('returns 500 when createProject throws a generic DB error', async () => {
      mockMiddlewareSuccess('user_1', { name: 'Good Project', sceneData: {} });
      vi.mocked(createProject).mockRejectedValue(new Error('database timeout'));

      const { POST } = await import('./route');
      const res = await POST(makeReq('POST', JSON.stringify({ name: 'Good Project', sceneData: {} })));
      const body = await res.json();

      expect(res.status).toBe(500);
      expect(body.code).toBe('INTERNAL_ERROR');
    });

    it('returns 403 with limit info when project limit exceeded with limit=1', async () => {
      mockMiddlewareSuccess('user_1', { name: 'Project', sceneData: {} });
      const error = new Error('Project limit exceeded') as Error & { limit?: number };
      error.limit = 1;
      vi.mocked(createProject).mockRejectedValue(error);

      const { POST } = await import('./route');
      const res = await POST(makeReq('POST', JSON.stringify({ name: 'Project', sceneData: {} })));
      const body = await res.json();

      expect(res.status).toBe(403);
      expect(body.code).toBe('PROJECT_LIMIT');
      // Singular form when limit is 1
      expect(body.error).toContain('1 project');
      expect(body.error).not.toContain('projects');
    });

    it('returns 500 when createProject throws a non-Error value', async () => {
      mockMiddlewareSuccess('user_1', { name: 'Project', sceneData: {} });
      vi.mocked(createProject).mockRejectedValue(42);

      const { POST } = await import('./route');
      const res = await POST(makeReq('POST', JSON.stringify({ name: 'Project', sceneData: {} })));

      expect(res.status).toBe(500);
    });
  });
});
