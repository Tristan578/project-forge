vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from './route';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { resolveApiKey, ApiKeyError } from '@/lib/keys/resolver';
import { makeUser, mockNextResponse } from '@/test/utils/apiTestUtils';

const mockGetTextureStatus = vi.hoisted(() => vi.fn());

vi.mock('@/lib/auth/api-auth');
vi.mock('@/lib/keys/resolver', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/keys/resolver')>();
  return { ...mod, resolveApiKey: vi.fn() };
});
vi.mock('@/lib/generate/meshyClient', () => ({
  MeshyClient: class MockMeshyClient {
    getTextureStatus = mockGetTextureStatus;
  },
}));

const makeRequest = (params: Record<string, string>) => {
  const url = new URL('http://localhost/api/generate/texture/status');
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return new NextRequest(url.toString());
};

describe('GET /api/generate/texture/status', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 if unauthenticated', async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({
      ok: false,
      response: mockNextResponse({ error: 'Unauthorized' }, { status: 401 }),
    });

    const res = await GET(makeRequest({}));
    expect(res.status).toBe(401);
  });

  it('returns 400 if jobId is missing', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: '123', user } });

    const res = await GET(makeRequest({}));
    const data = await res.json();
    expect(res.status).toBe(400);
    expect(data.error).toContain('jobId');
  });

  it('returns 402 if API key cannot be resolved', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: '123', user } });
    vi.mocked(resolveApiKey).mockRejectedValue(
      new ApiKeyError('NO_KEY_CONFIGURED', 'No Meshy key configured')
    );

    const res = await GET(makeRequest({ jobId: 'task_123' }));
    const data = await res.json();
    expect(res.status).toBe(402);
    expect(data.error).toBe('No Meshy key configured');
  });

  it('returns completed status when Meshy reports SUCCEEDED', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: '123', user } });
    vi.mocked(resolveApiKey).mockResolvedValue({ type: 'platform', key: 'meshy_key', metered: true });
    mockGetTextureStatus.mockResolvedValue({
      status: 'SUCCEEDED',
      progress: 100,
      maps: { albedo: 'https://cdn.meshy.ai/albedo.png' },
    });

    const res = await GET(makeRequest({ jobId: 'task_123' }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.status).toBe('completed');
    expect(data.progress).toBe(100);
    expect(data.maps).toEqual({ albedo: 'https://cdn.meshy.ai/albedo.png' });
  });

  it('returns failed status when Meshy reports FAILED', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: '123', user } });
    vi.mocked(resolveApiKey).mockResolvedValue({ type: 'platform', key: 'meshy_key', metered: true });
    mockGetTextureStatus.mockResolvedValue({ status: 'FAILED', progress: 0, maps: undefined });

    const res = await GET(makeRequest({ jobId: 'task_123' }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.status).toBe('failed');
    expect(data.error).toBe('Generation failed');
  });

  it('returns failed status when Meshy reports EXPIRED', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: '123', user } });
    vi.mocked(resolveApiKey).mockResolvedValue({ type: 'platform', key: 'meshy_key', metered: true });
    mockGetTextureStatus.mockResolvedValue({ status: 'EXPIRED', progress: 0, maps: undefined });

    const res = await GET(makeRequest({ jobId: 'task_123' }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.status).toBe('failed');
  });

  it('returns processing status when Meshy reports IN_PROGRESS', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: '123', user } });
    vi.mocked(resolveApiKey).mockResolvedValue({ type: 'platform', key: 'meshy_key', metered: true });
    mockGetTextureStatus.mockResolvedValue({ status: 'IN_PROGRESS', progress: 45, maps: undefined });

    const res = await GET(makeRequest({ jobId: 'task_123' }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.status).toBe('processing');
    expect(data.progress).toBe(45);
  });

  it('returns pending status for unknown Meshy states', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: '123', user } });
    vi.mocked(resolveApiKey).mockResolvedValue({ type: 'platform', key: 'meshy_key', metered: true });
    mockGetTextureStatus.mockResolvedValue({ status: 'PENDING', progress: 0, maps: undefined });

    const res = await GET(makeRequest({ jobId: 'task_123' }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.status).toBe('pending');
  });

  it('returns 500 if Meshy client throws unexpectedly', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: '123', user } });
    vi.mocked(resolveApiKey).mockResolvedValue({ type: 'platform', key: 'meshy_key', metered: true });
    mockGetTextureStatus.mockRejectedValue(new Error('Provider error'));

    const res = await GET(makeRequest({ jobId: 'task_123' }));
    const data = await res.json();

    expect(res.status).toBe(500);
    expect(data.error).toBe('Provider error');
  });
});
