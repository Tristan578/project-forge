import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));

// The handler defers the durable publish to Next.js `after()` so it never adds
// latency to the user response. In a unit test the framework's after-queue
// doesn't drain on its own, so we capture the scheduled callbacks and flush them
// explicitly — which also lets us assert the publish is deferred, not inline.
const { afterCallbacks } = vi.hoisted(() => ({ afterCallbacks: [] as Array<() => unknown> }));
vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>();
  return { ...actual, after: (cb: () => unknown) => { afterCallbacks.push(cb); } };
});

async function flushAfter(): Promise<void> {
  const pending = afterCallbacks.splice(0);
  for (const cb of pending) await cb();
}

// Same dependency doubles as createGenerationHandler.test.ts, plus the QStash
// wrapper — this file isolates the PF-906 durable-callback wiring.
vi.mock('@/lib/auth/api-auth', () => ({ authenticateRequest: vi.fn() }));
vi.mock('@/lib/keys/resolver', () => ({
  resolveApiKey: vi.fn(),
  ApiKeyError: class ApiKeyError extends Error {},
}));
vi.mock('@/lib/tokens/pricing', () => ({ getTokenCost: vi.fn().mockReturnValue(10) }));
vi.mock('@/lib/monitoring/sentry-server', () => ({ captureException: vi.fn() }));
vi.mock('@/lib/rateLimit', () => ({
  rateLimitResponse: vi.fn().mockReturnValue(new Response('{}', { status: 429 })),
}));
vi.mock('@/lib/rateLimit/distributed', () => ({
  distributedRateLimit: vi.fn(),
  aggregateGenerationRateLimit: vi.fn(),
}));
vi.mock('@/lib/ai/contentSafety', () => ({
  sanitizePrompt: vi.fn((p: string) => ({ safe: true, filtered: p })),
}));
vi.mock('@/lib/tokens/service', () => ({ refundTokens: vi.fn().mockResolvedValue({ refunded: true }) }));
vi.mock('@/lib/db/client', () => ({ getDb: vi.fn().mockReturnValue({}) }));
vi.mock('@/lib/qstash/client', () => ({
  isQstashConfigured: vi.fn(() => true),
  publishGenerationCallback: vi.fn(async () => {}),
}));

import { authenticateRequest } from '@/lib/auth/api-auth';
import { resolveApiKey } from '@/lib/keys/resolver';
import { distributedRateLimit, aggregateGenerationRateLimit } from '@/lib/rateLimit/distributed';
import { sanitizePrompt } from '@/lib/ai/contentSafety';
import { captureException } from '@/lib/monitoring/sentry-server';
import { isQstashConfigured, publishGenerationCallback } from '@/lib/qstash/client';
import { createGenerationHandler } from '../createGenerationHandler';

const mockAuth = vi.mocked(authenticateRequest);
const mockResolve = vi.mocked(resolveApiKey);
const mockRateLimit = vi.mocked(distributedRateLimit);
const mockAggRateLimit = vi.mocked(aggregateGenerationRateLimit);
const mockSanitize = vi.mocked(sanitizePrompt);
const mockCapture = vi.mocked(captureException);
const mockConfigured = vi.mocked(isQstashConfigured);
const mockPublish = vi.mocked(publishGenerationCallback);

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost:3000/api/generate/model', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

interface ModelResult { jobId: string; provider: string; status: string }

function makeAsyncHandler(over: Partial<{
  providerJobId: (r: ModelResult) => string | null;
  estimatedSeconds: number;
  jobId: string;
  provider: string;
}> = {}) {
  return createGenerationHandler<{ prompt: string }, ModelResult>({
    route: '/api/generate/model',
    provider: 'elevenlabs',
    operation: 'model_generation',
    rateLimitKey: 'gen-model',
    validate: (body) => ({ ok: true, params: { prompt: String(body.prompt ?? '') } }),
    execute: async () => ({ jobId: over.jobId ?? 'task-123', provider: over.provider ?? 'sdxl', status: 'pending' }),
    asyncJob: {
      type: 'model',
      providerJobId: over.providerJobId ?? ((r) => r.jobId),
      estimatedSeconds: over.estimatedSeconds,
    },
  });
}

