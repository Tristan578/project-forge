import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { User } from '@/lib/db/schema';
import { PLATFORM_KEY_ENV, GATEWAY_KEY_ENV } from '@/lib/config/providers';

/**
 * Factory-to-resolver credential integration for #9523: the issue's Given/When/Then — "image and embedding
 * resolve through AI_GATEWAY_API_KEY with no PLATFORM_OPENAI_KEY set" — exercised
 * against createGenerationHandler.ts itself, NOT the isolated resolver unit.
 *
 * The whole point is to catch the regression where the handler calls
 * resolveApiKey with the old 5-arg signature (capability omitted): with the real
 * resolver in place, a dropped capability argument makes getPlatformKey fall back
 * to PLATFORM_OPENAI_KEY, which is unset here, so the request would 500 instead of
 * resolving the gateway key. Only the DB and token-ledger dependencies of the real
 * resolver are mocked; resolver.ts, config/providers.ts and the handler run for real.
 * The synthetic execute callback makes no upstream request: gateway endpoint,
 * model adapter and OIDC authentication integration remain unverified.
 */

const { afterCallbacks } = vi.hoisted(() => ({ afterCallbacks: [] as Array<() => unknown> }));
vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>();
  return { ...actual, after: (cb: () => unknown) => { afterCallbacks.push(cb); } };
});

vi.mock('server-only', () => ({}));
vi.mock('@sentry/nextjs', () => ({
  metrics: { count: vi.fn(), distribution: vi.fn() },
}));

