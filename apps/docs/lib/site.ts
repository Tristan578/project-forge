/**
 * Canonical origin for the docs deployment.
 *
 * Three files need it: `app/robots.ts`, `app/sitemap.ts` and the `metadataBase`
 * in `app/layout.tsx` that resolves every canonical and OpenGraph URL. A
 * robots.txt advertising a sitemap at one origin while the sitemap declares
 * another — or while canonical tags point at a third — is silently useless to a
 * crawler, and nothing errors. So the value lives in one place rather than in
 * literals that happen to agree today.
 */
export const DOCS_URL = process.env.NEXT_PUBLIC_DOCS_URL ?? 'https://docs.spawnforge.ai';
