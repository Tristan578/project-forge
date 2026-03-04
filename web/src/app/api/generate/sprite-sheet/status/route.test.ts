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
    ? `http://test/api/generate/sprite-sheet/status?jobId=${encodeURIComponent(jobId)}`
    : 'http://test/api/generate/sprite-sheet/status';
  return new Request(url) as any;
}

describe('GET /api/generate/sprite-sheet/status', () => {
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

  it('returns failed immediately for spritesheet_ prefixed jobIds', async () => {
    const res = await GET(makeRequest('spritesheet_abc123'));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe('failed');
    expect(data.progress).toBe(0);
    expect(data.error).toContain('not yet available');
  });

  it('returns 402 when API key resolution fails', async () => {
    vi.mocked(resolveApiKey).mockRejectedValue(
      new ApiKeyError('TIER_NOT_ALLOWED', 'Tier not allowed')
    );

    const res = await GET(makeRequest('replicate-pred-123'));
    expect(res.status).toBe(402);
    const data = await res.json();
    expect(data.code).toBe('TIER_NOT_ALLOWED');
  });

  it('returns completed status with output URL for succeeded prediction', async () => {
    vi.mocked(SpriteClient).mockImplementation(function () {
      return {
        getReplicateStatus: vi.fn().mockResolvedValue({
          status: 'succeeded',
          output: ['https://replicate.delivery/sheet.png'],
        }),
      } as any;
    } as any);

    const res = await GET(makeRequest('replicate-pred-123'));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe('completed');
    expect(data.progress).toBe(100);
    expect(data.resultUrl).toBe('https://replicate.delivery/sheet.png');
    expect(data.error).toBeUndefined();
  });

  it('returns failed status for failed prediction', async () => {
    vi.mocked(SpriteClient).mockImplementation(function () {
      return {
        getReplicateStatus: vi.fn().mockResolvedValue({
          status: 'failed',
          output: null,
        }),
      } as any;
    } as any);

    const res = await GET(makeRequest('replicate-pred-123'));
    const data = await res.json();
    expect(data.status).toBe('failed');
    expect(data.error).toBe('Sprite sheet generation failed');
  });

  it('returns pending status for starting prediction', async () => {
    vi.mocked(SpriteClient).mockImplementation(function () {
      return {
        getReplicateStatus: vi.fn().mockResolvedValue({
          status: 'starting',
          output: null,
        }),
      } as any;
    } as any);

    const res = await GET(makeRequest('replicate-pred-123'));
    const data = await res.json();
    expect(data.status).toBe('pending');
    expect(data.progress).toBe(10);
  });

  it('returns 500 when provider throws', async () => {
    vi.mocked(SpriteClient).mockImplementation(function () {
      return {
        getReplicateStatus: vi.fn().mockRejectedValue(new Error('Connection reset')),
      } as any;
    } as any);

    const res = await GET(makeRequest('replicate-pred-123'));
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toBe('Connection reset');
  });
});
