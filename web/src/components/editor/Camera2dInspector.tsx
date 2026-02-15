'use client';

import { useCallback } from 'react';
import { useEditorStore, type Camera2dData } from '@/stores/editorStore';

export function Camera2dInspector() {
  const camera2dData = useEditorStore((s) => s.camera2dData);

  const handleUpdate = useCallback(
    (_partial: Partial<Camera2dData>) => {
      if (camera2dData) {
        // TODO: dispatch camera2d update command
        // dispatchCommand('update_camera2d', { ..._partial });
      }
    },
    [camera2dData]
  );

  if (!camera2dData) return null;

  return (
    <div className="border-t border-zinc-800 pt-4">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">
        2D Camera
      </h3>

      <div className="space-y-3">
        {/* Zoom Slider */}
        <div className="flex items-center gap-2">
          <label className="w-20 shrink-0 text-xs text-zinc-400">Zoom</label>
          <input
            type="range"
            min={0.1}
            max={10}
            step={0.1}
            value={camera2dData.zoom}
            onChange={(e) => handleUpdate({ zoom: parseFloat(e.target.value) })}
            className="h-1 flex-1 cursor-pointer appearance-none rounded bg-zinc-700
              [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3
              [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full
              [&::-webkit-slider-thumb]:bg-zinc-300"
          />
          <span className="w-10 text-right text-xs tabular-nums text-zinc-500">
            {camera2dData.zoom.toFixed(1)}
          </span>
        </div>

        {/* Pixel Perfect */}
        <div className="flex items-center gap-2">
          <label className="w-20 shrink-0 text-xs text-zinc-400">Pixel Perfect</label>
          <input
            type="checkbox"
            checked={camera2dData.pixelPerfect}
            onChange={(e) => handleUpdate({ pixelPerfect: e.target.checked })}
            className="h-3.5 w-3.5 rounded border-zinc-600 bg-zinc-800 text-blue-500 accent-blue-500
              focus:ring-1 focus:ring-blue-500 focus:ring-offset-0"
          />
        </div>

        {/* Camera Bounds Section */}
        <div className="border-t border-zinc-800 pt-2">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={camera2dData.bounds !== null}
              onChange={(e) =>
                handleUpdate({
                  bounds: e.target.checked ? { minX: -10, maxX: 10, minY: -10, maxY: 10 } : null,
                })
              }
              className="h-3.5 w-3.5 rounded border-zinc-600 bg-zinc-800 text-blue-500 accent-blue-500"
            />
            <span className="text-xs text-zinc-400">Enable Bounds</span>
          </label>

          {camera2dData.bounds && (
            <div className="mt-2 space-y-2">
              <div className="flex items-center gap-2">
                <label className="w-20 shrink-0 text-xs text-zinc-400">Min X</label>
                <input
                  type="number"
                  step={0.5}
                  value={camera2dData.bounds.minX}
                  onChange={(e) =>
                    handleUpdate({
                      bounds: { ...camera2dData.bounds!, minX: parseFloat(e.target.value) },
                    })
                  }
                  className="flex-1 rounded border border-zinc-600 bg-zinc-800 px-2 py-1 text-xs text-white"
                />
              </div>
              <div className="flex items-center gap-2">
                <label className="w-20 shrink-0 text-xs text-zinc-400">Max X</label>
                <input
                  type="number"
                  step={0.5}
                  value={camera2dData.bounds.maxX}
                  onChange={(e) =>
                    handleUpdate({
                      bounds: { ...camera2dData.bounds!, maxX: parseFloat(e.target.value) },
                    })
                  }
                  className="flex-1 rounded border border-zinc-600 bg-zinc-800 px-2 py-1 text-xs text-white"
                />
              </div>
              <div className="flex items-center gap-2">
                <label className="w-20 shrink-0 text-xs text-zinc-400">Min Y</label>
                <input
                  type="number"
                  step={0.5}
                  value={camera2dData.bounds.minY}
                  onChange={(e) =>
                    handleUpdate({
                      bounds: { ...camera2dData.bounds!, minY: parseFloat(e.target.value) },
                    })
                  }
                  className="flex-1 rounded border border-zinc-600 bg-zinc-800 px-2 py-1 text-xs text-white"
                />
              </div>
              <div className="flex items-center gap-2">
                <label className="w-20 shrink-0 text-xs text-zinc-400">Max Y</label>
                <input
                  type="number"
                  step={0.5}
                  value={camera2dData.bounds.maxY}
                  onChange={(e) =>
                    handleUpdate({
                      bounds: { ...camera2dData.bounds!, maxY: parseFloat(e.target.value) },
                    })
                  }
                  className="flex-1 rounded border border-zinc-600 bg-zinc-800 px-2 py-1 text-xs text-white"
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
