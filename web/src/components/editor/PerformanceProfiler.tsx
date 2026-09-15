import React, { useEffect, useCallback } from 'react';
import { usePerformanceStore } from '@/stores/performanceStore';
import { ChevronDown, ChevronUp, AlertTriangle } from 'lucide-react';
import {
  buildMeasurementManifestAsync,
  UNKNOWN,
  type MeasurementManifest,
  type ManifestViewport,
} from '@/lib/config/measurementManifest';
import { getActiveEngineBackend } from '@/hooks/useEngine';

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
          memoryUsage: (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory
            ? Math.round(((performance as unknown as { memory: { usedJSHeapSize: number } }).memory.usedJSHeapSize / 1024 / 1024) * 10) / 10
            : 0,
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
  const fpsPercentage = (stats.fps / budget.targetFps) * 100;

  const hasWarnings = warnings.length > 0;

  return (
    <div className="fixed bottom-4 left-4 right-4 z-50 bg-gray-900 text-white rounded-lg shadow-2xl border border-gray-700 sm:right-auto sm:min-w-[320px]">
      {/* Header */}
      <button
        onClick={handleToggle}
        aria-expanded={isProfilerOpen}
        aria-label={isProfilerOpen ? 'Collapse performance panel' : 'Expand performance panel'}
        className="w-full px-4 py-2 flex items-center justify-between hover:bg-gray-800 rounded-t-lg transition-colors"
      >
        <div className="flex items-center gap-2">
          <div className="font-medium">Performance</div>
          {hasWarnings && (
            <AlertTriangle className="w-4 h-4 text-yellow-500" aria-hidden="true" />
          )}
        </div>
        {isProfilerOpen ? (
          <ChevronDown className="w-4 h-4" aria-hidden="true" />
        ) : (
          <ChevronUp className="w-4 h-4" aria-hidden="true" />
        )}
      </button>

      {/* Collapsed view */}
      {!isProfilerOpen && (
        <div className="px-4 py-2 text-sm border-t border-gray-700">
          <div className="flex items-center gap-4">
            <div className={stats.fps < budget.targetFps * 0.9 ? 'text-red-400' : 'text-green-400'}>
              {stats.fps} FPS
            </div>
            <div className="text-gray-400">
              {stats.triangleCount.toLocaleString()} tris
            </div>
          </div>
        </div>
      )}

      {/* Expanded view */}
      {isProfilerOpen && (
        <div className="p-4 space-y-3 border-t border-gray-700">
          {/* FPS Counter */}
          <div>
            <div className="flex justify-between text-sm mb-1">
              <span>FPS</span>
              <span className={stats.fps < budget.targetFps * 0.9 ? 'text-red-400 font-medium' : 'text-green-400'}>
                {stats.fps}
              </span>
            </div>
            <div className="h-8 bg-gray-800 rounded relative overflow-hidden">
              {/* Sparkline */}
              <svg className="absolute inset-0 w-full h-full" role="img" aria-label="FPS history sparkline">
                <polyline
                  points={history
                    .map((s, i) => {
                      const x = (i / 59) * 100;
                      const y = 100 - (s.fps / budget.targetFps) * 100;
                      return `${x}%,${Math.max(0, Math.min(100, y))}%`;
                    })
                    .join(' ')}
                  fill="none"
                  stroke={fpsPercentage >= 90 ? '#4ade80' : '#ef4444'}
                  strokeWidth="2"
                />
              </svg>
            </div>
          </div>

          {/* Frame Time */}
          <div className="flex justify-between text-sm">
            <span className="text-gray-400">Frame Time</span>
            <span>{stats.frameTime.toFixed(2)} ms</span>
          </div>

          {/* Triangle Count */}
          <div>
            <div className="flex justify-between text-sm mb-1">
              <span>Triangles</span>
              <span className={triangleUsage > budget.warningThreshold * 100 ? 'text-yellow-400' : ''}>
                {stats.triangleCount.toLocaleString()} / {budget.maxTriangles.toLocaleString()}
              </span>
            </div>
            <div className="h-2 bg-gray-800 rounded overflow-hidden" role="progressbar" aria-valuenow={Math.round(triangleUsage)} aria-valuemin={0} aria-valuemax={100} aria-label="Triangle budget usage">
              <div
                className={`h-full transition-all ${
                  triangleUsage > budget.warningThreshold * 100
                    ? 'bg-red-500'
                    : triangleUsage > 60
                    ? 'bg-yellow-500'
                    : 'bg-green-500'
                }`}
                style={{ width: `${Math.min(100, triangleUsage)}%` }}
              />
            </div>
          </div>

          {/* Draw Calls */}
          <div>
            <div className="flex justify-between text-sm mb-1">
              <span>Draw Calls</span>
              <span className={drawCallUsage > budget.warningThreshold * 100 ? 'text-yellow-400' : ''}>
                {stats.drawCalls} / {budget.maxDrawCalls}
              </span>
            </div>
            <div className="h-2 bg-gray-800 rounded overflow-hidden" role="progressbar" aria-valuenow={Math.round(drawCallUsage)} aria-valuemin={0} aria-valuemax={100} aria-label="Draw call budget usage">
              <div
                className={`h-full transition-all ${
                  drawCallUsage > budget.warningThreshold * 100
                    ? 'bg-red-500'
                    : drawCallUsage > 60
                    ? 'bg-yellow-500'
                    : 'bg-green-500'
                }`}
                style={{ width: `${Math.min(100, drawCallUsage)}%` }}
              />
            </div>
          </div>

          {/* Entity Count */}
          <div className="flex justify-between text-sm">
            <span className="text-gray-400">Entities</span>
            <span>{stats.entityCount}</span>
          </div>

          {/* Memory Usage */}
          <div className="flex justify-between text-sm">
            <span className="text-gray-400">Memory</span>
            <span>{stats.memoryUsage.toFixed(1)} MB</span>
          </div>

          {/* Warnings */}
          {hasWarnings && (
            <div role="alert" aria-label="Performance warnings" className="mt-3 pt-3 border-t border-gray-700 space-y-1">
              {warnings.map((warning, i) => (
                <div key={i} className="flex items-start gap-2 text-yellow-400 text-sm">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span>{warning}</span>
                </div>
              ))}
            </div>
          )}

          {/* Manual capture */}
          <div className="mt-3 pt-3 border-t border-gray-700">
            <button
              type="button"
              onClick={handleCapture}
              className="w-full px-3 py-1.5 text-sm rounded bg-blue-600 hover:bg-blue-500 transition-colors"
            >
              Capture report
            </button>
          </div>

          {/* Captured report — stats pinned to a measurement manifest */}
          {capturedReport && (
            <div
              className="mt-3 pt-3 border-t border-gray-700 space-y-1"
              aria-label="Captured measurement manifest"
            >
              <div className="text-xs uppercase tracking-wide text-gray-400 mb-1">
                Measurement manifest
              </div>
              {MANIFEST_ROWS.map(([key, label]) => {
                const raw = capturedReport.manifest[key];
                const display = formatManifestValue(raw);
                const isUnknown = display === 'unknown';
                return (
                  <div key={key} className="flex justify-between text-xs">
                    <span className="text-gray-400">{label}</span>
                    <span className={isUnknown ? 'text-gray-400 italic' : ''}>{display}</span>
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
