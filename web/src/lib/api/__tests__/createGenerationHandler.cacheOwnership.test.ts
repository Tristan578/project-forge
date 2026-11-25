/**
 * Response cache x job-ownership binding (#10262).
 *
 * `createGenerationHandler` binds a provider job id to the caller only on a
 * cache MISS (`maybeBindJobOwnership` runs inside the `cachedGenerate`
 * closure). A cache HIT re-serves a stored result, job id included, and binds
 * nothing. That is only correct while a HIT can never cross a user boundary:
 * if user B could be served user A's cached result, B would receive a job id
 * bound to A, B's own status poll would be refused (404, terminal), and B's
 * generation would be lost.
 *
 * The isolation comes from the handler passing `userId` into `cachedGenerate`,
 * which folds it into the cache key (`generateCacheKey` in responseCache.ts).
 * `responseCache.test.ts` pins the key derivation in isolation; nothing pinned
 * the handler's half of it, so this file drives the REAL response cache
 * through the REAL handler and checks the served job id against an ownership
 * table with the production semantics (unique on (provider, job id), first
 * writer wins, owner only when the bound user is the caller).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));
vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>();
  // No durable publish is armed here (QStash is unconfigured below); a no-op
  // keeps `after()` from requiring a request scope if that ever changes.
  return { ...actual, after: () => {} };
});
vi.mock('@/lib/auth/api-auth', () => ({ authenticateRequest: vi.fn() }));
vi.mock('@/lib/keys/resolver', () => ({
  resolveApiKey: vi.fn(),
  ApiKeyError: class ApiKeyError extends Error {},
}));
vi.mock('@/lib/tokens/pricing', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/tokens/pricing')>();
  return { ...actual, getTokenCost: vi.fn().mockReturnValue(10) };
});
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
  isQstashConfigured: vi.fn(() => false),
  publishGenerationCallback: vi.fn(async () => {}),
}));

// An in-memory `provider_job_owners` with the production semantics: the
// `(provider, provider_job_id)` pair is unique and the first writer wins
// (`ON CONFLICT DO NOTHING`), and a poll is the owner's only when the bound
// user is the caller (`verifyProviderJobOwner`).
const { ownerTable } = vi.hoisted(() => ({ ownerTable: new Map<string, string>() }));
vi.mock('@/lib/generate/jobOwnership', () => ({
  bindProviderJob: vi.fn(async (userId: string, provider: string, providerJobId: string) => {
    const key = `${provider}:${providerJobId}`;
    if (!ownerTable.has(key)) ownerTable.set(key, userId);
  }),
  verifyProviderJobOwner: vi.fn(async (userId: string, provider: string, providerJobId: string) =>
    ownerTable.get(`${provider}:${providerJobId}`) === userId ? 'owner' : 'not_owner'),
}));

// `@/lib/api/responseCache` is deliberately NOT mocked: the property under
// test is the handler's use of the real cache key.
import { authenticateRequest } from '@/lib/auth/api-auth';
import { resolveApiKey } from '@/lib/keys/resolver';
import { distributedRateLimit, aggregateGenerationRateLimit } from '@/lib/rateLimit/distributed';
import { bindProviderJob, verifyProviderJobOwner } from '@/lib/generate/jobOwnership';
import { invalidateCache, _inFlight } from '@/lib/api/responseCache';
import { createGenerationHandler } from '../createGenerationHandler';

const mockAuth = vi.mocked(authenticateRequest);
const mockResolve = vi.mocked(resolveApiKey);
const mockRateLimit = vi.mocked(distributedRateLimit);
const mockAggRateLimit = vi.mocked(aggregateGenerationRateLimit);
const mockBind = vi.mocked(bindProviderJob);

interface JobResult { jobId: string; provider: string; status: string }

function signIn(userId: string): void {
  mockAuth.mockResolvedValue({
    ok: true,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ctx: { user: { id: userId, tier: 'pro' } as any, clerkId: `clerk-${userId}` },
  });
}

function makeRequest(): NextRequest {
  return new NextRequest('http://localhost:3000/api/generate/model', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: 'a castle' }),
  });
}

/** A cacheable route that also binds its job id: each provider call issues a fresh id. */
function makeCachedBindingHandler() {
  let issued = 0;
  const execute = vi.fn(async (): Promise<JobResult> => {
    issued += 1;
    return { jobId: `job-${issued}`, provider: 'meshy', status: 'pending' };
  });
  const handler = createGenerationHandler<{ prompt: string }, JobResult>({
    route: '/api/generate/model',
    panel: 'generate-model',
    provider: 'meshy',
    operation: 'model_generation',
    rateLimitKey: 'gen-model',
    validate: (body) => ({ ok: true, params: { prompt: String(body.prompt ?? '') } }),
    execute,
    cacheKeyParams: (p) => ({ prompt: p.prompt }),
    jobIdForOwnership: (r) => r.jobId,
  });
  return { handler, execute };
}

