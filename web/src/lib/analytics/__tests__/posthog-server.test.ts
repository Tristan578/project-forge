import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Tests for the dormant-by-default, content-free server LLM capture
 * (`$ai_generation`) helper — PF-907 / #8817.
 *
 * The three guarantees this suite locks in:
 *   1. DORMANT unless `POSTHOG_LLM_CAPTURE === 'true'` AND a project key is set.
 *   2. CONSENT-gated (PF-30) — no event without explicit consent.
 *   3. PRIVATE — the payload NEVER carries `$ai_input` / `$ai_output_choices`
 *      (the only `$ai_*` props that hold prompt/response content).
 */

vi.mock('server-only', () => ({}));

const captureException = vi.fn();
vi.mock('@/lib/monitoring/sentry-server', () => ({
  captureException: (...args: unknown[]) => captureException(...args),
}));

// `after()` is captured so the test can drive the post-response callback itself.
// `afterThrows` simulates calling capture outside a request scope.
const afterCallbacks: Array<() => void | Promise<void>> = [];
let afterThrows = false;
vi.mock('next/server', () => ({
  after: (cb: () => void | Promise<void>) => {
    if (afterThrows) throw new Error('after() called outside a request scope');
    afterCallbacks.push(cb);
  },
}));

// `cookies()` double — value and throw behavior controlled per test.
let cookieValue: string | undefined;
let cookiesThrows = false;
vi.mock('next/headers', () => ({
  cookies: async () => {
    if (cookiesThrows) throw new Error('cookies() called outside a request scope');
    return {
      get: (name: string) =>
        name === 'forge-cookie-consent' && cookieValue !== undefined
          ? { value: cookieValue }
          : undefined,
    };
  },
}));

import {
  buildAiGenerationPayload,
  captureAiGeneration,
  hasAnalyticsConsent,
  isLlmCaptureEnabled,
  type AiGenerationInput,
} from '../posthog-server';

const VALID: AiGenerationInput = {
  distinctId: 'user-123',
  consented: true,
  traceId: 'trace-abc',
  model: 'claude-haiku-4-5',
  provider: 'anthropic',
  inputTokens: 100,
  outputTokens: 50,
  latencySeconds: 1.25,
  stream: false,
  isError: false,
  route: '/api/generate/localize',
};

const ORIGINAL_ENV = { ...process.env };

function enable() {
  process.env.POSTHOG_LLM_CAPTURE = 'true';
  process.env.NEXT_PUBLIC_POSTHOG_KEY = 'phc_test_key';
}

beforeEach(() => {
  vi.clearAllMocks();
  afterCallbacks.length = 0;
  afterThrows = false;
  cookieValue = undefined;
  cookiesThrows = false;
  delete process.env.POSTHOG_LLM_CAPTURE;
  delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(null, { status: 200 }))));
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.unstubAllGlobals();
});

describe('isLlmCaptureEnabled', () => {
  it('is false when the flag is unset', () => {
    process.env.NEXT_PUBLIC_POSTHOG_KEY = 'phc_test_key';
    expect(isLlmCaptureEnabled()).toBe(false);
  });

  it('is false when the flag is set but the key is absent', () => {
    process.env.POSTHOG_LLM_CAPTURE = 'true';
    expect(isLlmCaptureEnabled()).toBe(false);
  });

  it('is false when the flag is any value other than the exact string "true"', () => {
    process.env.NEXT_PUBLIC_POSTHOG_KEY = 'phc_test_key';
    process.env.POSTHOG_LLM_CAPTURE = '1';
    expect(isLlmCaptureEnabled()).toBe(false);
  });

  it('is true only when both the flag is "true" and a key is present', () => {
    enable();
    expect(isLlmCaptureEnabled()).toBe(true);
  });
});

describe('buildAiGenerationPayload — dormancy & consent', () => {
  it('returns null when capture is disabled (flag unset)', () => {
    expect(buildAiGenerationPayload(VALID)).toBeNull();
  });

  it('returns null when the key is absent even with the flag set', () => {
    process.env.POSTHOG_LLM_CAPTURE = 'true';
    expect(buildAiGenerationPayload(VALID)).toBeNull();
  });

  it('returns null when the user has not consented', () => {
    enable();
    expect(buildAiGenerationPayload({ ...VALID, consented: false })).toBeNull();
  });
});

