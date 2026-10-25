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
 * Our local `DeploymentConfig` type checks the supported schema subset, so a typo'd property or a
 * wrong-typed value fails `tsc --noEmit` instead of silently misconfiguring
 * the deploy — that's the whole point of this migration (see the issue
 * body). All currently deployed fields are required. The regression suite
 * also pins each value and compiles negative mutations of this config.
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
 * The local type avoids installing @vercel/config's unpatched Zod v3
 * dependency just for editor/typecheck support. See vercel-config.types.ts
 * for the official schema reference and the deliberately limited contract.
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
import type { DeploymentConfig } from './vercel-config.types';

export const config: DeploymentConfig = {
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
