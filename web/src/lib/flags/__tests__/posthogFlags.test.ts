import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Tests for the safe-subset PostHog local-evaluation flags module
 * (PF-971 / #8952).
 *
 * Guarantees locked in:
 *   1. DORMANT unless both POSTHOG_PERSONAL_API_KEY and NEXT_PUBLIC_POSTHOG_KEY
 *      are set — zero fetches, caller default returned.
 *   2. Simple flags (100%/0% rollout, no filters) evaluate correctly.
 *   3. Targeting outside the safe subset falls back to the default with
 *      exactly one warn-level log per flag key.
 *   4. A poll failure keeps the last-known-good cached values.
 *   5. A malformed JSON response fails open (defaults, never throws).
 */

const captureException = vi.fn();
vi.mock('@/lib/monitoring/sentry-server', () => ({
  captureException: (...args: unknown[]) => captureException(...args),
}));

import { getBooleanFlag, isFlagEvaluationEnabled, primeFlagsCache } from '../posthogFlags';

const ORIGINAL_ENV = { ...process.env };

function enable() {
  process.env.POSTHOG_PERSONAL_API_KEY = 'phx_personal_test';
  process.env.NEXT_PUBLIC_POSTHOG_KEY = 'phc_test_key';
}

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status }));
}

function flagsPayload(flags: unknown[]) {
  return { flags };
}

let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.POSTHOG_PERSONAL_API_KEY;
  delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
  vi.stubGlobal('fetch', vi.fn(() => jsonResponse({ flags: [] })));
  consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.unstubAllGlobals();
  consoleWarnSpy.mockRestore();
});

describe('isFlagEvaluationEnabled', () => {
  it('is false when both env vars are unset', () => {
    expect(isFlagEvaluationEnabled()).toBe(false);
  });

  it('is false when only the personal key is set', () => {
    process.env.POSTHOG_PERSONAL_API_KEY = 'phx_personal_test';
    expect(isFlagEvaluationEnabled()).toBe(false);
  });

  it('is false when only the project key is set', () => {
    process.env.NEXT_PUBLIC_POSTHOG_KEY = 'phc_test_key';
    expect(isFlagEvaluationEnabled()).toBe(false);
  });

  it('is true when both are set', () => {
    enable();
    expect(isFlagEvaluationEnabled()).toBe(true);
  });
});

describe('getBooleanFlag — dormant (env absent)', () => {
  it('returns the caller default and fires zero fetches', () => {
    expect(getBooleanFlag('deep-generation-tier', true)).toBe(true);
    expect(getBooleanFlag('deep-generation-tier', false)).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('primeFlagsCache + getBooleanFlag — simple flags', () => {
  beforeEach(enable);

  it('evaluates an active flag with full rollout and no filters as true', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        jsonResponse(
          flagsPayload([
            { key: 'provider-kill-openai', active: true, filters: { groups: [{ properties: [], rollout_percentage: 100 }] } },
          ]),
        ),
      ),
    );
    await primeFlagsCache();
    expect(getBooleanFlag('provider-kill-openai', false)).toBe(true);
  });

  it('treats null rollout_percentage as full rollout (true)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        jsonResponse(
          flagsPayload([
            { key: 'deep-generation-tier', active: true, filters: { groups: [{ properties: [], rollout_percentage: null }] } },
          ]),
        ),
      ),
    );
    await primeFlagsCache();
    expect(getBooleanFlag('deep-generation-tier', false)).toBe(true);
  });

  it('evaluates a 0% rollout group as false', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        jsonResponse(
          flagsPayload([
            { key: 'provider-kill-replicate', active: true, filters: { groups: [{ properties: [], rollout_percentage: 0 }] } },
          ]),
        ),
      ),
    );
    await primeFlagsCache();
    expect(getBooleanFlag('provider-kill-replicate', true)).toBe(false);
  });

  it('evaluates an inactive flag as false regardless of the caller default', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        jsonResponse(flagsPayload([{ key: 'provider-kill-suno', active: false }])),
      ),
    );
    await primeFlagsCache();
    expect(getBooleanFlag('provider-kill-suno', true)).toBe(false);
  });

  it('returns the caller default for a flag not present in the cache', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse(flagsPayload([]))));
    await primeFlagsCache();
    expect(getBooleanFlag('unknown-flag', true)).toBe(true);
  });

  it('matches a single exact-match tier property filter against the context', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        jsonResponse(
          flagsPayload([
            {
              key: 'deep-generation-tier',
              active: true,
              filters: {
                groups: [
                  {
                    properties: [{ key: 'tier', operator: 'exact', value: ['pro', 'studio'] }],
                    rollout_percentage: null,
                  },
                ],
              },
            },
          ]),
        ),
      ),
    );
    await primeFlagsCache();
    expect(getBooleanFlag('deep-generation-tier', false, { tier: 'pro' })).toBe(true);
    // fallback=true + expected=false proves the evaluator COMPUTED the
    // mismatch (expected.includes(tier) === false) rather than taking the
    // unsupported-targeting fallback branch — with fallback=false the two
    // are indistinguishable. The fallback path also warns; a computed
    // mismatch must not.
    expect(getBooleanFlag('deep-generation-tier', true, { tier: 'free' })).toBe(false);
    expect(consoleWarnSpy).not.toHaveBeenCalled();
  });

  it('falls back to default when a tier property filter has no context supplied', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        jsonResponse(
          flagsPayload([
            {
              key: 'deep-generation-tier-no-context',
              active: true,
              filters: {
                groups: [{ properties: [{ key: 'tier', operator: 'exact', value: 'pro' }], rollout_percentage: null }],
              },
            },
          ]),
        ),
      ),
    );
    await primeFlagsCache();
    expect(getBooleanFlag('deep-generation-tier-no-context', true)).toBe(true);
    expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
  });
});

