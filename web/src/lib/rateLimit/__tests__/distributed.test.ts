import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { UPSTASH_REST_TIMEOUT_MS } from '@/lib/config/timeouts';

// We mock the root rateLimit module and globalThis.fetch before importing distributed
vi.mock('@/lib/rateLimit', () => ({
  rateLimit: vi.fn(),
}));

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

// Dynamic import so env vars and mocks are applied per test
let distributedRateLimit: typeof import('../distributed').distributedRateLimit;

// Helper to build a successful Upstash EVAL response, in the shape the shipped
// script returns (pinned by slidingWindowScript.lua.test.ts): [1, count] on
// allow, [0, count, oldest] on deny — `oldest` being the score of the earliest
// entry still in the window, which is what resetAt is derived from.
function makeEvalResponse(allowed: boolean, count: number, oldest: number = Date.now() - 1_000) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => ({ result: allowed ? [1, count] : [0, count, oldest] }),
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
  vi.doMock('@/lib/monitoring/sampledCapture', () => ({
    sampledCaptureException: vi.fn(),
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

  it('throws when Upstash is missing and strict failure handling is requested', async () => {
    const { rateLimit } = await import('@/lib/rateLimit');

    await expect(
      distributedRateLimit('ci-integration:missing-config', 2, 300, { fallbackOnError: false })
    ).rejects.toThrow('Upstash Redis is not configured');
    expect(rateLimit).not.toHaveBeenCalled();
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

  it('posts the command to the Upstash base URL with bearer auth', async () => {
    mockFetch.mockResolvedValue(makeEvalResponse(true, 1));

    await distributedRateLimit('test-key', 10, 30);

    // Body-form commands go to the BASE URL. `POST <base>/eval` is the path
    // form, and Upstash appends a POST body to a path-form command as ONE
    // trailing argument — which is how every call was refused with 400 from
    // #8369 (2026-04-13) until #9623. The URL is pinned exactly so a `/eval`
    // suffix can never come back.
    expect(mockFetch).toHaveBeenCalledWith(
      'https://redis.upstash.io',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-token',
          'Content-Type': 'application/json',
        }),
      }),
    );
  });

  it('bounds the Upstash round-trip with AbortSignal.timeout(UPSTASH_REST_TIMEOUT_MS)', async () => {
    const spy = vi.spyOn(AbortSignal, 'timeout');
    mockFetch.mockResolvedValue(makeEvalResponse(true, 1));

    await distributedRateLimit('timeout-key', 10, 30);

    // The fallback only engages when fetch THROWS; a stalled connection never
    // does on its own, so the signal is what keeps a hung Upstash from holding
    // every rate-limited route for the function's whole duration — and the
    // bound has to be the shared constant, not any signal.
    expect(spy).toHaveBeenCalledWith(UPSTASH_REST_TIMEOUT_MS);
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBeInstanceOf(AbortSignal);
    spy.mockRestore();
  });

  it('derives resetAt from the oldest in-window entry on deny, and from now on allow', async () => {
    const before = Date.now();
    const oldest = before - 50_000; // entered 50s ago in a 60s window

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ result: [0, 5, oldest] }),
    });
    const denied = await distributedRateLimit('reset-deny', 5, 60);
    expect(denied.allowed).toBe(false);
    // The window reopens when that entry expires: ~10s from now, not 60s.
    expect(denied.resetAt).toBe(oldest + 60_000);

    mockFetch.mockResolvedValueOnce(makeEvalResponse(true, 2));
    const allowed = await distributedRateLimit('reset-allow', 5, 60);
    expect(allowed.resetAt).toBeGreaterThanOrEqual(before + 60_000);
  });

  it('sends the documented body-form EVAL command array', async () => {
    mockFetch.mockResolvedValue(makeEvalResponse(true, 1));

    await distributedRateLimit('lua-key', 5, 30);

    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body as string) as unknown[];
    const prefixed = '@spawnforge/ratelimit:lua-key';
    // https://upstash.com/docs/redis/features/restapi — "Array's first element
    // must be the command name and command parameters should be appended next
    // to each other in the same order as Redis protocol":
    // ["EVAL", luaScript, numkeys, key, windowStart, limit, now, member, windowSeconds]
    expect(callBody).toHaveLength(9);
    expect(callBody[0]).toBe('EVAL');          // command name — REQUIRED in body form
    expect(typeof callBody[1]).toBe('string'); // Lua script
    expect((callBody[1] as string)).toContain('ZREMRANGEBYSCORE');
    expect((callBody[1] as string)).toContain('ZADD');
    expect((callBody[1] as string)).toContain('ZCARD');
    expect(callBody[2]).toBe(1);               // numkeys
    expect(callBody[3]).toBe(prefixed);        // KEYS[1]
    // ARGV: windowStart, limit, now, member, windowSeconds
    expect(typeof callBody[4]).toBe('number'); // windowStart
    expect(callBody[5]).toBe(5);               // limit
    expect(typeof callBody[6]).toBe('number'); // now
    expect(typeof callBody[7]).toBe('string'); // member
    expect(callBody[8]).toBe(30);              // windowSeconds
  });

  it('never emits the path-form request that Upstash rejects', async () => {
    mockFetch.mockResolvedValue(makeEvalResponse(true, 1));

    await distributedRateLimit('shape-key', 5, 30);

    const [calledUrl, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const callBody = JSON.parse(init.body as string) as unknown[];
    expect(calledUrl.endsWith('/eval')).toBe(false);
    // A body whose first element is the script (not the command name) is the
    // exact shape that produced SPAWNFORGE-AI-B.
    expect(callBody[0]).not.toContain('redis.call');
  });

  it('carries the Upstash error body into the thrown error so the fallback is diagnosable', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      text: async () => '{"error":"ERR wrong number of arguments for \'eval\' command"}',
      json: async () => ({ error: 'unused' }),
    });
    const { sampledCaptureException } = await import('@/lib/monitoring/sampledCapture');
    const { rateLimit } = await import('@/lib/rateLimit');
    vi.mocked(rateLimit).mockResolvedValue({ allowed: true, remaining: 9, resetAt: Date.now() + 60_000 });

    await distributedRateLimit('detail-key', 10, 60);

    expect(sampledCaptureException).toHaveBeenCalledTimes(1);
    const [action, err] = vi.mocked(sampledCaptureException).mock.calls[0] as [string, Error];
    expect(action).toBe('distributedRateLimit.failOpen');
    expect(err.message).toBe(
      "Upstash EVAL failed: 400 Bad Request — {\"error\":\"ERR wrong number of arguments for 'eval' command\"}",
    );
  });

  it('bounds the error detail and tolerates an unreadable body', async () => {
    const { rateLimit } = await import('@/lib/rateLimit');
    vi.mocked(rateLimit).mockResolvedValue({ allowed: true, remaining: 9, resetAt: Date.now() + 60_000 });
    const { sampledCaptureException } = await import('@/lib/monitoring/sampledCapture');

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      text: async () => 'x'.repeat(1000),
      json: async () => ({}),
    });
    await distributedRateLimit('long-key', 10, 60);
    const longErr = vi.mocked(sampledCaptureException).mock.calls[0][1] as Error;
    expect(longErr.message).toBe(`Upstash EVAL failed: 500 Internal Server Error — ${'x'.repeat(200)}`);

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 502,
      statusText: 'Bad Gateway',
      text: async () => { throw new Error('stream closed'); },
      json: async () => ({}),
    });
    await distributedRateLimit('unreadable-key', 10, 60);
    const bareErr = vi.mocked(sampledCaptureException).mock.calls[1][1] as Error;
    expect(bareErr.message).toBe('Upstash EVAL failed: 502 Bad Gateway');

    // Whitespace is collapsed so a multi-line body reads as one line in Sentry…
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      text: async () => '  ERR foo\n\n\t  bar ',
      json: async () => ({}),
    });
    await distributedRateLimit('multiline-key', 10, 60);
    const collapsedErr = vi.mocked(sampledCaptureException).mock.calls[2][1] as Error;
    expect(collapsedErr.message).toBe('Upstash EVAL failed: 400 Bad Request — ERR foo bar');

    // …and a whitespace-only body yields the bare status line, no separator.
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      text: async () => '   \n ',
      json: async () => ({}),
    });
    await distributedRateLimit('blank-key', 10, 60);
    const blankErr = vi.mocked(sampledCaptureException).mock.calls[3][1] as Error;
    expect(blankErr.message).toBe('Upstash EVAL failed: 400 Bad Request');
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
      text: async () => '',
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

  it('throws instead of falling back when strict failure handling is requested', async () => {
    mockFetch.mockRejectedValue(new Error('Invalid Upstash credential'));

    const { rateLimit } = await import('@/lib/rateLimit');

    await expect(
      distributedRateLimit('ci-integration:strict-key', 2, 300, { fallbackOnError: false })
    ).rejects.toThrow('Invalid Upstash credential');
    expect(rateLimit).not.toHaveBeenCalled();
  });

  it('makes exactly one fetch call (atomic EVAL) regardless of allow/deny', async () => {
    // Denied request: single EVAL, no second ZREM call needed (PF-744)
    mockFetch.mockResolvedValue(makeEvalResponse(false, 5));

    await distributedRateLimit('atomic-key', 5, 60);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [evalUrl] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(evalUrl).toBe('https://redis.upstash.io');
  });

  it('issues no cleanup round-trip on deny', async () => {
    // `fetch` is mocked, so the Lua body travels as an opaque string and its
    // ZADD branch is never executed here — this asserts only that the caller
    // makes a single EVAL and no follow-up ZREM. The claim that the deny path
    // writes nothing is proven by executing the script itself, in
    // `slidingWindowScript.lua.test.ts`.
    mockFetch.mockResolvedValue(makeEvalResponse(false, 10));

    const result = await distributedRateLimit('no-phantom-key', 10, 60);

    expect(result.allowed).toBe(false);
    expect(mockFetch).toHaveBeenCalledTimes(1); // No second cleanup call
  });
});

