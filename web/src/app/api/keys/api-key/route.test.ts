import { describe, it, expect, vi, beforeEach } from 'vitest';
import { authenticateRequest, assertTier } from '@/lib/auth/api-auth';
import { rateLimit } from '@/lib/rateLimit';
import { getDb } from '@/lib/db/client';

vi.mock('@/lib/auth/api-auth');
vi.mock('@/lib/rateLimit', () => ({
  rateLimit: vi.fn(),
  rateLimitResponse: vi.fn(() => new Response('Rate limited', { status: 429 })),
}));
vi.mock('@/lib/db/client');
vi.mock('@/lib/db/schema', () => ({
  apiKeys: { id: 'id', userId: 'userId', name: 'name', keyHash: 'keyHash', keyPrefix: 'keyPrefix', scopes: 'scopes', lastUsed: 'lastUsed', createdAt: 'createdAt' },
}));
vi.mock('bcryptjs', () => ({
  default: { hash: vi.fn().mockResolvedValue('hashed_key') },
}));

describe('POST /api/keys/api-key', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authenticateRequest).mockResolvedValue({
      ok: true as const,
      ctx: { clerkId: 'clerk_1', user: { id: 'user_1', tier: 'creator' } as never },
    });
    vi.mocked(rateLimit).mockReturnValue({ allowed: true, remaining: 4, resetAt: Date.now() + 60000 });
    vi.mocked(assertTier).mockReturnValue(null);
  });

  it('should return 401 when not authenticated', async () => {
    const mockResponse = new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    vi.mocked(authenticateRequest).mockResolvedValue({
      ok: false as const,
      response: mockResponse as never,
    });

    const { POST } = await import('./route');
    const req = new Request('http://localhost:3000/api/keys/api-key', {
      method: 'POST',
      body: JSON.stringify({ name: 'Test Key' }),
    });
    const res = await POST(req);

    expect(res.status).toBe(401);
  });

  it('should return 429 when rate limited', async () => {
    vi.mocked(rateLimit).mockReturnValue({ allowed: false, remaining: 0, resetAt: Date.now() + 60000 });

    const { POST } = await import('./route');
    const req = new Request('http://localhost:3000/api/keys/api-key', {
      method: 'POST',
      body: JSON.stringify({ name: 'Test Key' }),
    });
    const res = await POST(req);

    expect(res.status).toBe(429);
  });

  it('should return 400 for invalid scopes', async () => {
    const mockDb = { insert: vi.fn() };
    vi.mocked(getDb).mockReturnValue(mockDb as never);

    const { POST } = await import('./route');
    const req = new Request('http://localhost:3000/api/keys/api-key', {
      method: 'POST',
      body: JSON.stringify({ name: 'Test Key', scopes: ['invalid:scope'] }),
    });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain('Invalid scopes');
  });

  it('should generate API key and return it', async () => {
    const mockDb = {
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([{ id: 'key-1', createdAt: new Date('2025-01-01') }]),
      }),
    };
    vi.mocked(getDb).mockReturnValue(mockDb as never);

    const { POST } = await import('./route');
    const req = new Request('http://localhost:3000/api/keys/api-key', {
      method: 'POST',
      body: JSON.stringify({ name: 'My Key' }),
    });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.id).toBe('key-1');
    expect(body.key).toMatch(/^forge_/);
    expect(body.name).toBe('My Key');
    expect(body.warning).toContain('Save this key now');
  });
});

describe('GET /api/keys/api-key', () => {
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

  it('should return list of API keys without secrets', async () => {
    const keysData = [{
      id: 'key-1',
      name: 'My Key',
      prefix: 'forge_abcd',
      scopes: ['scene:read'],
      lastUsed: new Date('2025-02-01'),
      createdAt: new Date('2025-01-01'),
    }];
    const selectChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue(keysData),
    };
    const mockDb = {
      select: vi.fn().mockReturnValue(selectChain),
    };
    vi.mocked(getDb).mockReturnValue(mockDb as never);

    const { GET } = await import('./route');
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.keys).toHaveLength(1);
    expect(body.keys[0].name).toBe('My Key');
    // Should not expose the full key hash
    expect(body.keys[0].keyHash).toBeUndefined();
  });
});