// Each case below uses a distinct flag key: `getBooleanFlag`'s "warn once per
// key" dedup is module-level state that persists across tests in this file
// (no reset hook is exposed — nor should there be, in production the whole
// point is to warn once per process lifetime), so reusing a key across tests
// would make every test after the first see zero warnings.
describe('getBooleanFlag — unsupported targeting falls back with one warn', () => {
  beforeEach(enable);

  it('falls back on a partial percentage rollout and warns exactly once per key', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        jsonResponse(
          flagsPayload([
            {
              key: 'deep-generation-tier-partial-rollout',
              active: true,
              filters: { groups: [{ properties: [], rollout_percentage: 50 }] },
            },
          ]),
        ),
      ),
    );
    await primeFlagsCache();
    expect(getBooleanFlag('deep-generation-tier-partial-rollout', false)).toBe(false);
    expect(getBooleanFlag('deep-generation-tier-partial-rollout', false)).toBe(false);
    expect(getBooleanFlag('deep-generation-tier-partial-rollout', true)).toBe(true);
    expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
  });

  it('falls back on multiple filter groups', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        jsonResponse(
          flagsPayload([
            {
              key: 'deep-generation-tier-multigroup',
              active: true,
              filters: {
                groups: [
                  { properties: [], rollout_percentage: 100 },
                  { properties: [], rollout_percentage: 0 },
                ],
              },
            },
          ]),
        ),
      ),
    );
    await primeFlagsCache();
    expect(getBooleanFlag('deep-generation-tier-multigroup', false)).toBe(false);
    expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
  });

  it('falls back on a multivariate flag', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        jsonResponse(
          flagsPayload([
            {
              key: 'deep-generation-tier-multivariate',
              active: true,
              filters: { groups: [{ properties: [], rollout_percentage: 100 }], multivariate: { variants: [] } },
            },
          ]),
        ),
      ),
    );
    await primeFlagsCache();
    expect(getBooleanFlag('deep-generation-tier-multivariate', false)).toBe(false);
    expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
  });

  it('falls back on an unsupported property operator', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        jsonResponse(
          flagsPayload([
            {
              key: 'deep-generation-tier-bad-operator',
              active: true,
              filters: {
                groups: [{ properties: [{ key: 'tier', operator: 'icontains', value: 'pr' }], rollout_percentage: 100 }],
              },
            },
          ]),
        ),
      ),
    );
    await primeFlagsCache();
    expect(getBooleanFlag('deep-generation-tier-bad-operator', false, { tier: 'pro' })).toBe(false);
    expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
  });
});

