vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { resolveApiKey, ApiKeyError } from '@/lib/keys/resolver';
import { captureException } from '@/lib/monitoring/sentry-server';
import { rateLimit } from '@/lib/rateLimit';
import { makeUser, mockNextResponse } from '@/test/utils/apiTestUtils';

const mockCreateTextToTexture = vi.hoisted(() => vi.fn());

vi.mock('@/lib/auth/api-auth');
vi.mock('@/lib/keys/resolver', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/keys/resolver')>();
  return { ...mod, resolveApiKey: vi.fn() };
});
vi.mock('@/lib/generate/meshyClient', () => ({
  MeshyClient: class MockMeshyClient {
    createTextToTexture = mockCreateTextToTexture;
  },
}));
vi.mock('@/lib/monitoring/sentry-server');
vi.mock('@/lib/tokens/pricing', () => ({ getTokenCost: vi.fn().mockReturnValue(50) }));
vi.mock('@/lib/rateLimit', () => ({
  rateLimit: vi.fn(),
  rateLimitResponse: vi.fn().mockReturnValue(new Response('Rate Limited', { status: 429 })),
}));

const makeRequest = (body: Record<string, unknown>) =>
  new NextRequest('http://localhost/api/generate/texture', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });

describe('POST /api/generate/texture', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(rateLimit).mockResolvedValue({ allowed: true, remaining: 9, resetAt: Date.now() + 60000 });
  });

  it('returns 401 if unauthenticated', async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({
      ok: false,
      response: mockNextResponse({ error: 'Unauthorized' }, { status: 401 }),
    });

    const res = await POST(makeRequest({ prompt: 'stone wall' }));
    expect(res.status).toBe(401);
  });

  it('returns 429 if rate limited', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: '123', user } });
    vi.mocked(rateLimit).mockResolvedValue({ allowed: false, remaining: 0, resetAt: Date.now() + 60000 });

    const res = await POST(makeRequest({ prompt: 'stone wall' }));
    expect(res.status).toBe(429);
  });

  it('returns 400 for invalid JSON body', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: '123', user } });

    const req = new NextRequest('http://localhost/api/generate/texture', {
      method: 'POST',
      body: 'not-json',
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

  it('returns 402 if API key cannot be resolved', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: '123', user } });
    vi.mocked(resolveApiKey).mockRejectedValue(
      new ApiKeyError('INSUFFICIENT_TOKENS', 'Not enough tokens')
    );

    const res = await POST(makeRequest({ prompt: 'stone wall texture' }));
    const data = await res.json();
    expect(res.status).toBe(402);
    expect(data.error).toBe('Not enough tokens');
  });

  it('returns 201 with jobId on successful texture creation', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: '123', user } });
    vi.mocked(resolveApiKey).mockResolvedValue({ type: 'platform', key: 'meshy_key', metered: true, usageId: 'usage_1' });
    mockCreateTextToTexture.mockResolvedValue({ taskId: 'task_tex_001' });

    const res = await POST(makeRequest({ prompt: 'stone wall texture', resolution: '2048', style: 'realistic' }));
    const data = await res.json();

    expect(res.status).toBe(201);
    expect(data.jobId).toBe('task_tex_001');
    expect(data.provider).toBe('meshy');
    expect(data.status).toBe('pending');
    expect(data.usageId).toBe('usage_1');
  });

  it('returns 500 and captures exception on Meshy API error', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: '123', user } });
    vi.mocked(resolveApiKey).mockResolvedValue({ type: 'platform', key: 'meshy_key', metered: true });
    mockCreateTextToTexture.mockRejectedValue(new Error('Meshy quota exceeded'));

    const res = await POST(makeRequest({ prompt: 'stone wall texture' }));
    const data = await res.json();

    expect(res.status).toBe(500);
    expect(data.error).toBe('Meshy quota exceeded');
    expect(captureException).toHaveBeenCalled();
  });

  it('rethrows non-ApiKeyError during key resolution', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: '123', user } });
    vi.mocked(resolveApiKey).mockRejectedValue(new Error('DB connection failed'));

    await expect(POST(makeRequest({ prompt: 'stone wall texture' }))).rejects.toThrow('DB connection failed');
  });
});
