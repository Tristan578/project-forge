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
  tier = 'creator' as const,
  body: unknown = { name: 'Test', sceneData: {} },
) {
  vi.mocked(withApiMiddleware).mockResolvedValue({
    error: undefined,
    userId,
    authContext: { clerkId: 'clerk_1', user: { id: userId, tier } as never },
    body,
  });
}

describe('GET /api/projects', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMiddlewareSuccess();
  });

  it('should return 401 when not authenticated', async () => {
    const mockResponse = new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    vi.mocked(withApiMiddleware).mockResolvedValue({
      error: mockResponse as never,
      userId: null,
      authContext: null,
      body: undefined,
    });

    const { GET } = await import('./route');
    const res = await GET(makeReq());

    expect(res.status).toBe(401);
  });

  it('should return projects list', async () => {
    vi.mocked(listProjects).mockResolvedValue([
      { id: 'p1', name: 'Project 1' },
      { id: 'p2', name: 'Project 2' },
    ] as never);

    const { GET } = await import('./route');
    const res = await GET(makeReq());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toHaveLength(2);
  });
});

describe('POST /api/projects', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMiddlewareSuccess();
  });

  it('should return 401 when not authenticated', async () => {
    const mockResponse = new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    vi.mocked(withApiMiddleware).mockResolvedValue({
      error: mockResponse as never,
      userId: null,
      authContext: null,
      body: undefined,
    });

    const { POST } = await import('./route');
    const res = await POST(makeReq('POST', JSON.stringify({ name: 'Test', sceneData: {} })));

    expect(res.status).toBe(401);
  });

  it('should return 429 when rate limited', async () => {
    const rlResponse = new Response(JSON.stringify({ error: 'Rate limited' }), { status: 429 });
    vi.mocked(withApiMiddleware).mockResolvedValue({
      error: rlResponse as never,
      userId: null,
      authContext: null,
      body: undefined,
    });

    const { POST } = await import('./route');
    const res = await POST(makeReq('POST', JSON.stringify({ name: 'Test', sceneData: {} })));

    expect(res.status).toBe(429);
  });

  it('should create project and return 201', async () => {
    mockMiddlewareSuccess('user_1', 'creator', { name: 'New Project', sceneData: { entities: [] } });
    vi.mocked(createProject).mockResolvedValue({ id: 'p-new', name: 'New Project' } as never);

    const { POST } = await import('./route');
    const res = await POST(makeReq('POST', JSON.stringify({ name: 'New Project', sceneData: { entities: [] } })));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.id).toBe('p-new');
    expect(body.name).toBe('New Project');
  });

  it('should return 403 when project limit exceeded (regression: error field now contains human-readable message, not code)', async () => {
    mockMiddlewareSuccess('user_1', 'creator', { name: 'New Project', sceneData: {} });
    const error = new Error('Project limit exceeded') as Error & { limit?: number };
    error.limit = 3;
    vi.mocked(createProject).mockRejectedValue(error);

    const { POST } = await import('./route');
    const res = await POST(makeReq('POST', JSON.stringify({ name: 'New Project', sceneData: {} })));
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.code).toBe('PROJECT_LIMIT');
    expect(body.error).toContain('Your plan allows 3 project');
    expect(body.error).toContain('Upgrade to create more');
    expect(body.details).toEqual({ limit: 3 });
  });
});
