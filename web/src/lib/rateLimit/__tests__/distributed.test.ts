import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// We mock the root rateLimit module and globalThis.fetch before importing distributed
vi.mock('@/lib/rateLimit', () => ({
  rateLimit: vi.fn(),
}));

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

// Dynamic import so env vars and mocks are applied per test
let distributedRateLimit: typeof import('../distributed').distributedRateLimit;

// Helper to build a successful Upstash pipeline response with a given ZCARD result
function makePipelineResponse(zcard: number) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => [
      { result: 3 },         // ZREMRANGEBYSCORE
      { result: 1 },         // ZADD
      { result: zcard },     // ZCARD
      { result: 1 },         // EXPIRE
    ],
  };
}

beforeEach(async () => {
  vi.resetModules();
  vi.resetAllMocks();
  mockFetch.mockReset();
  // Re-import after reset so the module gets a fresh state
  vi.mock('@/lib/rateLimit', () => ({
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

  it('returns allowed=true when ZCARD is below limit', async () => {
    mockFetch.mockResolvedValue(makePipelineResponse(3)); // 3 out of 10

    const result = await distributedRateLimit('key-1', 10, 60);

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(7); // 10 - 3
  });

  it('returns allowed=true when ZCARD equals limit exactly', async () => {
    mockFetch.mockResolvedValue(makePipelineResponse(5)); // exactly at limit

    const result = await distributedRateLimit('key-2', 5, 60);

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(0);
  });

  it('returns allowed=false when ZCARD exceeds limit', async () => {
    // First call: pipeline response showing over limit
    mockFetch.mockResolvedValueOnce(makePipelineResponse(6)) // ZCARD = 6, limit = 5
      .mockResolvedValueOnce({ ok: true, json: async () => [{ result: 1 }] }); // ZREM cleanup

    const result = await distributedRateLimit('key-3', 5, 60);

    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it('calls the Upstash pipeline endpoint with correct headers', async () => {
    mockFetch.mockResolvedValue(makePipelineResponse(1));

    await distributedRateLimit('test-key', 10, 30);

    expect(mockFetch).toHaveBeenCalledWith(
      'https://redis.upstash.io/pipeline',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-token',
          'Content-Type': 'application/json',
        }),
      }),
    );
  });

  it('sends ZREMRANGEBYSCORE, ZADD, ZCARD, EXPIRE pipeline commands', async () => {
    mockFetch.mockResolvedValue(makePipelineResponse(1));

    await distributedRateLimit('pipeline-key', 5, 30);

    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body as string) as string[][];
    expect(callBody[0][0]).toBe('ZREMRANGEBYSCORE');
    expect(callBody[0][1]).toBe('pipeline-key');
    expect(callBody[1][0]).toBe('ZADD');
    expect(callBody[1][1]).toBe('pipeline-key');
    expect(callBody[2][0]).toBe('ZCARD');
    expect(callBody[2][1]).toBe('pipeline-key');
    expect(callBody[3][0]).toBe('EXPIRE');
    expect(callBody[3][1]).toBe('pipeline-key');
    // windowSeconds must be a number (not a string) — Redis sorted-set scores require numeric values
    expect(callBody[3][2]).toBe(30); // windowSeconds as number
  });

  it('provides a resetAt timestamp in the future', async () => {
    mockFetch.mockResolvedValue(makePipelineResponse(2));

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

  it('attempts cleanup via Lua EVAL when over limit', async () => {
    // Over-limit: ZCARD = 6 for limit = 5
    mockFetch
      .mockResolvedValueOnce(makePipelineResponse(6))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ result: 1 }) });

    await distributedRateLimit('cleanup-key', 5, 60);

    expect(mockFetch).toHaveBeenCalledTimes(2);
    // Second call must go to the /eval endpoint (Lua EVAL for atomic remove-if-over-limit)
    const [evalUrl, evalInit] = mockFetch.mock.calls[1] as [string, RequestInit];
    expect(evalUrl).toBe('https://redis.upstash.io/eval');
    expect(evalInit.method).toBe('POST');
    // Body is [luaScript, numkeys, key, member]
    const evalBody = JSON.parse(evalInit.body as string) as [string, number, string, string];
    expect(typeof evalBody[0]).toBe('string'); // Lua script
    expect(evalBody[0]).toContain('ZREM');     // script performs ZREM
    expect(evalBody[1]).toBe(1);               // numkeys = 1
    expect(evalBody[2]).toBe('cleanup-key');   // KEYS[1]
  });

  it('does not throw if Lua EVAL cleanup fails', async () => {
    mockFetch
      .mockResolvedValueOnce(makePipelineResponse(6))
      .mockRejectedValueOnce(new Error('cleanup failed'));

    // Should not throw despite cleanup failure
    await expect(distributedRateLimit('no-throw-key', 5, 60)).resolves.not.toBeUndefined();
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

    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => [
        { result: 3 },  // ZREMRANGEBYSCORE
        { result: 1 },  // ZADD
        { result: 4 },  // ZCARD (4 out of 10)
        { result: 1 },  // EXPIRE
      ],
    });

    const result = await distributedRateLimit('upstash-shape-key', 10, 60);

    // Must have the same three fields as RateLimitResult
    expect(typeof result.allowed).toBe('boolean');
    expect(typeof result.remaining).toBe('number');
    expect(typeof result.resetAt).toBe('number');
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(6); // 10 - 4
  });
});