async function generateAs(userId: string, handler: (req: NextRequest) => Promise<Response>) {
  signIn(userId);
  const res = await handler(makeRequest());
  const body = (await res.json()) as JobResult;
  return { res, body, text: JSON.stringify(body) };
}

describe('createGenerationHandler — response cache never serves a job id across users (#10262)', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    ownerTable.clear();
    // Memory layer only: a configured Upstash would make this test depend on
    // the network and on whatever another run left in the shared Redis.
    vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
    await invalidateCache();
    _inFlight.clear();
    mockAggRateLimit.mockResolvedValue({ allowed: true, remaining: 29, resetAt: Date.now() + 900000 });
    mockRateLimit.mockResolvedValue({ allowed: true, remaining: 9, resetAt: Date.now() + 300000 });
    mockResolve.mockResolvedValue({ type: 'platform', key: 'test-key', metered: true, usageId: 'usage-1' });
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await invalidateCache();
  });

  it('user B sending user A\'s exact request gets a cache MISS, its own job id bound to B, and B\'s poll is owned', async () => {
    const { handler, execute } = makeCachedBindingHandler();

    const a = await generateAs('user-A', handler);
    expect(a.res.status).toBe(200);
    expect(a.res.headers.get('X-Cache')).toBe('MISS');
    expect(a.body.jobId).toBe('job-1');

    const b = await generateAs('user-B', handler);
    expect(b.res.status).toBe(200);
    // Same operation, same cache params, different caller: must not be a HIT.
    expect(b.res.headers.get('X-Cache')).toBe('MISS');
    expect(execute).toHaveBeenCalledTimes(2);
    expect(b.body.jobId).toBe('job-2');
    // A's job id is never exposed to B, anywhere in B's response.
    expect(b.text).not.toContain('job-1');

    // B's status poll for the id it was served is answered as the owner's,
    // and A's id stays bound to A alone.
    await expect(verifyProviderJobOwner('user-B', 'meshy', b.body.jobId)).resolves.toBe('owner');
    await expect(verifyProviderJobOwner('user-B', 'meshy', 'job-1')).resolves.toBe('not_owner');
    await expect(verifyProviderJobOwner('user-A', 'meshy', 'job-1')).resolves.toBe('owner');
    expect(mockBind.mock.calls).toEqual([
      ['user-A', 'meshy', 'job-1'],
      ['user-B', 'meshy', 'job-2'],
    ]);
  });

  it('a cache HIT re-serves only the SAME user\'s job id, which is already bound to that user', async () => {
    const { handler, execute } = makeCachedBindingHandler();

    const first = await generateAs('user-A', handler);
    expect(first.res.headers.get('X-Cache')).toBe('MISS');

    const again = await generateAs('user-A', handler);
    expect(again.res.headers.get('X-Cache')).toBe('HIT');
    // The HIT is the stored result: no new provider job, no new bind.
    expect(execute).toHaveBeenCalledTimes(1);
    expect(mockBind).toHaveBeenCalledTimes(1);
    expect(again.body.jobId).toBe(first.body.jobId);
    // ...and the re-served id still polls as the caller's own.
    await expect(verifyProviderJobOwner('user-A', 'meshy', again.body.jobId)).resolves.toBe('owner');
  });
});
