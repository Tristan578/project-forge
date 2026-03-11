'use client';

import { useState, useEffect, useCallback } from 'react';
import type { HealthReport } from '@/lib/monitoring/healthChecks';
import { ServiceStatusCard } from './ServiceStatusCard';

interface HealthDashboardProps {
  initialReport: HealthReport;
}

const REFRESH_INTERVAL_MS = 30_000;

function overallBannerClass(overall: HealthReport['overall']): string {
  switch (overall) {
    case 'healthy':
      return 'bg-green-600 text-white';
    case 'degraded':
      return 'bg-yellow-500 text-black';
    case 'down':
      return 'bg-red-600 text-white';
    default:
      return 'bg-gray-600 text-white';
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
  const [report, setReport] = useState<HealthReport>(initialReport);
  const [refreshing, setRefreshing] = useState(false);
  const [secondsUntilRefresh, setSecondsUntilRefresh] = useState(REFRESH_INTERVAL_MS / 1000);

  const fetchReport = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch('/api/health', { cache: 'no-store' });
      if (res.ok || res.status === 503) {
        const data: HealthReport = await res.json();
        setReport(data);
      }
    } catch {
      // silently ignore fetch errors — stale data is better than crashing
    } finally {
      setRefreshing(false);
      setSecondsUntilRefresh(REFRESH_INTERVAL_MS / 1000);
    }
  }, []);

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

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100">
      {/* Overall status banner */}
      <div className={`px-4 py-6 text-center ${overallBannerClass(report.overall)}`}>
        <h1 className="text-2xl font-bold">{overallLabel(report.overall)}</h1>
        <p className="mt-1 text-sm opacity-80">
          {report.environment} &bull; v{report.version}
        </p>
      </div>

      <div className="mx-auto max-w-5xl px-4 py-6">
        {/* Header row */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-100">Service Status</h2>
            <p className="mt-0.5 text-sm text-gray-400">
              Last updated: {new Date(report.timestamp).toLocaleString()}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-400">
              {refreshing ? 'Refreshing...' : `Refreshes in ${secondsUntilRefresh}s`}
            </span>
            <button
              onClick={() => void fetchReport()}
              disabled={refreshing}
              className="rounded-md bg-gray-700 px-3 py-1.5 text-sm font-medium text-gray-200 transition-colors hover:bg-gray-600 disabled:cursor-not-allowed disabled:opacity-50"
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
        <p className="mt-8 text-center text-xs text-gray-500">
          SpawnForge Health Dashboard &bull; Auto-refreshes every 30 seconds
        </p>
      </div>
    </div>
  );
}
