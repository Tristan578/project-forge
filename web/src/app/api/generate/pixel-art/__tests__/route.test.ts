vi.mock('server-only', () => ({}));
vi.mock('@/lib/ai/contentSafety', () => ({
  sanitizePrompt: vi.fn((p: string) => ({ safe: true, filtered: p })),
}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '../route';

vi.mock('@/lib/auth/api-auth', () => ({
  authenticateRequest: vi.fn(),
}));
vi.mock('@/lib/rateLimit', () => ({
  rateLimit: vi.fn(),
  rateLimitResponse: vi.fn(),
}));
vi.mock('@/lib/rateLimit/distributed', () => ({
  distributedRateLimit: vi.fn(),
  aggregateGenerationRateLimit: vi.fn(),
}));
vi.mock('@/lib/keys/resolver', () => ({
  resolveApiKey: vi.fn(),
  ApiKeyError: class ApiKeyError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
      this.name = 'ApiKeyError';
    }
  },
}));
// Stable container so the hoisted vi.mock factory can reference it.
const pixelArtClientMock = { generate: vi.fn() };
vi.mock('@/lib/generate/pixelArtClient', () => ({
  PixelArtClient: vi.fn(function (this: Record<string, unknown>) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.generate = (...args: unknown[]) => pixelArtClientMock.generate(...(args as [any, any, any]));
  }),
}));
vi.mock('@/lib/tokens/service', () => ({
  refundTokens: vi.fn(),
}));
vi.mock('@/lib/monitoring/sentry-server', () => ({
  captureException: vi.fn(),
}));

import { authenticateRequest } from '@/lib/auth/api-auth';
import { rateLimitResponse } from '@/lib/rateLimit';
import { distributedRateLimit, aggregateGenerationRateLimit } from '@/lib/rateLimit/distributed';
import { resolveApiKey } from '@/lib/keys/resolver';
import { refundTokens } from '@/lib/tokens/service';
import { captureException } from '@/lib/monitoring/sentry-server';
import { NextResponse } from 'next/server';

const mockAuth = authenticateRequest as ReturnType<typeof vi.fn>;
const mockRateLimitResponse = rateLimitResponse as ReturnType<typeof vi.fn>;
const mockDistributedRateLimit = distributedRateLimit as ReturnType<typeof vi.fn>;
const mockAggregateRateLimit = aggregateGenerationRateLimit as ReturnType<typeof vi.fn>;
const mockResolveKey = resolveApiKey as ReturnType<typeof vi.fn>;
const mockRefundTokens = refundTokens as ReturnType<typeof vi.fn>;
const mockCaptureException = captureException as ReturnType<typeof vi.fn>;

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost:3000/api/generate/pixel-art', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const validBody = {
  prompt: 'a warrior knight with sword',
  targetSize: 32,
  palette: 'pico-8',
  dithering: 'none',
  ditheringIntensity: 0,
  style: 'character',
  provider: 'auto',
};

