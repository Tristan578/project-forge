import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('server-only', () => ({}));

/**
 * `/health` is public (PF-1038) and a Server Component cannot rate-limit
 * itself, so the shared TTL cache IS the amplification guard for this page —
 * see `getCachedHealthReport()`. The cache function has its own unit tests, but
 * those prove only that the cache works, not that the PAGE uses it. Without the
 * assertions below, reverting `page.tsx` to call `runAllHealthChecks()`
 * directly would silently reopen the ten-outbound-probes-per-request vector
 * this fix exists to close, and every other suite would stay green.
 *
 * Lives in `src/app/__tests__/` rather than co-located under `src/app/health/`
 * on purpose: `vitest.config.node.ts` includes `src/app/__tests__/**` and
 * `src/app/api/**`, and nothing else under `src/app`. A co-located
 * `src/app/health/__tests__/page.test.tsx` matches neither glob and would run
 * only under the standalone config — the exact gap that config's own comments
 * document.
 */

const CACHED_REPORT = {
  timestamp: '2026-03-16T12:34:56.000Z',
  overall: 'healthy',
  services: [{ name: 'Database', status: 'up', error: 'internal detail' }],
};

const getCachedHealthReport = vi.fn().mockResolvedValue(CACHED_REPORT);
const runAllHealthChecks = vi.fn().mockResolvedValue(CACHED_REPORT);
const sanitizeForPublic = vi.fn((services: unknown[]) => services.map(() => ({ redacted: true })));

vi.mock('@/lib/monitoring/healthChecks', () => ({
  getCachedHealthReport,
  runAllHealthChecks,
  sanitizeForPublic,
}));

// The dashboard is a client component; stub it so importing the page under the
// node environment does not drag in browser-only dependencies.
vi.mock('@/components/health/HealthDashboard', () => ({
  HealthDashboard: (props: unknown) => ({ type: 'HealthDashboard', props }),
}));

describe('/health page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCachedHealthReport.mockResolvedValue(CACHED_REPORT);
    sanitizeForPublic.mockImplementation((services: unknown[]) =>
      services.map(() => ({ redacted: true })),
    );
  });

  afterEach(() => {
    vi.resetModules();
  });

  it('reads the health report through the shared cache', async () => {
    const { default: HealthPage } = await import('../health/page');
    await HealthPage();
    expect(getCachedHealthReport).toHaveBeenCalledTimes(1);
  });

  it('never triggers a raw fan-out', async () => {
    const { default: HealthPage } = await import('../health/page');
    await HealthPage();
    // The whole point of the cache: one inbound request must not become ten
    // outbound service probes.
    expect(runAllHealthChecks).not.toHaveBeenCalled();
  });

  it('sanitizes the cached services before handing them to the client', async () => {
    const { default: HealthPage } = await import('../health/page');
    await HealthPage();
    // A cached report is shared across every anonymous visitor, so failing to
    // sanitize would leak internal error detail more widely, not less.
    expect(sanitizeForPublic).toHaveBeenCalledWith(CACHED_REPORT.services);
  });
});
