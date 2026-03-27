vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { POST } from './route';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { rateLimitResponse } from '@/lib/rateLimit';
import { distributedRateLimit, aggregateGenerationRateLimit } from '@/lib/rateLimit/distributed';
import { resolveApiKey } from '@/lib/keys/resolver';
import { captureException } from '@/lib/monitoring/sentry-server';
import { refundTokens } from '@/lib/tokens/service';

const mockGenerateText = vi.hoisted(() => vi.fn());
const mockAnthropicModel = vi.hoisted(() => vi.fn(() => 'model-stub'));

vi.mock('@/lib/auth/api-auth', () => ({ authenticateRequest: vi.fn() }));
vi.mock('@/lib/rateLimit', () => ({
  rateLimitResponse: vi.fn(() => new Response('Rate limited', { status: 429 })),
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
vi.mock('@/lib/tokens/service', () => ({ refundTokens: vi.fn() }));
vi.mock('@/lib/monitoring/sentry-server', () => ({ captureException: vi.fn() }));
vi.mock('ai', () => ({ generateText: mockGenerateText }));
vi.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: vi.fn(() => mockAnthropicModel),
}));

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/generate/localize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const validStrings = [
  { id: 'ui.start', text: 'Start Game', context: 'Main menu start button' },
  { id: 'ui.quit', text: 'Quit', context: 'Main menu quit button' },
];

const translationResponseJson = JSON.stringify({
  'ui.start': 'Spiel starten',
  'ui.quit': 'Beenden',
});

const validBody = {
  strings: validStrings,
  sourceLocale: 'en',
  targetLocales: ['de'],
};

describe('POST /api/generate/localize', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(authenticateRequest).mockResolvedValue({
      ok: true,
      ctx: { clerkId: 'clerk-1', user: { id: 'user-1', tier: 'pro' } as never },
    });
    vi.mocked(aggregateGenerationRateLimit).mockResolvedValue({
      allowed: true,
      remaining: 29,
      resetAt: Date.now() + 900000,
    });
    vi.mocked(distributedRateLimit).mockResolvedValue({
      allowed: true,
      remaining: 4,
      resetAt: Date.now() + 600000,
    });
    vi.mocked(resolveApiKey).mockResolvedValue({
      type: 'platform',
      key: 'test-key',
      metered: true,
      usageId: 'usage-abc',
    });
    vi.mocked(rateLimitResponse).mockReturnValue(
      NextResponse.json({ error: 'Too many requests' }, { status: 429 }),
    );
    vi.mocked(refundTokens).mockResolvedValue({ refunded: true });
    mockGenerateText.mockResolvedValue({ text: translationResponseJson });
  });

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    });

    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(401);
  });

  it('returns 429 when aggregate rate limit is exceeded', async () => {
    vi.mocked(aggregateGenerationRateLimit).mockResolvedValue({
      allowed: false,
      remaining: 0,
      resetAt: Date.now() + 900000,
    });

    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(429);
  });

  it('returns 429 when per-route rate limit is exceeded', async () => {
    vi.mocked(distributedRateLimit).mockResolvedValue({
      allowed: false,
      remaining: 0,
      resetAt: Date.now() + 600000,
    });

    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(429);
  });

  it('returns 400 for invalid JSON body', async () => {
    const req = new NextRequest('http://localhost/api/generate/localize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-valid-json',
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('Invalid JSON');
  });

  it('returns 422 when strings array is empty', async () => {
    const res = await POST(makeRequest({ ...validBody, strings: [] }));
    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.error).toContain('non-empty array');
  });

  it('returns 422 when strings is not an array', async () => {
    const res = await POST(makeRequest({ ...validBody, strings: 'not-an-array' }));
    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.error).toContain('non-empty array');
  });

  it('returns 422 when strings array exceeds 2000 items', async () => {
    const tooMany = Array.from({ length: 2001 }, (_, i) => ({
      id: `key.${i}`,
      text: `Text ${i}`,
      context: 'button',
    }));
    const res = await POST(makeRequest({ ...validBody, strings: tooMany }));
    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.error).toContain('2000');
  });

  it('returns 422 when a string item is missing required fields', async () => {
    const res = await POST(
      makeRequest({
        ...validBody,
        strings: [{ id: 'ui.start', text: 'Start' }], // missing context
      }),
    );
    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.error).toContain('strings[0]');
  });

  it('returns 422 when a string item has a non-string field', async () => {
    const res = await POST(
      makeRequest({
        ...validBody,
        strings: [{ id: 42, text: 'Start', context: 'button' }],
      }),
    );
    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.error).toContain('strings[0]');
  });

  it('returns 422 when sourceLocale is missing', async () => {
    const { sourceLocale: _omitted, ...bodyWithout } = validBody;
    const res = await POST(makeRequest(bodyWithout));
    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.error).toContain('sourceLocale');
  });

  it('returns 422 when sourceLocale is an empty string', async () => {
    const res = await POST(makeRequest({ ...validBody, sourceLocale: '' }));
    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.error).toContain('sourceLocale');
  });

  it('returns 422 when targetLocales is empty', async () => {
    const res = await POST(makeRequest({ ...validBody, targetLocales: [] }));
    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.error).toContain('targetLocales');
  });

  it('returns 422 when targetLocale is an unsupported locale code', async () => {
    const res = await POST(makeRequest({ ...validBody, targetLocales: ['xx-INVALID'] }));
    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.error).toContain('Unsupported locale');
  });

  it('returns 402 when API key resolution fails with ApiKeyError', async () => {
    const { ApiKeyError: MockApiKeyError } = await import('@/lib/keys/resolver');
    vi.mocked(resolveApiKey).mockRejectedValue(
      new MockApiKeyError('INSUFFICIENT_TOKENS', 'Not enough tokens'),
    );

    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(402);
    const data = await res.json();
    expect(data.error).toBe('Not enough tokens');
  });

  it('returns 200 with locale bundles on successful translation', async () => {
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.locales).toBeDefined();
    expect(data.locales['de']).toBeDefined();
    expect(data.locales['de'].locale).toBe('de');
    expect(data.locales['de'].translations).toBeDefined();
  });

  it('includes all requested target locales in the response', async () => {
    mockGenerateText.mockResolvedValue({ text: translationResponseJson });

    const res = await POST(
      makeRequest({ ...validBody, targetLocales: ['de', 'fr'] }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Object.keys(data.locales)).toContain('de');
    expect(Object.keys(data.locales)).toContain('fr');
  });

  it('returns 500 and refunds tokens when provider call fails', async () => {
    mockGenerateText.mockRejectedValue(new Error('Anthropic API error'));

    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toBe('Anthropic API error');
    expect(refundTokens).toHaveBeenCalledWith('user-1', 'usage-abc');
    expect(captureException).toHaveBeenCalled();
  });

  it('does not refund when no usageId exists on provider error', async () => {
    vi.mocked(resolveApiKey).mockResolvedValue({
      type: 'platform',
      key: 'test-key',
      metered: true,
      // usageId intentionally absent
    });
    mockGenerateText.mockRejectedValue(new Error('Provider error'));

    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(500);
    expect(refundTokens).not.toHaveBeenCalled();
  });

  it('rethrows non-ApiKeyError during key resolution', async () => {
    vi.mocked(resolveApiKey).mockRejectedValue(new Error('DB connection failed'));

    await expect(POST(makeRequest(validBody))).rejects.toThrow('DB connection failed');
  });
});
