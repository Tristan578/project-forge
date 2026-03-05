/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';
import { POST } from './route';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { rateLimit } from '@/lib/rateLimit';
import { resolveApiKey, ApiKeyError } from '@/lib/keys/resolver';
import { ElevenLabsClient } from '@/lib/generate/elevenlabsClient';

vi.mock('@/lib/auth/api-auth');
vi.mock('@/lib/rateLimit', () => ({
  rateLimit: vi.fn(),
  rateLimitResponse: vi.fn(() => new Response('Rate limited', { status: 429 })),
}));
vi.mock('@/lib/keys/resolver', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/keys/resolver')>();
  return { ...mod, resolveApiKey: vi.fn() };
});
vi.mock('@/lib/generate/elevenlabsClient', () => ({
  ElevenLabsClient: vi.fn(() => ({
    generateVoice: vi.fn(),
  })),
}));

function makeRequest(body: unknown) {
  return new Request('http://test/api/generate/voice/batch', {
    method: 'POST',
    body: JSON.stringify(body),
  }) as any;
}

const validBody = {
  items: [
    { nodeId: 'node-1', text: 'Hello world', speaker: 'Alice' },
    { nodeId: 'node-2', text: 'Goodbye world', speaker: 'Bob' },
  ],
  voiceSettings: {
    voiceId: 'voice-abc',
    stability: 0.5,
    similarityBoost: 0.7,
    style: 0.3,
  },
};

describe('POST /api/generate/voice/batch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authenticateRequest).mockResolvedValue({
      ok: true as const,
      ctx: { clerkId: 'clerk_1', user: { id: 'user_1', tier: 'creator' } as any },
    });
    vi.mocked(rateLimit).mockReturnValue({ allowed: true, remaining: 4, resetAt: Date.now() + 300000 });
    vi.mocked(resolveApiKey).mockResolvedValue({ type: 'platform', key: 'test-key', metered: true, usageId: 'usage-1' });
    vi.mocked(ElevenLabsClient).mockImplementation(function () {
      return {
        generateVoice: vi.fn().mockResolvedValue({
          audioBase64: 'base64audio',
          durationSeconds: 2.5,
        }),
      } as any;
    } as any);
  });

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({
      ok: false as const,
      response: new NextResponse('Unauthorized', { status: 401 }),
    });

    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(401);
  });

  it('returns 429 when rate limited', async () => {
    vi.mocked(rateLimit).mockReturnValue({ allowed: false, remaining: 0, resetAt: Date.now() + 300000 });

    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(429);
  });

  it('returns 400 for invalid JSON body', async () => {
    const req = new Request('http://test/api/generate/voice/batch', {
      method: 'POST',
      body: 'not json',
    });

    const res = await POST(req as any);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('Invalid JSON');
  });

  it('returns 422 when items array is empty', async () => {
    const res = await POST(makeRequest({ items: [], voiceSettings: validBody.voiceSettings }));
    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.error).toBe('items array is required');
  });

  it('returns 422 when items is not an array', async () => {
    const res = await POST(makeRequest({ items: 'not-array', voiceSettings: validBody.voiceSettings }));
    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.error).toBe('items array is required');
  });

  it('returns 422 when items exceed maximum of 20', async () => {
    const tooManyItems = Array.from({ length: 21 }, (_, i) => ({
      nodeId: `node-${i}`,
      text: 'Hello',
      speaker: 'Alice',
    }));
    const res = await POST(makeRequest({ items: tooManyItems, voiceSettings: validBody.voiceSettings }));
    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.error).toBe('Maximum 20 items per batch');
  });

  it('returns 422 when item text exceeds 1000 characters', async () => {
    const longText = 'a'.repeat(1001);
    const res = await POST(makeRequest({
      items: [{ nodeId: 'node-1', text: longText, speaker: 'Alice' }],
      voiceSettings: validBody.voiceSettings,
    }));
    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.error).toContain('text must be 1-1000 characters');
  });

  it('returns 422 when voiceSettings.voiceId is missing', async () => {
    const res = await POST(makeRequest({
      items: validBody.items,
      voiceSettings: { stability: 0.5, similarityBoost: 0.7, style: 0.3 },
    }));
    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.error).toBe('voiceSettings.voiceId is required');
  });

  it('returns 402 when API key resolution fails', async () => {
    vi.mocked(resolveApiKey).mockRejectedValue(
      new ApiKeyError('INSUFFICIENT_TOKENS', 'Not enough tokens')
    );

    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(402);
    const data = await res.json();
    expect(data.code).toBe('INSUFFICIENT_TOKENS');
  });

  it('returns successful results for all items', async () => {
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.totalGenerated).toBe(2);
    expect(data.totalFailed).toBe(0);
    expect(data.results).toHaveLength(2);
    expect(data.results[0].nodeId).toBe('node-1');
    expect(data.results[0].audioBase64).toBe('base64audio');
    expect(data.results[0].durationSeconds).toBe(2.5);
    expect(data.errors).toHaveLength(0);
  });

  it('reports partial failures when some items fail', async () => {
    let callCount = 0;
    vi.mocked(ElevenLabsClient).mockImplementation(function () {
      return {
        generateVoice: vi.fn().mockImplementation(() => {
          callCount++;
          if (callCount === 2) {
            return Promise.reject(new Error('Voice generation failed'));
          }
          return Promise.resolve({ audioBase64: 'base64audio', durationSeconds: 1.0 });
        }),
      } as any;
    } as any);

    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.totalGenerated).toBe(1);
    expect(data.totalFailed).toBe(1);
    expect(data.errors[0].nodeId).toBe('node-2');
    expect(data.errors[0].error).toBe('Voice generation failed');
  });

  it('calculates token cost as 5 per item', async () => {
    await POST(makeRequest(validBody));

    expect(resolveApiKey).toHaveBeenCalledWith(
      'user_1',
      'elevenlabs',
      10, // 2 items * 5
      'voice_batch_generation',
      { itemCount: 2, speaker: 'Alice' }
    );
  });
});
