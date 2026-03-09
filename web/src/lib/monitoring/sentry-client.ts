import * as Sentry from '@sentry/nextjs';

const DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;

/**
 * Initialize the Sentry browser SDK.
 * With @sentry/nextjs, init happens via sentry.client.config.ts automatically.
 * This function is kept for backward compatibility with SentryProvider.
 */
export function initSentryClient(): void {
  // No-op — @sentry/nextjs initializes from sentry.client.config.ts
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

/**
 * Add a breadcrumb for debugging context.
 * No-ops when NEXT_PUBLIC_SENTRY_DSN is not configured.
 */
export function addBreadcrumb(breadcrumb: Sentry.Breadcrumb): void {
  if (!DSN) return;
  Sentry.addBreadcrumb(breadcrumb);
}

/**
 * Set a tag on the current scope.
 * No-ops when NEXT_PUBLIC_SENTRY_DSN is not configured.
 */
export function setTag(key: string, value: string): void {
  if (!DSN) return;
  Sentry.setTag(key, value);
}
