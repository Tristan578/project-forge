/**
 * Typed replacement for the former `vercel.json` (PF-1060 / #9097).
 *
 * Vercel only reads ONE project configuration file — `vercel.ts` or
 * `vercel.json`, never both (see "Requirements" in
 * https://vercel.com/docs/project-configuration/vercel-ts). This file's
 * `config` export must therefore carry every property the old
 * `vercel.json` declared, verbatim, or the platform silently falls back to
 * defaults for whatever is missing.
 *
 * `@vercel/config/v1` gives us `VercelConfig`, so a typo'd property or a
 * wrong-typed value fails `tsc --noEmit` instead of silently misconfiguring
 * the deploy — that's the whole point of this migration (see the issue
 * body). A REMOVED property still type-checks, because every `VercelConfig`
 * field is optional; `scripts/__tests__/vercelConfig.test.ts` is what
 * catches a removal, by pinning each value.
 *
 * IMPORTS MUST STAY TYPE-ONLY. This file can be evaluated BEFORE any
 * install: `vercel deploy` in `.github/workflows/cd.yml` compiles it on the
 * GitHub runner (Vercel CLI `compileVercelConfig`: esbuild with
 * `packages: "external"`, then a forked `node` import), and the
 * `deploy-staging` job runs no `npm ci` before that step; a remote build
 * likewise has to read it to learn the very `installCommand` it declares.
 * `import type` is erased by esbuild and costs nothing; a VALUE import — e.g.
 * the `routes` helpers from `@vercel/config/v1` — fails every deploy with
 * "Cannot find package '@vercel/config'". `vercelConfig.test.ts` pins this.
 *
 * `@vercel/config` is a devDependency on purpose: it is only ever needed for
 * `tsc --noEmit` and editor types, never at evaluation time. Keeping it out
 * of `dependencies` keeps its transitive `@vercel/routing-utils` (which pins
 * an exact, advisory-bearing `path-to-regexp@6.1.0`) off the production
 * dependency graph; the root `package.json` `overrides` entry
 * `"path-to-regexp@6.1.0": "6.3.0"` retires that nested copy to the patched
 * 6.x line (GHSA-9wv6-86v2-598j). npm propagates overrides along dependency
 * edges and never through workspace links, so the same `@vercel/config`
 * range is ALSO declared in the root `package.json` devDependencies purely
 * to carry that override into the subtree — keep both declarations on the
 * same range.
 *
 * Preserved values and why each one is load-bearing:
 * - `installCommand` reaches ABOVE the deploy root (`cd ..`) because of the
 *   single-root lockfile (`package-lock.json` lives at the repo root, not
 *   `web/`). Do not "simplify" this to a plain `npm ci` — that breaks every
 *   build. See the root CLAUDE.md gotcha on the generated-artifact sync
 *   gates (the single-root lockfile is the first of them).
 * - `git.deploymentEnabled: false` disables Vercel's own git-push deploys.
 *   Deploys are driven by `.github/workflows/cd.yml` instead. Losing this
 *   starts double-deploying every push to `main`.
 * - `regions: ['iad1']` and the `health-monitor` cron path/schedule must
 *   match the values already live in Vercel's dashboard for this project;
 *   changing them here changes production behavior, not just this file.
 */
import type { VercelConfig } from '@vercel/config/v1';

export const config: VercelConfig = {
  framework: 'nextjs',
  installCommand: 'cd .. && npm ci && npm run build --workspace=packages/ui',
  buildCommand: 'npm run build',
  outputDirectory: '.next',
  regions: ['iad1'],
  git: {
    deploymentEnabled: false,
  },
  crons: [
    {
      path: '/api/cron/health-monitor',
      schedule: '*/15 * * * *',
    },
  ],
};
