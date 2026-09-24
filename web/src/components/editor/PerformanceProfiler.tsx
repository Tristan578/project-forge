import React, { useEffect, useCallback } from 'react';
import { Button, InlineAlert, Progress, cn } from '@spawnforge/ui';
import { usePerformanceStore } from '@/stores/performanceStore';
import { ChevronDown, ChevronUp, AlertTriangle } from 'lucide-react';
import {
  buildMeasurementManifestAsync,
  UNKNOWN,
  type MeasurementManifest,
  type ManifestViewport,
} from '@/lib/config/measurementManifest';
import { getActiveEngineBackend, getWasmModule } from '@/hooks/useEngine';
import { readMemoryAvailability, type PerformanceMemoryLike } from '@/lib/perf/frameCapture';
import { PerformanceCapturePanel } from './PerformanceCapturePanel';

/**
 * Render a manifest field for display. The `'unknown'` sentinel and a null
 * value both render as the literal text "unknown" — an unsupported field must
 * never surface as 0, false, or a blank that reads like a passed budget
 * (#9904, negative-case acceptance scenario).
 */
function formatManifestValue(value: unknown): string {
  if (value === UNKNOWN || value === null || value === undefined) return 'unknown';
  if (typeof value === 'object') {
    const v = value as ManifestViewport;
    if (typeof v.width === 'number' && typeof v.height === 'number') {
      return `${v.width}×${v.height} @${v.devicePixelRatio}x`;
    }
  }
  return String(value);
}

/**
 * Format one system group's aggregate CPU cost for display. The UNKNOWN
 * sentinel renders as the literal "unknown" — a group the engine did not
 * measure (e.g. rendering/GPU this slice, OP-02) must never surface as a real
 * `0.00 ms`, which would read as "measured and free".
 */
function formatSystemCost(totalMs: number | typeof UNKNOWN): string {
  return totalMs === UNKNOWN ? 'unknown' : `${totalMs.toFixed(2)} ms`;
}

const MANIFEST_ROWS: Array<[keyof MeasurementManifest, string]> = [
  ['backend', 'Backend'],
  ['browserVersion', 'Browser'],
  ['os', 'OS'],
  ['deviceMemory', 'Device memory (GB)'],
  ['viewport', 'Viewport'],
  ['gpuDriver', 'GPU / driver'],
  ['buildSha', 'Build'],
  ['fixtureChecksum', 'Fixture'],
  ['cacheState', 'Cache'],
  ['sampleCount', 'Samples'],
];

/**
 * Colours come only from `var(--sf-*)` tokens (#9904 board round 1), so the
 * panel follows all seven themes. The `--sf-status-*-indicator` tokens are
 * pinned at >= 4.5:1 on `--sf-bg-surface` — the surface this panel paints —
 * in every theme by packages/ui/src/tokens/__tests__/themes.test.ts. Class
 * names are spelled out in full so Tailwind's source scan generates them.
 */
type Status = 'healthy' | 'degraded' | 'down';

const STATUS_TEXT: Record<Status, string> = {
  healthy: 'text-[var(--sf-status-healthy-indicator)]',
  degraded: 'text-[var(--sf-status-degraded-indicator)]',
  down: 'text-[var(--sf-status-down-indicator)]',
};

const STATUS_STROKE: Record<Status, string> = {
  healthy: 'stroke-[var(--sf-status-healthy-indicator)]',
  degraded: 'stroke-[var(--sf-status-degraded-indicator)]',
  down: 'stroke-[var(--sf-status-down-indicator)]',
};

/** Muted copy for labels and for a value that was not measured. */
const SECONDARY = 'text-[var(--sf-text-secondary)]';
const UNMEASURED = 'text-[var(--sf-text-secondary)] italic';

/**
 * The library Progress fills with `--sf-accent`. A budget bar has to show a
 * status instead, so it re-scopes that one custom property to the matching
 * status token on the bar's own subtree: the library primitive, recoloured
 * through the theme, with no palette value anywhere.
 */
