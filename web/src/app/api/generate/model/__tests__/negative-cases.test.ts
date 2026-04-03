/**
 * Additional negative / error case tests for POST /api/generate/model
 *
 * Extends existing route tests with boundary conditions, malformed payloads,
 * and provider timeout scenarios.
 */
vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { makeUser } from '@/test/utils/apiTestUtils';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockUser = makeUser({ id: 'user-gen', tier: 'creator' });

vi.mock('@/lib/auth/api-auth', () => ({
  authenticateRequest: vi.fn(),
}));

vi.mock('@/lib/rateLimit', () => ({
  rateLimit: vi.fn(),
  rateLimitResponse: vi.fn(() => new Response(JSON.stringify({ error: 'Too many requests' }), { status: 429 })),
}));

vi.mock('@/lib/keys/resolver', () => {
  class ApiKeyError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
      this.name = 'ApiKeyError';
    }
  }
  return { resolveApiKey: vi.fn(), ApiKeyError };
});

vi.mock('@/lib/tokens/pricing', () => ({
  getTokenCost: vi.fn(() => 100),
}));

vi.mock('@/lib/rateLimit/distributed', () => ({
  distributedRateLimit: vi.fn().mockResolvedValue({ allowed: true, remaining: 9, resetAt: Date.now() + 300000 }),
  aggregateGenerationRateLimit: vi.fn().mockResolvedValue({ allowed: true, remaining: 29, resetAt: Date.now() + 900000 }),
}));

const mockCreateTextTo3D = vi.fn();
const mockCreateImageTo3D = vi.fn();

vi.mock('@/lib/generate/meshyClient', () => {
  const MeshyClient = vi.fn(function (this: Record<string, unknown>) {
    this.createTextTo3D = mockCreateTextTo3D;
    this.createImageTo3D = mockCreateImageTo3D;
    this.getTaskStatus = vi.fn();
    this.createTextToTexture = vi.fn();
    this.getTextureStatus = vi.fn();
  });
  return { MeshyClient };
});

vi.mock('@/lib/monitoring/sentry-server', () => ({
  captureException: vi.fn(),
}));

vi.mock('@/lib/ai/contentSafety', () => ({
  sanitizePrompt: vi.fn((prompt: unknown) => ({
    safe: true,
    filtered: typeof prompt === 'string' ? prompt : String(prompt),
  })),
}));

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { authenticateRequest } from '@/lib/auth/api-auth';
import { rateLimit } from '@/lib/rateLimit';
import { distributedRateLimit } from '@/lib/rateLimit/distributed';
import { resolveApiKey } from '@/lib/keys/resolver';
import { captureException } from '@/lib/monitoring/sentry-server';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/generate/model', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

