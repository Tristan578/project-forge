/**
 * @vitest-environment node
 *
 * The root layout stamps the deployed commit into every page's <head> as
 * `<meta name="spawnforge-docs-commit" content="<sha>">`, read from
 * `VERCEL_GIT_COMMIT_SHA` — the system variable Vercel sets on a deployment
 * that carries git metadata, which a `vercel deploy` from the CI checkout does.
 *
 * WHY
 *
 * `scripts/post-deploy-docs-check.sh` probes the production ALIAS, and the
 * alias can keep serving the previous healthy build (assignment lag, or a
 * deploy whose domain set did not include docs.spawnforge.ai). A content-only
 * gate goes green against the old artifact — the same adjacent-property
 * failure as lesson 1, which `post-deploy-health-check.sh` closed for the web
 * app with its `commit` field. This stamp is the docs site's equivalent, and
 * this test proves the layout actually reads the variable rather than a
 * constant that happens to look right today.
 *
 * The layout's `metadata` is evaluated at module load, so each case resets the
 * module registry and imports the layout fresh under a stubbed environment.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

import { DOCS_COMMIT_META_NAME, UNKNOWN_COMMIT } from '../../lib/commit';

async function stampUnder(sha: string | undefined): Promise<unknown> {
  vi.resetModules();
  if (sha === undefined) {
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', '');
    delete process.env.VERCEL_GIT_COMMIT_SHA;
  } else {
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', sha);
  }
  const { metadata } = await import('../layout');
  const other = metadata.other as Record<string, unknown> | undefined;
  return other?.[DOCS_COMMIT_META_NAME];
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('root layout commit stamp', () => {
  it('renders VERCEL_GIT_COMMIT_SHA under the meta name the deploy gate greps for', async () => {
    const sha = 'abcdef1234567890abcdef1234567890abcdef12';
    expect(await stampUnder(sha)).toBe(sha);
  });

  it('renders the unknown marker, not nothing, when the variable is absent', async () => {
    // A page with no tag at all is indistinguishable from a page whose layout
    // forgot the stamp; the marker says "this build had no SHA" explicitly.
    expect(await stampUnder(undefined)).toBe(UNKNOWN_COMMIT);
  });
});
