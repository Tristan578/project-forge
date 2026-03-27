vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { POST } from './route';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { rateLimitResponse } from '@/lib/rateLimit';
import { distributedRateLimit, aggregateGenerationRateLimit } from '@/lib/rateLimit/distributed';
import { resolveApiKey } from '@/lib/keys/resolver';
import { captureException } from '@/lib/monitoring/sentry-server';

// generateText and createAnthropic are mocked before the import so they can
// be controlled per-test via vi.mocked().
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
vi.mock('@/lib/tokens/pricing', () => ({ getTokenCost: vi.fn(() => 10) }));
vi.mock('@/lib/tokens/service', () => ({ refundTokens: vi.fn() }));
vi.mock('@/lib/monitoring/sentry-server', () => ({ captureException: vi.fn() }));
vi.mock('ai', () => ({ generateText: mockGenerateText }));
vi.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: vi.fn(() => mockAnthropicModel),
}));

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/generate/pacing', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const validReport = {
  score: 72,
  curve: {
    segments: [
      { sceneIndex: 0, sceneName: 'Intro', intensity: 0.3, emotion: 'calm' },
      { sceneIndex: 1, sceneName: 'Conflict', intensity: 0.8, emotion: 'tense' },
    ],
    averageIntensity: 0.55,
    variance: 0.0625,
  },
  suggestions: [
    { title: 'Slow down opening', description: 'Give players time to breathe.', priority: 'medium' as const },
  ],
};

const aiSuggestionsJson = JSON.stringify([
  {
    title: 'Add midpoint rest',
    description: 'Insert a calm scene to reset tension.',
    targetSceneIndex: 1,
    priority: 'medium',
  },
  {
    title: 'Ramp up finale',
    description: 'Escalate intensity in the last act.',
    targetSceneIndex: null,
    priority: 'high',
  },
]);

describe('POST /api/generate/pacing', () => {
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
      remaining: 19,
      resetAt: Date.now() + 300000,
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
    mockGenerateText.mockResolvedValue({ text: aiSuggestionsJson });
  });

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    });

    const res = await POST(makeRequest({ report: validReport }));
    expect(res.status).toBe(401);
  });

  it('returns 429 when aggregate rate limit is exceeded', async () => {
    vi.mocked(aggregateGenerationRateLimit).mockResolvedValue({
      allowed: false,
      remaining: 0,
      resetAt: Date.now() + 900000,
    });

    const res = await POST(makeRequest({ report: validReport }));
    expect(res.status).toBe(429);
  });

  it('returns 429 when per-route rate limit is exceeded', async () => {
    vi.mocked(distributedRateLimit).mockResolvedValue({
      allowed: false,
      remaining: 0,
      resetAt: Date.now() + 300000,
    });

    const res = await POST(makeRequest({ report: validReport }));
    expect(res.status).toBe(429);
  });

  it('returns 400 for invalid JSON body', async () => {
    const req = new NextRequest('http://localhost/api/generate/pacing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-valid-json',
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('Invalid JSON');
  });

  it('returns 422 when report field is missing', async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.error).toContain('report');
  });

  it('returns 422 when report.curve.segments is not an array', async () => {
    const res = await POST(
      makeRequest({
        report: { ...validReport, curve: { segments: 'not-an-array', averageIntensity: 0.5, variance: 0.01 } },
      }),
    );
    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.error).toContain('report.curve.segments');
  });

  it('returns 422 when report.curve is missing entirely', async () => {
    const res = await POST(
      makeRequest({
        report: { score: 50, suggestions: [] },
      }),
    );
    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.error).toContain('report.curve.segments');
  });

  it('returns 402 when API key resolution fails with ApiKeyError', async () => {
    const { ApiKeyError: MockApiKeyError } = await import('@/lib/keys/resolver');
    vi.mocked(resolveApiKey).mockRejectedValue(
      new MockApiKeyError('INSUFFICIENT_TOKENS', 'Not enough tokens'),
    );

    const res = await POST(makeRequest({ report: validReport }));
    expect(res.status).toBe(402);
    const data = await res.json();
    expect(data.error).toBe('Not enough tokens');
    expect(data.code).toBe('INSUFFICIENT_TOKENS');
  });

  it('returns 201 with enriched report on successful pacing analysis', async () => {
    const res = await POST(makeRequest({ report: validReport }));
    expect(res.status).toBe(200);
    const data = await res.json();
    // Original suggestions preserved
    expect(data.suggestions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: 'Slow down opening' }),
      ]),
    );
    // AI-generated suggestions appended
    expect(data.suggestions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: 'Add midpoint rest' }),
        expect.objectContaining({ title: 'Ramp up finale' }),
      ]),
    );
    // Original report fields preserved
    expect(data.score).toBe(validReport.score);
    expect(data.curve).toEqual(validReport.curve);
  });

  it('returns 200 with only original suggestions when AI response is non-JSON', async () => {
    mockGenerateText.mockResolvedValue({ text: 'Sorry, I cannot help with that.' });

    const res = await POST(makeRequest({ report: validReport }));
    expect(res.status).toBe(200);
    const data = await res.json();
    // Only the original suggestion
    expect(data.suggestions).toHaveLength(1);
    expect(data.suggestions[0].title).toBe('Slow down opening');
  });

  it('returns 500 and captures exception when provider call fails', async () => {
    mockGenerateText.mockRejectedValue(new Error('Anthropic API timeout'));

    const res = await POST(makeRequest({ report: validReport }));
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toBe('Anthropic API timeout');
    expect(captureException).toHaveBeenCalled();
  });

  it('calls generateText with the report data in the prompt', async () => {
    await POST(makeRequest({ report: validReport }));

    expect(mockGenerateText).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('Score: 72/100'),
        maxOutputTokens: 800,
        temperature: 0.4,
      }),
    );
  });

  it('rethrows non-ApiKeyError during key resolution', async () => {
    vi.mocked(resolveApiKey).mockRejectedValue(new Error('DB connection failed'));

    await expect(POST(makeRequest({ report: validReport }))).rejects.toThrow('DB connection failed');
  });
});
