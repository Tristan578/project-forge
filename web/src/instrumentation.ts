import * as Sentry from '@sentry/nextjs';

/**
 * Next.js Instrumentation Hook
 *
 * Called once when the Next.js server starts. Used for one-time setup
 * like environment validation and monitoring initialization.
 *
 * @see https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */
export async function register() {
  const { validateEnvironment } = await import('@/lib/config/validateEnv');
  const result = validateEnvironment();

  if (!result.valid) {
    if (process.env.NODE_ENV === 'production' && !process.env.SKIP_ENV_VALIDATION) {
      throw new Error(
        `Server startup aborted: missing required environment variables: ${result.missing.join(', ')}`
      );
    }
  }

  // Initialize Sentry SDK for the current server runtime.
  // Without these imports, Sentry initialization depends on config file
  // side-effects loading at the right time.
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('../sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('../sentry.edge.config');
  }
}

/**
 * Captures unhandled server-side request errors automatically.
 * Without this export, any unhandled route error is invisible to Sentry.
 *
 * @see https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/#server-side-error-capture
 */
export const onRequestError = Sentry.captureRequestError;
