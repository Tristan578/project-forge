/**
 * /sign-in, /sign-up and /docs are listed in the sitemap but declared no
 * canonical, while every other sitemap page does. Production serves the same
 * page on both spawnforge.ai and www.spawnforge.ai, so Search Console reported
 * these as "Duplicate without user-selected canonical". Each one must name its
 * own path; the root layout's metadataBase (SITE_URL) makes it absolute.
 *
 * @vitest-environment node
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('../sign-in/[[...sign-in]]/SignInClient', () => ({ SignInClient: () => null }));
vi.mock('../sign-up/[[...sign-up]]/SignUpClient', () => ({ SignUpClient: () => null }));
vi.mock('@/components/docs/DocsPage', () => ({ DocsPage: () => null }));
vi.mock('next/cache', () => ({ cacheLife: vi.fn(), cacheTag: vi.fn() }));

describe('canonical on auth and docs pages', () => {
  it.each([
    ['/sign-in', () => import('../sign-in/[[...sign-in]]/page')],
    ['/sign-up', () => import('../sign-up/[[...sign-up]]/page')],
    ['/docs', () => import('../docs/page')],
  ])('%s declares itself as canonical', async (path, load) => {
    const { metadata } = await load();
    expect(metadata.alternates?.canonical).toBe(path);
  });
});
