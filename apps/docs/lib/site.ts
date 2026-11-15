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
export const DEFAULT_DOCS_URL = 'https://docs.spawnforge.ai';

/**
 * Resolve the docs origin from `NEXT_PUBLIC_DOCS_URL`, falling back to the
 * canonical default when the variable is unset or not an absolute URL.
 *
 * Every consumer parses this value at module scope — `proxy.ts` for Clerk's
 * `authorizedParties`, `app/layout.tsx` for `metadataBase` — so a malformed
 * value (a bare host with no scheme, say) used to throw from `new URL()` while
 * the module loaded and take the whole site down before it served a request.
 * A misconfigured env var is a deploy mistake worth a loud log line, not an
 * outage. A valid value is returned unchanged so callers that concatenate
 * paths onto it (`robots.ts`, `sitemap.ts`) never pick up a trailing slash.
 */
export function resolveDocsUrl(raw: string | undefined): string {
  if (raw === undefined) return DEFAULT_DOCS_URL;
  try {
    new URL(raw);
    return raw;
  } catch {
    console.error(
      `[docs] NEXT_PUBLIC_DOCS_URL ${JSON.stringify(raw)} is not an absolute URL; using ${DEFAULT_DOCS_URL}`,
    );
    return DEFAULT_DOCS_URL;
  }
}

export const DOCS_URL = resolveDocsUrl(process.env.NEXT_PUBLIC_DOCS_URL);
