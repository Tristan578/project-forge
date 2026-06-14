vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from './route';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { resolveApiKey, ApiKeyError } from '@/lib/keys/resolver';
import { makeUser, mockNextResponse } from '@/test/utils/apiTestUtils';

const mockGetReplicateStatus = vi.hoisted(() => vi.fn());

vi.mock('@/lib/auth/api-auth');
vi.mock('@/lib/keys/resolver', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/keys/resolver')>();
  return { ...mod, resolveApiKey: vi.fn() };
});
vi.mock('@/lib/generate/spriteClient', () => ({
  SpriteClient: class MockSpriteClient {
    getReplicateStatus = mockGetReplicateStatus;
  },
}));

const makeRequest = (params: Record<string, string>) => {
  const url = new URL('http://localhost/api/generate/sprite/status');
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return new NextRequest(url.toString());
};

describe('GET /api/generate/sprite/status', () => {
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
    expect(data.error).toContain('Missing jobId');
  });

  it('returns completed status immediately for DALL-E URL jobId', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: '123', user } });

    const resultUrl = 'https://dalle.example.com/image.png';
    const jobId = `dalle3:${resultUrl}`;
    const res = await GET(makeRequest({ jobId }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.status).toBe('completed');
    expect(data.resultUrl).toBe(resultUrl);
    expect(data.progress).toBe(100);
  });

  it('returns 402 if API key cannot be resolved', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: '123', user } });
    vi.mocked(resolveApiKey).mockRejectedValue(
      new ApiKeyError('INSUFFICIENT_TOKENS', 'Not enough tokens')
    );

    const res = await GET(makeRequest({ jobId: 'pred_abc123' }));
    const data = await res.json();
    expect(res.status).toBe(402);
    expect(data.error).toBe('Not enough tokens');
  });

  it('returns completed status with resultUrl when prediction succeeded', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: '123', user } });
    vi.mocked(resolveApiKey).mockResolvedValue({ type: 'platform', key: 'rp_key', metered: true });
    mockGetReplicateStatus.mockResolvedValue({
      status: 'succeeded',
      output: ['https://replicate.delivery/result.png'],
    });

    const res = await GET(makeRequest({ jobId: 'pred_abc123' }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.jobId).toBe('pred_abc123');
    expect(data.status).toBe('completed');
    expect(data.resultUrl).toBe('https://replicate.delivery/result.png');
    expect(data.progress).toBe(100);
    expect(data.error).toBeUndefined();
  });

  it('returns failed status when prediction failed', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: '123', user } });
    vi.mocked(resolveApiKey).mockResolvedValue({ type: 'platform', key: 'rp_key', metered: true });
    mockGetReplicateStatus.mockResolvedValue({ status: 'failed', output: undefined });

    const res = await GET(makeRequest({ jobId: 'pred_abc123' }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.jobId).toBe('pred_abc123');
    expect(data.status).toBe('failed');
    expect(data.error).toBe('Sprite generation failed');
    expect(data.resultUrl).toBeUndefined();
    expect(data.progress).toBe(10);
  });

  it('maps canceled predictions to failed', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: '123', user } });
    vi.mocked(resolveApiKey).mockResolvedValue({ type: 'platform', key: 'rp_key', metered: true });
    mockGetReplicateStatus.mockResolvedValue({ status: 'canceled', output: undefined });

    const res = await GET(makeRequest({ jobId: 'pred_abc123' }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.status).toBe('failed');
    expect(data.error).toBe('Sprite generation failed');
    expect(data.progress).toBe(10);
  });

  it('maps succeeded-with-no-output to failed (so the poller refunds, not hangs)', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: '123', user } });
    vi.mocked(resolveApiKey).mockResolvedValue({ type: 'platform', key: 'rp_key', metered: true });
    // Replicate reports success but produced no image URL. Mapping this to
    // `completed` hands the client a completed job with no resultUrl, which throws
    // an uncaught "No result URL" in useGenerationPolling — the job then sticks in
    // `downloading` for the full 5-minute poll cap before refunding with a generic
    // timeout (#8757). The route must surface it as `failed` so the poller refunds
    // immediately with a meaningful error.
    mockGetReplicateStatus.mockResolvedValue({ status: 'succeeded', output: [] });

    const res = await GET(makeRequest({ jobId: 'pred_abc123' }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.status).toBe('failed');
    expect(data.resultUrl).toBeUndefined();
    expect(data.progress).toBe(10);
    expect(data.error).toBe('Sprite generation produced no image');
  });

  it('does not leak a resultUrl while still processing', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: '123', user } });
    vi.mocked(resolveApiKey).mockResolvedValue({ type: 'platform', key: 'rp_key', metered: true });
    // Replicate can populate `output` before status flips to succeeded; the route
    // must gate resultUrl on completion so the client doesn't import a partial image.
    mockGetReplicateStatus.mockResolvedValue({
      status: 'processing',
      output: ['https://replicate.delivery/partial.png'],
    });

    const res = await GET(makeRequest({ jobId: 'pred_abc123' }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.status).toBe('processing');
    expect(data.resultUrl).toBeUndefined();
    expect(data.error).toBeUndefined();
  });

  it('returns processing status for in-progress prediction', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: '123', user } });
    vi.mocked(resolveApiKey).mockResolvedValue({ type: 'platform', key: 'rp_key', metered: true });
    mockGetReplicateStatus.mockResolvedValue({ status: 'processing', output: undefined });

    const res = await GET(makeRequest({ jobId: 'pred_abc123' }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.status).toBe('processing');
    expect(data.progress).toBe(50);
  });

  it('returns 500 if client throws unexpectedly', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: '123', user } });
    vi.mocked(resolveApiKey).mockResolvedValue({ type: 'platform', key: 'rp_key', metered: true });
    mockGetReplicateStatus.mockRejectedValue(new Error('Network timeout'));

    const res = await GET(makeRequest({ jobId: 'pred_abc123' }));
    const data = await res.json();

    expect(res.status).toBe(500);
    expect(data.error).toBe('Network timeout');
  });
});
