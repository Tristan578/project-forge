/**
 * Vercel project configuration in TypeScript.
 * Replaces vercel.json — Vercel CLI compiles this automatically on build/deploy.
 *
 * "One config file only": vercel.json has been removed.
 * See: https://vercel.com/docs/project-configuration/vercel-ts
 */
import type { VercelConfig } from '@vercel/config/v1';

const isPreview = process.env.VERCEL_ENV === 'preview';

const config: VercelConfig = {
  framework: 'nextjs',
  installCommand: 'cd .. && npm ci && npm run build --workspace=packages/ui',
  buildCommand: 'npm run build',
  outputDirectory: '.next',
  regions: ['iad1'],
  git: {
    deploymentEnabled: false,
  },
  // Crons are disabled on preview deployments to avoid unintended side-effects.
  crons: isPreview
    ? []
    : [
        {
          path: '/api/cron/health-monitor',
          schedule: '*/5 * * * *',
        },
      ],
};

export default config;
