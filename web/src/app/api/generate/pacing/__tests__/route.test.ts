/**
 * Tests for POST /api/generate/pacing
 *
 * Focuses on:
 * - Auth, rate limit, and validation gates
 * - Structured output via Output.object — no JSON.parse in route (regression #7997)
 * - AI suggestions merged with existing report suggestions
 * - Token refund on AI error
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// Module mocks (must be declared before any imports of the mocked modules)
// ---------------------------------------------------------------------------

vi.mock('server-only', () => ({}));

vi.mock('@/lib/auth/api-auth', () => ({
  authenticateRequest: vi.fn().mockResolvedValue({
    ok: true,
    response: null,
    ctx: { user: { id: 'user-123' } },
  }),
}));

vi.mock('@/lib/rateLimit/distributed', () => ({
  distributedRateLimit: vi.fn().mockResolvedValue({ allowed: true, remaining: 19, resetAt: 0 }),
  aggregateGenerationRateLimit: vi.fn().mockResolvedValue({ allowed: true, remaining: 29, resetAt: 0 }),
}));

vi.mock('@/lib/rateLimit', () => ({
  rateLimitResponse: vi.fn().mockReturnValue(new Response('Rate limited', { status: 429 })),
}));

vi.mock('@/lib/keys/resolver', () => ({
  resolveApiKey: vi.fn().mockResolvedValue({ key: 'sk-test', usageId: 'usage-1' }),
  ApiKeyError: class ApiKeyError extends Error {
    code: string;
    constructor(msg: string, code: string) { super(msg); this.code = code; }
  },
}));

vi.mock('@/lib/tokens/pricing', () => ({
  getTokenCost: vi.fn().mockReturnValue(5),
}));

vi.mock('@/lib/ai/contentSafety', () => ({
  sanitizePrompt: vi.fn().mockReturnValue({ safe: true }),
}));

vi.mock('@/lib/monitoring/sentry-server', () => ({
  captureException: vi.fn(),
}));

vi.mock('@/lib/tokens/service', () => ({
  refundTokens: vi.fn().mockResolvedValue(undefined),
}));

const mockGenerateText = vi.fn();
vi.mock('ai', () => ({
  generateText: mockGenerateText,
  Output: {
    object: vi.fn().mockReturnValue({ type: 'object' }),
  },
}));

vi.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: vi.fn().mockReturnValue(vi.fn().mockReturnValue('mock-model')),
}));

vi.mock('@/lib/ai/models', () => ({
  AI_MODEL_FAST: 'claude-haiku-4-5',
}));

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makePacingReport(overrides = {}) {
  return {
    score: 72,
    curve: {
      segments: [
        { sceneIndex: 0, sceneName: 'Tutorial', intensity: 0.3, emotion: 'calm' },
        { sceneIndex: 1, sceneName: 'Boss Fight', intensity: 0.9, emotion: 'tense' },
      ],
      averageIntensity: 0.6,
      variance: 0.09,
    },
    suggestions: [
      { title: 'Add more variety', description: 'Mix it up.', priority: 'medium' as const },
    ],
    ...overrides,
  };
}

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/generate/pacing', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/generate/pacing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGenerateText.mockResolvedValue({
      output: {
        suggestions: [
          {
            title: 'Add a breather scene',
            description: 'Give players time to recover after the boss fight.',
            targetSceneIndex: 2,
            priority: 'high',
          },
        ],
      },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns 422 when report is missing', async () => {
    const { POST } = await import('../route');
    const res = await POST(makeRequest({ report: null }));
    expect(res.status).toBe(422);
  });

  it('returns 422 when report.curve.segments is missing', async () => {
    const { POST } = await import('../route');
    const res = await POST(makeRequest({ report: { score: 72, curve: {}, suggestions: [] } }));
    expect(res.status).toBe(422);
  });

  it('returns 400 for invalid JSON body', async () => {
    const { POST } = await import('../route');
    const req = new NextRequest('http://localhost:3000/api/generate/pacing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 422 when content safety rejects the prompt', async () => {
    const { sanitizePrompt } = await import('@/lib/ai/contentSafety');
    vi.mocked(sanitizePrompt).mockReturnValueOnce({ safe: false, reason: 'Inappropriate content' });

    const { POST } = await import('../route');
    const res = await POST(makeRequest({ report: makePacingReport() }));
    expect(res.status).toBe(422);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('Inappropriate content');
  });

  it('merges AI suggestions with existing suggestions (structured output, no JSON.parse)', async () => {
    const { POST } = await import('../route');
    const res = await POST(makeRequest({ report: makePacingReport() }));

    expect(res.status).toBe(200);
    const body = await res.json() as { suggestions: unknown[] };
    // 1 existing + 1 AI = 2 total
    expect(body.suggestions).toHaveLength(2);
  });

  it('calls generateText with Output.object for structured output', async () => {
    const { POST } = await import('../route');
    await POST(makeRequest({ report: makePacingReport() }));

    expect(mockGenerateText).toHaveBeenCalledOnce();
    const callArgs = mockGenerateText.mock.calls[0][0] as { output: unknown };
    // Output.object() was called and its return value passed as the output param
    expect(callArgs.output).toBeDefined();
  });

  it('returns enriched report without AI suggestions when output.suggestions is empty', async () => {
    mockGenerateText.mockResolvedValue({ output: { suggestions: [] } });

    const { POST } = await import('../route');
    const res = await POST(makeRequest({ report: makePacingReport() }));

    expect(res.status).toBe(200);
    const body = await res.json() as { suggestions: unknown[] };
    // Only the original suggestion
    expect(body.suggestions).toHaveLength(1);
  });

  it('refunds tokens and returns 500 when AI call throws', async () => {
    mockGenerateText.mockRejectedValue(new Error('Provider timeout'));

    const { POST } = await import('../route');
    const res = await POST(makeRequest({ report: makePacingReport() }));

    expect(res.status).toBe(500);

    const { refundTokens } = await import('@/lib/tokens/service');
    expect(vi.mocked(refundTokens)).toHaveBeenCalledWith('user-123', 'usage-1');
  });

  it('returns 402 when API key resolution fails with payment error', async () => {
    const { resolveApiKey, ApiKeyError } = await import('@/lib/keys/resolver');
    vi.mocked(resolveApiKey).mockRejectedValueOnce(
      new ApiKeyError('Insufficient tokens', 'INSUFFICIENT_TOKENS')
    );

    const { POST } = await import('../route');
    const res = await POST(makeRequest({ report: makePacingReport() }));
    expect(res.status).toBe(402);
  });
});
