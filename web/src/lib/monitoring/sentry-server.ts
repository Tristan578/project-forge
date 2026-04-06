import * as Sentry from '@sentry/nextjs';

// Sentry is auto-initialized by sentry.server.config.ts (loaded by @sentry/nextjs).
// This wrapper provides guarded access — no-ops when SENTRY_DSN is not set.
const DSN = process.env.SENTRY_DSN;

/**
 * Report an exception to Sentry (server-side).
 * No-ops silently when SENTRY_DSN is not configured.
 */
export function captureException(
  error: unknown,
  context?: Record<string, unknown>,
): void {
  if (!DSN) return;

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

  Sentry.captureMessage(message, level);
}

/**
 * Start a performance span (server-side).
 * When Sentry is not configured, the callback is still executed and its
 * return value is forwarded to the caller.
 */
/**
 * Add a breadcrumb to the current Sentry scope (server-side).
 * No-ops silently when SENTRY_DSN is not configured.
 */
export function addBreadcrumb(breadcrumb: {
  category?: string;
  message: string;
  level?: 'info' | 'warning' | 'error';
  data?: Record<string, unknown>;
}): void {
  if (!DSN) return;

  Sentry.addBreadcrumb(breadcrumb);
}

export function startSpan<T>(
  options: { name: string; op?: string },
  callback: () => T,
): T {
  if (!DSN) return callback();

  return Sentry.startSpan(options, callback);
}
