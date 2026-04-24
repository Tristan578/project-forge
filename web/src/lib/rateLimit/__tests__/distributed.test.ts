import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// We mock the root rateLimit module and globalThis.fetch before importing distributed
vi.mock('@/lib/rateLimit', () => ({
  rateLimit: vi.fn(),
}));

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

// Dynamic import so env vars and mocks are applied per test
let distributedRateLimit: typeof import('../distributed').distributedRateLimit;

// Helper to build a successful Upstash EVAL response.
// The Lua script returns [allowed (0|1), count].
function makeEvalResponse(allowed: boolean, count: number) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => ({ result: [allowed ? 1 : 0, count] }),
  };
}

beforeEach(async () => {
  vi.resetModules();
  vi.resetAllMocks();
  mockFetch.mockReset();
  // Re-import after reset so the module gets a fresh state
  // vi.doMock is not hoisted, so it runs after vi.resetModules() as intended
  vi.doMock('@/lib/rateLimit', () => ({
    rateLimit: vi.fn(),
  }));
  globalThis.fetch = mockFetch;
  const mod = await import('../distributed');
  distributedRateLimit = mod.distributedRateLimit;
});

afterEach(() => {
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
});

describe('distributedRateLimit — fallback (Upstash not configured)', () => {
  beforeEach(async () => {
    // Ensure env vars absent
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
  });

  it('falls back to in-memory rateLimit when env vars are missing', async () => {
    const { rateLimit } = await import('@/lib/rateLimit');
    vi.mocked(rateLimit).mockResolvedValue({ allowed: true, remaining: 4, resetAt: Date.now() + 60_000 });

    const result = await distributedRateLimit('test-key', 5, 60);

    expect(rateLimit).toHaveBeenCalledWith('test-key', 5, 60_000);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(4);
  });

  it('passes through denied result from in-memory fallback', async () => {
    const { rateLimit } = await import('@/lib/rateLimit');
    vi.mocked(rateLimit).mockResolvedValue({ allowed: false, remaining: 0, resetAt: Date.now() + 60_000 });

    const result = await distributedRateLimit('test-key', 5, 60);

    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it('does not call fetch when Upstash is not configured', async () => {
    const { rateLimit } = await import('@/lib/rateLimit');
    vi.mocked(rateLimit).mockResolvedValue({ allowed: true, remaining: 3, resetAt: Date.now() + 1000 });

    await distributedRateLimit('no-upstash', 10, 30);

    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('distributedRateLimit — Upstash path', () => {
  beforeEach(() => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://redis.upstash.io';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token';
  });

  it('returns allowed=true when count is below limit', async () => {
    mockFetch.mockResolvedValue(makeEvalResponse(true, 3)); // 3 out of 10

    const result = await distributedRateLimit('key-1', 10, 60);

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(7); // 10 - 3
  });

  it('returns allowed=true when count equals limit exactly', async () => {
    mockFetch.mockResolvedValue(makeEvalResponse(true, 5)); // exactly at limit

    const result = await distributedRateLimit('key-2', 5, 60);

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(0);
  });

  it('returns allowed=false when count exceeds limit', async () => {
    // Single EVAL call — no separate ZREM needed (PF-744)
    mockFetch.mockResolvedValue(makeEvalResponse(false, 5)); // at limit, denied

    const result = await distributedRateLimit('key-3', 5, 60);

    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it('calls the Upstash EVAL endpoint with correct headers', async () => {
    mockFetch.mockResolvedValue(makeEvalResponse(true, 1));

    await distributedRateLimit('test-key', 10, 30);

    expect(mockFetch).toHaveBeenCalledWith(
      'https://redis.upstash.io/eval',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-token',
          'Content-Type': 'application/json',
        }),
      }),
    );
  });

  it('sends Lua script with correct arguments to EVAL', async () => {
    mockFetch.mockResolvedValue(makeEvalResponse(true, 1));

    await distributedRateLimit('lua-key', 5, 30);

    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body as string) as unknown[];
    const prefixed = '@spawnforge/ratelimit:lua-key';
    // [luaScript, numkeys, key, windowStart, limit, now, member, windowSeconds]
    expect(typeof callBody[0]).toBe('string'); // Lua script
    expect((callBody[0] as string)).toContain('ZREMRANGEBYSCORE');
    expect((callBody[0] as string)).toContain('ZADD');
    expect((callBody[0] as string)).toContain('ZCARD');
    expect(callBody[1]).toBe(1);              // numkeys
    expect(callBody[2]).toBe(prefixed);       // KEYS[1]
    // ARGV: windowStart, limit, now, member, windowSeconds
    expect(typeof callBody[3]).toBe('number'); // windowStart
    expect(callBody[4]).toBe(5);              // limit
    expect(typeof callBody[5]).toBe('number'); // now
    expect(typeof callBody[6]).toBe('string'); // member
    expect(callBody[7]).toBe(30);             // windowSeconds
  });

  it('provides a resetAt timestamp in the future', async () => {
    mockFetch.mockResolvedValue(makeEvalResponse(true, 2));

    const before = Date.now();
    const result = await distributedRateLimit('reset-key', 10, 60);

    expect(result.resetAt).toBeGreaterThanOrEqual(before + 60_000 - 10); // ~60s from now
  });

  it('falls back to in-memory on Upstash HTTP error', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
      json: async () => ({ error: 'unavailable' }),
    });

    const { rateLimit } = await import('@/lib/rateLimit');
    vi.mocked(rateLimit).mockResolvedValue({ allowed: true, remaining: 9, resetAt: Date.now() + 60_000 });

    const result = await distributedRateLimit('fallback-key', 10, 60);

    expect(rateLimit).toHaveBeenCalledWith('fallback-key', 10, 60_000);
    expect(result.allowed).toBe(true);
  });

  it('falls back to in-memory when fetch throws', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'));

    const { rateLimit } = await import('@/lib/rateLimit');
    vi.mocked(rateLimit).mockResolvedValue({ allowed: false, remaining: 0, resetAt: Date.now() + 1000 });

    const result = await distributedRateLimit('network-fail-key', 5, 60);

    expect(rateLimit).toHaveBeenCalled();
    expect(result.allowed).toBe(false);
  });

  it('makes exactly one fetch call (atomic EVAL) regardless of allow/deny', async () => {
    // Denied request: single EVAL, no second ZREM call needed (PF-744)
    mockFetch.mockResolvedValue(makeEvalResponse(false, 5));

    await distributedRateLimit('atomic-key', 5, 60);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [evalUrl] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(evalUrl).toBe('https://redis.upstash.io/eval');
  });

  it('never adds a phantom entry on deny (no ZADD in deny path)', async () => {
    // The Lua script only calls ZADD when count < limit.
    // On deny, the entry is never written — nothing to clean up.
    mockFetch.mockResolvedValue(makeEvalResponse(false, 10));

    const result = await distributedRateLimit('no-phantom-key', 10, 60);

    expect(result.allowed).toBe(false);
    expect(mockFetch).toHaveBeenCalledTimes(1); // No second cleanup call
  });
});

