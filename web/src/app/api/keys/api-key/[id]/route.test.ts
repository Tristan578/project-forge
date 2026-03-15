vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { getDb } from '@/lib/db/client';

vi.mock('@/lib/auth/api-auth');
vi.mock('@/lib/db/client');
vi.mock('@/lib/db/schema', () => ({
  apiKeys: { id: 'id', userId: 'userId' },
}));

describe('DELETE /api/keys/api-key/[id]', () => {
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
    const req = new Request('http://localhost:3000/api/keys/api-key/key-1', { method: 'DELETE' });
    const res = await DELETE(req, { params: Promise.resolve({ id: 'key-1' }) });

    expect(res.status).toBe(401);
  });

  it('should return 404 when key not found', async () => {
    const mockDb = {
      delete: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([]),
      }),
    };
    vi.mocked(getDb).mockReturnValue(mockDb as never);

    const { DELETE } = await import('./route');
    const req = new Request('http://localhost:3000/api/keys/api-key/missing', { method: 'DELETE' });
    const res = await DELETE(req, { params: Promise.resolve({ id: 'missing' }) });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe('API key not found');
  });

  it('should revoke key and return success', async () => {
    const mockDb = {
      delete: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([{ id: 'key-1' }]),
      }),
    };
    vi.mocked(getDb).mockReturnValue(mockDb as never);

    const { DELETE } = await import('./route');
    const req = new Request('http://localhost:3000/api/keys/api-key/key-1', { method: 'DELETE' });
    const res = await DELETE(req, { params: Promise.resolve({ id: 'key-1' }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.revoked).toBe('key-1');
  });
});
