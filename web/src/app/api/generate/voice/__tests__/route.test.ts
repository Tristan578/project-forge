import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { resolveApiKey } from '@/lib/keys/resolver';
import { rateLimit } from '@/lib/rateLimit';
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
  getTokenCost: vi.fn().mockReturnValue(75),
}));
vi.mock('@/lib/generate/elevenlabsClient', () => {
  const ElevenLabsClient = vi.fn(function (this: ElevenLabsClient) {
    this.generateSfx = vi.fn();
    this.generateVoice = vi.fn().mockResolvedValue({
      audioBase64: 'voiceaudio==',
      durationSeconds: 3,
    });
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

const mockUser = { id: 'user_voice', tier: 'pro' };

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/generate/voice', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/generate/voice', () => {
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
      key: 'platform-elevenlabs-key',
      metered: true,
      usageId: 'usage_voice_001',
    });
  });

  describe('authentication', () => {
    it('returns 401 when not authenticated', async () => {
      vi.mocked(authenticateRequest).mockResolvedValue({
        ok: false as const,
        response: new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }) as never,
      });

      const { POST } = await import('../route');
      const res = await POST(makeRequest({ text: 'Hello world' }));

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
      const res = await POST(makeRequest({ text: 'Hello world' }));

      expect(res.status).toBe(429);
    });
  });

  describe('request validation', () => {
    it('returns 400 on invalid JSON body', async () => {
      const req = new NextRequest('http://localhost:3000/api/generate/voice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'invalid}json',
      });

      const { POST } = await import('../route');
      const res = await POST(req);
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.error).toBe('Invalid JSON');
    });

    it('returns 422 when text is missing', async () => {
      const { POST } = await import('../route');
      const res = await POST(makeRequest({}));
      const body = await res.json();

      expect(res.status).toBe(422);
      expect(body.error).toMatch(/Text must be between/);
    });

    it('returns 422 when text is empty string', async () => {
      const { POST } = await import('../route');
      const res = await POST(makeRequest({ text: '' }));
      const body = await res.json();

      expect(res.status).toBe(422);
      expect(body.error).toMatch(/Text must be between 1 and 1000/);
    });

    it('returns 422 when text exceeds 1000 characters', async () => {
      const { POST } = await import('../route');
      const res = await POST(makeRequest({ text: 'x'.repeat(1001) }));

      expect(res.status).toBe(422);
    });

    it('accepts single character text', async () => {
      const { POST } = await import('../route');
      const res = await POST(makeRequest({ text: 'A' }));

      expect(res.status).toBe(200);
    });

    it('accepts text at the 1000 character boundary', async () => {
      const { POST } = await import('../route');
      const res = await POST(makeRequest({ text: 'y'.repeat(1000) }));

      expect(res.status).toBe(200);
    });
  });

  describe('voice style mapping', () => {
    it('maps "friendly" voiceStyle to numeric style 0.3', async () => {
      const { ElevenLabsClient } = await import('@/lib/generate/elevenlabsClient');
      const mockGenerateVoice = vi.fn().mockResolvedValue({ audioBase64: 'x==', durationSeconds: 1 });
      vi.mocked(ElevenLabsClient).mockImplementationOnce(function (this: ElevenLabsClient) {
        this.generateSfx = vi.fn();
        this.generateVoice = mockGenerateVoice;
      } as never);

      const { POST } = await import('../route');
      await POST(makeRequest({ text: 'Hello friend', voiceStyle: 'friendly' }));

      expect(mockGenerateVoice).toHaveBeenCalledWith(
        expect.objectContaining({ style: 0.3 })
      );
    });

    it('maps "calm" voiceStyle to 0.2', async () => {
      const { ElevenLabsClient } = await import('@/lib/generate/elevenlabsClient');
      const mockGenerateVoice = vi.fn().mockResolvedValue({ audioBase64: 'x==', durationSeconds: 1 });
      vi.mocked(ElevenLabsClient).mockImplementationOnce(function (this: ElevenLabsClient) {
        this.generateSfx = vi.fn();
        this.generateVoice = mockGenerateVoice;
      } as never);

      const { POST } = await import('../route');
      await POST(makeRequest({ text: 'Relax', voiceStyle: 'calm' }));

      expect(mockGenerateVoice).toHaveBeenCalledWith(
        expect.objectContaining({ style: 0.2 })
      );
    });

    it('maps "excited" voiceStyle to 1.0', async () => {
      const { ElevenLabsClient } = await import('@/lib/generate/elevenlabsClient');
      const mockGenerateVoice = vi.fn().mockResolvedValue({ audioBase64: 'x==', durationSeconds: 1 });
      vi.mocked(ElevenLabsClient).mockImplementationOnce(function (this: ElevenLabsClient) {
        this.generateSfx = vi.fn();
        this.generateVoice = mockGenerateVoice;
      } as never);

      const { POST } = await import('../route');
      await POST(makeRequest({ text: 'Woohoo!', voiceStyle: 'excited' }));

      expect(mockGenerateVoice).toHaveBeenCalledWith(
        expect.objectContaining({ style: 1.0 })
      );
    });

    it('maps "sinister" voiceStyle to 0.7', async () => {
      const { ElevenLabsClient } = await import('@/lib/generate/elevenlabsClient');
      const mockGenerateVoice = vi.fn().mockResolvedValue({ audioBase64: 'x==', durationSeconds: 1 });
      vi.mocked(ElevenLabsClient).mockImplementationOnce(function (this: ElevenLabsClient) {
        this.generateSfx = vi.fn();
        this.generateVoice = mockGenerateVoice;
      } as never);

      const { POST } = await import('../route');
      await POST(makeRequest({ text: 'Muhahaha', voiceStyle: 'sinister' }));

      expect(mockGenerateVoice).toHaveBeenCalledWith(
        expect.objectContaining({ style: 0.7 })
      );
    });

    it('maps "neutral" voiceStyle to 0', async () => {
      const { ElevenLabsClient } = await import('@/lib/generate/elevenlabsClient');
      const mockGenerateVoice = vi.fn().mockResolvedValue({ audioBase64: 'x==', durationSeconds: 1 });
      vi.mocked(ElevenLabsClient).mockImplementationOnce(function (this: ElevenLabsClient) {
        this.generateSfx = vi.fn();
        this.generateVoice = mockGenerateVoice;
      } as never);

      const { POST } = await import('../route');
      await POST(makeRequest({ text: 'Hello', voiceStyle: 'neutral' }));

      expect(mockGenerateVoice).toHaveBeenCalledWith(
        expect.objectContaining({ style: 0 })
      );
    });

    it('falls back to 0 for unknown voiceStyle strings', async () => {
      const { ElevenLabsClient } = await import('@/lib/generate/elevenlabsClient');
      const mockGenerateVoice = vi.fn().mockResolvedValue({ audioBase64: 'x==', durationSeconds: 1 });
      vi.mocked(ElevenLabsClient).mockImplementationOnce(function (this: ElevenLabsClient) {
        this.generateSfx = vi.fn();
        this.generateVoice = mockGenerateVoice;
      } as never);

      const { POST } = await import('../route');
      await POST(makeRequest({ text: 'Test', voiceStyle: 'unknown-style' }));

      expect(mockGenerateVoice).toHaveBeenCalledWith(
        expect.objectContaining({ style: 0 })
      );
    });

    it('passes numeric style directly when voiceStyle is absent', async () => {
      const { ElevenLabsClient } = await import('@/lib/generate/elevenlabsClient');
      const mockGenerateVoice = vi.fn().mockResolvedValue({ audioBase64: 'x==', durationSeconds: 1 });
      vi.mocked(ElevenLabsClient).mockImplementationOnce(function (this: ElevenLabsClient) {
        this.generateSfx = vi.fn();
        this.generateVoice = mockGenerateVoice;
      } as never);

      const { POST } = await import('../route');
      await POST(makeRequest({ text: 'Hello', style: 0.6 }));

      expect(mockGenerateVoice).toHaveBeenCalledWith(
        expect.objectContaining({ style: 0.6 })
      );
    });
  });

  describe('API key resolution errors', () => {
    it('returns 402 on ApiKeyError with NO_KEY_CONFIGURED', async () => {
      const { ApiKeyError } = await import('@/lib/keys/resolver');
      vi.mocked(resolveApiKey).mockRejectedValue(
        new ApiKeyError('NO_KEY_CONFIGURED', 'No elevenlabs key')
      );

      const { POST } = await import('../route');
      const res = await POST(makeRequest({ text: 'Hello there' }));
      const body = await res.json();

      expect(res.status).toBe(402);
      expect(body.code).toBe('NO_KEY_CONFIGURED');
    });

    it('returns 402 on ApiKeyError with TIER_NOT_ALLOWED', async () => {
      const { ApiKeyError } = await import('@/lib/keys/resolver');
      vi.mocked(resolveApiKey).mockRejectedValue(
        new ApiKeyError('TIER_NOT_ALLOWED', 'Starter tier not allowed')
      );

      const { POST } = await import('../route');
      const res = await POST(makeRequest({ text: 'Hello' }));
      const body = await res.json();

      expect(res.status).toBe(402);
      expect(body.code).toBe('TIER_NOT_ALLOWED');
    });

    it('rethrows non-ApiKeyError exceptions', async () => {
      vi.mocked(resolveApiKey).mockRejectedValue(new Error('Network failure'));

      const { POST } = await import('../route');
      await expect(POST(makeRequest({ text: 'Hi' }))).rejects.toThrow('Network failure');
    });
  });

  describe('successful voice generation', () => {
    it('returns 200 with audioBase64, durationSeconds, and provider', async () => {
      const { POST } = await import('../route');
      const res = await POST(makeRequest({ text: 'Welcome to SpawnForge' }));
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.audioBase64).toBe('voiceaudio==');
      expect(body.durationSeconds).toBe(3);
      expect(body.provider).toBe('elevenlabs');
    });

    it('calls resolveApiKey with voice_generation operation and text length', async () => {
      const text = 'Hello world';
      const { POST } = await import('../route');
      await POST(makeRequest({ text }));

      expect(vi.mocked(resolveApiKey)).toHaveBeenCalledWith(
        mockUser.id,
        'elevenlabs',
        75,
        'voice_generation',
        expect.objectContaining({ text, textLength: text.length })
      );
    });

    it('passes voiceId to ElevenLabs client', async () => {
      const { ElevenLabsClient } = await import('@/lib/generate/elevenlabsClient');
      const mockGenerateVoice = vi.fn().mockResolvedValue({ audioBase64: 'x==', durationSeconds: 2 });
      vi.mocked(ElevenLabsClient).mockImplementationOnce(function (this: ElevenLabsClient) {
        this.generateSfx = vi.fn();
        this.generateVoice = mockGenerateVoice;
      } as never);

      const { POST } = await import('../route');
      await POST(makeRequest({ text: 'Test', voiceId: 'CustomVoiceABC' }));

      expect(mockGenerateVoice).toHaveBeenCalledWith(
        expect.objectContaining({ voiceId: 'CustomVoiceABC' })
      );
    });
  });

  describe('ElevenLabs API errors', () => {
    it('returns 500 when ElevenLabs TTS throws', async () => {
      const { ElevenLabsClient } = await import('@/lib/generate/elevenlabsClient');
      vi.mocked(ElevenLabsClient).mockImplementationOnce(function (this: ElevenLabsClient) {
        this.generateSfx = vi.fn();
        this.generateVoice = vi.fn().mockRejectedValue(
          new Error('ElevenLabs TTS API error (500): Internal error')
        );
      } as never);

      const { POST } = await import('../route');
      const res = await POST(makeRequest({ text: 'Hello' }));
      const body = await res.json();

      expect(res.status).toBe(500);
      expect(body.error).toContain('ElevenLabs TTS API error');
    });

    it('returns "Provider error" for non-Error thrown objects', async () => {
      const { ElevenLabsClient } = await import('@/lib/generate/elevenlabsClient');
      vi.mocked(ElevenLabsClient).mockImplementationOnce(function (this: ElevenLabsClient) {
        this.generateSfx = vi.fn();
        this.generateVoice = vi.fn().mockRejectedValue('unexpected error');
      } as never);

      const { POST } = await import('../route');
      const res = await POST(makeRequest({ text: 'Hi there' }));
      const body = await res.json();

      expect(res.status).toBe(500);
      expect(body.error).toBe('Provider error');
    });
  });
});
