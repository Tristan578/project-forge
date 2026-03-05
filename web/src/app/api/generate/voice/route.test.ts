import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { resolveApiKey, ApiKeyError } from '@/lib/keys/resolver';
import { captureException } from '@/lib/monitoring/sentry-server';
import { rateLimit } from '@/lib/rateLimit';
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
vi.mock('@/lib/monitoring/sentry-server');
vi.mock('@/lib/tokens/pricing', () => ({ getTokenCost: vi.fn().mockReturnValue(10) }));
vi.mock('@/lib/rateLimit', () => ({
  rateLimit: vi.fn(),
  rateLimitResponse: vi.fn().mockReturnValue(new Response('Rate Limited', { status: 429 })),
}));

const makeRequest = (body: Record<string, unknown>) =>
  new NextRequest('http://localhost/api/generate/voice', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });

describe('POST /api/generate/voice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(rateLimit).mockReturnValue({ allowed: true, remaining: 9, resetAt: Date.now() + 60000 });
  });

  it('returns 401 if unauthenticated', async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({
      ok: false,
      response: mockNextResponse({ error: 'Unauthorized' }, { status: 401 }),
    });

    const res = await POST(makeRequest({ text: 'Hello world' }));
    expect(res.status).toBe(401);
  });

  it('returns 429 if rate limited', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: '123', user } });
    vi.mocked(rateLimit).mockReturnValue({ allowed: false, remaining: 0, resetAt: Date.now() + 60000 });

    const res = await POST(makeRequest({ text: 'Hello world' }));
    expect(res.status).toBe(429);
  });

  it('returns 400 for invalid JSON body', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: '123', user } });

    const req = new NextRequest('http://localhost/api/generate/voice', {
      method: 'POST',
      body: 'bad-json',
      headers: { 'content-type': 'application/json' },
    });
    const res = await POST(req);
    const data = await res.json();
    expect(res.status).toBe(400);
    expect(data.error).toBe('Invalid JSON');
  });

  it('returns 422 if text is empty', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: '123', user } });

    const res = await POST(makeRequest({ text: '' }));
    const data = await res.json();
    expect(res.status).toBe(422);
    expect(data.error).toContain('Text must be');
  });

  it('returns 422 if text exceeds 1000 characters', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: '123', user } });

    const res = await POST(makeRequest({ text: 'x'.repeat(1001) }));
    expect(res.status).toBe(422);
  });

  it('returns 402 if API key cannot be resolved', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: '123', user } });
    vi.mocked(resolveApiKey).mockRejectedValue(
      new ApiKeyError('INSUFFICIENT_TOKENS', 'Not enough tokens')
    );

    const res = await POST(makeRequest({ text: 'Hello world' }));
    const data = await res.json();
    expect(res.status).toBe(402);
    expect(data.error).toBe('Not enough tokens');
  });

  it('returns audioBase64 and durationSeconds on success', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: '123', user } });
    vi.mocked(resolveApiKey).mockResolvedValue({ type: 'platform', key: 'el_key', metered: true });
    mockGenerateVoice.mockResolvedValue({ audioBase64: 'dGVzdA==', durationSeconds: 2.5 });

    const res = await POST(makeRequest({ text: 'Hello world', voiceId: 'JBFqnCBsd6RMkjVDRZzb' }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.audioBase64).toBe('dGVzdA==');
    expect(data.durationSeconds).toBe(2.5);
    expect(data.provider).toBe('elevenlabs');
  });

  it('maps voiceStyle string to numeric style before generating', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: '123', user } });
    vi.mocked(resolveApiKey).mockResolvedValue({ type: 'platform', key: 'el_key', metered: true });
    mockGenerateVoice.mockResolvedValue({ audioBase64: 'dGVzdA==', durationSeconds: 1.0 });

    await POST(makeRequest({ text: 'Hello world', voiceStyle: 'excited' }));

    expect(mockGenerateVoice).toHaveBeenCalledWith(expect.objectContaining({ style: 1.0 }));
  });

  it('returns 500 and captures exception on ElevenLabs error', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: '123', user } });
    vi.mocked(resolveApiKey).mockResolvedValue({ type: 'platform', key: 'el_key', metered: true });
    mockGenerateVoice.mockRejectedValue(new Error('ElevenLabs quota exceeded'));

    const res = await POST(makeRequest({ text: 'Hello world' }));
    const data = await res.json();

    expect(res.status).toBe(500);
    expect(data.error).toBe('ElevenLabs quota exceeded');
    expect(captureException).toHaveBeenCalled();
  });

  it('rethrows non-ApiKeyError during key resolution', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: '123', user } });
    vi.mocked(resolveApiKey).mockRejectedValue(new Error('DB connection failed'));

    await expect(POST(makeRequest({ text: 'Hello world' }))).rejects.toThrow('DB connection failed');
  });
});
