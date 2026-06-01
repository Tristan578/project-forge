import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('server-only', () => ({}));

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockLimit = vi.fn();

vi.mock('@upstash/redis', () => ({
  Redis: vi.fn(function () { return {}; }),
}));

vi.mock('@upstash/ratelimit', () => ({
  Ratelimit: Object.assign(
    vi.fn(function () { return { limit: mockLimit }; }),
    { slidingWindow: vi.fn(function () { return 'sliding-window-config'; }) },
  ),
}));

vi.mock('@/lib/monitoring/sampledCapture', () => ({
  sampledCaptureException: vi.fn(),
}));

import { sampledCaptureException } from '@/lib/monitoring/sampledCapture';
import {
  checkDbRateLimit,
  DbRateLimitError,
  _resetDbRateLimiter,
} from '../dbRateLimit';

const mockSampledCapture = vi.mocked(sampledCaptureException);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DbRateLimitError', () => {
  it('has correct name and message', () => {
    const err = new DbRateLimitError();
    expect(err.name).toBe('DbRateLimitError');
    expect(err.message).toContain('rate limit exceeded');
  });
});

describe('checkDbRateLimit — no Upstash', () => {
  const savedUrl = process.env.UPSTASH_REDIS_REST_URL;
  const savedToken = process.env.UPSTASH_REDIS_REST_TOKEN;

  beforeEach(() => {
    _resetDbRateLimiter();
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
  });

  afterEach(() => {
    if (savedUrl) process.env.UPSTASH_REDIS_REST_URL = savedUrl;
    else delete process.env.UPSTASH_REDIS_REST_URL;
    if (savedToken) process.env.UPSTASH_REDIS_REST_TOKEN = savedToken;
    else delete process.env.UPSTASH_REDIS_REST_TOKEN;
  });

  it('is a no-op when Upstash is not configured', async () => {
    await expect(checkDbRateLimit()).resolves.toBeUndefined();
    expect(mockLimit).not.toHaveBeenCalled();
  });
});

describe('checkDbRateLimit — with Upstash', () => {
  const savedUrl = process.env.UPSTASH_REDIS_REST_URL;
  const savedToken = process.env.UPSTASH_REDIS_REST_TOKEN;

  beforeEach(() => {
    mockLimit.mockReset();
    mockSampledCapture.mockClear();
    _resetDbRateLimiter();
    process.env.UPSTASH_REDIS_REST_URL = 'https://fake.upstash.io';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'fake-token';
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    if (savedUrl) process.env.UPSTASH_REDIS_REST_URL = savedUrl;
    else delete process.env.UPSTASH_REDIS_REST_URL;
    if (savedToken) process.env.UPSTASH_REDIS_REST_TOKEN = savedToken;
    else delete process.env.UPSTASH_REDIS_REST_TOKEN;
  });

  it('allows requests when under the limit', async () => {
    mockLimit.mockResolvedValue({ success: true, remaining: 50, reset: Date.now() + 1000 });
    await expect(checkDbRateLimit()).resolves.toBeUndefined();
    expect(mockLimit).toHaveBeenCalledTimes(1);
  });

  it('uses global-db-ops as the rate limit key', async () => {
    mockLimit.mockResolvedValue({ success: true, remaining: 79, reset: Date.now() + 1000 });
    await checkDbRateLimit();
    expect(mockLimit).toHaveBeenCalledWith('global-db-ops');
  });

  it('retries once after 100ms when rate limited, then allows', async () => {
    mockLimit
      .mockResolvedValueOnce({ success: false, remaining: 0, reset: Date.now() + 1000 })
      .mockResolvedValueOnce({ success: true, remaining: 1, reset: Date.now() + 1000 });

    const promise = checkDbRateLimit();
    await vi.advanceTimersByTimeAsync(100);
    await expect(promise).resolves.toBeUndefined();
    expect(mockLimit).toHaveBeenCalledTimes(2);
  });

  it('throws DbRateLimitError after retry also fails', async () => {
    mockLimit.mockResolvedValue({ success: false, remaining: 0, reset: Date.now() + 1000 });
    const promise = checkDbRateLimit();
    // Suppress the unhandled-rejection warning that fires between advanceTimersByTimeAsync
    // completing (which resolves the setTimeout and rejects the promise) and our await below.
    void promise.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(100);
    await expect(promise).rejects.toThrow(DbRateLimitError);
    expect(mockLimit).toHaveBeenCalledTimes(2);
  });

  it('does NOT report observability when the limit is legitimately exceeded (PF-840)', async () => {
    // A genuine over-limit is the expected signal, not a fail-open — it must
    // propagate as DbRateLimitError without firing a Sentry alert.
    mockLimit.mockResolvedValue({ success: false, remaining: 0, reset: Date.now() + 1000 });
    const promise = checkDbRateLimit();
    void promise.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(100);
    await expect(promise).rejects.toThrow(DbRateLimitError);
    expect(mockSampledCapture).not.toHaveBeenCalled();
  });

  it('reports the fail-open via sampled captureException when Upstash throws, then allows the query (PF-840)', async () => {
    const err = new Error('Network error');
    mockLimit.mockRejectedValue(err);

    // Still fails open (query allowed through) ...
    await expect(checkDbRateLimit()).resolves.toBeUndefined();

    // ... but the silent bypass is now observable.
    expect(mockSampledCapture).toHaveBeenCalledTimes(1);
    expect(mockSampledCapture).toHaveBeenCalledWith(
      'checkDbRateLimit.failOpen',
      err,
    );
  });
});
