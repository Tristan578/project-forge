import * as Sentry from '@sentry/browser';

const DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;
const IS_PROD = process.env.NODE_ENV === 'production';

let initialized = false;

/**
 * Initialize the Sentry browser SDK.
 * Called once from the SentryProvider component on mount.
 * No-ops when NEXT_PUBLIC_SENTRY_DSN is not set.
 */
export function initSentryClient(): void {
  if (initialized || !DSN) return;
  initialized = true;

  Sentry.init({
    dsn: DSN,
    environment: process.env.NODE_ENV ?? 'development',
    release: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ?? 'local',
    tracesSampleRate: IS_PROD ? 0.1 : 1.0,

    // Use the tunnel to bypass ad-blockers when available
    tunnel: '/api/sentry',

    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration({ maskAllText: false, blockAllMedia: false }),
    ],

    // Capture 10% of sessions for Replay in prod, 100% in dev
    replaysSessionSampleRate: IS_PROD ? 0.1 : 1.0,
    replaysOnErrorSampleRate: 1.0,
  });
}

/**
 * Report an exception to Sentry (client-side).
 * No-ops silently when NEXT_PUBLIC_SENTRY_DSN is not configured.
 */
export function captureException(
  error: unknown,
  context?: Record<string, unknown>,
): void {
  if (!DSN) return;
  Sentry.captureException(error, context ? { extra: context } : undefined);
}

/**
 * Send a message to Sentry (client-side).
 * No-ops silently when NEXT_PUBLIC_SENTRY_DSN is not configured.
 */
export function captureMessage(
  message: string,
  level: 'info' | 'warning' | 'error' = 'info',
): void {
  if (!DSN) return;
  Sentry.captureMessage(message, level);
}

/**
 * Start a performance span (client-side).
 * When Sentry is not configured, the callback is still executed and its
 * return value is forwarded to the caller.
 */
export function startSpan<T>(
  options: { name: string; op?: string },
  callback: () => T,
): T {
  if (!DSN) return callback();
  return Sentry.startSpan(options, callback);
}
