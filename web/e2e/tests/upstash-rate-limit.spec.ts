import { randomUUID } from 'node:crypto';

import { expect, test } from '@playwright/test';

test.describe('@ui real Upstash rate limit', () => {
  test.skip(
    process.env.E2E_UPSTASH_TEST_REQUIRED !== 'true',
    'CI Upstash secrets are unavailable for untrusted pull requests'
  );

  test('uses the distributed limiter and rejects the third request', async ({ request }) => {
    const key = `${process.env.GITHUB_RUN_ID ?? 'local'}-${randomUUID()}`;
    const headers = { 'x-e2e-rate-limit-key': key };

    const first = await request.get('/api/test/upstash-rate-limit', { headers });
    const second = await request.get('/api/test/upstash-rate-limit', { headers });
    const third = await request.get('/api/test/upstash-rate-limit', { headers });

    expect(first.status()).toBe(200);
    expect(second.status()).toBe(200);
    expect(third.status()).toBe(429);
    await expect(third.json()).resolves.toMatchObject({ error: expect.any(String) });
  });
});
