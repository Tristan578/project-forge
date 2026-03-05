/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';
import { GET } from './route';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { resolveApiKey, ApiKeyError } from '@/lib/keys/resolver';
import { SpriteClient } from '@/lib/generate/spriteClient';

vi.mock('@/lib/auth/api-auth');
vi.mock('@/lib/keys/resolver', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/keys/resolver')>();
  return { ...mod, resolveApiKey: vi.fn() };
});
vi.mock('@/lib/generate/spriteClient', () => ({
  SpriteClient: vi.fn(() => ({
    getReplicateStatus: vi.fn(),
  })),
}));

function makeRequest(jobId?: string) {
  const url = jobId
    ? `http://test/api/generate/sprite/status?jobId=${encodeURIComponent(jobId)}`
    : 'http://test/api/generate/sprite/status';
  return new Request(url) as any;
}

describe('GET /api/generate/sprite/status', () => {
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
    expect(data.error).toBe('Missing jobId parameter');
  });

  it('returns completed immediately for URL-based jobId (DALL-E)', async () => {
    const res = await GET(makeRequest('https://oai.dalle.com/result.png'));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe('completed');
    expect(data.progress).toBe(100);
    expect(data.resultUrl).toBe('https://oai.dalle.com/result.png');
  });

  it('returns 402 when API key resolution fails', async () => {
    vi.mocked(resolveApiKey).mockRejectedValue(
      new ApiKeyError('NO_KEY_CONFIGURED', 'No Replicate key')
    );

    const res = await GET(makeRequest('replicate-pred-123'));
    expect(res.status).toBe(402);
    const data = await res.json();
    expect(data.code).toBe('NO_KEY_CONFIGURED');
  });

  it('returns completed status with first output URL for succeeded prediction', async () => {
    vi.mocked(SpriteClient).mockImplementation(function () {
      return {
        getReplicateStatus: vi.fn().mockResolvedValue({
          status: 'succeeded',
          output: ['https://replicate.delivery/sprite.png', 'https://replicate.delivery/sprite2.png'],
        }),
      } as any;
    } as any);

    const res = await GET(makeRequest('replicate-pred-123'));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe('completed');
    expect(data.progress).toBe(100);
    expect(data.resultUrl).toBe('https://replicate.delivery/sprite.png');
    expect(data.error).toBeUndefined();
  });

  it('returns failed status for canceled prediction', async () => {
    vi.mocked(SpriteClient).mockImplementation(function () {
      return {
        getReplicateStatus: vi.fn().mockResolvedValue({
          status: 'canceled',
          output: null,
        }),
      } as any;
    } as any);

    const res = await GET(makeRequest('replicate-pred-123'));
    const data = await res.json();
    expect(data.status).toBe('failed');
    expect(data.error).toBe('Sprite generation failed');
  });

  it('returns processing status with 50% progress', async () => {
    vi.mocked(SpriteClient).mockImplementation(function () {
      return {
        getReplicateStatus: vi.fn().mockResolvedValue({
          status: 'processing',
          output: null,
        }),
      } as any;
    } as any);

    const res = await GET(makeRequest('replicate-pred-123'));
    const data = await res.json();
    expect(data.status).toBe('processing');
    expect(data.progress).toBe(50);
  });

  it('returns 500 when provider throws', async () => {
    vi.mocked(SpriteClient).mockImplementation(function () {
      return {
        getReplicateStatus: vi.fn().mockRejectedValue(new Error('Replicate API error')),
      } as any;
    } as any);

    const res = await GET(makeRequest('replicate-pred-123'));
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toBe('Replicate API error');
  });
});
