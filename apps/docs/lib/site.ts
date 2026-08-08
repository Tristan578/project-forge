/**
 * Canonical origin for the docs deployment.
 *
 * Both `app/sitemap.ts` and `app/robots.ts` need it, and a robots.txt that
 * advertises a sitemap at a different origin than the sitemap itself declares is
 * silently useless — so the value lives in one place rather than two literals
 * that happen to agree today.
 */
export const DOCS_URL = process.env.NEXT_PUBLIC_DOCS_URL ?? 'https://docs.spawnforge.ai';