function makeRawRequest(rawBody: string): NextRequest {
  return new NextRequest('http://localhost:3000/api/generate/model', {
    method: 'POST',
    body: rawBody,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/generate/model — negative cases', () => {
  let POST: (request: NextRequest) => Promise<Response>;

  beforeEach(async () => {
    vi.clearAllMocks();

    vi.mocked(authenticateRequest).mockResolvedValue({
      ok: true,
      ctx: { user: mockUser, clerkId: 'clerk_gen' },
    });
    vi.mocked(rateLimit).mockResolvedValue({ allowed: true, remaining: 9, resetAt: Date.now() + 300_000 });
    vi.mocked(resolveApiKey).mockResolvedValue({
      type: 'platform',
      key: 'meshy-key',
      metered: true,
      usageId: 'usage-gen',
    } as Awaited<ReturnType<typeof resolveApiKey>>);
    mockCreateTextTo3D.mockResolvedValue({ taskId: 'task-001' });
    mockCreateImageTo3D.mockResolvedValue({ taskId: 'img-001' });

    const mod = await import('../route');
    POST = mod.POST;
  });

  // -------------------------------------------------------------------------
  // Malformed body edge cases
  // -------------------------------------------------------------------------
  describe('malformed body', () => {
    it('returns 400 for empty body', async () => {
      const req = makeRawRequest('');
      const res = await POST(req);
      expect(res.status).toBe(400);
    });

    it('returns 400 when body is null JSON', async () => {
      const req = makeRawRequest('null');
      const res = await POST(req);
      expect(res.status).toBe(400);
    });

    it('returns 400 for array JSON body', async () => {
      const req = makeRawRequest('[1,2,3]');
      const res = await POST(req);
      expect(res.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // Prompt boundary conditions
  // -------------------------------------------------------------------------
  describe('prompt boundary conditions', () => {
    it('returns 422 for prompt of exactly 2 characters (below minimum)', async () => {
      const res = await POST(makeRequest({ prompt: 'ab', mode: 'text-to-3d' }));
      expect(res.status).toBe(422);
      const body = await res.json();
      expect(body.error).toMatch(/3 and 500/);
    });

    it('accepts prompt of exactly 3 characters (minimum)', async () => {
      const res = await POST(makeRequest({ prompt: 'abc', mode: 'text-to-3d' }));
      expect(res.status).toBe(201);
    });

    it('accepts prompt of exactly 500 characters (maximum)', async () => {
      const res = await POST(makeRequest({ prompt: 'x'.repeat(500), mode: 'text-to-3d' }));
      expect(res.status).toBe(201);
    });

    it('returns 422 for prompt of exactly 501 characters (above maximum)', async () => {
      const res = await POST(makeRequest({ prompt: 'x'.repeat(501), mode: 'text-to-3d' }));
      expect(res.status).toBe(422);
    });

    it('returns 422 for empty string prompt', async () => {
      const res = await POST(makeRequest({ prompt: '', mode: 'text-to-3d' }));
      expect(res.status).toBe(422);
    });

    it('rejects numeric prompt with 422', async () => {
      const res = await POST(makeRequest({ prompt: 12345, mode: 'text-to-3d' }));
      expect(res.status).toBe(422);
    });

    it('returns 422 when prompt is null (falsy check)', async () => {
      const res = await POST(makeRequest({ prompt: null, mode: 'text-to-3d' }));
      expect(res.status).toBe(422);
    });
  });

  // -------------------------------------------------------------------------
  // Rate limiting
  // -------------------------------------------------------------------------
  describe('rate limiting', () => {
    it('applies rate limit with correct key pattern', async () => {
      await POST(makeRequest({ prompt: 'test model', mode: 'text-to-3d' }));
      expect(distributedRateLimit).toHaveBeenCalledWith('gen-model:user-gen', 10, 300);
    });

    it('returns 429 with proper response when rate limited', async () => {
      vi.mocked(distributedRateLimit).mockResolvedValueOnce({ allowed: false, remaining: 0, resetAt: Date.now() + 60_000 });

      const res = await POST(makeRequest({ prompt: 'test', mode: 'text-to-3d' }));
      expect(res.status).toBe(429);
    });

    it('does not call Meshy API when rate limited', async () => {
      vi.mocked(distributedRateLimit).mockResolvedValueOnce({ allowed: false, remaining: 0, resetAt: Date.now() + 60_000 });

      await POST(makeRequest({ prompt: 'test model', mode: 'text-to-3d' }));
      expect(mockCreateTextTo3D).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Provider errors and timeouts
  // -------------------------------------------------------------------------
  describe('provider errors', () => {
    it('returns 500 when Meshy times out', async () => {
      mockCreateTextTo3D.mockRejectedValue(new Error('Request timeout after 180000ms'));

      const res = await POST(makeRequest({ prompt: 'slow model', mode: 'text-to-3d' }));
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toContain('timeout');
    });

    it('captures exception with route context on provider error', async () => {
      mockCreateTextTo3D.mockRejectedValue(new Error('Meshy 503'));

      await POST(makeRequest({ prompt: 'broken', mode: 'text-to-3d' }));
      expect(captureException).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({ route: '/api/generate/model' }),
      );
    });

    it('returns 500 for image-to-3d provider failure', async () => {
      mockCreateImageTo3D.mockRejectedValue(new Error('Image processing failed'));

      const res = await POST(makeRequest({
        prompt: 'from this image',
        mode: 'image-to-3d',
        imageBase64: 'data:image/png;base64,abc',
      }));
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toContain('Image processing failed');
    });
  });

  // -------------------------------------------------------------------------
  // Token cost calculation
  // -------------------------------------------------------------------------
  describe('token cost by quality/mode', () => {
    it('resolves API key with 3d_generation_standard for text-to-3d standard', async () => {
      await POST(makeRequest({ prompt: 'test', mode: 'text-to-3d', quality: 'standard' }));
      expect(resolveApiKey).toHaveBeenCalledWith(
        'user-gen',
        'meshy',
        expect.any(Number),
        '3d_generation_standard',
        expect.objectContaining({ prompt: 'test', mode: 'text-to-3d', quality: 'standard' }),
      );
    });

    it('resolves API key with 3d_generation_high for text-to-3d high', async () => {
      await POST(makeRequest({ prompt: 'test', mode: 'text-to-3d', quality: 'high' }));
      expect(resolveApiKey).toHaveBeenCalledWith(
        'user-gen',
        'meshy',
        expect.any(Number),
        '3d_generation_high',
        expect.objectContaining({ quality: 'high' }),
      );
    });

    it('resolves API key with image_to_3d for image-to-3d mode', async () => {
      await POST(makeRequest({
        prompt: 'img',
        mode: 'image-to-3d',
        imageBase64: 'data:image/png;base64,abc',
      }));
      expect(resolveApiKey).toHaveBeenCalledWith(
        'user-gen',
        'meshy',
        expect.any(Number),
        'image_to_3d',
        expect.objectContaining({ mode: 'image-to-3d' }),
      );
    });
  });
});