describe('primeFlagsCache — resilience', () => {
  beforeEach(enable);

  it('keeps the last-known-good cache when a subsequent poll fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        jsonResponse(
          flagsPayload([
            { key: 'provider-kill-openai', active: true, filters: { groups: [{ properties: [], rollout_percentage: 100 }] } },
          ]),
        ),
      ),
    );
    await primeFlagsCache();
    expect(getBooleanFlag('provider-kill-openai', false)).toBe(true);

    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network down'))));
    await primeFlagsCache();

    expect(getBooleanFlag('provider-kill-openai', false)).toBe(true);
    expect(captureException).toHaveBeenCalledTimes(1);
  });

  it('fails open (defaults, no throw) when the JSON body is malformed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('{not valid json', { status: 200 }))),
    );
    await expect(primeFlagsCache()).resolves.toBeUndefined();
    expect(getBooleanFlag('deep-generation-tier', true)).toBe(true);
    expect(captureException).toHaveBeenCalledTimes(1);
  });

  it('fails open when the response is a non-2xx status', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse({ error: 'unauthorized' }, 401)));
    await primeFlagsCache();
    expect(getBooleanFlag('deep-generation-tier', false)).toBe(false);
    expect(captureException).toHaveBeenCalledTimes(1);
  });

  it('primeFlagsCache is a no-op (no fetch) when evaluation is disabled', async () => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.POSTHOG_PERSONAL_API_KEY;
    delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
    await primeFlagsCache();
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('primeFlagsCache — request shape', () => {
  beforeEach(enable);

  it('authenticates with the personal key and passes the project key as a query token', async () => {
    await primeFlagsCache();
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toContain('https://us.i.posthog.com/api/feature_flag/local_evaluation?token=');
    expect(url).toContain('phc_test_key');
    expect(init.headers.Authorization).toBe('Bearer phx_personal_test');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});

// KEEP THIS DESCRIBE LAST. It manipulates the module-level cache timestamp via
// fake timers; every pending refresh is resolved + flushed before each test
// ends, but ordering it last keeps any residue away from the suites above.
describe('getBooleanFlag — stale-cache background refresh', () => {
  beforeEach(() => {
    enable();
    // Fakes Date.now too, so cache.fetchedAt staleness is fully controlled.
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Response.json() inside the refresh settles over several microtask ticks;
  // flush them all so refreshInFlight clears before the test returns.
  async function flushMicrotasks() {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  }

  it('serves a fresh cache without refetching, then refreshes once the TTL passes', async () => {
    await primeFlagsCache();
    expect(fetch).toHaveBeenCalledTimes(1);

    // Fresh (age 0 < 30s TTL): no background refresh scheduled.
    getBooleanFlag('deep-generation-tier', false);
    expect(fetch).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(31_000);

    // Stale: the background refresh's async body runs synchronously up to its
    // first await, so the fetch fires before getBooleanFlag returns — and the
    // caller still gets an immediate (cached) answer, never a blocked one.
    getBooleanFlag('deep-generation-tier', false);
    expect(fetch).toHaveBeenCalledTimes(2);

    await flushMicrotasks();
  });

  it('dedups concurrent stale reads onto one in-flight refresh, then allows the next', async () => {
    // 120s (not 31s): each useFakeTimers() restarts the fake clock at real
    // now, so the previous test's advanced fetchedAt can sit up to ~31s in
    // this clock's "future" — a 31s advance would not reach staleness.
    let resolveFirst!: (r: Response) => void;
    let resolveSecond!: (r: Response) => void;
    const pending = [
      new Promise<Response>((res) => { resolveFirst = res; }),
      new Promise<Response>((res) => { resolveSecond = res; }),
    ];
    let call = 0;
    vi.stubGlobal('fetch', vi.fn(() => pending[call++]));

    vi.advanceTimersByTime(120_000);

    getBooleanFlag('deep-generation-tier', false);
    getBooleanFlag('deep-generation-tier', false);
    // Second stale read must ride the in-flight refresh, not stack a request.
    expect(fetch).toHaveBeenCalledTimes(1);

    resolveFirst(new Response(JSON.stringify({ flags: [] }), { status: 200 }));
    await flushMicrotasks();

    // refreshInFlight cleared: the next staleness triggers a NEW refresh.
    vi.advanceTimersByTime(120_000);
    getBooleanFlag('deep-generation-tier', false);
    expect(fetch).toHaveBeenCalledTimes(2);

    resolveSecond(new Response(JSON.stringify({ flags: [] }), { status: 200 }));
    await flushMicrotasks();
  });
});
