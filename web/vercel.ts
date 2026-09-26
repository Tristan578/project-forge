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
 * `@vercel/config/v1` gives us `VercelConfig`, so a typo'd or removed
 * property fails `tsc --noEmit` instead of silently misconfiguring the
 * deploy — that's the whole point of this migration (see the issue body).
 *
 * Preserved values and why each one is load-bearing:
 * - `installCommand` reaches ABOVE the deploy root (`cd ..`) because of the
 *   single-root lockfile (`package-lock.json` lives at the repo root, not
 *   `web/`). Do not "simplify" this to a plain `npm ci` — that breaks every
 *   build. See root CLAUDE.md gotchas -> "Three generated-artifact sync
 *   gates".
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