describe('distributedRateLimit — Upstash failure observability (PF-842 #8666)', () => {
  beforeEach(() => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://redis.upstash.io';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token';
  });

  it('reports an Upstash failure through the throttled sampledCaptureException helper (not a raw capture storm)', async () => {
    mockFetch.mockRejectedValue(new Error('upstash down'));

    const { rateLimit } = await import('@/lib/rateLimit');
    vi.mocked(rateLimit).mockResolvedValue({ allowed: true, remaining: 9, resetAt: Date.now() + 60_000 });

    const { sampledCaptureException } = await import('@/lib/monitoring/sampledCapture');

    await distributedRateLimit('billing-checkout:user-123', 10, 60);

    // The fail-open bypass must be observable — but through the per-action throttle,
    // so a sustained Upstash outage can't turn the alert into its own storm.
    expect(vi.mocked(sampledCaptureException)).toHaveBeenCalledWith(
      'distributedRateLimit.failOpen',
      expect.any(Error),
      expect.objectContaining({ keyPrefix: 'billing-checkout' }),
    );
  });

  it('strips the user-identifying suffix from the key before reporting (no PII in Sentry extra)', async () => {
    mockFetch.mockRejectedValue(new Error('upstash down'));

    const { rateLimit } = await import('@/lib/rateLimit');
    vi.mocked(rateLimit).mockResolvedValue({ allowed: true, remaining: 9, resetAt: Date.now() + 60_000 });

    const { sampledCaptureException } = await import('@/lib/monitoring/sampledCapture');

    await distributedRateLimit('gen-all:user-secret-id', 30, 900);

    const extra = vi.mocked(sampledCaptureException).mock.calls[0]?.[2] as Record<string, unknown>;
    expect(extra.keyPrefix).toBe('gen-all');
    // The raw user id must never reach Sentry.
    expect(JSON.stringify(extra)).not.toContain('user-secret-id');
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
