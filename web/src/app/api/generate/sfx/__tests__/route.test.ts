vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { resolveApiKey } from '@/lib/keys/resolver';
import { rateLimit } from '@/lib/rateLimit';
import { refundTokens } from '@/lib/tokens/service';
import type { ElevenLabsClient } from '@/lib/generate/elevenlabsClient';

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
  getTokenCost: vi.fn().mockReturnValue(50),
}));
vi.mock('@/lib/generate/elevenlabsClient', () => {
  const ElevenLabsClient = vi.fn(function (this: Record<string, unknown>) {
    this.generateSfx = vi.fn().mockResolvedValue({
      audioBase64: 'base64audiodata==',
      durationSeconds: 5,
    });
    this.generateVoice = vi.fn();
  });
  return { ElevenLabsClient };
});
vi.mock('@/lib/monitoring/sentry-server', () => ({
  captureException: vi.fn(),
}));
vi.mock('@/lib/rateLimit', () => ({
  rateLimit: vi.fn(),
  rateLimitResponse: vi.fn(() => new Response('Rate limited', { status: 429 })),
}));
vi.mock('@/lib/tokens/service', () => ({
  refundTokens: vi.fn().mockResolvedValue(undefined),
}));

const mockUser = { id: 'user_sfx', tier: 'creator' };

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/generate/sfx', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/generate/sfx', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authenticateRequest).mockResolvedValue({
      ok: true as const,
      ctx: { clerkId: 'clerk_1', user: mockUser as never },
    });
    vi.mocked(rateLimit).mockResolvedValue({
      allowed: true,
      remaining: 9,
      resetAt: Date.now() + 300_000,
    });
    vi.mocked(resolveApiKey).mockResolvedValue({
      type: 'platform',
      key: 'platform-elevenlabs-key',
      metered: true,
      usageId: 'usage_sfx_001',
    });
  });

  describe('authentication', () => {
    it('returns 401 when not authenticated', async () => {
      vi.mocked(authenticateRequest).mockResolvedValue({
        ok: false as const,
        response: new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }) as never,
      });

      const { POST } = await import('../route');
      const res = await POST(makeRequest({ prompt: 'whoosh', durationSeconds: 3 }));

      expect(res.status).toBe(401);
    });
  });

  describe('rate limiting', () => {
    it('returns 429 when rate limited', async () => {
      vi.mocked(rateLimit).mockResolvedValue({
        allowed: false,
        remaining: 0,
        resetAt: Date.now() + 60_000,
      });

      const { POST } = await import('../route');
      const res = await POST(makeRequest({ prompt: 'whoosh', durationSeconds: 3 }));

      expect(res.status).toBe(429);
    });
  });

  describe('request validation', () => {
    it('returns 400 on invalid JSON body', async () => {
      const req = new NextRequest('http://localhost:3000/api/generate/sfx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{invalid-json',
      });

      const { POST } = await import('../route');
      const res = await POST(req);
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.error).toBe('Invalid JSON');
    });

    it('returns 422 when prompt is missing', async () => {
      const { POST } = await import('../route');
      const res = await POST(makeRequest({ durationSeconds: 5 }));
      const body = await res.json();

      expect(res.status).toBe(422);
      expect(body.error).toMatch(/Prompt must be/);
    });

    it('returns 422 when prompt is too short', async () => {
      const { POST } = await import('../route');
      const res = await POST(makeRequest({ prompt: 'ab', durationSeconds: 5 }));
      const body = await res.json();

      expect(res.status).toBe(422);
      expect(body.error).toMatch(/Prompt must be between 3 and 500/);
    });

    it('returns 422 when prompt exceeds 500 characters', async () => {
      const { POST } = await import('../route');
      const res = await POST(makeRequest({ prompt: 'z'.repeat(501), durationSeconds: 5 }));

      expect(res.status).toBe(422);
    });

    it('returns 422 when durationSeconds is too short (below 0.5)', async () => {
      const { POST } = await import('../route');
      const res = await POST(makeRequest({ prompt: 'explosion', durationSeconds: 0.4 }));
      const body = await res.json();

      expect(res.status).toBe(422);
      expect(body.error).toMatch(/Duration must be between/);
    });

    it('returns 422 when durationSeconds exceeds 22', async () => {
      const { POST } = await import('../route');
      const res = await POST(makeRequest({ prompt: 'rain', durationSeconds: 23 }));
      const body = await res.json();

      expect(res.status).toBe(422);
      expect(body.error).toMatch(/Duration must be between/);
    });

    it('accepts valid durationSeconds at boundary (0.5)', async () => {
      const { POST } = await import('../route');
      const res = await POST(makeRequest({ prompt: 'tick', durationSeconds: 0.5 }));

      expect(res.status).toBe(200);
    });

    it('accepts valid durationSeconds at boundary (22)', async () => {
      const { POST } = await import('../route');
      const res = await POST(makeRequest({ prompt: 'ocean waves', durationSeconds: 22 }));

      expect(res.status).toBe(200);
    });
  });

  describe('API key resolution errors', () => {
    it('returns 402 on ApiKeyError with NO_KEY_CONFIGURED', async () => {
      const { ApiKeyError } = await import('@/lib/keys/resolver');
      vi.mocked(resolveApiKey).mockRejectedValue(
        new ApiKeyError('NO_KEY_CONFIGURED', 'No elevenlabs key configured')
      );

      const { POST } = await import('../route');
      const res = await POST(makeRequest({ prompt: 'beep boop', durationSeconds: 3 }));
      const body = await res.json();

      expect(res.status).toBe(402);
      expect(body.error).toBe('No elevenlabs key configured');
      expect(body.code).toBe('NO_KEY_CONFIGURED');
    });

    it('returns 402 on ApiKeyError with INSUFFICIENT_TOKENS', async () => {
      const { ApiKeyError } = await import('@/lib/keys/resolver');
      vi.mocked(resolveApiKey).mockRejectedValue(
        new ApiKeyError('INSUFFICIENT_TOKENS', 'Need 50, have 0')
      );

      const { POST } = await import('../route');
      const res = await POST(makeRequest({ prompt: 'clang', durationSeconds: 2 }));
      const body = await res.json();

      expect(res.status).toBe(402);
      expect(body.code).toBe('INSUFFICIENT_TOKENS');
    });

    it('rethrows non-ApiKeyError exceptions', async () => {
      vi.mocked(resolveApiKey).mockRejectedValue(new Error('DB error'));

      const { POST } = await import('../route');
      await expect(
        POST(makeRequest({ prompt: 'thunder', durationSeconds: 5 }))
      ).rejects.toThrow('DB error');
    });
  });

  describe('successful SFX generation', () => {
    it('returns 200 with audioBase64 and durationSeconds', async () => {
      const { POST } = await import('../route');
      const res = await POST(makeRequest({ prompt: 'explosion sound', durationSeconds: 3 }));
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.audioBase64).toBe('base64audiodata==');
      expect(body.durationSeconds).toBe(5);
      expect(body.provider).toBe('elevenlabs');
    });

    it('defaults durationSeconds to 5 when not provided', async () => {
      const { POST } = await import('../route');
      // durationSeconds defaults to 5 in the route
      const res = await POST(makeRequest({ prompt: 'wind sound' }));

      expect(res.status).toBe(200);
    });

    it('calls resolveApiKey with sfx_generation operation', async () => {
      const { POST } = await import('../route');
      await POST(makeRequest({ prompt: 'sword clash', durationSeconds: 4 }));

      expect(vi.mocked(resolveApiKey)).toHaveBeenCalledWith(
        mockUser.id,
        'elevenlabs',
        50,
        'sfx_generation',
        expect.objectContaining({ prompt: 'sword clash' })
      );
    });
  });

  describe('ElevenLabs API errors', () => {
    it('returns 500 when ElevenLabs client throws', async () => {
      const { ElevenLabsClient } = await import('@/lib/generate/elevenlabsClient');
      vi.mocked(ElevenLabsClient).mockImplementationOnce(function (this: ElevenLabsClient) {
        this.generateSfx = vi.fn().mockRejectedValue(
          new Error('ElevenLabs SFX API error (500): Server error')
        );
        this.generateVoice = vi.fn();
      } as never);

      const { POST } = await import('../route');
      const res = await POST(makeRequest({ prompt: 'crash', durationSeconds: 2 }));
      const body = await res.json();

      expect(res.status).toBe(500);
      expect(body.error).toContain('ElevenLabs SFX API error');
    });

    it('returns "Provider error" for non-Error thrown objects', async () => {
      const { ElevenLabsClient } = await import('@/lib/generate/elevenlabsClient');
      vi.mocked(ElevenLabsClient).mockImplementationOnce(function (this: ElevenLabsClient) {
        this.generateSfx = vi.fn().mockRejectedValue('something went wrong');
        this.generateVoice = vi.fn();
      } as never);

      const { POST } = await import('../route');
      const res = await POST(makeRequest({ prompt: 'laser', durationSeconds: 1 }));
      const body = await res.json();

      expect(res.status).toBe(500);
      expect(body.error).toBe('Provider error');
    });
  });

  describe('usageId tracking and refund', () => {
    it('does not expose usageId in success response (prevents double refund)', async () => {
      const { POST } = await import('../route');
      const res = await POST(makeRequest({ prompt: 'explosion sound', durationSeconds: 3 }));
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.usageId).toBeUndefined();
    });

    it('calls refundTokens when provider fails with platform key', async () => {
      const { ElevenLabsClient } = await import('@/lib/generate/elevenlabsClient');
      vi.mocked(ElevenLabsClient).mockImplementationOnce(function (this: ElevenLabsClient) {
        this.generateSfx = vi.fn().mockRejectedValue(new Error('Provider timeout'));
        this.generateVoice = vi.fn();
      } as never);

      const { POST } = await import('../route');
      const res = await POST(makeRequest({ prompt: 'crash boom', durationSeconds: 2 }));

      expect(res.status).toBe(500);
      expect(vi.mocked(refundTokens)).toHaveBeenCalledWith('user_sfx', 'usage_sfx_001');
    });

    it('does not call refundTokens when usageId is undefined (BYOK)', async () => {
      vi.mocked(resolveApiKey).mockResolvedValue({
        type: 'byok',
        key: 'user-own-key',
        metered: false,
      });

      const { ElevenLabsClient } = await import('@/lib/generate/elevenlabsClient');
      vi.mocked(ElevenLabsClient).mockImplementationOnce(function (this: ElevenLabsClient) {
        this.generateSfx = vi.fn().mockRejectedValue(new Error('Provider error'));
        this.generateVoice = vi.fn();
      } as never);

      const { POST } = await import('../route');
      await POST(makeRequest({ prompt: 'zap sound', durationSeconds: 1 }));

      expect(vi.mocked(refundTokens)).not.toHaveBeenCalled();
    });

    it('still returns 500 even if refund fails', async () => {
      vi.mocked(refundTokens).mockRejectedValueOnce(new Error('Refund DB error'));

      const { ElevenLabsClient } = await import('@/lib/generate/elevenlabsClient');
      vi.mocked(ElevenLabsClient).mockImplementationOnce(function (this: ElevenLabsClient) {
        this.generateSfx = vi.fn().mockRejectedValue(new Error('Provider down'));
        this.generateVoice = vi.fn();
      } as never);

      const { POST } = await import('../route');
      const res = await POST(makeRequest({ prompt: 'bang', durationSeconds: 2 }));
      const body = await res.json();

      expect(res.status).toBe(500);
      expect(body.error).toContain('Provider down');
    });
  });
});
