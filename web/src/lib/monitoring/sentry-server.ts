import * as Sentry from '@sentry/nextjs';

// Sentry is auto-initialized by sentry.server.config.ts (loaded by
// @sentry/nextjs). This wrapper provides guarded access — no-ops when Sentry is
// not configured.
//
// THE FALLBACK MATCHES THE INITIALISATION, and it did not used to. This guard
// read `SENTRY_DSN` alone while `sentry.server.config.ts`,
// `sentry.edge.config.ts` and `cronMonitors.ts` all accept
// `NEXT_PUBLIC_SENTRY_DSN` as well. So a deployment carrying only the public
// variable initialised Sentry, registered cron check-ins, and looked healthy —
// while every `captureException` here returned early and dropped the error.
// Monitoring that reports itself as working and delivers nothing is worse than
// monitoring that is plainly off.
//
// It is the same DSN either way; the public spelling only means it is also
// exposed to the browser. Guarding on it server-side is what makes this file
// no-op exactly when Sentry is uninitialised, and never when it is not.
//
// `||`, NOT `??`, and the two Sentry configs were changed to match. An
// environment variable set to the EMPTY STRING is not a DSN, but `??` falls
// back only on null/undefined — so `SENTRY_DSN=''` with the public one set kept
// the empty value, and the fallback this comment describes never fired. That is
// the one shape a test can produce with `vi.stubEnv`, and it is how the defect
// was caught. `cronMonitors.ts` already used `||`; now all four agree.
const DSN = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;

/**
 * Report an exception to Sentry (server-side).
 * No-ops silently when Sentry is not configured (see the DSN guard above).
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
 * No-ops silently when Sentry is not configured (see the DSN guard above).
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
 * No-ops silently when Sentry is not configured (see the DSN guard above).
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
 * No-ops when Sentry is not configured, matching every other export here.
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
