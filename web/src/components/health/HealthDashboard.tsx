'use client';

import { useState, useEffect, useCallback } from 'react';
import type { HealthReport, ServiceHealth } from '@/lib/monitoring/healthChecks';
import { HEALTH_CACHE_TTL_MS } from '@/lib/config/timeouts';
import { ServiceStatusCard } from './ServiceStatusCard';

interface HealthDashboardProps {
  /**
   * The server-rendered report, or `null` when the server declined to pay for a
   * fan-out (see `web/src/app/health/page.tsx` — the page is public and rate-
   * limited, and a limited request degrades rather than 429-ing).
   *
   * `null` is deliberately NOT modelled as a synthetic report with an
   * `overall: 'unknown'`: `ServiceStatus` has exactly three members
   * ('healthy' | 'degraded' | 'down') and inventing a fourth would mean
   * widening a type the API contract depends on in order to express "we did not
   * look". Instead we render the shell and let the existing `/api/health` poll
   * fill it in — that route serves a live cached report for free, so the retry
   * usually costs nothing even while the caller is still over budget.
   */
  initialReport: HealthReport | null;
}

/**
 * Tied to the report cache TTL rather than hardcoded: `/api/health` serves a
 * cached report for that long, so polling any faster just re-reads bytes we
 * already have, and polling slower leaves the page staler than it needs to be.
 * Two independent literals that happen to agree today would drift silently.
 */
const REFRESH_INTERVAL_MS = HEALTH_CACHE_TTL_MS;

/**
 * `/api/health` speaks a different status vocabulary than the rest of the app:
 * it remaps the internal `'healthy'` to `'up'` for consistency with uptime
 * monitoring conventions (see `normalizeStatus` in that route). That is a
 * documented, externally-visible contract, so the translation belongs here at
 * the client boundary rather than in the API.
 *
 * Without it, `ServiceStatusCard` — which switches on the internal vocabulary —
 * falls through to its `default:` arm and every healthy service silently flips
 * from a green "Healthy" to a gray "Unknown" on the first 30s poll, on the one
 * page people load during an incident.
 *
 * Only `services[].status` is remapped: the route returns `overall` as the raw
 * internal value, so touching it here would break the banner rather than fix it.
 */
/**
 * Exported so test fixtures can be annotated with the real wire shape. A
 * hand-typed fixture agrees with whatever the test author believed; annotating
 * it makes a future drift in this vocabulary a compile error rather than a
 * green test asserting the wrong contract.
 */
export type WireServiceStatus = 'up' | ServiceHealth['status'];
export type WireReport = Omit<HealthReport, 'services'> & {
  services: Array<Omit<ServiceHealth, 'status'> & { status: WireServiceStatus }>;
};

function fromWireReport(wire: WireReport): HealthReport {
  return {
    ...wire,
    services: wire.services.map((service) => ({
      ...service,
      status: service.status === 'up' ? 'healthy' : service.status,
    })),
  };
}

function overallBannerClass(overall: HealthReport['overall']): string {
  switch (overall) {
    case 'healthy':
      // green-700, not green-600: white on #16a34a is ~3.6:1, under the 4.5:1
      // WCAG AA minimum for this text size. #15803d clears it at ~4.8:1.
      return 'bg-green-700 text-white';
    case 'degraded':
      return 'bg-yellow-500 text-black';
    case 'down':
      return 'bg-red-600 text-white';
    default:
      return 'bg-zinc-600 text-white';
  }
}

function overallLabel(overall: HealthReport['overall']): string {
  switch (overall) {
    case 'healthy':
      return 'All Systems Operational';
    case 'degraded':
      return 'Partial Service Disruption';
    case 'down':
      return 'Major Outage Detected';
    default:
      return 'Unknown Status';
  }
}

