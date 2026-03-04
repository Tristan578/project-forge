import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';
import { GET } from './route';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { resolveApiKey, ApiKeyError } from '@/lib/keys/resolver';
import { MeshyClient } from '@/lib/generate/meshyClient';

vi.mock('@/lib/auth/api-auth');
vi.mock('@/lib/keys/resolver', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/keys/resolver')>();
  return { ...mod, resolveApiKey: vi.fn() };
});
vi.mock('@/lib/generate/meshyClient', () => ({
  MeshyClient: vi.fn(() => ({
    getTaskStatus: vi.fn(),
  })),
}));

function makeRequest(jobId?: string) {
  const url = jobId
    ? `http://test/api/generate/model/status?jobId=${jobId}`
    : 'http://test/api/generate/model/status';
  return new Request(url) as any;
}

describe('GET /api/generate/model/status', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authenticateRequest).mockResolvedValue({
      ok: true as const,
      ctx: { clerkId: 'clerk_1', user: { id: 'user_1', tier: 'creator' } as any },
    });
    vi.mocked(resolveApiKey).mockResolvedValue({ type: 'platform', key: 'test-key', metered: true, usageId: 'usage-1' });
  });

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({
      ok: false as const,
      response: new NextResponse('Unauthorized', { status: 401 }),
    });

    const res = await GET(makeRequest('job-123'));
    expect(res.status).toBe(401);
  });

  it('returns 400 when jobId is missing', async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('jobId query parameter required');
  });

  it('returns 402 when API key resolution fails', async () => {
    vi.mocked(resolveApiKey).mockRejectedValue(
      new ApiKeyError('INSUFFICIENT_TOKENS', 'Not enough tokens')
    );

    const res = await GET(makeRequest('job-123'));
    expect(res.status).toBe(402);
    const data = await res.json();
    expect(data.code).toBe('INSUFFICIENT_TOKENS');
  });

  it('returns completed status for SUCCEEDED task', async () => {
    vi.mocked(MeshyClient).mockImplementation(function () {
      return {
        getTaskStatus: vi.fn().mockResolvedValue({
          status: 'SUCCEEDED',
          progress: 100,
          modelUrls: { glb: 'https://cdn.meshy.ai/model.glb' },
          thumbnailUrl: 'https://cdn.meshy.ai/thumb.png',
        }),
      } as any;
    } as any);

    const res = await GET(makeRequest('job-123'));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe('completed');
    expect(data.progress).toBe(100);
    expect(data.resultUrl).toBe('https://cdn.meshy.ai/model.glb');
    expect(data.thumbnailUrl).toBe('https://cdn.meshy.ai/thumb.png');
    expect(data.error).toBeUndefined();
  });

  it('returns failed status for FAILED task', async () => {
    vi.mocked(MeshyClient).mockImplementation(function () {
      return {
        getTaskStatus: vi.fn().mockResolvedValue({
          status: 'FAILED',
          progress: 0,
        }),
      } as any;
    } as any);

    const res = await GET(makeRequest('job-123'));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe('failed');
    expect(data.error).toBe('Generation failed');
  });

  it('returns processing status for IN_PROGRESS task', async () => {
    vi.mocked(MeshyClient).mockImplementation(function () {
      return {
        getTaskStatus: vi.fn().mockResolvedValue({
          status: 'IN_PROGRESS',
          progress: 50,
        }),
      } as any;
    } as any);

    const res = await GET(makeRequest('job-123'));
    const data = await res.json();
    expect(data.status).toBe('processing');
    expect(data.progress).toBe(50);
  });

  it('returns pending status for unknown status values', async () => {
    vi.mocked(MeshyClient).mockImplementation(function () {
      return {
        getTaskStatus: vi.fn().mockResolvedValue({
          status: 'QUEUED',
          progress: 0,
        }),
      } as any;
    } as any);

    const res = await GET(makeRequest('job-123'));
    const data = await res.json();
    expect(data.status).toBe('pending');
  });

  it('returns 500 when provider throws an error', async () => {
    vi.mocked(MeshyClient).mockImplementation(function () {
      return {
        getTaskStatus: vi.fn().mockRejectedValue(new Error('Meshy API timeout')),
      } as any;
    } as any);

    const res = await GET(makeRequest('job-123'));
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toBe('Meshy API timeout');
  });
});