describe('buildAiGenerationPayload — shape (enabled + consented)', () => {
  beforeEach(enable);

  it('builds a $ai_generation event with the correct envelope', () => {
    const payload = buildAiGenerationPayload(VALID)!;
    expect(payload).not.toBeNull();
    expect(payload.event).toBe('$ai_generation');
    expect(payload.distinct_id).toBe('user-123');
    expect(payload.api_key).toBe('phc_test_key');
  });

  it('carries the non-content metric props', () => {
    const props = buildAiGenerationPayload(VALID)!.properties as Record<string, unknown>;
    expect(props.$ai_trace_id).toBe('trace-abc');
    expect(props.$ai_model).toBe('claude-haiku-4-5');
    expect(props.$ai_provider).toBe('anthropic');
    expect(props.$ai_input_tokens).toBe(100);
    expect(props.$ai_output_tokens).toBe(50);
    expect(props.$ai_latency).toBe(1.25);
    expect(props.$ai_is_error).toBe(false);
    expect(props.route).toBe('/api/generate/localize');
  });

  it('NEVER includes content fields ($ai_input / $ai_output_choices)', () => {
    const props = buildAiGenerationPayload(VALID)!.properties as Record<string, unknown>;
    expect('$ai_input' in props).toBe(false);
    expect('$ai_output_choices' in props).toBe(false);
    // Defense in depth: the serialized JSON must not carry either content KEY.
    // Match the quoted-key form so `$ai_input_tokens` (a legit metric whose name
    // starts with `$ai_input`) does not false-positive.
    const serialized = JSON.stringify(buildAiGenerationPayload(VALID));
    expect(serialized).not.toContain('"$ai_input"');
    expect(serialized).not.toContain('"$ai_output_choices"');
  });

  it('omits optional numeric props that are not finite', () => {
    const props = buildAiGenerationPayload({
      ...VALID,
      inputTokens: undefined,
      outputTokens: undefined,
      latencySeconds: undefined,
    })!.properties as Record<string, unknown>;
    expect('$ai_input_tokens' in props).toBe(false);
    expect('$ai_output_tokens' in props).toBe(false);
    expect('$ai_latency' in props).toBe(false);
  });

  it('includes cache token props only when provided', () => {
    const withCache = buildAiGenerationPayload({
      ...VALID,
      cacheReadInputTokens: 80,
      cacheCreationInputTokens: 20,
    })!.properties as Record<string, unknown>;
    expect(withCache.$ai_cache_read_input_tokens).toBe(80);
    expect(withCache.$ai_cache_creation_input_tokens).toBe(20);

    const withoutCache = buildAiGenerationPayload(VALID)!.properties as Record<string, unknown>;
    expect('$ai_cache_read_input_tokens' in withoutCache).toBe(false);
    expect('$ai_cache_creation_input_tokens' in withoutCache).toBe(false);
  });
});

describe('captureAiGeneration', () => {
  it('fires no fetch and registers no callback when dormant', () => {
    captureAiGeneration(VALID); // flag unset
    expect(afterCallbacks).toHaveLength(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('fires no fetch when the user has not consented', () => {
    enable();
    captureAiGeneration({ ...VALID, consented: false });
    expect(afterCallbacks).toHaveLength(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('registers exactly one post-response callback when enabled + consented', () => {
    enable();
    captureAiGeneration(VALID);
    expect(afterCallbacks).toHaveLength(1);
    // The fetch only happens when the post-response callback runs.
    expect(fetch).not.toHaveBeenCalled();
  });

  it('POSTs the event to the PostHog capture endpoint when the callback runs', async () => {
    enable();
    captureAiGeneration(VALID);
    await afterCallbacks[0]();
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('https://us.i.posthog.com/i/v0/e/');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    expect(body.event).toBe('$ai_generation');
    expect(body.distinct_id).toBe('user-123');
  });

  it('never throws when the fetch rejects — reports to Sentry instead', async () => {
    enable();
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network down'))));
    captureAiGeneration(VALID);
    await expect(afterCallbacks[0]()).resolves.toBeUndefined();
    expect(captureException).toHaveBeenCalledTimes(1);
  });

  it('never throws when after() is unavailable (no request scope)', () => {
    enable();
    afterThrows = true;
    expect(() => captureAiGeneration(VALID)).not.toThrow();
    expect(captureException).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('hasAnalyticsConsent', () => {
  it('is true only when the consent cookie is exactly "true"', async () => {
    cookieValue = 'true';
    await expect(hasAnalyticsConsent()).resolves.toBe(true);
  });

  it('is false when the cookie value is "false"', async () => {
    cookieValue = 'false';
    await expect(hasAnalyticsConsent()).resolves.toBe(false);
  });

  it('is false when the consent cookie is absent', async () => {
    cookieValue = undefined;
    await expect(hasAnalyticsConsent()).resolves.toBe(false);
  });

  it('is false (fail-closed) when cookies() throws (no request scope)', async () => {
    cookiesThrows = true;
    await expect(hasAnalyticsConsent()).resolves.toBe(false);
  });
});
