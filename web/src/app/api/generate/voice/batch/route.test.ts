vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { resolveApiKey, ApiKeyError } from '@/lib/keys/resolver';
import { rateLimit } from '@/lib/rateLimit';
import { refundTokens, refundTokenAmount } from '@/lib/tokens/service';
import { makeUser, mockNextResponse } from '@/test/utils/apiTestUtils';

const mockGenerateVoice = vi.hoisted(() => vi.fn());

vi.mock('@/lib/auth/api-auth');
vi.mock('@/lib/keys/resolver', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/keys/resolver')>();
  return { ...mod, resolveApiKey: vi.fn() };
});
vi.mock('@/lib/generate/elevenlabsClient', () => ({
  ElevenLabsClient: class MockElevenLabsClient {
    generateVoice = mockGenerateVoice;
  },
}));
vi.mock('@/lib/rateLimit', () => ({
  rateLimit: vi.fn(),
  rateLimitResponse: vi.fn().mockReturnValue(new Response('Rate Limited', { status: 429 })),
}));
vi.mock('@/lib/tokens/service', () => ({
  refundTokens: vi.fn().mockResolvedValue({ refunded: true }),
  refundTokenAmount: vi.fn().mockResolvedValue({ refunded: true }),
}));
vi.mock('@/lib/monitoring/sentry-server', () => ({
  captureException: vi.fn(),
}));
vi.mock('@/lib/rateLimit/distributed', () => ({
  distributedRateLimit: vi.fn().mockResolvedValue({ allowed: true, remaining: 9, resetAt: Date.now() + 300000 }),
  aggregateGenerationRateLimit: vi.fn().mockResolvedValue({ allowed: true, remaining: 29, resetAt: Date.now() + 900000 }),
}));
vi.mock('@/lib/ai/contentSafety', () => ({
  sanitizePrompt: vi.fn((p: string) => ({ safe: true, filtered: p })),
}));

interface BatchItem {
  nodeId: string;
  text: string;
  speaker: string;
}

interface VoiceSettings {
  voiceId: string;
  stability: number;
  similarityBoost: number;
  style: number;
}

const makeRequest = (body: Record<string, unknown>) =>
  new NextRequest('http://localhost/api/generate/voice/batch', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });

const defaultItems: BatchItem[] = [
  { nodeId: 'node_1', text: 'Hello world', speaker: 'narrator' },
  { nodeId: 'node_2', text: 'How are you?', speaker: 'character' },
];

const defaultVoiceSettings: VoiceSettings = {
  voiceId: 'JBFqnCBsd6RMkjVDRZzb',
  stability: 0.5,
  similarityBoost: 0.75,
  style: 0,
};