describe('createGenerationHandler — durable QStash callback (PF-906)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    afterCallbacks.length = 0;
    mockConfigured.mockReturnValue(true);
    mockAuth.mockResolvedValue({
      ok: true,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ctx: { user: { id: 'user-1', tier: 'pro' } as any, clerkId: 'clerk-1' },
    });
    mockAggRateLimit.mockResolvedValue({ allowed: true, remaining: 29, resetAt: Date.now() + 900000 });
    mockRateLimit.mockResolvedValue({ allowed: true, remaining: 9, resetAt: Date.now() + 300000 });
    mockResolve.mockResolvedValue({ type: 'platform', key: 'test-key', metered: true, usageId: 'usage-1' });
    mockSanitize.mockReturnValue({ safe: true, filtered: 'a castle' });
  });

  it('publishes the callback with the extracted job id after a successful execute', async () => {
    const res = await makeAsyncHandler({ estimatedSeconds: 45 })(makeRequest({ prompt: 'a castle' }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ jobId: 'task-123' });
    // Runs post-response via after(): the response is fully formed before the
    // publish executes, so it never blocks the user submit.
    expect(mockPublish).not.toHaveBeenCalled();
    await flushAfter();
    expect(mockPublish).toHaveBeenCalledWith(
      { userId: 'user-1', providerJobId: 'task-123', type: 'model', tokenUsageId: 'usage-1', attempt: 0 },
      { delaySeconds: 45 },
    );
  });

  it('defaults the delay to 30s when estimatedSeconds is omitted', async () => {
    await makeAsyncHandler()(makeRequest({ prompt: 'a castle' }));
    await flushAfter();
    expect(mockPublish).toHaveBeenCalledWith(expect.anything(), { delaySeconds: 30 });
  });

  it('publishes tokenUsageId: null for a BYOK/unmetered job (usageId undefined)', async () => {
    // BYOK / non-metered path: resolveApiKey returns no usageId. The payload
    // must coalesce to null so the webhook's `if (tokenUsageId)` refund guard
    // correctly skips (no platform tokens were ever deducted to refund).
    mockResolve.mockResolvedValue({ type: 'byok', key: 'user-key', metered: false, usageId: undefined });
    const res = await makeAsyncHandler()(makeRequest({ prompt: 'a castle' }));
    expect(res.status).toBe(200);
    await flushAfter();
    expect(mockPublish).toHaveBeenCalledWith(
      expect.objectContaining({ providerJobId: 'task-123', tokenUsageId: null }),
      expect.anything(),
    );
  });

  it('does not publish when QStash is unconfigured (dormant)', async () => {
    mockConfigured.mockReturnValue(false);
    const res = await makeAsyncHandler()(makeRequest({ prompt: 'a castle' }));
    expect(res.status).toBe(200);
    await flushAfter();
    expect(mockPublish).not.toHaveBeenCalled();
  });

  it('does not publish when the extractor returns null (synchronous result)', async () => {
    const handler = makeAsyncHandler({ provider: 'dalle3', providerJobId: (r) => (r.provider === 'sdxl' ? r.jobId : null) });
    const res = await handler(makeRequest({ prompt: 'a hero' }));
    expect(res.status).toBe(200);
    await flushAfter();
    expect(mockPublish).not.toHaveBeenCalled();
    expect(mockCapture).not.toHaveBeenCalled();
  });

  it('never fails the request when publishing throws (logs to Sentry)', async () => {
    mockPublish.mockRejectedValueOnce(new Error('qstash 500'));
    const res = await makeAsyncHandler()(makeRequest({ prompt: 'a castle' }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ jobId: 'task-123' });
    await flushAfter();
    expect(mockCapture).toHaveBeenCalled();
  });

  it('never fails the request when the job-id extractor throws (logs to Sentry)', async () => {
    const handler = makeAsyncHandler({ providerJobId: () => { throw new Error('bad result shape'); } });
    const res = await handler(makeRequest({ prompt: 'a castle' }));
    expect(res.status).toBe(200);
    await flushAfter();
    expect(mockPublish).not.toHaveBeenCalled();
    expect(mockCapture).toHaveBeenCalled();
  });

  it('does not publish for a handler with no asyncJob config', async () => {
    const plain = createGenerationHandler<{ prompt: string }, ModelResult>({
      route: '/api/generate/sfx',
      provider: 'elevenlabs',
      operation: 'sfx_generation',
      rateLimitKey: 'gen-sfx',
      validate: (body) => ({ ok: true, params: { prompt: String(body.prompt ?? '') } }),
      execute: async () => ({ jobId: 'x', provider: 'elevenlabs', status: 'pending' }),
    });
    const res = await plain(makeRequest({ prompt: 'a sound' }));
    expect(res.status).toBe(200);
    await flushAfter();
    expect(mockPublish).not.toHaveBeenCalled();
  });
});