vi.mock('@/lib/auth/api-auth', () => ({
  authenticateRequest: vi.fn(),
}));
// Partial mock: the REAL resolver pulls TIER_DISPLAY_NAMES from billing/tierPlans,
// which reads TIER_MONTHLY_TOKENS from this module — so keep every real export and
// override only the cost lookup.
vi.mock('@/lib/tokens/pricing', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/tokens/pricing')>();
  return { ...actual, getTokenCost: vi.fn().mockReturnValue(10) };
});
vi.mock('@/lib/monitoring/sentry-server', () => ({
  captureException: vi.fn(),
  sentryLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('@/lib/security/botId', () => ({
  checkBotIdGate: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/lib/rateLimit', () => ({
  rateLimitResponse: vi.fn().mockReturnValue(
    new Response(JSON.stringify({ error: 'Rate limited' }), { status: 429 }),
  ),
}));
vi.mock('@/lib/rateLimit/distributed', () => ({
  distributedRateLimit: vi.fn().mockResolvedValue({ allowed: true, remaining: 9, resetAt: 0 }),
  aggregateGenerationRateLimit: vi.fn().mockResolvedValue({ allowed: true, remaining: 29, resetAt: 0 }),
}));
vi.mock('@/lib/ai/contentSafety', () => ({
  sanitizePrompt: vi.fn((p: string) => ({ safe: true, filtered: p })),
}));
vi.mock('@/lib/api/responseCache', () => ({
  cachedGenerate: vi.fn(async (_op: string, _params: unknown, factory: () => Promise<unknown>) => ({
    result: await factory(),
    cached: false,
  })),
}));
vi.mock('@/lib/qstash/client', () => ({
  isQstashConfigured: vi.fn(() => false),
  publishGenerationCallback: vi.fn(async () => {}),
}));
vi.mock('@/lib/flags/posthogFlags', () => ({
  isProviderKilled: vi.fn(() => false),
}));

// The real resolver's data dependencies — mocked so the resolver's key-selection
// logic (BYOK precedence, tier gating, gateway-vs-direct env var) runs for real
// against controlled DB/ledger state. resolveApiKey and config/providers are NOT
// mocked: this is the whole subject under test.
const { queryResults } = vi.hoisted(() => ({ queryResults: [] as unknown[] }));
vi.mock('@/lib/db/client', () => ({
  getDb: vi.fn(() => ({})),
  getNeonSql: vi.fn(() => Object.assign(vi.fn(), { transaction: vi.fn().mockResolvedValue([]) })),
  // resolver calls queryWithResilience once for the BYOK lookup and once for the
  // user row, in that order — shift the queued results per call.
  queryWithResilience: vi.fn(async () => queryResults.shift()),
}));
vi.mock('@/lib/tokens/service', () => ({
  deductTokens: vi.fn(async () => ({ success: true, usageId: 'usage-e2e', remaining: 990 })),
  refundTokens: vi.fn(async () => ({ refunded: true })),
}));

import { authenticateRequest } from '@/lib/auth/api-auth';
import { createGenerationHandler } from '../createGenerationHandler';

const mockAuth = vi.mocked(authenticateRequest);

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost:3000/api/generate/image-test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const GATEWAY_KEY = 'gw-secret-e2e-9523';

describe('createGenerationHandler → real resolveApiKey gateway routing (#9523)', () => {
  const user: User = {
    id: 'user-1', clerkId: 'clerk-1', email: 'test@example.com', displayName: null, tier: 'pro',
    monthlyTokens: 1000, monthlyTokensUsed: 0, addonTokens: 0, earnedCredits: 0,
    stripeCustomerId: null, stripeSubscriptionId: null, billingCycleStart: null,
    activeFeatures: null, banned: 0, createdAt: new Date(0), updatedAt: new Date(0),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    afterCallbacks.length = 0;
    queryResults.length = 0;
    // The exact production misconfiguration the new docs invite: gateway key set,
    // PLATFORM_OPENAI_KEY absent.
    for (const name of [...Object.values(PLATFORM_KEY_ENV), ...Object.values(GATEWAY_KEY_ENV),
      'VERCEL', 'VERCEL_ENV', 'USE_GENERATION_AGENT']) vi.stubEnv(name, '');
    vi.stubEnv('AI_GATEWAY_API_KEY', GATEWAY_KEY);
    mockAuth.mockResolvedValue({
      ok: true,
      ctx: { user, clerkId: 'clerk-1' },
    });
    // BYOK lookup → none; user row → pro tier with balance.
    queryResults.push(
      [],
      [{ id: 'user-1', tier: 'pro', monthlyTokens: 1000, monthlyTokensUsed: 0, addonTokens: 0 }],
    );
  });

  afterEach(() => vi.unstubAllEnvs());

  it('resolves AI_GATEWAY_API_KEY for an image route with PLATFORM_OPENAI_KEY unset', async () => {
    let capturedKey: string | undefined;
    const handler = createGenerationHandler({
      route: '/api/generate/image-test',
      panel: 'generate-texture',
      provider: 'openai',
      capability: 'image',
      operation: 'image_generation',
      rateLimitKey: 'gen-image',
      validate: (body) => ({ ok: true, params: { prompt: body.prompt as string } }),
      execute: async (_params, apiKey) => {
        capturedKey = apiKey;
        return { ok: true };
      },
    });

    const res = await handler(makeRequest({ prompt: 'a fox in a forest' }));

    expect(res.status).toBe(200);
    // The gateway key reached the execute callback — not PLATFORM_OPENAI_KEY (unset),
    // which would have thrown "Platform key not configured" and produced a 500.
    expect(capturedKey).toBe(GATEWAY_KEY);
  });

  it('resolves AI_GATEWAY_API_KEY for an embedding route with PLATFORM_OPENAI_KEY unset', async () => {
    let capturedKey: string | undefined;
    const handler = createGenerationHandler({
      route: '/api/generate/embedding-test',
      panel: 'ai-chat',
      provider: 'openai',
      capability: 'embedding',
      operation: 'embedding_generation',
      rateLimitKey: 'gen-embedding',
      skipContentSafety: true,
      validate: () => ({ ok: true, params: { text: 'embed me' } }),
      execute: async (_params, apiKey) => {
        capturedKey = apiKey;
        return { ok: true };
      },
    });

    const res = await handler(makeRequest({ text: 'embed me' }));

    expect(res.status).toBe(200);
    expect(capturedKey).toBe(GATEWAY_KEY);
  });

  it('a NON-gateway capability still 500s when its PLATFORM_* var is unset (guards the mock)', async () => {
    // sfx is a direct-routed capability → PLATFORM_ELEVENLABS_KEY. Unset it so the
    // real resolver throws "Platform key not configured", proving the gateway pass
    // above succeeded because of routing, not because the mock hands back a key.
    vi.stubEnv('PLATFORM_ELEVENLABS_KEY', '');
    const handler = createGenerationHandler({
      route: '/api/generate/sfx-test',
      panel: 'generate-sound',
      provider: 'elevenlabs',
      capability: 'sfx',
      operation: 'sfx_generation',
      rateLimitKey: 'gen-sfx',
      validate: (body) => ({ ok: true, params: { prompt: body.prompt as string } }),
      execute: async () => ({ ok: true }),
    });
    const res = await handler(makeRequest({ prompt: 'door creak' }));
    expect(res.status).toBe(500);
  });
});
