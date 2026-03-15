vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { resolveApiKey, ApiKeyError } from '@/lib/keys/resolver';
import { captureException } from '@/lib/monitoring/sentry-server';
import { rateLimit } from '@/lib/rateLimit';
import { makeUser, mockNextResponse } from '@/test/utils/apiTestUtils';

const mockGenerateTileset = vi.hoisted(() => vi.fn());

vi.mock('@/lib/auth/api-auth');
vi.mock('@/lib/keys/resolver', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/keys/resolver')>();
  return { ...mod, resolveApiKey: vi.fn() };
});
vi.mock('@/lib/generate/spriteClient', () => ({
  SpriteClient: class MockSpriteClient {
    generateTileset = mockGenerateTileset;
  },
}));
vi.mock('@/lib/monitoring/sentry-server');
vi.mock('@/lib/rateLimit', () => ({
  rateLimit: vi.fn(),
  rateLimitResponse: vi.fn().mockReturnValue(new Response('Rate Limited', { status: 429 })),
}));

const makeRequest = (body: Record<string, unknown>) =>
  new NextRequest('http://localhost/api/generate/tileset-gen', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });

describe('POST /api/generate/tileset-gen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(rateLimit).mockReturnValue({ allowed: true, remaining: 9, resetAt: Date.now() + 60000 });
  });

  it('returns 401 if unauthenticated', async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({
      ok: false,
      response: mockNextResponse({ error: 'Unauthorized' }, { status: 401 }),
    });

    const res = await POST(makeRequest({ prompt: 'forest tileset' }));
    expect(res.status).toBe(401);
  });

  it('returns 429 if rate limited', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: '123', user } });
    vi.mocked(rateLimit).mockReturnValue({ allowed: false, remaining: 0, resetAt: Date.now() + 60000 });

    const res = await POST(makeRequest({ prompt: 'forest tileset' }));
    expect(res.status).toBe(429);
  });

  it('returns 400 for invalid JSON body', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: '123', user } });

    const req = new NextRequest('http://localhost/api/generate/tileset-gen', {
      method: 'POST',
      body: 'bad-json',
      headers: { 'content-type': 'application/json' },
    });
    const res = await POST(req);
    const data = await res.json();
    expect(res.status).toBe(400);
    expect(data.error).toBe('Invalid JSON');
  });

  it('returns 422 if prompt is too short', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: '123', user } });

    const res = await POST(makeRequest({ prompt: 'ab' }));
    const data = await res.json();
    expect(res.status).toBe(422);
    expect(data.error).toContain('Prompt must be');
  });

  it('returns 422 if prompt is too long', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: '123', user } });

    const res = await POST(makeRequest({ prompt: 'x'.repeat(501) }));
    expect(res.status).toBe(422);
  });

  it('returns 402 if API key cannot be resolved', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: '123', user } });
    vi.mocked(resolveApiKey).mockRejectedValue(
      new ApiKeyError('INSUFFICIENT_TOKENS', 'Not enough tokens')
    );

    const res = await POST(makeRequest({ prompt: 'forest tileset texture' }));
    const data = await res.json();
    expect(res.status).toBe(402);
    expect(data.error).toBe('Not enough tokens');
  });

  it('returns 201 with jobId on successful tileset generation', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: '123', user } });
    vi.mocked(resolveApiKey).mockResolvedValue({ type: 'platform', key: 'rp_key', metered: true });
    mockGenerateTileset.mockResolvedValue({ taskId: 'pred_tile_001', status: 'starting' });

    const res = await POST(makeRequest({ prompt: 'forest tileset texture', tileSize: 32, gridSize: '8x8' }));
    const data = await res.json();

    expect(res.status).toBe(201);
    expect(data.jobId).toBe('pred_tile_001');
    expect(data.provider).toBe('replicate');
    expect(data.status).toBe('starting');
  });

  it('returns 500 and captures exception on provider error', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: '123', user } });
    vi.mocked(resolveApiKey).mockResolvedValue({ type: 'platform', key: 'rp_key', metered: true });
    mockGenerateTileset.mockRejectedValue(new Error('Replicate error'));

    const res = await POST(makeRequest({ prompt: 'forest tileset texture' }));
    const data = await res.json();

    expect(res.status).toBe(500);
    expect(data.error).toBe('Replicate error');
    expect(captureException).toHaveBeenCalled();
  });

  it('rethrows non-ApiKeyError during key resolution', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: '123', user } });
    vi.mocked(resolveApiKey).mockRejectedValue(new Error('DB connection failed'));

    await expect(POST(makeRequest({ prompt: 'forest tileset texture' }))).rejects.toThrow('DB connection failed');
  });
});
