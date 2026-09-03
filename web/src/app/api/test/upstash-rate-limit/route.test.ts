import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { distributedRateLimit } = vi.hoisted(() => ({ distributedRateLimit: vi.fn() }));

vi.mock('@/lib/rateLimit/distributed', () => ({ distributedRateLimit }));

import { GET } from './route';

function request(key = 'ci-integration-key-1234'): NextRequest {
  return new NextRequest('http://localhost/api/test/upstash-rate-limit', {
    headers: { 'x-e2e-rate-limit-key': key },
  });
}

describe('GET /api/test/upstash-rate-limit', () => {
  beforeEach(() => {
    process.env.E2E_UPSTASH_TEST_ENABLED = 'true';
  });

  afterEach(() => {
    delete process.env.E2E_UPSTASH_TEST_ENABLED;
    vi.clearAllMocks();
  });

  it('is unavailable unless the CI-only build flag is enabled', async () => {
    delete process.env.E2E_UPSTASH_TEST_ENABLED;

    expect((await GET(request())).status).toBe(404);
    expect(distributedRateLimit).not.toHaveBeenCalled();
  });

  it('uses strict distributed limiting and returns 429 on the third request', async () => {
    distributedRateLimit
      .mockResolvedValueOnce({ allowed: true, remaining: 1, resetAt: Date.now() + 300_000 })
      .mockResolvedValueOnce({ allowed: true, remaining: 0, resetAt: Date.now() + 300_000 })
      .mockResolvedValueOnce({ allowed: false, remaining: 0, resetAt: Date.now() + 300_000 });

    const probe = request();
    expect((await GET(probe)).status).toBe(200);
    expect((await GET(probe)).status).toBe(200);
    expect((await GET(probe)).status).toBe(429);
    expect(distributedRateLimit).toHaveBeenCalledWith(
      'ci-integration:ci-integration-key-1234',
      2,
      300,
      { fallbackOnError: false }
    );
  });

  it('returns 503 instead of silently using memory when Upstash fails', async () => {
    distributedRateLimit.mockRejectedValue(new Error('bad credential'));

    const response = await GET(request());

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'CI Upstash integration unavailable' });
  });
});