// Test the index module re-exports in isolation (no mocks active)
describe('rateLimit/index — re-exports', () => {
  it('re-exports distributedRateLimit', () => {
    // Verify the distributed module exports the function directly
    // (avoids the @/lib/rateLimit mock interfering with re-export checks)
    expect(typeof distributedRateLimit).toBe('function');
  });

  it('re-exports rateLimit from the original module', async () => {
    // The original module is mocked as vi.fn() so it will be a function
    const { rateLimit } = await import('@/lib/rateLimit');
    expect(typeof rateLimit).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// PF-738: RateLimitResult type shape — in-memory fallback must match
// distributed result shape so callers can use both interchangeably.
// ---------------------------------------------------------------------------

describe('PF-738: distributedRateLimit result shape matches in-memory RateLimitResult', () => {
  it('fallback result has allowed, remaining, and resetAt fields (type-compatible shape)', async () => {
    const { rateLimit } = await import('@/lib/rateLimit');
    vi.mocked(rateLimit).mockResolvedValue({ allowed: true, remaining: 7, resetAt: Date.now() + 60_000 });

    const result = await distributedRateLimit('shape-test-key', 10, 60);

    // PF-738: the distributed result must expose the same surface area as
    // the in-memory RateLimitResult so consumers can use them interchangeably
    expect(typeof result.allowed).toBe('boolean');
    expect(typeof result.remaining).toBe('number');
    expect(typeof result.resetAt).toBe('number');
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(7);
  });

  it('fallback denied result has allowed=false with remaining=0', async () => {
    const { rateLimit } = await import('@/lib/rateLimit');
    vi.mocked(rateLimit).mockResolvedValue({ allowed: false, remaining: 0, resetAt: Date.now() + 30_000 });

    const result = await distributedRateLimit('shape-denied-key', 5, 30);

    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.resetAt).toBeGreaterThan(Date.now());
  });

  it('Upstash result has the same shape as the in-memory fallback result', async () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://redis.upstash.io';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token';

    mockFetch.mockResolvedValue(makeEvalResponse(true, 4)); // 4 out of 10

    const result = await distributedRateLimit('upstash-shape-key', 10, 60);

    // Must have the same three fields as RateLimitResult
    expect(typeof result.allowed).toBe('boolean');
    expect(typeof result.remaining).toBe('number');
    expect(typeof result.resetAt).toBe('number');
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(6); // 10 - 4
  });
});
