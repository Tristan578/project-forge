import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockWithMonitor = vi.fn();
vi.mock('@sentry/nextjs', () => ({
  withMonitor: (...args: unknown[]) => mockWithMonitor(...args),
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
