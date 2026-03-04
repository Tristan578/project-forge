import { describe, it, expect, vi, beforeEach } from 'vitest';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { rateLimit } from '@/lib/rateLimit';
import { listProjects, createProject } from '@/lib/projects/service';

vi.mock('@/lib/auth/api-auth');
vi.mock('@/lib/rateLimit', () => ({
  rateLimit: vi.fn(),
  rateLimitResponse: vi.fn(() => new Response('Rate limited', { status: 429 })),
}));
vi.mock('@/lib/projects/service');
vi.mock('@/lib/monitoring/sentry-server', () => ({
  captureException: vi.fn(),
}));

describe('GET /api/projects', () => {
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
    const res = await GET();

    expect(res.status).toBe(401);
  });

  it('should return projects list', async () => {
    vi.mocked(listProjects).mockResolvedValue([
      { id: 'p1', name: 'Project 1' },
      { id: 'p2', name: 'Project 2' },
    ] as never);

    const { GET } = await import('./route');
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toHaveLength(2);
  });
});

describe('POST /api/projects', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authenticateRequest).mockResolvedValue({
      ok: true as const,
      ctx: { clerkId: 'clerk_1', user: { id: 'user_1', tier: 'creator' } as never },
    });
    vi.mocked(rateLimit).mockReturnValue({ allowed: true, remaining: 9, resetAt: Date.now() + 60000 });
  });

  it('should return 401 when not authenticated', async () => {
    const mockResponse = new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    vi.mocked(authenticateRequest).mockResolvedValue({
      ok: false as const,
      response: mockResponse as never,
    });

    const { POST } = await import('./route');
    const req = new Request('http://localhost:3000/api/projects', {
      method: 'POST',
      body: JSON.stringify({ name: 'Test', sceneData: {} }),
    });
    const res = await POST(req);

    expect(res.status).toBe(401);
  });

  it('should return 429 when rate limited', async () => {
    vi.mocked(rateLimit).mockReturnValue({ allowed: false, remaining: 0, resetAt: Date.now() + 60000 });

    const { POST } = await import('./route');
    const req = new Request('http://localhost:3000/api/projects', {
      method: 'POST',
      body: JSON.stringify({ name: 'Test', sceneData: {} }),
    });
    const res = await POST(req);

    expect(res.status).toBe(429);
  });

  it('should return 400 when name is missing', async () => {
    const { POST } = await import('./route');
    const req = new Request('http://localhost:3000/api/projects', {
      method: 'POST',
      body: JSON.stringify({ sceneData: {} }),
    });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('Project name is required');
  });

  it('should return 400 when sceneData is missing', async () => {
    const { POST } = await import('./route');
    const req = new Request('http://localhost:3000/api/projects', {
      method: 'POST',
      body: JSON.stringify({ name: 'Test' }),
    });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('Scene data is required');
  });

  it('should create project and return 201', async () => {
    vi.mocked(createProject).mockResolvedValue({ id: 'p-new', name: 'New Project' } as never);

    const { POST } = await import('./route');
    const req = new Request('http://localhost:3000/api/projects', {
      method: 'POST',
      body: JSON.stringify({ name: 'New Project', sceneData: { entities: [] } }),
    });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.id).toBe('p-new');
    expect(body.name).toBe('New Project');
  });

  it('should return 403 when project limit exceeded', async () => {
    const error = new Error('Project limit exceeded') as Error & { limit?: number };
    error.limit = 3;
    vi.mocked(createProject).mockRejectedValue(error);

    const { POST } = await import('./route');
    const req = new Request('http://localhost:3000/api/projects', {
      method: 'POST',
      body: JSON.stringify({ name: 'New Project', sceneData: {} }),
    });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toBe('PROJECT_LIMIT');
    expect(body.limit).toBe(3);
  });
});
