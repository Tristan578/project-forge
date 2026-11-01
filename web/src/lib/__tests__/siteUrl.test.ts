/**
 * Production serves www.spawnforge.ai and redirects the apex host to it, so
 * the SITE_URL fallback must be the www origin. An apex fallback makes every
 * canonical, sitemap entry and robots Host point at a redirecting URL, which
 * Search Console reports as "Alternate page" or "Duplicate without
 * user-selected canonical".
 *
 * @vitest-environment node
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('SITE_URL', () => {
  it('falls back to the www origin when NEXT_PUBLIC_SITE_URL is unset', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', undefined);
    vi.resetModules();
    const { SITE_URL } = await import('../constants');
    expect(SITE_URL).toBe('https://www.spawnforge.ai');
  });

  it('uses NEXT_PUBLIC_SITE_URL when it is set', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://preview.example.com');
    vi.resetModules();
    const { SITE_URL } = await import('../constants');
    expect(SITE_URL).toBe('https://preview.example.com');
  });
});
