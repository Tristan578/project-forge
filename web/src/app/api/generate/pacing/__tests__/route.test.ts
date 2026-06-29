/**
 * PostHog `$ai_generation` capture coverage for POST /api/generate/pacing (PF-907).
 *
 * The full generation pipeline (auth, rate limit, billing, content safety) is
 * exercised by createGenerationHandler.test.ts. Here we mock the factory to
 * capture the route's own `execute` callback and drive it directly, so we assert
 * exactly what the route contributes: a content-free, consent-gated capture.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

// Capture the execute callback the route registers with the factory. The holder
// is created via vi.hoisted so it is initialized before the hoisted vi.mock
// factory and the static `import '../route'` run (which call createGenerationHandler
// at module-load time — a plain `let` would be in the TDZ at that point).
type ExecuteCtx = { userId: string; tier: string; usageId: string | undefined; tokenCost: number };
type ExecuteFn = (params: unknown, apiKey: string, ctx: ExecuteCtx) => Promise<unknown>;
const holder = vi.hoisted(() => ({ execute: undefined as ExecuteFn | undefined }));
vi.mock('@/lib/api/createGenerationHandler', () => ({
  createGenerationHandler: (config: { execute: ExecuteFn }) => {
    holder.execute = config.execute;
    return vi.fn();
  },
}));

const generateText = vi.fn();
vi.mock('ai', () => ({
  generateText: (...args: unknown[]) => generateText(...args),
  Output: { object: vi.fn(() => ({ __output: true })) },
}));

vi.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: vi.fn(() => (model: string) => ({ __model: model })),
}));

const captureAiGeneration = vi.fn();
const hasAnalyticsConsent = vi.fn().mockResolvedValue(true);
vi.mock('@/lib/analytics/posthog-server', () => ({
  captureAiGeneration: (...args: unknown[]) => captureAiGeneration(...args),
  hasAnalyticsConsent: () => hasAnalyticsConsent(),
}));

// Importing the route runs createGenerationHandler(config) → captures execute.
import '../route';

const REPORT = {
  score: 70,
  curve: { segments: [{ sceneIndex: 0, sceneName: 'Intro', intensity: 0.5, emotion: 'calm' }], averageIntensity: 0.5, variance: 0.01 },
  suggestions: [],
};

const CTX: ExecuteCtx = { userId: 'user-1', tier: 'pro', usageId: 'usage-1', tokenCost: 10 };

describe('POST /api/generate/pacing — $ai_generation capture (PF-907)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hasAnalyticsConsent.mockResolvedValue(true);
    generateText.mockResolvedValue({ output: [], usage: { inputTokens: 500, outputTokens: 120 } });
  });

  it('captures one content-free $ai_generation event with token + latency metrics', async () => {
    expect(holder.execute).toBeDefined();
    await holder.execute!({ report: REPORT }, 'anthropic-key', CTX);

    expect(captureAiGeneration).toHaveBeenCalledTimes(1);
    const arg = captureAiGeneration.mock.calls[0][0];
    expect(arg).toMatchObject({
      distinctId: 'user-1',
      consented: true,
      traceId: 'usage-1',
      provider: 'anthropic',
      inputTokens: 500,
      outputTokens: 120,
      stream: false,
      isError: false,
      route: '/api/generate/pacing',
    });
    expect(typeof arg.latencySeconds).toBe('number');
    // Never carries prompt / response content.
    expect(arg).not.toHaveProperty('prompt');
    expect(arg).not.toHaveProperty('$ai_input');
  });

  it('passes consented=false through when the user has not consented', async () => {
    hasAnalyticsConsent.mockResolvedValue(false);
    await holder.execute!({ report: REPORT }, 'anthropic-key', CTX);
    expect(captureAiGeneration.mock.calls[0][0].consented).toBe(false);
  });
});
