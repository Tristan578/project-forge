/**
 * GameAnalyticsPanel — Dashboard for viewing player behavior analytics
 * of published games. Shows session stats, death heatmap, and funnel chart.
 */

'use client';

import { useState, useCallback, useMemo } from 'react';
import {
  BarChart3,
  Download,
  Users,
  Clock,
  Target,
  Flame,
  RefreshCw,
} from 'lucide-react';
import {
  GameAnalyticsAggregator,
  sessionsToCSV,
} from '@/lib/analytics/gameAnalytics';
import type {
  PlayerSession,
  AnalyticsDashboard,
  HeatmapPoint,
  FunnelStage,
} from '@/lib/analytics/gameAnalytics';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface GameAnalyticsPanelProps {
  sessions?: PlayerSession[];
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatCard({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 rounded-md bg-zinc-800 px-3 py-2">
      <span className="text-zinc-400">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs text-zinc-400">{label}</p>
        <p className="text-sm font-semibold text-zinc-100">{value}</p>
      </div>
    </div>
  );
}

function HeatmapGrid({ points }: { points: HeatmapPoint[] }) {
  if (points.length === 0) {
    return (
      <p className="py-4 text-center text-xs text-zinc-500">
        No death data recorded yet.
      </p>
    );
  }

  const maxCount = Math.max(...points.map((p) => p.count));

  // Determine grid bounds
  const minX = Math.min(...points.map((p) => p.x));
  const maxX = Math.max(...points.map((p) => p.x));
  const minY = Math.min(...points.map((p) => p.y));
  const maxY = Math.max(...points.map((p) => p.y));
  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;

  const svgWidth = 280;
  const svgHeight = 180;
  const padding = 12;

  return (
    <svg
      viewBox={`0 0 ${svgWidth} ${svgHeight}`}
      className="w-full rounded-md bg-zinc-800"
      role="img"
      aria-label="Death heatmap showing where players died most frequently"
    >
      {points.map((point, i) => {
        const cx =
          padding +
          ((point.x - minX) / rangeX) * (svgWidth - padding * 2);
        const cy =
          padding +
          ((point.y - minY) / rangeY) * (svgHeight - padding * 2);
        const intensity = point.count / maxCount;
        const r = 4 + intensity * 10;
        const opacity = 0.3 + intensity * 0.7;

        return (
          <circle
            key={`${point.x}-${point.y}-${i}`}
            cx={cx}
            cy={cy}
            r={r}
            fill={`rgba(239, 68, 68, ${opacity})`}
            stroke="rgba(239, 68, 68, 0.3)"
            strokeWidth={1}
          >
            <title>
              ({point.x}, {point.y}): {point.count} death
              {point.count !== 1 ? 's' : ''}
            </title>
          </circle>
        );
      })}
    </svg>
  );
}

function FunnelChart({ stages }: { stages: FunnelStage[] }) {
  if (stages.length === 0) {
    return (
      <p className="py-4 text-center text-xs text-zinc-500">
        No funnel data available.
      </p>
    );
  }

  const maxCount = Math.max(...stages.map((s) => s.count), 1);

  return (
    <div className="space-y-1.5">
      {stages.map((stage) => {
        const width = maxCount > 0 ? (stage.count / maxCount) * 100 : 0;
        const dropoffPct = Math.round(stage.dropoffRate * 100);

        return (
          <div key={stage.name} className="space-y-0.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-zinc-300">
                {stage.name.replace(/_/g, ' ')}
              </span>
              <span className="text-zinc-500">
                {stage.count}
                {dropoffPct > 0 && (
                  <span className="ml-1 text-red-400">
                    -{dropoffPct}%
                  </span>
                )}
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-700">
              <div
                className="h-full rounded-full bg-blue-500 transition-all duration-300"
                style={{ width: `${width}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SessionList({ sessions }: { sessions: PlayerSession[] }) {
  if (sessions.length === 0) {
    return (
      <p className="py-4 text-center text-xs text-zinc-500">
        No sessions recorded yet.
      </p>
    );
  }

  // Show most recent first, limit to 20
  const sorted = [...sessions]
    .sort((a, b) => b.startTime - a.startTime)
    .slice(0, 20);

  return (
    <div className="max-h-48 space-y-1 overflow-y-auto">
      {sorted.map((session) => {
        const durationSec = Math.round(session.duration / 1000);
        const eventCount = session.events.length;
        const deaths = session.events.filter(
          (e) => e.type === 'PLAYER_DEATH'
        ).length;

        return (
          <div
            key={session.sessionId}
            className="flex items-center justify-between rounded bg-zinc-800 px-2 py-1.5 text-xs"
          >
            <span className="truncate text-zinc-300" title={session.sessionId}>
              {session.sessionId.slice(0, 18)}...
            </span>
            <div className="flex items-center gap-2 text-zinc-500">
              <span>{durationSec}s</span>
              <span>{eventCount} events</span>
              {deaths > 0 && (
                <span className="text-red-400">{deaths} deaths</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDuration(ms: number): string {
  if (ms === 0) return '0s';
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}m ${sec}s`;
}

function formatPercent(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

// ---------------------------------------------------------------------------
// Main Panel
// ---------------------------------------------------------------------------

export function GameAnalyticsPanel({
  sessions = [],
}: GameAnalyticsPanelProps) {
  const [refreshKey, setRefreshKey] = useState(0);

  const handleRefresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  const dashboard: AnalyticsDashboard = useMemo(() => {
    // refreshKey used to force re-computation
    void refreshKey;
    const agg = new GameAnalyticsAggregator();
    agg.addSessions(sessions);
    return agg.getDashboard();
  }, [sessions, refreshKey]);

  const handleExportCSV = useCallback(() => {
    const csv = sessionsToCSV(sessions);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'game-analytics.csv';
    link.click();
    URL.revokeObjectURL(url);
  }, [sessions]);

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-zinc-900 text-zinc-100">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-700 px-3 py-2">
        <div className="flex items-center gap-2">
          <BarChart3 size={14} className="text-blue-400" />
          <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-300">
            Game Analytics
          </h2>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={handleRefresh}
            className="rounded p-1 text-zinc-400 transition-colors duration-150 hover:bg-zinc-700 hover:text-zinc-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
            aria-label="Refresh analytics"
            title="Refresh"
          >
            <RefreshCw size={13} />
          </button>
          <button
            onClick={handleExportCSV}
            className="rounded p-1 text-zinc-400 transition-colors duration-150 hover:bg-zinc-700 hover:text-zinc-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
            aria-label="Export analytics as CSV"
            title="Export CSV"
            disabled={sessions.length === 0}
          >
            <Download size={13} />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 space-y-4 p-3">
        {/* Stats Grid */}
        <div className="grid grid-cols-3 gap-2">
          <StatCard
            label="Sessions"
            value={String(dashboard.totalSessions)}
            icon={<Users size={14} />}
          />
          <StatCard
            label="Avg Duration"
            value={formatDuration(dashboard.avgSessionDuration)}
            icon={<Clock size={14} />}
          />
          <StatCard
            label="Completion"
            value={formatPercent(dashboard.completionRate)}
            icon={<Target size={14} />}
          />
        </div>

        {/* Death Heatmap */}
        <section>
          <h3 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase text-zinc-400">
            <Flame size={12} className="text-red-400" />
            Death Heatmap
          </h3>
          <HeatmapGrid points={dashboard.deathHeatmap} />
        </section>

        {/* Completion Funnel */}
        <section>
          <h3 className="mb-1.5 text-xs font-semibold uppercase text-zinc-400">
            Completion Funnel
          </h3>
          <FunnelChart stages={dashboard.funnelStages} />
        </section>

        {/* Session Timeline */}
        <section>
          <h3 className="mb-1.5 text-xs font-semibold uppercase text-zinc-400">
            Recent Sessions
          </h3>
          <SessionList sessions={sessions} />
        </section>
      </div>
    </div>
  );
}
