import React, { useEffect, useCallback } from 'react';
import { usePerformanceStore } from '@/stores/performanceStore';
import { ChevronDown, ChevronUp, AlertTriangle } from 'lucide-react';

export function PerformanceProfiler() {
  const {
    stats,
    isProfilerOpen,
    history,
    budget,
    warnings,
    setProfilerOpen,
    updateStats,
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
    <div className="fixed bottom-4 left-4 z-50 bg-gray-900 text-white rounded-lg shadow-2xl border border-gray-700 min-w-[320px]">
      {/* Header */}
      <button
        onClick={handleToggle}
        className="w-full px-4 py-2 flex items-center justify-between hover:bg-gray-800 rounded-t-lg transition-colors"
      >
        <div className="flex items-center gap-2">
          <div className="font-medium">Performance</div>
          {hasWarnings && (
            <AlertTriangle className="w-4 h-4 text-yellow-500" />
          )}
        </div>
        {isProfilerOpen ? (
          <ChevronDown className="w-4 h-4" />
        ) : (
          <ChevronUp className="w-4 h-4" />
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
              <svg className="absolute inset-0 w-full h-full">
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
            <div className="h-2 bg-gray-800 rounded overflow-hidden">
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
            <div className="h-2 bg-gray-800 rounded overflow-hidden">
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
            <div className="mt-3 pt-3 border-t border-gray-700 space-y-1">
              {warnings.map((warning, i) => (
                <div key={i} className="flex items-start gap-2 text-yellow-400 text-sm">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span>{warning}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