function statusFill(status: Status): React.CSSProperties {
  return { '--sf-accent': `var(--sf-status-${status}-indicator)` } as React.CSSProperties;
}

/** Budget usage: past the warning threshold is down, past 60% is degraded. */
function usageStatus(usagePct: number, warningThreshold: number): Status {
  if (usagePct > warningThreshold * 100) return 'down';
  if (usagePct > 60) return 'degraded';
  return 'healthy';
}

export function PerformanceProfiler() {
  const {
    stats,
    isProfilerOpen,
    history,
    budget,
    warnings,
    setProfilerOpen,
    updateStats,
    captureReport,
    capturedReport,
    captureActive,
    systemCosts,
    startSystemCapture,
    stopSystemCapture,
  } = usePerformanceStore();

  // Update stats periodically (every frame)
  useEffect(() => {
    let frameId: number;
    let lastTime = performance.now();
    let frameCount = 0;
    let fpsTime = 0;

    const updateFrame = () => {
      const now = performance.now();
      const delta = now - lastTime;
      lastTime = now;

      frameCount++;
      fpsTime += delta;

      if (fpsTime >= 1000) {
        const fps = Math.round((frameCount * 1000) / fpsTime);
        const frameTime = fpsTime / frameCount;

        updateStats({
          fps,
          frameTime,
          // performance.memory is Chromium-only. Where it is missing the heap is
          // unknown — this used to write 0 MB into `memoryUsage`, overwriting
          // the engine's mesh-memory figure with a fake measurement (#10013).
          jsHeapMb: readMemoryAvailability(performance as unknown as PerformanceMemoryLike, undefined).jsHeapUsedMb,
        });

        frameCount = 0;
        fpsTime = 0;
      }

      frameId = requestAnimationFrame(updateFrame);
    };

    frameId = requestAnimationFrame(updateFrame);

    return () => {
      cancelAnimationFrame(frameId);
    };
  }, [updateStats]);

  const handleToggle = useCallback(() => {
    setProfilerOpen(!isProfilerOpen);
  }, [isProfilerOpen, setProfilerOpen]);

  // Manual capture: snapshot the current stats and pin them to a measurement
  // manifest describing this machine + build and the engine's selected backend.
  // Every metadata field the browser cannot expose is recorded as
  // 'unknown' by the builder (never a zero). Operation performance.FR-3.OP-01.
  const handleCapture = useCallback(async () => {
    const manifest = await buildMeasurementManifestAsync({
      backend: getActiveEngineBackend(),
      sampleCount: history.length,
    });
    captureReport({ stats, manifest, capturedAt: Date.now() });
  }, [captureReport, history.length, stats]);

  // Manual system-timing capture (performance.FR-1.OP-01/OP-04). Arms the JS
  // session (store) AND signals the engine to begin/stop emitting per-frame
  // SYSTEM_TIMINGS. Engine signalling is best-effort: it no-ops when the WASM
  // module is not loaded (tests, @ui E2E), and the store session stays
  // authoritative for what the panel shows.
  const handleToggleSystemCapture = useCallback(() => {
    const next = !captureActive;
    if (next) {
      startSystemCapture();
    } else {
      stopSystemCapture();
    }
    try {
      getWasmModule()?.set_system_timing_capture?.(next);
    } catch {
      // best-effort only
    }
  }, [captureActive, startSystemCapture, stopSystemCapture]);

  // Keyboard shortcut (F12 or Ctrl+Shift+P)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F12' || (e.ctrlKey && e.shiftKey && e.key === 'P')) {
        e.preventDefault();
        setProfilerOpen(!isProfilerOpen);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isProfilerOpen, setProfilerOpen]);

  const triangleUsage = (stats.triangleCount / budget.maxTriangles) * 100;
  const drawCallUsage = (stats.drawCalls / budget.maxDrawCalls) * 100;
  const fpsStatus: Status = stats.fps < budget.targetFps * 0.9 ? 'down' : 'healthy';
  const triangleStatus = usageStatus(triangleUsage, budget.warningThreshold);
  const drawCallStatus = usageStatus(drawCallUsage, budget.warningThreshold);

  const hasWarnings = warnings.length > 0;

  return (
    // `fixed bottom-4 left-4 z-50` is also the selector the E2E editor fixture
    // uses to hide this overlay (web/e2e/fixtures/editor.fixture.ts).
    <div className="fixed bottom-4 left-4 right-4 z-50 bg-[var(--sf-bg-surface)] text-[var(--sf-text)] rounded-[var(--sf-radius-lg)] shadow-2xl border border-[var(--sf-border-strong)] sm:right-auto sm:min-w-[320px]">
      {/* Header */}
      <Button
        type="button"
        variant="ghost"
        onClick={handleToggle}
        aria-expanded={isProfilerOpen}
        aria-label={isProfilerOpen ? 'Collapse performance panel' : 'Expand performance panel'}
        className="w-full h-auto min-h-[44px] px-4 py-2 justify-between rounded-b-none text-[var(--sf-text)] active:scale-100"
      >
        <span className="flex items-center gap-2">
          <span className="font-medium">Performance</span>
          {hasWarnings && (
            <AlertTriangle className={cn('w-4 h-4', STATUS_TEXT.degraded)} aria-hidden="true" />
          )}
        </span>
        {isProfilerOpen ? (
          <ChevronDown className="w-4 h-4" aria-hidden="true" />
        ) : (
          <ChevronUp className="w-4 h-4" aria-hidden="true" />
        )}
      </Button>

      {/* Collapsed view */}
      {!isProfilerOpen && (
        <div className="px-4 py-2 text-sm border-t border-[var(--sf-border)]">
          <div className="flex items-center gap-4">
            <div className={STATUS_TEXT[fpsStatus]}>
              {stats.fps} FPS
            </div>
            <div className={SECONDARY}>
              {stats.triangleCount.toLocaleString()} tris
            </div>
          </div>
        </div>
      )}

      {/* Expanded view */}
      {isProfilerOpen && (
        <div className="p-4 space-y-3 border-t border-[var(--sf-border)] max-h-[75vh] overflow-y-auto">
          {/* FPS Counter */}
          <div>
            <div className="flex justify-between text-sm mb-1">
              <span>FPS</span>
              <span className={cn(STATUS_TEXT[fpsStatus], fpsStatus === 'down' && 'font-medium')}>
                {stats.fps}
              </span>
            </div>
            <div className="h-8 bg-[var(--sf-bg-elevated)] rounded-[var(--sf-radius-sm)] relative overflow-hidden">
              {/* Sparkline */}
              <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="FPS history sparkline">
                <polyline
                  points={history
                    .map((s, i) => {
                      const x = (i / 59) * 100;
                      const y = 100 - (s.fps / budget.targetFps) * 100;
                      return `${x},${Math.max(0, Math.min(100, y))}`;
                    })
                    .join(' ')}
                  fill="none"
                  className={STATUS_STROKE[fpsStatus]}
                  strokeWidth="2"
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
            </div>
          </div>

          {/* Frame Time */}
          <div className="flex justify-between text-sm">
            <span className={SECONDARY}>Frame Time</span>
            <span>{stats.frameTime.toFixed(2)} ms</span>
          </div>

          {/* Triangle Count */}
          <div>
            <div className="flex justify-between text-sm mb-1">
              <span>Triangles</span>
              <span className={triangleStatus === 'down' ? STATUS_TEXT.degraded : undefined}>
                {stats.triangleCount.toLocaleString()} / {budget.maxTriangles.toLocaleString()}
              </span>
            </div>
            <Progress
              value={Math.round(triangleUsage)}
              label="Triangle budget usage"
              className="h-2"
              style={statusFill(triangleStatus)}
            />
          </div>

          {/* Draw Calls */}
          <div>
            <div className="flex justify-between text-sm mb-1">
              <span>Draw Calls</span>
              <span className={drawCallStatus === 'down' ? STATUS_TEXT.degraded : undefined}>
                {stats.drawCalls} / {budget.maxDrawCalls}
              </span>
            </div>
            <Progress
              value={Math.round(drawCallUsage)}
              label="Draw call budget usage"
              className="h-2"
              style={statusFill(drawCallStatus)}
            />
          </div>

          {/* Entity Count */}
          <div className="flex justify-between text-sm">
            <span className={SECONDARY}>Entities</span>
            <span>{stats.entityCount}</span>
          </div>

          {/* Memory: engine mesh memory and the JS heap, each unknown until measured */}
          <div className="flex justify-between text-sm">
            <span className={SECONDARY}>Mesh memory</span>
            <span className={stats.memoryUsage === UNKNOWN ? UNMEASURED : undefined}>
              {stats.memoryUsage === UNKNOWN ? 'unknown' : `${stats.memoryUsage.toFixed(1)} MB`}
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span className={SECONDARY}>JS heap</span>
            <span className={stats.jsHeapMb === UNKNOWN || stats.jsHeapMb === undefined ? UNMEASURED : undefined}>
              {stats.jsHeapMb === UNKNOWN || stats.jsHeapMb === undefined ? 'unknown' : `${stats.jsHeapMb.toFixed(1)} MB`}
            </span>
          </div>

          {/* Warnings: polite, since they refresh with the stats every second */}
          {hasWarnings && (
            <InlineAlert variant="warning" aria-label="Performance warnings" className="mt-3 space-y-1">
              {warnings.map((warning, i) => (
                <div key={i} className="flex items-start gap-2 text-sm">
                  <AlertTriangle className={cn('w-4 h-4 flex-shrink-0 mt-0.5', STATUS_TEXT.degraded)} aria-hidden="true" />
                  <span>{warning}</span>
                </div>
              ))}
            </InlineAlert>
          )}

          {/* Top costly systems (performance.FR-1.OP-01/OP-04) */}
          <div className="mt-3 pt-3 border-t border-[var(--sf-border)]" aria-label="Top costly systems">
            <div className="flex items-center justify-between mb-1">
              <div className={cn('text-xs uppercase tracking-wide', SECONDARY)}>
                Top costly systems
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={handleToggleSystemCapture}
                aria-pressed={captureActive}
              >
                {captureActive ? 'Stop capture' : 'Capture systems'}
              </Button>
            </div>
            <div className="space-y-0.5">
              {systemCosts.map((cost) => {
                const display = formatSystemCost(cost.totalMs);
                const isUnknown = cost.totalMs === UNKNOWN;
                return (
                  <div key={cost.group} className="flex justify-between text-xs">
                    <span className={SECONDARY}>{cost.label}</span>
                    <span className={isUnknown ? UNMEASURED : undefined}>{display}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Manual capture */}
          <div className="mt-3 pt-3 border-t border-[var(--sf-border)]">
            <Button type="button" size="sm" onClick={handleCapture} className="w-full">
              Capture report
            </Button>
          </div>

          {/* Timed, manifest-pinned capture shared with the in-app AI (#10013) */}
          <PerformanceCapturePanel />

          {/* Captured report — stats pinned to a measurement manifest */}
          {capturedReport && (
            <div
              className="mt-3 pt-3 border-t border-[var(--sf-border)] space-y-1"
              aria-label="Captured measurement manifest"
            >
              <div className={cn('text-xs uppercase tracking-wide mb-1', SECONDARY)}>
                Measurement manifest
              </div>
              {MANIFEST_ROWS.map(([key, label]) => {
                const raw = capturedReport.manifest[key];
                const display = formatManifestValue(raw);
                const isUnknown = display === 'unknown';
                return (
                  <div key={key} className="flex justify-between text-xs">
                    <span className={SECONDARY}>{label}</span>
                    <span className={isUnknown ? UNMEASURED : undefined}>{display}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
