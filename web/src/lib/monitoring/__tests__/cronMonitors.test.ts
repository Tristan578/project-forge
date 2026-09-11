import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockWithMonitor = vi.fn();
const mockFlush = vi.fn((..._args: unknown[]) => Promise.resolve(true));
vi.mock('@sentry/nextjs', () => ({
  withMonitor: (...args: unknown[]) => mockWithMonitor(...args),
  flush: (...args: unknown[]) => mockFlush(...args),
}));

import {
  CRON_MONITORS,
  getCronMonitor,
  withCronMonitor,
  type CronMonitor,
} from '../cronMonitors';

describe('CRON_MONITORS registry', () => {
  it('has at least one monitor', () => {
    expect(CRON_MONITORS.length).toBeGreaterThan(0);
  });

  it('has unique paths and unique slugs', () => {
    const paths = CRON_MONITORS.map((m) => m.path);
    const slugs = CRON_MONITORS.map((m) => m.slug);
    expect(new Set(paths).size).toBe(paths.length);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('uses kebab-case slugs (Sentry-safe identifiers)', () => {
    for (const m of CRON_MONITORS) {
      expect(m.slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    }
  });

  it('uses 5-field crontab schedules', () => {
    for (const m of CRON_MONITORS) {
      expect(m.schedule.trim().split(/\s+/)).toHaveLength(5);
    }
  });
});

describe('CRON_MONITORS ↔ vercel.json parity', () => {
  // The registry is the runtime mirror of the source-of-truth `web/vercel.json`.
  // Drift in either direction (a Vercel cron without a monitor, or a monitor
  // for a non-existent cron) must fail CI rather than ship an unmonitored job.
  type VercelCron = { path: string; schedule: string };
  const vercelJson = JSON.parse(
    readFileSync(join(__dirname, '../../../../vercel.json'), 'utf8'),
  ) as { crons?: VercelCron[] };
  const vercelCrons = vercelJson.crons ?? [];

  it('every vercel.json cron has a registry entry with a matching schedule', () => {
    for (const cron of vercelCrons) {
      const monitor = getCronMonitor(cron.path);
      expect(
        monitor,
        `vercel.json cron ${cron.path} has no Sentry monitor in CRON_MONITORS`,
      ).toBeDefined();
      expect(monitor?.schedule).toBe(cron.schedule);
    }
  });

  it('every registry entry maps to a real vercel.json cron', () => {
    const vercelPaths = new Set(vercelCrons.map((c) => c.path));
    for (const m of CRON_MONITORS) {
      expect(
        vercelPaths.has(m.path),
        `CRON_MONITORS entry ${m.path} is not declared in vercel.json crons`,
      ).toBe(true);
    }
  });

  it('registry count equals vercel.json cron count', () => {
    expect(CRON_MONITORS.length).toBe(vercelCrons.length);
  });

  // #9531: cadence is a standing dollar cost, not a preference. */5 was 8,640
  // invocations/month against an endpoint that returns 401 on every call until
  // CRON_SECRET is set (#9118). This asserts that ticket's acceptance criterion
  // — "fires at most 4x/hour" — so a quiet return to */5, or worse */1, is a
  // red build rather than a line item nobody reads. Raise the floor
  // deliberately, with a reason, if a cron ever genuinely needs to run hotter.
  const MAX_RUNS_PER_HOUR = 4;
  const MIN_STEP_MINUTES = 60 / MAX_RUNS_PER_HOUR;

  it(`every vercel.json cron fires at most ${MAX_RUNS_PER_HOUR}x/hour`, () => {
    for (const cron of vercelCrons) {
      const minuteField = cron.schedule.trim().split(/\s+/)[0];
      const step = /^\*\/(\d+)$/.exec(minuteField);
      expect(
        step,
        `cron ${cron.path} has minute field "${minuteField}", which is not a */N step — ` +
          'its hourly invocation count cannot be bounded by this guard, so review its cost by hand.',
      ).not.toBeNull();
      expect(
        Number(step?.[1]),
        `cron ${cron.path} runs every ${step?.[1] ?? '?'} minutes, which exceeds ${MAX_RUNS_PER_HOUR}/hour`,
      ).toBeGreaterThanOrEqual(MIN_STEP_MINUTES);
    }
  });
});

describe('getCronMonitor', () => {
  it('returns the monitor for a known path', () => {
    const m = getCronMonitor('/api/cron/health-monitor');
    expect(m?.slug).toBe('spawnforge-health-monitor');
  });

  it('returns undefined for an unknown path', () => {
    expect(getCronMonitor('/api/cron/does-not-exist')).toBeUndefined();
  });
});

describe('withCronMonitor', () => {
  const monitor: CronMonitor = {
    path: '/api/cron/test',
    schedule: '*/5 * * * *',
    slug: 'test-monitor',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('no-ops (calls handler directly, no check-in) when SENTRY_DSN is absent', async () => {
    vi.stubEnv('SENTRY_DSN', '');
    vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', '');
    const handler = vi.fn().mockResolvedValue('result');

    const out = await withCronMonitor(monitor, handler);

    expect(out).toBe('result');
    expect(handler).toHaveBeenCalledTimes(1);
    expect(mockWithMonitor).not.toHaveBeenCalled();
  });

  it('wraps in Sentry.withMonitor with the slug + crontab schedule when DSN is set', async () => {
    vi.stubEnv('SENTRY_DSN', 'https://key@sentry.io/123');
    const handler = vi.fn().mockResolvedValue('ok');
    mockWithMonitor.mockImplementation(
      (_slug: string, cb: () => Promise<unknown>) => cb(),
    );

    const out = await withCronMonitor(monitor, handler);

    expect(out).toBe('ok');
    expect(mockWithMonitor).toHaveBeenCalledTimes(1);
    const [slug, cb, config] = mockWithMonitor.mock.calls[0];
    expect(slug).toBe('test-monitor');
    expect(typeof cb).toBe('function');
    expect(config).toEqual(
      expect.objectContaining({
        schedule: { type: 'crontab', value: '*/5 * * * *' },
      }),
    );
  });

  it('activates via NEXT_PUBLIC_SENTRY_DSN fallback', async () => {
    vi.stubEnv('SENTRY_DSN', '');
    vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', 'https://key@sentry.io/456');
    const handler = vi.fn().mockResolvedValue('ok');
    mockWithMonitor.mockImplementation(
      (_slug: string, cb: () => Promise<unknown>) => cb(),
    );

    await withCronMonitor(monitor, handler);

    expect(mockWithMonitor).toHaveBeenCalledTimes(1);
  });

  it('propagates the handler rejection (so the check-in is marked error)', async () => {
    vi.stubEnv('SENTRY_DSN', 'https://key@sentry.io/123');
    const boom = new Error('infra down');
    const handler = vi.fn().mockRejectedValue(boom);
    mockWithMonitor.mockImplementation(
      (_slug: string, cb: () => Promise<unknown>) => cb(),
    );

    await expect(withCronMonitor(monitor, handler)).rejects.toThrow('infra down');
  });
});

// ---------------------------------------------------------------------------
// Serverless transport flush (#9981).
//
// Sentry's transport is async. On Vercel the function is frozen the instant the
// response returns, so a check-in still sitting in the queue is discarded.
// `withMonitor` records the terminal check-in correctly; it just never leaves
// the process. Sentry then sees an in_progress with no terminal check-in and
// reports "A timeout check-in was detected" -- 645 occurrences over 7 days
// (SPAWNFORGE-AI-Z) while the health monitor read as quiet.
//
// These assert ORDERING, not call count. `expect(mockFlush).toHaveBeenCalled()`
// passes even when the flush is fired and abandoned, which is precisely the bug
// -- so it would be a test incapable of failing on the thing it names.
// ---------------------------------------------------------------------------
describe('withCronMonitor — serverless flush', () => {
  const monitor: CronMonitor = {
    path: '/api/cron/test',
    schedule: '*/5 * * * *',
    slug: 'test-monitor',
  };

  /** Drain the microtask queue so anything that CAN settle already has. */
  const drainMicrotasks = async () => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  };

  /**
   * A flush that stays pending until the test releases it.
   *
   * Deliberately NOT a timer-delayed flush. A microtask-tick delay is too weak
   * (the assertion machinery drains several microtasks itself, so an unawaited
   * flush still wins that race and the test passes with the bug present —
   * measured, not assumed), and a `setTimeout` version is banned by
   * `no-restricted-syntax` for good reason. A deferred asserts the stronger and
   * fully deterministic property: while the flush is pending, the returned
   * promise MUST NOT settle.
   */
  const deferFlush = () => {
    let release!: () => void;
    mockFlush.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          release = () => resolve(true);
        }),
    );
    return () => release();
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    mockFlush.mockImplementation(() => Promise.resolve(true));
    mockWithMonitor.mockImplementation(
      (_slug: string, cb: () => Promise<unknown>) => cb(),
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('cannot resolve while the flush is still pending', async () => {
    vi.stubEnv('SENTRY_DSN', 'https://key@sentry.io/123');
    const release = deferFlush();

    let settled = false;
    const pending = withCronMonitor(monitor, async () => 'ok').then((v) => {
      settled = true;
      return v;
    });

    await drainMicrotasks();
    expect(settled).toBe(false);

    release();
    await expect(pending).resolves.toBe('ok');
  });

  it('cannot reject while the flush is still pending, and preserves the error', async () => {
    vi.stubEnv('SENTRY_DSN', 'https://key@sentry.io/123');
    const release = deferFlush();
    const boom = new Error('infra down');

    let rejectedWith: unknown;
    const pending = withCronMonitor(monitor, () => Promise.reject(boom));
    pending.catch((e: unknown) => {
      rejectedWith = e;
    });

    await drainMicrotasks();
    expect(rejectedWith).toBeUndefined();

    release();
    await expect(pending).rejects.toBe(boom);
    expect(rejectedWith).toBe(boom);
  });

  it('never flushes when no DSN is configured (stays fully inert)', async () => {
    vi.stubEnv('SENTRY_DSN', '');
    vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', '');

    await withCronMonitor(monitor, async () => 'ok');

    expect(mockFlush).not.toHaveBeenCalled();
  });

  it('a failing flush does not mask the handler result', async () => {
    vi.stubEnv('SENTRY_DSN', 'https://key@sentry.io/123');
    mockFlush.mockImplementation(() =>
      Promise.reject(new Error('flush timeout')),
    );

    await expect(withCronMonitor(monitor, async () => 'ok')).resolves.toBe('ok');
  });

  it('a failing flush does not mask the handler error', async () => {
    vi.stubEnv('SENTRY_DSN', 'https://key@sentry.io/123');
    const boom = new Error('infra down');
    mockFlush.mockImplementation(() =>
      Promise.reject(new Error('flush timeout')),
    );

    await expect(
      withCronMonitor(monitor, () => Promise.reject(boom)),
    ).rejects.toBe(boom);
  });

  it('warns rather than throwing when the transport reports an incomplete drain', async () => {
    vi.stubEnv('SENTRY_DSN', 'https://key@sentry.io/123');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockFlush.mockImplementation(() => Promise.resolve(false));

    await expect(withCronMonitor(monitor, async () => 'ok')).resolves.toBe('ok');
    expect(warn).toHaveBeenCalledTimes(1);

    warn.mockRestore();
  });
});