describe('POST /api/generate/pixel-art', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({
      ok: true,
      ctx: { user: { id: 'user-123', tier: 'pro' }, clerkId: 'clerk-123' },
    });
    mockDistributedRateLimit.mockResolvedValue({ allowed: true, remaining: 9, resetAt: Date.now() + 300000 });
    mockAggregateRateLimit.mockResolvedValue({ allowed: true, remaining: 29, resetAt: Date.now() + 900000 });
    mockRateLimitResponse.mockReturnValue(
      NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    );
    mockResolveKey.mockResolvedValue({ type: 'byok', key: 'sk-test-key', metered: false, usageId: 'usage-abc' });
    mockRefundTokens.mockResolvedValue(undefined);
    mockCaptureException.mockReturnValue(undefined);

    // Default: provider returns a Replicate prediction
    pixelArtClientMock.generate.mockResolvedValue({ predictionId: 'pred-xyz', status: 'starting' });
  });

  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    });
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(401);
  });

  it('returns 429 when rate limited', async () => {
    mockDistributedRateLimit.mockResolvedValue({ allowed: false, remaining: 0, resetAt: Date.now() + 300000 });
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(429);
  });

  it('returns 400 for short prompt', async () => {
    const res = await POST(makeRequest({ ...validBody, prompt: 'ab' }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('3 characters');
  });

  it('returns 400 for invalid size', async () => {
    const res = await POST(makeRequest({ ...validBody, targetSize: 50 }));
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid palette', async () => {
    const res = await POST(makeRequest({ ...validBody, palette: 'invalid' }));
    expect(res.status).toBe(400);
  });

  it('returns 400 for custom palette without colors', async () => {
    const res = await POST(makeRequest({ ...validBody, palette: 'custom' }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('Custom palette');
  });

  it('returns 400 for invalid dithering intensity', async () => {
    const res = await POST(makeRequest({ ...validBody, ditheringIntensity: 2 }));
    expect(res.status).toBe(400);
  });

  it('returns 402 when no API key', async () => {
    const { ApiKeyError: MockApiKeyError } = await import('@/lib/keys/resolver');
    mockResolveKey.mockRejectedValue(new MockApiKeyError('NO_KEY_CONFIGURED', 'No API key configured for replicate'));
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(402);
    const data = await res.json();
    expect(data.error).toContain('API key');
  });

  // PF-837 regression: route must call PixelArtClient and return the real provider jobId.
  // Previously the route charged tokens but returned a fake Date.now() stub job ID
  // without ever calling a provider — users paid but received nothing.
  it('calls PixelArtClient and returns provider jobId for replicate (PF-837)', async () => {
    pixelArtClientMock.generate.mockResolvedValue({ predictionId: 'pred-real-123', status: 'starting' });
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.jobId).toBe('pred-real-123');
    expect(data.status).toBe('pending');
    expect(data.provider).toBe('replicate');
    expect(data.tokenCost).toBe(10);
    expect(pixelArtClientMock.generate).toHaveBeenCalledTimes(1);
  });

  it('returns base64 and completed status for openai provider (PF-837)', async () => {
    pixelArtClientMock.generate.mockResolvedValue({ base64: 'aGVsbG8=' });
    const res = await POST(makeRequest({ ...validBody, provider: 'openai' }));
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.status).toBe('completed');
    expect(data.base64).toBe('aGVsbG8=');
    expect(data.provider).toBe('openai');
    expect(data.tokenCost).toBe(20);
    // The synthetic id is a client-side key only — OpenAI answers inline, so
    // there is no provider job to poll. It must be a UUID, not `Date.now()`:
    // two submissions in the same millisecond would otherwise collide.
    expect(data.jobId).toMatch(
      /^pxart-openai-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });

  // The defect this suite's PF-837 tests could not see: completion used to be
  // derived from the ABSENCE of a predictionId, so a replicate response with no
  // `id` was read as an OpenAI success — fabricated `pxart-openai-<timestamp>`
  // jobId, `status: 'completed'`, HTTP 201, tokens charged, nothing delivered.
  describe('provider succeeds but delivers no artifact', () => {
    const EXPECTED = 'Pixel art generation produced no image';

    it('replicate: returns 503 naming the missing artifact instead of a fake completed job', async () => {
      pixelArtClientMock.generate.mockResolvedValue({});
      const res = await POST(makeRequest(validBody));

      expect(res.status).toBe(503);
      const data = await res.json();
      expect(data.error).toBe(EXPECTED);
      expect(data.code).toBe('SERVICE_UNAVAILABLE');
      // The old fabricated id must never appear on a failure.
      expect(JSON.stringify(data)).not.toMatch(/pxart-openai-/);
      expect(data.status).toBeUndefined();
      expect(mockRefundTokens).toHaveBeenCalledWith('user-123', 'usage-abc');
    });

    it('replicate: treats an empty-string predictionId the same as a missing one', async () => {
      pixelArtClientMock.generate.mockResolvedValue({ predictionId: '', status: 'starting' });
      const res = await POST(makeRequest(validBody));

      expect(res.status).toBe(503);
      expect((await res.json()).error).toBe(EXPECTED);
      expect(mockRefundTokens).toHaveBeenCalledWith('user-123', 'usage-abc');
    });

    it('openai: returns 503 when the response carries an empty base64', async () => {
      pixelArtClientMock.generate.mockResolvedValue({ base64: '' });
      const res = await POST(makeRequest({ ...validBody, provider: 'openai' }));

      expect(res.status).toBe(503);
      const data = await res.json();
      expect(data.error).toBe(EXPECTED);
      expect(data.code).toBe('SERVICE_UNAVAILABLE');
      expect(mockRefundTokens).toHaveBeenCalledWith('user-123', 'usage-abc');
    });

    it('still reports the empty artifact to Sentry', async () => {
      pixelArtClientMock.generate.mockResolvedValue({});
      await POST(makeRequest(validBody));
      expect(mockCaptureException).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({ route: '/api/generate/pixel-art' })
      );
    });

    it('does not refund when there is no usageId', async () => {
      mockResolveKey.mockResolvedValue({ type: 'byok', key: 'sk-test-key', metered: false });
      pixelArtClientMock.generate.mockResolvedValue({});
      const res = await POST(makeRequest(validBody));

      expect(res.status).toBe(503);
      expect(mockRefundTokens).not.toHaveBeenCalled();
    });
  });

  it('refunds tokens and returns 500 when provider call fails (PF-837)', async () => {
    pixelArtClientMock.generate.mockRejectedValue(new Error('Replicate API error 503: Service down'));
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toBe('Generation failed due to a server error. Please try again later.');
    expect(data.error).not.toContain('Replicate');
    // Tokens must be refunded when provider fails
    expect(mockRefundTokens).toHaveBeenCalledWith('user-123', 'usage-abc');
  });

  it('reports provider error to Sentry when provider call fails (PF-837)', async () => {
    pixelArtClientMock.generate.mockRejectedValue(new Error('OpenAI timeout'));
    await POST(makeRequest({ ...validBody, provider: 'openai' }));
    expect(mockCaptureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ route: '/api/generate/pixel-art' })
    );
  });

  it('uses openai provider when specified', async () => {
    pixelArtClientMock.generate.mockResolvedValue({ base64: 'data' });
    const res = await POST(makeRequest({ ...validBody, provider: 'openai' }));
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.provider).toBe('openai');
    expect(data.tokenCost).toBe(20);
  });

  it('does not refund tokens when no usageId exists on provider error', async () => {
    mockResolveKey.mockResolvedValue({ type: 'byok', key: 'sk-test-key', metered: false });
    pixelArtClientMock.generate.mockRejectedValue(new Error('Provider error'));
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(500);
    // No usageId — refund should not be called
    expect(mockRefundTokens).not.toHaveBeenCalled();
  });
});
