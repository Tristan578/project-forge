import * as Sentry from '@sentry/nextjs';

/**
 * Sentry cron (check-in) monitors for Vercel-scheduled routes.
 *
 * Each scheduled route declared under `crons` in `web/vercel.json` is mirrored
 * here so its handler can be wrapped in `Sentry.withMonitor()`. That tells
 * Sentry to expect a check-in on the given crontab schedule and to alert when a
 * run is missed, errors, or runs long — turning a silent cron failure (Vercel
 * cron failures are otherwise invisible) into a Sentry alert.
 *
 * SOURCE-OF-TRUTH: `web/vercel.json` is what Vercel actually schedules. This
 * registry is the runtime mirror of it; `cronMonitors.test.ts` asserts the two
 * stay in lockstep so adding a Vercel cron without a monitor (or vice versa)
 * fails CI rather than shipping an unmonitored job.
 *
 * GUARD: `withCronMonitor` no-ops (runs the handler directly, no check-in) when
 * `SENTRY_DSN` is absent — local dev, CI, and previews without Sentry behave
 * exactly as before. Mirrors the `DSN` guard in `sentry-server.ts`.
 */

export interface CronMonitor {
  /** Vercel cron `path` (e.g. `/api/cron/health-monitor`). */
  readonly path: string;
  /** Crontab schedule expression (e.g. `*\/5 * * * *`). Mirrors vercel.json. */
  readonly schedule: string;
  /**
   * Stable Sentry monitor slug. Kebab-cased, deterministic, and decoupled from
   * the path so a route rename does not orphan the dashboard monitor.
   */
  readonly slug: string;
}

/**
 * The monitor registry. One entry per `crons[]` entry in `web/vercel.json`.
 *
 * When you add a Vercel cron, add the matching entry here (the parity test will
 * remind you). Keep `slug` stable across renames — it is the Sentry dashboard
 * identity.
 */
export const CRON_MONITORS: readonly CronMonitor[] = [
  {
    path: '/api/cron/health-monitor',
    schedule: '*/5 * * * *',
    slug: 'spawnforge-health-monitor',
  },
] as const;

/** Look up a monitor by its Vercel cron path. */
export function getCronMonitor(path: string): CronMonitor | undefined {
  return CRON_MONITORS.find((m) => m.path === path);
}

/**
 * Wrap a cron handler in a Sentry check-in monitor.
 *
 * On each invocation Sentry records an `in_progress` check-in, then `ok` or
 * `error` based on whether the handler resolves or throws. `withMonitor` also
 * upserts the monitor's schedule config so the dashboard knows when to expect
 * the next run and can alert on a missed one.
 *
 * No-ops (calls `handler()` directly) when `SENTRY_DSN` is not configured, so
 * the wrap is inert in environments without Sentry.
 *
 * The handler's resolved value is forwarded unchanged; thrown errors propagate
 * after the failed check-in is recorded (so existing error handling is intact).
 */
export function withCronMonitor<T>(
  monitor: CronMonitor,
  handler: () => Promise<T>,
): Promise<T> {
  // Treat an empty string as "not set" so SENTRY_DSN="" still falls through to
  // the public DSN (and ultimately to the inert no-op path). `||` is correct
  // here precisely because empty/missing are equivalent for a DSN.
  const dsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) return handler();

  return Sentry.withMonitor(monitor.slug, handler, {
    schedule: { type: 'crontab', value: monitor.schedule },
    // Allow a run up to 5 min to complete and tolerate a 1-min late start
    // before flagging a missed/long check-in. Conservative defaults that suit
    // the 5-minute health cadence; tune per-monitor if cadences diverge.
    maxRuntime: 5,
    checkinMargin: 1,
  });
}
