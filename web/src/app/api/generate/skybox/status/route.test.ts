vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { GET } from './route';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { resolveApiKey, ApiKeyError } from '@/lib/keys/resolver';
import { MeshyClient } from '@/lib/generate/meshyClient';
import type { User } from '@/lib/db/schema';

vi.mock('@/lib/auth/api-auth');
vi.mock('@/lib/keys/resolver', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/keys/resolver')>();
  return { ...mod, resolveApiKey: vi.fn() };
});
vi.mock('@/lib/generate/meshyClient', () => ({
  MeshyClient: vi.fn(() => ({
    getTextureStatus: vi.fn(),
  })),
}));

function makeRequest(jobId?: string): NextRequest {
  const url = jobId
    ? `http://test/api/generate/skybox/status?jobId=${jobId}`
    : 'http://test/api/generate/skybox/status';
  return new NextRequest(url);
}

describe('GET /api/generate/skybox/status', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authenticateRequest).mockResolvedValue({
      ok: true as const,
      ctx: { clerkId: 'clerk_1', user: { id: 'user_1', tier: 'creator' } as unknown as User },
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

  it('returns completed status with first map URL for SUCCEEDED task', async () => {
    vi.mocked(MeshyClient).mockImplementation(
      function (this: InstanceType<typeof MeshyClient>) {
        this.getTextureStatus = vi.fn().mockResolvedValue({
          status: 'SUCCEEDED',
          progress: 100,
          maps: { baseColor: 'https://cdn.meshy.ai/skybox.hdr', normal: 'https://cdn.meshy.ai/normal.hdr' },
        });
      } as unknown as typeof MeshyClient
    );

    const res = await GET(makeRequest('job-123'));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe('completed');
    expect(data.progress).toBe(100);
    expect(data.resultUrl).toBe('https://cdn.meshy.ai/skybox.hdr');
    expect(data.error).toBeUndefined();
  });

  it('returns undefined resultUrl when maps is empty', async () => {
    vi.mocked(MeshyClient).mockImplementation(
      function (this: InstanceType<typeof MeshyClient>) {
        this.getTextureStatus = vi.fn().mockResolvedValue({
          status: 'SUCCEEDED',
          progress: 100,
          maps: undefined,
        });
      } as unknown as typeof MeshyClient
    );

    const res = await GET(makeRequest('job-123'));
    const data = await res.json();
    expect(data.status).toBe('completed');
    expect(data.resultUrl).toBeUndefined();
  });

  it('returns failed status for EXPIRED task', async () => {
    vi.mocked(MeshyClient).mockImplementation(
      function (this: InstanceType<typeof MeshyClient>) {
        this.getTextureStatus = vi.fn().mockResolvedValue({
          status: 'EXPIRED',
          progress: 0,
        });
      } as unknown as typeof MeshyClient
    );

    const res = await GET(makeRequest('job-123'));
    const data = await res.json();
    expect(data.status).toBe('failed');
    expect(data.error).toBe('Generation failed');
  });

  it('returns 500 when provider throws', async () => {
    vi.mocked(MeshyClient).mockImplementation(
      function (this: InstanceType<typeof MeshyClient>) {
        this.getTextureStatus = vi.fn().mockRejectedValue(new Error('Network error'));
      } as unknown as typeof MeshyClient
    );

    const res = await GET(makeRequest('job-123'));
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toBe('Network error');
  });
});
