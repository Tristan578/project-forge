vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { GET } from './route';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { resolveApiKey, ApiKeyError } from '@/lib/keys/resolver';
import { SunoClient } from '@/lib/generate/sunoClient';
import type { User } from '@/lib/db/schema';

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

function makeRequest(jobId?: string): NextRequest {
  const url = jobId
    ? `http://test/api/generate/music/status?jobId=${jobId}`
    : 'http://test/api/generate/music/status';
  return new NextRequest(url);
}

describe('GET /api/generate/music/status', () => {
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
      new ApiKeyError('NO_KEY_CONFIGURED', 'No Suno key available')
    );

    const res = await GET(makeRequest('job-123'));
    expect(res.status).toBe(402);
    const data = await res.json();
    expect(data.code).toBe('NO_KEY_CONFIGURED');
  });

  it('returns completed status for completed/succeeded task', async () => {
    vi.mocked(SunoClient).mockImplementation(
      function (this: InstanceType<typeof SunoClient>) {
        this.getStatus = vi.fn().mockResolvedValue({
          status: 'completed',
          progress: 100,
          audioUrl: 'https://cdn.suno.ai/song.mp3',
          durationSeconds: 120,
        });
      } as unknown as typeof SunoClient
    );

    const res = await GET(makeRequest('job-123'));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe('completed');
    expect(data.resultUrl).toBe('https://cdn.suno.ai/song.mp3');
    expect(data.durationSeconds).toBe(120);
    expect(data.error).toBeUndefined();
  });

  it('returns failed status for failed task', async () => {
    vi.mocked(SunoClient).mockImplementation(
      function (this: InstanceType<typeof SunoClient>) {
        this.getStatus = vi.fn().mockResolvedValue({
          status: 'failed',
          progress: 0,
        });
      } as unknown as typeof SunoClient
    );

    const res = await GET(makeRequest('job-123'));
    const data = await res.json();
    expect(data.status).toBe('failed');
    expect(data.error).toBe('Generation failed');
  });

  it('maps success-with-no-audio to failed (so the poller refunds, not hangs)', async () => {
    vi.mocked(SunoClient).mockImplementation(
      function (this: InstanceType<typeof SunoClient>) {
        // Suno reports success but produced no audio URL. Mapping this to
        // `completed` hands the client a completed job with no resultUrl, which
        // throws an uncaught "No result URL" in useGenerationPolling — the job then
        // sticks in `downloading` for the full poll cap before refunding with a
        // generic timeout (#8757). The route must surface it as `failed` so the
        // poller refunds immediately with a meaningful error.
        this.getStatus = vi.fn().mockResolvedValue({
          status: 'completed',
          progress: 100,
          audioUrl: undefined,
        });
      } as unknown as typeof SunoClient
    );

    const res = await GET(makeRequest('job-123'));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe('failed');
    expect(data.resultUrl).toBeUndefined();
    expect(data.error).toBe('Music generation produced no audio');
  });

  it('does not leak a resultUrl while still processing', async () => {
    vi.mocked(SunoClient).mockImplementation(
      function (this: InstanceType<typeof SunoClient>) {
        // Suno can surface a partial audioUrl before completion; the route must gate
        // resultUrl on completion so the client doesn't import a partial track.
        this.getStatus = vi.fn().mockResolvedValue({
          status: 'generating',
          progress: 60,
          audioUrl: 'https://cdn.suno.ai/partial.mp3',
        });
      } as unknown as typeof SunoClient
    );

    const res = await GET(makeRequest('job-123'));
    const data = await res.json();
    expect(data.status).toBe('processing');
    expect(data.resultUrl).toBeUndefined();
    expect(data.error).toBeUndefined();
  });

  it('returns processing status for generating task', async () => {
    vi.mocked(SunoClient).mockImplementation(
      function (this: InstanceType<typeof SunoClient>) {
        this.getStatus = vi.fn().mockResolvedValue({
          status: 'generating',
          progress: 60,
        });
      } as unknown as typeof SunoClient
    );

    const res = await GET(makeRequest('job-123'));
    const data = await res.json();
    expect(data.status).toBe('processing');
  });

  it('returns pending status for unknown status values', async () => {
    vi.mocked(SunoClient).mockImplementation(
      function (this: InstanceType<typeof SunoClient>) {
        this.getStatus = vi.fn().mockResolvedValue({
          status: 'queued',
          progress: 0,
        });
      } as unknown as typeof SunoClient
    );

    const res = await GET(makeRequest('job-123'));
    const data = await res.json();
    expect(data.status).toBe('pending');
  });

  it('returns 500 when provider throws', async () => {
    vi.mocked(SunoClient).mockImplementation(
      function (this: InstanceType<typeof SunoClient>) {
        this.getStatus = vi.fn().mockRejectedValue(new Error('Suno API down'));
      } as unknown as typeof SunoClient
    );

    const res = await GET(makeRequest('job-123'));
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toBe('Suno API down');
  });
});
