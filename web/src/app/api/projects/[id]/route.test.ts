vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { getProject, updateProject, deleteProject } from '@/lib/projects/service';

vi.mock('@/lib/auth/api-auth');
vi.mock('@/lib/projects/service');

describe('GET /api/projects/[id]', () => {
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
    const req = new Request('http://localhost:3000/api/projects/p1');
    const res = await GET(req, { params: Promise.resolve({ id: 'p1' }) });

    expect(res.status).toBe(401);
  });

  it('should return project data', async () => {
    vi.mocked(getProject).mockResolvedValue({ id: 'p1', name: 'My Project' } as never);

    const { GET } = await import('./route');
    const req = new Request('http://localhost:3000/api/projects/p1');
    const res = await GET(req, { params: Promise.resolve({ id: 'p1' }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.name).toBe('My Project');
  });

  it('should return 404 when project not found', async () => {
    vi.mocked(getProject).mockResolvedValue(null as never);

    const { GET } = await import('./route');
    const req = new Request('http://localhost:3000/api/projects/missing');
    const res = await GET(req, { params: Promise.resolve({ id: 'missing' }) });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe('Project not found');
  });
});

describe('PUT /api/projects/[id]', () => {
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

    const { PUT } = await import('./route');
    const req = new Request('http://localhost:3000/api/projects/p1', {
      method: 'PUT',
      body: JSON.stringify({ name: 'Updated' }),
    });
    const res = await PUT(req, { params: Promise.resolve({ id: 'p1' }) });

    expect(res.status).toBe(401);
  });

  it('should update project and return it', async () => {
    vi.mocked(updateProject).mockResolvedValue({ id: 'p1', name: 'Updated' } as never);

    const { PUT } = await import('./route');
    const req = new Request('http://localhost:3000/api/projects/p1', {
      method: 'PUT',
      body: JSON.stringify({ name: 'Updated' }),
    });
    const res = await PUT(req, { params: Promise.resolve({ id: 'p1' }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.name).toBe('Updated');
  });

  it('should return 404 when project not found', async () => {
    vi.mocked(updateProject).mockResolvedValue(null as never);

    const { PUT } = await import('./route');
    const req = new Request('http://localhost:3000/api/projects/missing', {
      method: 'PUT',
      body: JSON.stringify({ name: 'Updated' }),
    });
    const res = await PUT(req, { params: Promise.resolve({ id: 'missing' }) });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe('Project not found');
  });

  it('should return 400 for null name', async () => {
    const { PUT } = await import('./route');
    const req = new Request('http://localhost:3000/api/projects/p1', {
      method: 'PUT',
      body: JSON.stringify({ name: null }),
    });
    const res = await PUT(req, { params: Promise.resolve({ id: 'p1' }) });
    expect(res.status).toBe(400);
  });

  it('should return 400 for null sceneData', async () => {
    const { PUT } = await import('./route');
    const req = new Request('http://localhost:3000/api/projects/p1', {
      method: 'PUT',
      body: JSON.stringify({ sceneData: null }),
    });
    const res = await PUT(req, { params: Promise.resolve({ id: 'p1' }) });
    expect(res.status).toBe(400);
  });

  it('should return 422 for non-integer entityCount (regression: was 400, valid JSON with invalid numeric value)', async () => {
    const { PUT } = await import('./route');
    const req = new Request('http://localhost:3000/api/projects/p1', {
      method: 'PUT',
      body: JSON.stringify({ entityCount: 3.5 }),
    });
    const res = await PUT(req, { params: Promise.resolve({ id: 'p1' }) });
    expect(res.status).toBe(422);
  });

  it('should return 422 for negative entityCount (regression: was 400, valid JSON with invalid numeric value)', async () => {
    const { PUT } = await import('./route');
    const req = new Request('http://localhost:3000/api/projects/p1', {
      method: 'PUT',
      body: JSON.stringify({ entityCount: -1 }),
    });
    const res = await PUT(req, { params: Promise.resolve({ id: 'p1' }) });
    expect(res.status).toBe(422);
  });

  it('should allow thumbnail: null to clear thumbnail', async () => {
    vi.mocked(updateProject).mockResolvedValue({ id: 'p1', name: 'Test', thumbnail: null } as never);

    const { PUT } = await import('./route');
    const req = new Request('http://localhost:3000/api/projects/p1', {
      method: 'PUT',
      body: JSON.stringify({ thumbnail: null }),
    });
    const res = await PUT(req, { params: Promise.resolve({ id: 'p1' }) });
    expect(res.status).toBe(200);
    expect(updateProject).toHaveBeenCalledWith('user_1', 'p1', { thumbnail: null });
  });
});

describe('DELETE /api/projects/[id]', () => {
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

    const { DELETE } = await import('./route');
    const req = new Request('http://localhost:3000/api/projects/p1', { method: 'DELETE' });
    const res = await DELETE(req, { params: Promise.resolve({ id: 'p1' }) });

    expect(res.status).toBe(401);
  });

  it('should delete project and return 204', async () => {
    vi.mocked(deleteProject).mockResolvedValue(true as never);

    const { DELETE } = await import('./route');
    const req = new Request('http://localhost:3000/api/projects/p1', { method: 'DELETE' });
    const res = await DELETE(req, { params: Promise.resolve({ id: 'p1' }) });

    expect(res.status).toBe(204);
  });

  it('should return 404 when project not found', async () => {
    vi.mocked(deleteProject).mockResolvedValue(false as never);

    const { DELETE } = await import('./route');
    const req = new Request('http://localhost:3000/api/projects/missing', { method: 'DELETE' });
    const res = await DELETE(req, { params: Promise.resolve({ id: 'missing' }) });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe('Project not found');
  });
});
