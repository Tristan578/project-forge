/**
 * Environment detection utilities.
 *
 * Uses NEXT_PUBLIC_ENVIRONMENT when set (staging/production), falls back to
 * NODE_ENV. Vercel automatically provides deployment metadata variables.
 */

export const environment = {
  /** Current environment name */
  name: (process.env.NEXT_PUBLIC_ENVIRONMENT ?? process.env.NODE_ENV ?? 'development') as
    | 'development'
    | 'staging'
    | 'production',

  /** True in local development */
  isDev: process.env.NODE_ENV === 'development',

  /** True on the production deployment */
  isProduction:
    (process.env.NEXT_PUBLIC_ENVIRONMENT ?? process.env.NODE_ENV) === 'production',

  /** True on the staging deployment */
  isStaging: process.env.NEXT_PUBLIC_ENVIRONMENT === 'staging',

  /** Git commit SHA (short) — auto-filled by Vercel */
  commit: (process.env.VERCEL_GIT_COMMIT_SHA ?? 'local').slice(0, 8),

  /** Git branch — auto-filled by Vercel */
  branch: process.env.VERCEL_GIT_COMMIT_REF ?? 'unknown',

  /** Vercel deployment URL — auto-filled by Vercel */
  deploymentUrl: process.env.VERCEL_URL ?? 'localhost:3000',
} as const;

/**
 * Validates that required environment variables are set.
 * Delegates to the centralized validator in `lib/config/validateEnv.ts`.
 *
 * @deprecated Import from `@/lib/config/validateEnv` directly.
 */
export { validateEnvironment } from '@/lib/config/validateEnv';