describe('POST /api/generate/voice/batch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(rateLimit).mockResolvedValue({ allowed: true, remaining: 4, resetAt: Date.now() + 60000 });
  });

  it('returns 401 if unauthenticated', async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({
      ok: false,
      response: mockNextResponse({ error: 'Unauthorized' }, { status: 401 }),
    });

    const res = await POST(makeRequest({ items: defaultItems, voiceSettings: defaultVoiceSettings }));
    expect(res.status).toBe(401);
  });

  it('returns 429 if distributed rate limited', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: '123', user } });
    const { distributedRateLimit } = await import('@/lib/rateLimit/distributed');
    vi.mocked(distributedRateLimit).mockResolvedValueOnce({ allowed: false, remaining: 0, resetAt: Date.now() + 60000 });

    const res = await POST(makeRequest({ items: defaultItems, voiceSettings: defaultVoiceSettings }));
    expect(res.status).toBe(429);
  });

  it('returns 400 for invalid JSON body', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: '123', user } });

    const req = new NextRequest('http://localhost/api/generate/voice/batch', {
      method: 'POST',
      body: 'bad-json',
      headers: { 'content-type': 'application/json' },
    });
    const res = await POST(req);
    const data = await res.json();
    expect(res.status).toBe(400);
    expect(data.error).toBe('Invalid JSON');
  });

  it('returns 422 if items is not an array', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: '123', user } });

    const res = await POST(makeRequest({ items: 'not-array', voiceSettings: defaultVoiceSettings }));
    const data = await res.json();
    expect(res.status).toBe(422);
    expect(data.error).toContain('items');
  });

  it('returns 422 if items is empty', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: '123', user } });

    const res = await POST(makeRequest({ items: [], voiceSettings: defaultVoiceSettings }));
    expect(res.status).toBe(422);
  });

  it('returns 422 if items exceeds 20', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: '123', user } });

    const items: BatchItem[] = Array.from({ length: 21 }, (_, i) => ({
      nodeId: `node_${i}`,
      text: 'Hello',
      speaker: 'narrator',
    }));

    const res = await POST(makeRequest({ items, voiceSettings: defaultVoiceSettings }));
    const data = await res.json();
    expect(res.status).toBe(422);
    expect(data.error).toContain('20');
  });

  it('returns 422 if an item text is empty', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: '123', user } });

    const items: BatchItem[] = [{ nodeId: 'node_1', text: '', speaker: 'narrator' }];
    const res = await POST(makeRequest({ items, voiceSettings: defaultVoiceSettings }));
    const data = await res.json();
    expect(res.status).toBe(422);
    expect(data.error).toContain('node_1');
  });

  it('returns 422 if voiceSettings.voiceId is missing', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: '123', user } });

    const res = await POST(makeRequest({ items: defaultItems, voiceSettings: { stability: 0.5 } }));
    const data = await res.json();
    expect(res.status).toBe(422);
    expect(data.error).toContain('voiceId');
  });

  it('returns 402 if API key cannot be resolved', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: '123', user } });
    vi.mocked(resolveApiKey).mockRejectedValue(
      new ApiKeyError('INSUFFICIENT_TOKENS', 'Not enough tokens')
    );

    const res = await POST(makeRequest({ items: defaultItems, voiceSettings: defaultVoiceSettings }));
    const data = await res.json();
    expect(res.status).toBe(402);
    expect(data.error).toBe('Not enough tokens');
  });

  it('returns results for all items on success', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: '123', user } });
    vi.mocked(resolveApiKey).mockResolvedValue({ type: 'platform', key: 'el_key', metered: true });
    mockGenerateVoice.mockResolvedValue({ audioBase64: 'abc123==', durationSeconds: 1.2 });

    const res = await POST(makeRequest({ items: defaultItems, voiceSettings: defaultVoiceSettings }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.totalGenerated).toBe(2);
    expect(data.totalFailed).toBe(0);
    expect(data.results).toHaveLength(2);
    expect(data.results[0].audioBase64).toBe('abc123==');
  });

  it('records errors for failed items while completing others', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: '123', user } });
    vi.mocked(resolveApiKey).mockResolvedValue({ type: 'platform', key: 'el_key', metered: true });
    mockGenerateVoice
      .mockResolvedValueOnce({ audioBase64: 'abc123==', durationSeconds: 1.2 })
      .mockRejectedValueOnce(new Error('Voice generation failed'));

    const res = await POST(makeRequest({ items: defaultItems, voiceSettings: defaultVoiceSettings }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.totalGenerated).toBe(1);
    expect(data.totalFailed).toBe(1);
    expect(data.errors[0].nodeId).toBe('node_2');
    expect(data.errors[0].error).toBe('Voice generation failed');
  });

  it('rethrows non-ApiKeyError during key resolution', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: '123', user } });
    vi.mocked(resolveApiKey).mockRejectedValue(new Error('DB connection failed'));

    await expect(
      POST(makeRequest({ items: defaultItems, voiceSettings: defaultVoiceSettings }))
    ).rejects.toThrow('DB connection failed');
  });

  describe('token refunds', () => {
    it('calls refundTokens (full refund) when all items fail', async () => {
      const user = makeUser();
      vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: '123', user } });
      vi.mocked(resolveApiKey).mockResolvedValue({ type: 'platform', key: 'el_key', metered: true, usageId: 'usage_123' });
      mockGenerateVoice.mockRejectedValue(new Error('API unavailable'));

      const res = await POST(makeRequest({ items: defaultItems, voiceSettings: defaultVoiceSettings }));
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.totalGenerated).toBe(0);
      expect(data.totalFailed).toBe(2);
      expect(refundTokens).toHaveBeenCalledWith(user.id, 'usage_123');
      expect(refundTokenAmount).not.toHaveBeenCalled();
    });

    it('calls refundTokenAmount (partial refund) when some items fail', async () => {
      const user = makeUser();
      vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: '123', user } });
      vi.mocked(resolveApiKey).mockResolvedValue({ type: 'platform', key: 'el_key', metered: true, usageId: 'usage_456' });
      mockGenerateVoice
        .mockResolvedValueOnce({ audioBase64: 'ok==', durationSeconds: 1.0 })
        .mockRejectedValueOnce(new Error('Item failed'));

      const res = await POST(makeRequest({ items: defaultItems, voiceSettings: defaultVoiceSettings }));
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.totalGenerated).toBe(1);
      expect(data.totalFailed).toBe(1);
      // 1 failed item * 5 tokens per item = 5 tokens refunded
      expect(refundTokenAmount).toHaveBeenCalledWith(
        user.id,
        5,
        expect.stringContaining('voice_batch_partial_failure'),
        'usage_456',
      );
      expect(refundTokens).not.toHaveBeenCalled();
    });

    it('does not call any refund when all items succeed', async () => {
      const user = makeUser();
      vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: '123', user } });
      vi.mocked(resolveApiKey).mockResolvedValue({ type: 'platform', key: 'el_key', metered: true, usageId: 'usage_789' });
      mockGenerateVoice.mockResolvedValue({ audioBase64: 'ok==', durationSeconds: 1.0 });

      const res = await POST(makeRequest({ items: defaultItems, voiceSettings: defaultVoiceSettings }));
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.totalFailed).toBe(0);
      expect(refundTokens).not.toHaveBeenCalled();
      expect(refundTokenAmount).not.toHaveBeenCalled();
    });

    it('does not refund when usageId is undefined (BYOK key)', async () => {
      const user = makeUser();
      vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: '123', user } });
      // BYOK keys return no usageId
      vi.mocked(resolveApiKey).mockResolvedValue({ type: 'byok', key: 'user_key', metered: false });
      mockGenerateVoice.mockRejectedValue(new Error('API unavailable'));

      const res = await POST(makeRequest({ items: defaultItems, voiceSettings: defaultVoiceSettings }));
      const data = await res.json();

      expect(data.totalFailed).toBe(2);
      expect(refundTokens).not.toHaveBeenCalled();
      expect(refundTokenAmount).not.toHaveBeenCalled();
    });

    it('refunds 5 tokens per failed item for a 3-item batch with 2 failures', async () => {
      const user = makeUser();
      vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: '123', user } });
      vi.mocked(resolveApiKey).mockResolvedValue({ type: 'platform', key: 'el_key', metered: true, usageId: 'usage_abc' });
      const threeItems: BatchItem[] = [
        { nodeId: 'n1', text: 'Hello', speaker: 'narrator' },
        { nodeId: 'n2', text: 'World', speaker: 'narrator' },
        { nodeId: 'n3', text: 'Goodbye', speaker: 'narrator' },
      ];
      mockGenerateVoice
        .mockResolvedValueOnce({ audioBase64: 'ok==', durationSeconds: 1.0 })
        .mockRejectedValueOnce(new Error('fail'))
        .mockRejectedValueOnce(new Error('fail'));

      const res = await POST(makeRequest({ items: threeItems, voiceSettings: defaultVoiceSettings }));
      const data = await res.json();

      expect(data.totalGenerated).toBe(1);
      expect(data.totalFailed).toBe(2);
      // 2 failed items * 5 tokens = 10 tokens refunded
      expect(refundTokenAmount).toHaveBeenCalledWith(user.id, 10, expect.any(String), 'usage_abc');
    });
  });

  it('returns 422 when sanitizePrompt returns safe:false on combined batch text', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: '123', user } });
    const { sanitizePrompt } = await import('@/lib/ai/contentSafety');
    vi.mocked(sanitizePrompt).mockReturnValueOnce({ safe: false, filtered: '', reason: 'Injection detected' });

    const res = await POST(makeRequest({ items: defaultItems, voiceSettings: defaultVoiceSettings }));
    const data = await res.json();

    expect(res.status).toBe(422);
    expect(typeof data.error).toBe('string');
    expect(data.error.length).toBeGreaterThan(0);
  });
});
