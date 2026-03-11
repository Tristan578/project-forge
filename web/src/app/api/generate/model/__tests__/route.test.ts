import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { resolveApiKey } from '@/lib/keys/resolver';
import { rateLimit } from '@/lib/rateLimit';
import type { MeshyClient } from '@/lib/generate/meshyClient';

vi.mock('@/lib/auth/api-auth');
vi.mock('@/lib/keys/resolver', () => {
  class ApiKeyError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
      this.name = 'ApiKeyError';
    }
  }
  return {
    resolveApiKey: vi.fn(),
    ApiKeyError,
  };
});
vi.mock('@/lib/tokens/pricing', () => ({
  getTokenCost: vi.fn().mockReturnValue(100),
}));
vi.mock('@/lib/generate/meshyClient', () => {
  const MeshyClient = vi.fn(function (this: Record<string, unknown>) {
    this.createTextTo3D = vi.fn().mockResolvedValue({ taskId: 'meshy-task-001' });
    this.createImageTo3D = vi.fn().mockResolvedValue({ taskId: 'meshy-img-task-001' });
    this.getTaskStatus = vi.fn();
    this.createTextToTexture = vi.fn();
    this.getTextureStatus = vi.fn();
  });
  return { MeshyClient };
});
vi.mock('@/lib/monitoring/sentry-server', () => ({
  captureException: vi.fn(),
}));
vi.mock('@/lib/rateLimit', () => ({
  rateLimit: vi.fn(),
  rateLimitResponse: vi.fn(() => new Response('Rate limited', { status: 429 })),
}));

