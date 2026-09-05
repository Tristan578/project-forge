/**
 * The commit stamp every docs page carries in its <head>.
 *
 * `app/layout.tsx` renders `<meta name={DOCS_COMMIT_META_NAME} content=...>`
 * from `VERCEL_GIT_COMMIT_SHA` — the system variable Vercel sets on a
 * deployment that carries git metadata, which `vercel deploy` from the CI
 * checkout does (the web app's `/api/health` reports the same variable and
 * `cd.yml` already asserts it there).
 *
 * WHY THE PAGE NAMES ITS OWN COMMIT
 *
 * `scripts/post-deploy-docs-check.sh` probes the production ALIAS after every
 * docs deploy. The alias can keep serving the PREVIOUS healthy build — alias
 * assignment lag, or a `--prod` deploy whose domain set did not include
 * docs.spawnforge.ai — and a gate that only reads content goes green against
 * the old artifact: "a healthy body proves that SOMETHING is healthy; only the
 * commit proves it is the build this run deployed" (post-deploy-health-check.sh,
 * lessons-learned #1). The gate compares this stamp to `github.sha` and
 * refuses a page that carries another build's, or none.
 *
 * `scripts/__tests__/post-deploy-docs-check.test.sh` extracts
 * `DOCS_COMMIT_META_NAME` from this file and fails when the script greps for a
 * different name. Keep the `export const` line in exactly this shape.
 */
export const DOCS_COMMIT_META_NAME = 'spawnforge-docs-commit';

/**
 * What the stamp says when the build had no SHA (local `next dev`, a build
 * without git metadata). Deliberately not hex: the gate only accepts a hex
 * stamp and refuses a non-hex expected commit, so this can never compare equal
 * to anything a deploy would be asked to expect.
 */
export const UNKNOWN_COMMIT = 'unknown';

/** A git SHA-1, full or abbreviated. Anything else is not rendered into the page. */
const GIT_SHA = /^[0-9a-fA-F]{7,40}$/;

/**
 * The stamp value for an environment: the SHA verbatim when it is one,
 * `UNKNOWN_COMMIT` otherwise. Pure, so the layout's read of `process.env` and
 * the value it produces can be tested separately.
 */
export function commitStampOf(env: Readonly<Record<string, string | undefined>>): string {
  const sha = env.VERCEL_GIT_COMMIT_SHA?.trim() ?? '';
  return GIT_SHA.test(sha) ? sha : UNKNOWN_COMMIT;
}