export function HealthDashboard({ initialReport }: HealthDashboardProps) {
  const [report, setReport] = useState<HealthReport | null>(initialReport);
  const [refreshing, setRefreshing] = useState(false);
  const [secondsUntilRefresh, setSecondsUntilRefresh] = useState(REFRESH_INTERVAL_MS / 1000);

  const fetchReport = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch('/api/health', { cache: 'no-store' });
      if (res.ok || res.status === 503) {
        const wire: WireReport = await res.json();
        setReport(fromWireReport(wire));
      }
    } catch {
      // silently ignore fetch errors — stale data is better than crashing
    } finally {
      setRefreshing(false);
      setSecondsUntilRefresh(REFRESH_INTERVAL_MS / 1000);
    }
  }, []);

  // No server-rendered report (the page was rate-limited) — fetch one straight
  // away rather than making the visitor wait a full refresh interval to see
  // anything. Mount-only: the interval below covers every subsequent attempt,
  // including a retry after this one fails.
  const hasInitialReport = initialReport !== null;
  useEffect(() => {
    if (!hasInitialReport) {
      void fetchReport();
    }
  }, [hasInitialReport, fetchReport]);

  // Auto-refresh every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      void fetchReport();
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchReport]);

  // Countdown ticker
  useEffect(() => {
    const ticker = setInterval(() => {
      setSecondsUntilRefresh((prev) => (prev <= 1 ? REFRESH_INTERVAL_MS / 1000 : prev - 1));
    }, 1_000);
    return () => clearInterval(ticker);
  }, []);

  if (report === null) {
    // Not an outage — we simply have not looked yet. Saying "Major Outage" or
    // "Unknown Status" here would be worse than saying nothing, because this
    // page is what people trust during a real incident.
    return (
      <div className="min-h-screen bg-zinc-900 text-zinc-100">
        <div className="bg-zinc-700 px-4 py-6 text-center text-white">
          <h1 className="text-2xl font-bold">Checking Service Status</h1>
        </div>
        <div className="mx-auto max-w-5xl px-4 py-6">
          <p role="status" aria-live="polite" className="text-center text-sm text-zinc-400">
            Loading the latest service status&hellip;
          </p>
          <div className="mt-6 text-center">
            <button
              onClick={() => void fetchReport()}
              disabled={refreshing}
              className="rounded-md bg-zinc-700 px-3 py-1.5 text-sm font-medium text-zinc-200 transition-colors hover:bg-zinc-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-900 text-zinc-100">
      {/* Overall status banner */}
      {/*
        The 30s poll swaps this banner's text without any user action, so it has
        to be announced (WCAG 4.1.3). `polite` rather than `assertive`: an
        outage is worth hearing about, not worth cutting off whatever the
        visitor is already reading.
      */}
      <div
        role="status"
        aria-live="polite"
        className={`px-4 py-6 text-center ${overallBannerClass(report.overall)}`}
      >
        <h1 className="text-2xl font-bold">{overallLabel(report.overall)}</h1>
        {/* No `opacity-80` — it drops every banner variant below the 4.5:1
            contrast floor that the background colours were chosen to clear. */}
        <p className="mt-1 text-sm">
          {report.environment} &bull; v{report.version}
        </p>
      </div>

      <div className="mx-auto max-w-5xl px-4 py-6">
        {/* Header row */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-zinc-100">Service Status</h2>
            <p className="mt-0.5 text-sm text-zinc-400">
              Last updated: {new Date(report.timestamp).toLocaleString()}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-zinc-400">
              {refreshing ? 'Refreshing...' : `Refreshes in ${secondsUntilRefresh}s`}
            </span>
            <button
              onClick={() => void fetchReport()}
              disabled={refreshing}
              className="rounded-md bg-zinc-700 px-3 py-1.5 text-sm font-medium text-zinc-200 transition-colors hover:bg-zinc-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Refresh
            </button>
          </div>
        </div>

        {/* Service grid */}
        <div
          data-testid="service-grid"
          className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
        >
          {report.services.map((service) => (
            <ServiceStatusCard key={service.name} service={service} />
          ))}
        </div>

        {/* Footer */}
        <p className="mt-8 text-center text-xs text-zinc-400">
          SpawnForge Health Dashboard &bull; Auto-refreshes every 30 seconds
        </p>
      </div>
    </div>
  );
}
