import * as Sentry from '@sentry/nextjs';

/**
 * Next.js Instrumentation Hook
 *
 * Called once when the Next.js server starts. Used for one-time setup
 * like environment validation, Sentry initialization, and monitoring.
 *
 * @see https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */
export async function register() {
  // Sentry server/edge SDK initialization
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('../sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('../sentry.edge.config');
  }

  const { validateEnvironment } = await import('@/lib/config/validateEnv');
  const result = validateEnvironment();

  if (!result.valid) {
    if (process.env.NODE_ENV === 'production' && !process.env.SKIP_ENV_VALIDATION) {
      throw new Error(
        `Server startup aborted: missing required environment variables: ${result.missing.join(', ')}`
      );
    }
  }
}

// Captures server-side errors from Server Components, middleware, and proxies.
// Requires @sentry/nextjs >= 8.28.0 and Next.js >= 15.
export const onRequestError = Sentry.captureRequestError;
