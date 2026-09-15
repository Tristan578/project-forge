/**
 * PostHog `$ai_generation` capture coverage for POST /api/generate/localize (PF-907).
 *
 * The full generation pipeline is exercised by createGenerationHandler.test.ts.
 * Here we mock the factory to capture the route's own `execute` callback and drive
 * it directly, asserting the route's contribution: one content-free, consent-gated
 * capture per generation, all sharing a single trace id.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('server-only', () => ({}));

// The holder is created via vi.hoisted so it is initialized before the hoisted
// vi.mock factory and the static `import '../route'` run (the route calls
// createGenerationHandler at module-load time — a plain `let` would be in the TDZ).
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
}));

const createAnthropicMock = vi.fn((_opts: { apiKey: string }) => (model: string) => ({ __backend: 'anthropic', __model: model }));
vi.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: (opts: { apiKey: string }) => createAnthropicMock(opts),
}));

// The 'chat' capability's platform path resolves AI_GATEWAY_API_KEY (#9523) —
// exercised below by setting that env var and passing it as `apiKey`.
const createGatewayMock = vi.fn((_opts: { apiKey: string }) => (model: string) => ({ __backend: 'gateway', __model: model }));
vi.mock('@ai-sdk/gateway', () => ({
  createGateway: (opts: { apiKey: string }) => createGatewayMock(opts),
}));

// Deterministic localization helpers — one chunk per locale, fixed parse output.
vi.mock('@/lib/i18n/gameLocalization', () => ({
  buildTranslationPrompt: () => 'translate-prompt',
  parseTranslationResponse: () => ({ translations: { greeting: 'hola' } }),
  chunkArray: (arr: unknown[]) => [arr],
  LOCALE_MAP: new Map([['es', 'Spanish'], ['fr', 'French']]),
}));

const captureAiGeneration = vi.fn();
const hasAnalyticsConsent = vi.fn().mockResolvedValue(true);
vi.mock('@/lib/analytics/posthog-server', () => ({
  captureAiGeneration: (...args: unknown[]) => captureAiGeneration(...args),
  hasAnalyticsConsent: () => hasAnalyticsConsent(),
}));

import '../route';
// Real constant the route forwards as the model — asserting it catches a blank model.
import { AI_MODEL_FAST } from '@/lib/ai/models';

const PARAMS = {
  strings: [{ id: 'greeting', text: 'Hello', context: 'menu' }],
  sourceLocale: 'en',
  targetLocales: ['es', 'fr'],
};

const CTX: ExecuteCtx = { userId: 'user-1', tier: 'pro', usageId: 'usage-1', tokenCost: 10 };

describe('POST /api/generate/localize — $ai_generation capture (PF-907)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hasAnalyticsConsent.mockResolvedValue(true);
    generateText.mockResolvedValue({ text: '{"greeting":"hola"}', usage: { inputTokens: 200, outputTokens: 80 } });
  });

  it('captures one content-free event per generation, all under a single trace id', async () => {
    expect(holder.execute).toBeDefined();
    await holder.execute!(PARAMS, 'anthropic-key', CTX);

    // 2 target locales × 1 chunk each = 2 generations.
    expect(captureAiGeneration).toHaveBeenCalledTimes(2);
    for (const call of captureAiGeneration.mock.calls) {
      const arg = call[0];
      expect(arg).toMatchObject({
        distinctId: 'user-1',
        consented: true,
        traceId: 'usage-1',
        model: AI_MODEL_FAST,
        provider: 'anthropic',
        inputTokens: 200,
        outputTokens: 80,
        stream: false,
        isError: false,
        route: '/api/generate/localize',
      });
      expect(arg).not.toHaveProperty('prompt');
      expect(arg).not.toHaveProperty('$ai_input');
    }
    // Same trace id across the whole localize op.
    const traceIds = new Set(captureAiGeneration.mock.calls.map((c) => c[0].traceId));
    expect(traceIds.size).toBe(1);
  });

  it('passes consented=false through when the user has not consented', async () => {
    hasAnalyticsConsent.mockResolvedValue(false);
    await holder.execute!(PARAMS, 'anthropic-key', CTX);
    expect(captureAiGeneration.mock.calls.every((c) => c[0].consented === false)).toBe(true);
  });
});

// Regression (#9523 review): the 'chat' capability's platform path resolves
// AI_GATEWAY_API_KEY, which a direct `createAnthropic` client cannot
// authenticate with. The route must switch backends based on which key it
// actually received, not always assume a direct Anthropic key.
describe('POST /api/generate/localize — gateway vs. direct backend selection (#9523)', () => {
  const ORIGINAL_GATEWAY_KEY = process.env.AI_GATEWAY_API_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    hasAnalyticsConsent.mockResolvedValue(true);
    generateText.mockResolvedValue({ text: '{"greeting":"hola"}', usage: { inputTokens: 200, outputTokens: 80 } });
  });

  afterEach(() => {
    if (ORIGINAL_GATEWAY_KEY === undefined) {
      delete process.env.AI_GATEWAY_API_KEY;
    } else {
      process.env.AI_GATEWAY_API_KEY = ORIGINAL_GATEWAY_KEY;
    }
  });

  it('uses the direct Anthropic client for a BYOK/direct-platform key', async () => {
    delete process.env.AI_GATEWAY_API_KEY;
    await holder.execute!(PARAMS, 'anthropic-key', CTX);

    expect(createAnthropicMock).toHaveBeenCalledWith({ apiKey: 'anthropic-key' });
    expect(createGatewayMock).not.toHaveBeenCalled();
    const model = generateText.mock.calls[0][0].model as { __backend: string };
    expect(model.__backend).toBe('anthropic');
  });

  it('uses the AI SDK gateway client when the resolved key is AI_GATEWAY_API_KEY', async () => {
    process.env.AI_GATEWAY_API_KEY = 'gw-secret-123';
    await holder.execute!(PARAMS, 'gw-secret-123', CTX);

    expect(createGatewayMock).toHaveBeenCalledWith({ apiKey: 'gw-secret-123' });
    expect(createAnthropicMock).not.toHaveBeenCalled();
    const model = generateText.mock.calls[0][0].model as { __backend: string; __model: string };
    expect(model.__backend).toBe('gateway');
    // Gateway model ids are namespaced ('anthropic/<model>'), never the bare
    // canonical id a direct Anthropic client expects.
    expect(model.__model).toBe('anthropic/claude-haiku-4-5');
  });
});
