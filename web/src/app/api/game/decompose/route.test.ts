vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { withApiMiddleware } from '@/lib/api/middleware';
import { decomposeIntoSystems } from '@/lib/game-creation/decomposer';
import { resolveApiKey, ApiKeyError } from '@/lib/keys/resolver';
import { refundTokens } from '@/lib/tokens/service';
import { isProviderKilled } from '@/lib/flags/posthogFlags';
import { makeUser } from '@/test/utils/apiTestUtils';

vi.mock('@/lib/api/middleware');
// Must match the route's import specifier exactly — vitest keys module mocks by
// resolved specifier, so mocking the `@/lib/game-creation` barrel here would
// silently stop intercepting and run the real decomposer. The route imports the
// module directly (not via the barrel) so a server bundle doesn't pull in the
// client-only executor graph.
vi.mock('@/lib/game-creation/decomposer', () => ({
  decomposeIntoSystems: vi.fn(),
}));
vi.mock('@/lib/monitoring/sentry-server', () => ({
  captureException: vi.fn(),
}));

// `checkBotIdGate` and `isProviderKilled` are deliberately NOT mocked here,
// mirroring chat/route.test.ts: both fail open with no config present in the
// test environment (checkBotId() throws with no Vercel/BotID context and the
// gate catches that; the PostHog flag evaluator is dormant with no API keys
// set) — see their own header comments in botId.ts / posthogFlags.ts.
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
vi.mock('@/lib/tokens/service', () => ({
  refundTokens: vi.fn().mockResolvedValue({ refunded: true }),
}));
vi.mock('@/lib/flags/posthogFlags', () => ({
  isProviderKilled: vi.fn(() => false),
}));

