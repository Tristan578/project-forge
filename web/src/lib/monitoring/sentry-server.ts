import * as Sentry from '@sentry/nextjs';

const DSN = process.env.SENTRY_DSN;
const IS_PROD = process.env.NODE_ENV === 'production';

let initialized = false;

function ensureInit(): void {
  if (initialized || !DSN) return;
  initialized = true;

  Sentry.init({
    dsn: DSN,
    environment: process.env.NODE_ENV ?? 'development',
    release: process.env.VERCEL_GIT_COMMIT_SHA ?? 'local',
    tracesSampleRate: IS_PROD ? 0.1 : 1.0,
  });
}

/**
 * Report an exception to Sentry (server-side).
 * No-ops silently when SENTRY_DSN is not configured.
 */
export function captureException(
  error: unknown,
  context?: Record<string, unknown>,
): void {
  if (!DSN) return;
  ensureInit();
  Sentry.captureException(error, context ? { extra: context } : undefined);
}

/**
 * Send a message to Sentry (server-side).
 * No-ops silently when SENTRY_DSN is not configured.
 */
export function captureMessage(
  message: string,
  level: 'info' | 'warning' | 'error' = 'info',
): void {
  if (!DSN) return;
  ensureInit();
  Sentry.captureMessage(message, level);
}

/**
 * Start a performance span (server-side).
 * When Sentry is not configured, the callback is still executed and its
 * return value is forwarded to the caller.
 */
export function startSpan<T>(
  options: { name: string; op?: string },
  callback: () => T,
): T {
  if (!DSN) return callback();
  ensureInit();
  return Sentry.startSpan(options, callback);
}
