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

  return Sentry.startSpan(options, callback);
}

/**
 * Structured Sentry log (server-side; PF-967 / #8956).
 *
 * Routes through Sentry's Logs pipeline (`Sentry.logger.*`), which is
 * SEPARATE from event capture (`captureException`/`captureMessage` above) —
 * it requires `enableLogs: true` in the Sentry init (already set in all
 * three init files) and is scrubbed by its own `beforeSendLog` hook
 * (`scrubSentryLog` in sentryConfig.ts), NOT `beforeSend`/`scrubSentryEvent`.
 * No-ops when SENTRY_DSN is not configured, matching every other export here.
 *
 * For general JSON/console log aggregation (Axiom, Datadog, etc.) use
 * `@/lib/logging/logger` instead — that module never reaches Sentry. Reach
 * for `sentryLogger` (this export) when you want an entry searchable in
 * Sentry's Logs UI alongside error/trace context; the two are complementary,
 * not interchangeable — see `@/lib/logging/logger` module doc for that
 * logger's own PII redaction layer. Named `sentryLogger` (not `logger`) so
 * call sites can import both without an alias.
 *
 * Attributes are passed through Sentry's Logs pipeline scrubbing, but that
 * is a defense-in-depth net, not a substitute for care at the call site —
 * never pass prompt content, full request bodies, or unredacted secrets.
 */
export const sentryLogger = {
  info(message: string, attributes?: Record<string, unknown>): void {
    if (!DSN) return;
    Sentry.logger.info(message, attributes);
  },
  warn(message: string, attributes?: Record<string, unknown>): void {
    if (!DSN) return;
    Sentry.logger.warn(message, attributes);
  },
  error(message: string, attributes?: Record<string, unknown>): void {
    if (!DSN) return;
    Sentry.logger.error(message, attributes);
  },
};
