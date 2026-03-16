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
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        `Server startup aborted: missing required environment variables: ${result.missing.join(', ')}`
      );
    }
  }
}