const mockUser = { id: 'user_123', tier: 'creator' };

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/generate/model', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/generate/model', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authenticateRequest).mockResolvedValue({
      ok: true as const,
      ctx: { clerkId: 'clerk_1', user: mockUser as never },
    });
    vi.mocked(rateLimit).mockReturnValue({
      allowed: true,
      remaining: 9,
      resetAt: Date.now() + 300_000,
    });
    vi.mocked(resolveApiKey).mockResolvedValue({
      type: 'platform',
      key: 'platform-meshy-key',
      metered: true,
      usageId: 'usage_123',
    });
  });

  describe('authentication', () => {
    it('returns 401 when not authenticated', async () => {
      vi.mocked(authenticateRequest).mockResolvedValue({
        ok: false as const,
        response: new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }) as never,
      });

      const { POST } = await import('../route');
      const res = await POST(makeRequest({ prompt: 'a car', mode: 'text-to-3d' }));

      expect(res.status).toBe(401);
    });
  });

  describe('rate limiting', () => {
    it('returns 429 when rate limited', async () => {
      vi.mocked(rateLimit).mockReturnValue({
        allowed: false,
        remaining: 0,
        resetAt: Date.now() + 60_000,
      });

      const { POST } = await import('../route');
      const res = await POST(makeRequest({ prompt: 'a car', mode: 'text-to-3d' }));

      expect(res.status).toBe(429);
    });
  });

  describe('request validation', () => {
    it('returns 400 on invalid JSON body', async () => {
      const req = new NextRequest('http://localhost:3000/api/generate/model', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not-json{{{',
      });

      const { POST } = await import('../route');
      const res = await POST(req);
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.error).toBe('Invalid JSON');
    });

    it('returns 422 when prompt is missing', async () => {
      const { POST } = await import('../route');
      const res = await POST(makeRequest({ mode: 'text-to-3d' }));
      const body = await res.json();

      expect(res.status).toBe(422);
      expect(body.error).toMatch(/Prompt must be/);
    });

    it('returns 422 when prompt is too short (less than 3 chars)', async () => {
      const { POST } = await import('../route');
      const res = await POST(makeRequest({ prompt: 'ab', mode: 'text-to-3d' }));
      const body = await res.json();

      expect(res.status).toBe(422);
      expect(body.error).toMatch(/Prompt must be between 3 and 500/);
    });

    it('returns 422 when prompt exceeds 500 characters', async () => {
      const { POST } = await import('../route');
      const res = await POST(makeRequest({ prompt: 'a'.repeat(501), mode: 'text-to-3d' }));

      expect(res.status).toBe(422);
    });

    it('returns 422 for image-to-3d mode without imageBase64', async () => {
      const { POST } = await import('../route');
      const res = await POST(makeRequest({ prompt: 'a car from image', mode: 'image-to-3d' }));
      const body = await res.json();

      expect(res.status).toBe(422);
      expect(body.error).toMatch(/imageBase64 required/);
    });
  });

  describe('API key resolution errors', () => {
    it('returns 402 on ApiKeyError with NO_KEY_CONFIGURED', async () => {
      const { ApiKeyError } = await import('@/lib/keys/resolver');
      vi.mocked(resolveApiKey).mockRejectedValue(
        new ApiKeyError('NO_KEY_CONFIGURED', 'No meshy API key configured')
      );

      const { POST } = await import('../route');
      const res = await POST(makeRequest({ prompt: 'a tree', mode: 'text-to-3d' }));
      const body = await res.json();

      expect(res.status).toBe(402);
      expect(body.error).toBe('No meshy API key configured');
      expect(body.code).toBe('NO_KEY_CONFIGURED');
    });

    it('returns 402 on ApiKeyError with INSUFFICIENT_TOKENS', async () => {
      const { ApiKeyError } = await import('@/lib/keys/resolver');
      vi.mocked(resolveApiKey).mockRejectedValue(
        new ApiKeyError('INSUFFICIENT_TOKENS', 'Insufficient tokens. Need 100, have 0.')
      );

      const { POST } = await import('../route');
      const res = await POST(makeRequest({ prompt: 'mountain', mode: 'text-to-3d' }));
      const body = await res.json();

      expect(res.status).toBe(402);
      expect(body.code).toBe('INSUFFICIENT_TOKENS');
    });

    it('returns 402 on ApiKeyError with TIER_NOT_ALLOWED', async () => {
      const { ApiKeyError } = await import('@/lib/keys/resolver');
      vi.mocked(resolveApiKey).mockRejectedValue(
        new ApiKeyError('TIER_NOT_ALLOWED', 'Starter tier cannot use AI generation')
      );

      const { POST } = await import('../route');
      const res = await POST(makeRequest({ prompt: 'spaceship', mode: 'text-to-3d' }));
      const body = await res.json();

      expect(res.status).toBe(402);
      expect(body.code).toBe('TIER_NOT_ALLOWED');
    });

    it('rethrows non-ApiKeyError exceptions', async () => {
      vi.mocked(resolveApiKey).mockRejectedValue(new Error('DB connection failed'));

      const { POST } = await import('../route');
      await expect(
        POST(makeRequest({ prompt: 'dragon', mode: 'text-to-3d' }))
      ).rejects.toThrow('DB connection failed');
    });
  });

  describe('successful text-to-3d generation', () => {
    it('returns 201 with jobId, provider, status, and estimatedSeconds', async () => {
      const { POST } = await import('../route');
      const res = await POST(
        makeRequest({ prompt: 'a red dragon', mode: 'text-to-3d', quality: 'standard' })
      );
      const body = await res.json();

      expect(res.status).toBe(201);
      expect(body.jobId).toBe('meshy-task-001');
      expect(body.provider).toBe('meshy');
      expect(body.status).toBe('pending');
      expect(body.estimatedSeconds).toBe(60);
    });

    it('returns 120 estimatedSeconds for high quality', async () => {
      const { POST } = await import('../route');
      const res = await POST(
        makeRequest({ prompt: 'a castle', mode: 'text-to-3d', quality: 'high' })
      );
      const body = await res.json();

      expect(res.status).toBe(201);
      expect(body.estimatedSeconds).toBe(120);
    });

    it('returns usageId from resolveApiKey', async () => {
      const { POST } = await import('../route');
      const res = await POST(makeRequest({ prompt: 'potion', mode: 'text-to-3d' }));
      const body = await res.json();

      expect(body.usageId).toBe('usage_123');
    });
  });

  describe('successful image-to-3d generation', () => {
    it('returns 201 with jobId for image-to-3d mode', async () => {
      const { POST } = await import('../route');
      const res = await POST(
        makeRequest({
          prompt: 'from image',
          mode: 'image-to-3d',
          imageBase64: 'data:image/png;base64,abc123',
        })
      );
      const body = await res.json();

      expect(res.status).toBe(201);
      expect(body.jobId).toBe('meshy-img-task-001');
    });
  });

  describe('Meshy API errors', () => {
    it('returns 500 when Meshy client throws', async () => {
      const { MeshyClient } = await import('@/lib/generate/meshyClient');
      vi.mocked(MeshyClient).mockImplementationOnce(function (this: MeshyClient) {
        this.createTextTo3D = vi.fn().mockRejectedValue(new Error('Meshy API error (500): Server down'));
        this.createImageTo3D = vi.fn();
        this.getTaskStatus = vi.fn();
        this.createTextToTexture = vi.fn();
        this.getTextureStatus = vi.fn();
      } as never);

      const { POST } = await import('../route');
      const res = await POST(makeRequest({ prompt: 'sword', mode: 'text-to-3d' }));
      const body = await res.json();

      expect(res.status).toBe(500);
      expect(body.error).toContain('Meshy API error');
    });

    it('returns "Provider error" for non-Error thrown objects', async () => {
      const { MeshyClient } = await import('@/lib/generate/meshyClient');
      vi.mocked(MeshyClient).mockImplementationOnce(function (this: MeshyClient) {
        this.createTextTo3D = vi.fn().mockRejectedValue('string error');
        this.createImageTo3D = vi.fn();
        this.getTaskStatus = vi.fn();
        this.createTextToTexture = vi.fn();
        this.getTextureStatus = vi.fn();
      } as never);

      const { POST } = await import('../route');
      const res = await POST(makeRequest({ prompt: 'gem', mode: 'text-to-3d' }));
      const body = await res.json();

      expect(res.status).toBe(500);
      expect(body.error).toBe('Provider error');
    });
  });
});
