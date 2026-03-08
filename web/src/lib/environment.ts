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
 * Called at app startup to fail fast with clear error messages.
 * Only validates in production/staging — skips in development.
 */
export function validateEnvironment(): { valid: boolean; missing: string[] } {
  if (environment.isDev) {
    return { valid: true, missing: [] };
  }

  const required = [
    'DATABASE_URL',
    'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY',
    'CLERK_SECRET_KEY',
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET',
    'STRIPE_PRICE_STARTER',
    'STRIPE_PRICE_CREATOR',
    'STRIPE_PRICE_STUDIO',
    'ENCRYPTION_MASTER_KEY',
  ];

  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    console.error(
      `[Environment] Missing required environment variables: ${missing.join(', ')}`
    );
  }

  return { valid: missing.length === 0, missing };
}
