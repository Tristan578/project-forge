import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('server-only', () => ({}));

/**
 * `/health` is public (PF-1038), so an anonymous visitor drives six outbound
 * probes per cold render — see `getCachedHealthReport()`. The bound is the
 * shared fan-out budget (`checkHealthFanoutBudget`, Upstash-backed and callable
 * from a Server Component); the cache is the fast path in FRONT of it, so a
 * warm cache is served without spending budget at all.
 *
 * All three halves need pinning here, because all three are invisible to every
 * other suite. `getCachedHealthReport()` has its own unit tests, but they prove
 * only that the cache works, not that the PAGE uses it — reverting to a raw
 * `runAllHealthChecks()` would reopen the amplification vector with everything
 * else still green. The budget must be charged only on a miss, or a warm cache
 * costs an allowance it does not consume. And the degrade path (hand back a
 * null report, never 429) is the whole reason a status page can be bounded at
 * all, so a regression that turned it into a hard block would be a silent
 * outage of the one page people load during an outage.
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
const peekCachedHealthReport = vi.fn().mockReturnValue(null);
const runAllHealthChecks = vi.fn().mockResolvedValue(CACHED_REPORT);
const sanitizeForPublic = vi.fn((services: unknown[]) => services.map(() => ({ redacted: true })));

vi.mock('@/lib/monitoring/healthChecks', () => ({
  getCachedHealthReport,
  peekCachedHealthReport,
  runAllHealthChecks,
  sanitizeForPublic,
}));

const checkHealthFanoutBudget = vi
  .fn()
  .mockResolvedValue({ allowed: true, remaining: 29, resetAt: 0 });

vi.mock('@/lib/monitoring/healthFanoutBudget', () => ({ checkHealthFanoutBudget }));

const headerValues = new Map<string, string>();

vi.mock('next/headers', () => ({
  headers: () => Promise.resolve({ get: (name: string) => headerValues.get(name) ?? null }),
}));

// The dashboard is a client component; stub it so importing the page under the
// node environment does not drag in browser-only dependencies.
vi.mock('@/components/health/HealthDashboard', () => ({
  HealthDashboard: (props: unknown) => ({ type: 'HealthDashboard', props }),
}));

describe('/health page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    headerValues.clear();
    headerValues.set('x-forwarded-for', '203.0.113.7, 70.41.3.18');
    getCachedHealthReport.mockResolvedValue(CACHED_REPORT);
    peekCachedHealthReport.mockReturnValue(null);
    checkHealthFanoutBudget.mockResolvedValue({ allowed: true, remaining: 29, resetAt: 0 });
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
    // The whole point of the cache: one inbound request must not become six
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

  it('charges the fan-out budget on the CLIENT hop of x-forwarded-for', async () => {
    const { default: HealthPage } = await import('../health/page');
    await HealthPage();
    // Everything after the first comma is proxy-appended and attacker-
    // controllable; keying on it would hand out a fresh bucket per request.
    expect(checkHealthFanoutBudget).toHaveBeenCalledWith('203.0.113.7');
  });

  it('serves a live cached report without spending fan-out budget', async () => {
    peekCachedHealthReport.mockReturnValue(CACHED_REPORT);
    const { default: HealthPage } = await import('../health/page');
    const element = (await HealthPage()) as unknown as {
      props: { initialReport: { services: unknown[] } | null };
    };
    // A report we already hold costs no outbound calls, so it must not consume
    // an allowance — nor pay a Upstash round-trip to be handed out. The budget
    // exists to bound the probes, not to bound reading a variable.
    expect(checkHealthFanoutBudget).not.toHaveBeenCalled();
    expect(getCachedHealthReport).not.toHaveBeenCalled();
    // Sanitization still applies on this path.
    expect(element.props.initialReport).not.toBeNull();
    expect(sanitizeForPublic).toHaveBeenCalledWith(CACHED_REPORT.services);
  });

  it('does not pay for a fan-out once the caller is over budget', async () => {
    checkHealthFanoutBudget.mockResolvedValue({ allowed: false, remaining: 0, resetAt: 0 });
    const { default: HealthPage } = await import('../health/page');
    await HealthPage();
    expect(getCachedHealthReport).not.toHaveBeenCalled();
  });

  it('hands the client a null report when over budget with nothing cached', async () => {
    checkHealthFanoutBudget.mockResolvedValue({ allowed: false, remaining: 0, resetAt: 0 });
    peekCachedHealthReport.mockReturnValue(null);
    const { default: HealthPage } = await import('../health/page');
    const element = (await HealthPage()) as unknown as {
      props: { initialReport: unknown };
    };
    // Degrade, never 429: a status page that goes dark under load has failed at
    // its one job. `null` means "we did not look" — deliberately NOT a
    // synthetic report with a fourth `overall` member, which would widen a type
    // the API contract depends on. The dashboard renders its shell and polls
    // /api/health, which serves a cached report if one is live.
    expect(element.props.initialReport).toBeNull();
    expect(sanitizeForPublic).not.toHaveBeenCalled();
  });

  it('falls back to a placeholder key when no client IP is resolvable', async () => {
    headerValues.clear();
    const { default: HealthPage } = await import('../health/page');
    await HealthPage();
    // A missing IP must still land in SOME bucket. Skipping the budget check
    // (or keying on an empty string that Redis would reject) would hand every
    // header-stripped request an unbounded fan-out.
    expect(checkHealthFanoutBudget).toHaveBeenCalledWith('unknown');
  });
});
