import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';
import { GET } from './route';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { resolveApiKey, ApiKeyError } from '@/lib/keys/resolver';
import { SunoClient } from '@/lib/generate/sunoClient';

vi.mock('@/lib/auth/api-auth');
vi.mock('@/lib/keys/resolver', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/keys/resolver')>();
  return { ...mod, resolveApiKey: vi.fn() };
});
vi.mock('@/lib/generate/sunoClient', () => ({
  SunoClient: vi.fn(() => ({
    getStatus: vi.fn(),
  })),
}));

function makeRequest(jobId?: string) {
  const url = jobId
    ? `http://test/api/generate/music/status?jobId=${jobId}`
    : 'http://test/api/generate/music/status';
  return new Request(url) as any;
}

describe('GET /api/generate/music/status', () => {
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
      new ApiKeyError('NO_KEY_CONFIGURED', 'No Suno key available')
    );

    const res = await GET(makeRequest('job-123'));
    expect(res.status).toBe(402);
    const data = await res.json();
    expect(data.code).toBe('NO_KEY_CONFIGURED');
  });

  it('returns completed status for completed/succeeded task', async () => {
    vi.mocked(SunoClient).mockImplementation(function () {
      return {
        getStatus: vi.fn().mockResolvedValue({
          status: 'completed',
          progress: 100,
          audioUrl: 'https://cdn.suno.ai/song.mp3',
          durationSeconds: 120,
        }),
      } as any;
    } as any);

    const res = await GET(makeRequest('job-123'));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe('completed');
    expect(data.resultUrl).toBe('https://cdn.suno.ai/song.mp3');
    expect(data.durationSeconds).toBe(120);
    expect(data.error).toBeUndefined();
  });

  it('returns failed status for failed task', async () => {
    vi.mocked(SunoClient).mockImplementation(function () {
      return {
        getStatus: vi.fn().mockResolvedValue({
          status: 'failed',
          progress: 0,
        }),
      } as any;
    } as any);

    const res = await GET(makeRequest('job-123'));
    const data = await res.json();
    expect(data.status).toBe('failed');
    expect(data.error).toBe('Generation failed');
  });

  it('returns processing status for generating task', async () => {
    vi.mocked(SunoClient).mockImplementation(function () {
      return {
        getStatus: vi.fn().mockResolvedValue({
          status: 'generating',
          progress: 60,
        }),
      } as any;
    } as any);

    const res = await GET(makeRequest('job-123'));
    const data = await res.json();
    expect(data.status).toBe('processing');
  });

  it('returns pending status for unknown status values', async () => {
    vi.mocked(SunoClient).mockImplementation(function () {
      return {
        getStatus: vi.fn().mockResolvedValue({
          status: 'queued',
          progress: 0,
        }),
      } as any;
    } as any);

    const res = await GET(makeRequest('job-123'));
    const data = await res.json();
    expect(data.status).toBe('pending');
  });

  it('returns 500 when provider throws', async () => {
    vi.mocked(SunoClient).mockImplementation(function () {
      return {
        getStatus: vi.fn().mockRejectedValue(new Error('Suno API down')),
      } as any;
    } as any);

    const res = await GET(makeRequest('job-123'));
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toBe('Suno API down');
  });
});