function makeReq(body: unknown) {
  return new NextRequest('http://localhost:3000/api/game/decompose', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function mockMiddlewareSuccess(overrides?: Partial<ReturnType<typeof makeUser>>) {
  // `makeUser`'s default tier is 'starter', which `assertTier` in the route
  // rejects (['hobbyist', 'creator', 'pro']) with a 403 — override to a tier
  // that actually has AI access so "success" fixtures don't accidentally
  // exercise the tier-gate branch.
  const user = makeUser({ tier: 'hobbyist', ...overrides });
  vi.mocked(withApiMiddleware).mockResolvedValue({
    error: undefined,
    userId: user.id,
    authContext: { clerkId: 'clerk123', user } as never,
    body: undefined,
  });
  return user;
}

function mockMiddlewareError(status: number, error: string) {
  vi.mocked(withApiMiddleware).mockResolvedValue({
    error: NextResponse.json({ error }, { status }),
    userId: null,
    authContext: null,
    body: undefined,
  });
}

const MOCK_GDD = {
  id: 'gdd-1',
  title: 'Test Game',
  description: 'test prompt',
  systems: [{ category: 'movement', type: 'walk', config: {}, priority: 'core', dependsOn: [] }],
  scenes: [{ name: 'Level 1', purpose: 'Main level', systems: ['movement'], entities: [], transitions: [] }],
  assetManifest: [],
  estimatedScope: 'small',
  styleDirective: 'default',
  feelDirective: { mood: 'fun', pacing: 'medium', weight: 'medium', referenceGames: [], oneLiner: 'test' },
  constraints: [],
  projectType: '3d',
};

describe('POST /api/game/decompose', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveApiKey).mockResolvedValue({
      type: 'platform',
      key: 'sk-ant-test',
      metered: true,
      usageId: 'usage-1',
    } as never);
  });

  it('returns 200 with GDD on valid request', async () => {
    mockMiddlewareSuccess();
    vi.mocked(decomposeIntoSystems).mockResolvedValue(MOCK_GDD as never);

    const { POST } = await import('./route');
    const res = await POST(makeReq({ prompt: 'make a platformer', projectType: '3d' }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.gdd).toBeDefined();
    expect(body.gdd.title).toBe('Test Game');
  });

  it('calls decomposeIntoSystems with correct args', async () => {
    mockMiddlewareSuccess();
    vi.mocked(decomposeIntoSystems).mockResolvedValue(MOCK_GDD as never);

    const { POST } = await import('./route');
    await POST(makeReq({ prompt: 'jungle adventure', projectType: '2d' }));

    expect(decomposeIntoSystems).toHaveBeenCalledWith('jungle adventure', '2d');
  });

  it('returns 400 on missing prompt', async () => {
    mockMiddlewareSuccess();

    const { POST } = await import('./route');
    const res = await POST(makeReq({ projectType: '3d' }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('validation_error');
  });

  it('returns 400 on invalid projectType', async () => {
    mockMiddlewareSuccess();

    const { POST } = await import('./route');
    const res = await POST(makeReq({ prompt: 'test', projectType: 'vr' }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('validation_error');
  });

  it('returns 400 on empty prompt', async () => {
    mockMiddlewareSuccess();

    const { POST } = await import('./route');
    const res = await POST(makeReq({ prompt: '', projectType: '3d' }));

    expect(res.status).toBe(400);
  });

  it('returns 400 on prompt exceeding max length', async () => {
    mockMiddlewareSuccess();

    const { POST } = await import('./route');
    const res = await POST(makeReq({ prompt: 'x'.repeat(1001), projectType: '3d' }));

    expect(res.status).toBe(400);
  });

  it('returns middleware error for unauthenticated request', async () => {
    mockMiddlewareError(401, 'unauthorized');

    const { POST } = await import('./route');
    const res = await POST(makeReq({ prompt: 'test', projectType: '3d' }));

    expect(res.status).toBe(401);
  });

  it('returns 400 when prompt is rejected by sanitizer', async () => {
    mockMiddlewareSuccess();
    vi.mocked(decomposeIntoSystems).mockRejectedValue(
      new Error('Prompt rejected: content unsafe'),
    );

    const { POST } = await import('./route');
    const res = await POST(makeReq({ prompt: 'bad prompt', projectType: '3d' }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('prompt_rejected');
  });

  it('returns 500 on LLM failure', async () => {
    mockMiddlewareSuccess();
    vi.mocked(decomposeIntoSystems).mockRejectedValue(
      new Error('LLM call failed: timeout'),
    );

    const { POST } = await import('./route');
    const res = await POST(makeReq({ prompt: 'test game', projectType: '3d' }));

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('decomposition_failed');
  });

  it('returns 400 on invalid JSON body', async () => {
    mockMiddlewareSuccess();

    const { POST } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/game/decompose', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    });
    const res = await POST(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('validation_error');
  });

  // Security finding 2 (PR #9672 review) — this route hand-wires the same
  // gates createGenerationHandler routes get for free, so each one needs its
  // own coverage.
  it('returns 403 for a tier with no AI access (starter)', async () => {
    mockMiddlewareSuccess({ tier: 'starter' });

    const { POST } = await import('./route');
    const res = await POST(makeReq({ prompt: 'test', projectType: '3d' }));

    expect(res.status).toBe(403);
    expect(decomposeIntoSystems).not.toHaveBeenCalled();
    expect(resolveApiKey).not.toHaveBeenCalled();
  });

  it('returns 503 without deducting tokens when the provider kill switch is on', async () => {
    mockMiddlewareSuccess();
    vi.mocked(isProviderKilled).mockReturnValueOnce(true);

    const { POST } = await import('./route');
    const res = await POST(makeReq({ prompt: 'test', projectType: '3d' }));

    expect(res.status).toBe(503);
    expect(resolveApiKey).not.toHaveBeenCalled();
    expect(decomposeIntoSystems).not.toHaveBeenCalled();
  });

  it('returns 402 and never calls decomposeIntoSystems when resolveApiKey rejects', async () => {
    mockMiddlewareSuccess();
    vi.mocked(resolveApiKey).mockRejectedValueOnce(
      new ApiKeyError('INSUFFICIENT_TOKENS', 'Not enough tokens'),
    );

    const { POST } = await import('./route');
    const res = await POST(makeReq({ prompt: 'test', projectType: '3d' }));

    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.code).toBe('INSUFFICIENT_TOKENS');
    expect(decomposeIntoSystems).not.toHaveBeenCalled();
  });

  it('refunds tokens when decomposeIntoSystems throws', async () => {
    mockMiddlewareSuccess();
    vi.mocked(decomposeIntoSystems).mockRejectedValue(new Error('LLM call failed: timeout'));

    const { POST } = await import('./route');
    await POST(makeReq({ prompt: 'test game', projectType: '3d' }));

    expect(refundTokens).toHaveBeenCalledWith('user-uuid-1', 'usage-1');
  });

  it('does not refund tokens on success', async () => {
    mockMiddlewareSuccess();
    vi.mocked(decomposeIntoSystems).mockResolvedValue(MOCK_GDD as never);

    const { POST } = await import('./route');
    await POST(makeReq({ prompt: 'make a platformer', projectType: '3d' }));

    expect(refundTokens).not.toHaveBeenCalled();
  });
});
