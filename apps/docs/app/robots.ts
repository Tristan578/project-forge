import type { MetadataRoute } from 'next';
import { DOCS_URL } from '../lib/site';

/**
 * The docs deployment is Clerk-gated by default (`proxy.ts`), so only `/` and
 * the `/mcp` command reference are reachable without a session. Everything else
 * answers a crawler with a sign-in redirect, which is a crawl budget spent on
 * nothing — say so explicitly rather than leaving the policy undeclared.
 *
 * Entries are written WITHOUT a trailing slash: a `Disallow` value is a prefix
 * match, so `/sign-in/` would not match the canonical `/sign-in`.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/', '/mcp'],
        disallow: ['/sign-in', '/sign-up', '/api'],
      },
    ],
    sitemap: `${DOCS_URL}/sitemap.xml`,
  };
}
