'use client';

import { useViewport } from '@/hooks/useViewport';
import { useEngineEvents } from '@/hooks/useEngineEvents';
import { getWasmModule } from '@/hooks/useEngine';
import { InitOverlay } from './InitOverlay';
import { ViewPresetButtons } from './ViewPresetButtons';

const CANVAS_ID = 'game-canvas';

export function CanvasArea() {
  const { dimensions, isReady } = useViewport(CANVAS_ID);

  // Connect engine events to Zustand store
  useEngineEvents({ wasmModule: getWasmModule() });

  return (
    <div className="relative h-full w-full overflow-hidden bg-zinc-950">
      <canvas
        id={CANVAS_ID}
        className="block h-full w-full"
      />

      {/* Initialization overlay with progress and error handling */}
      <InitOverlay />

      {/* Camera preset buttons */}
      {isReady && (
        <div className="absolute top-2 right-2">
          <ViewPresetButtons />
        </div>
      )}

      {/* Dimension indicator (only show when ready) */}
      {isReady && (
        <div className="absolute bottom-2 right-2 rounded bg-zinc-900/80 px-2 py-1 text-xs text-zinc-500">
          {dimensions.width} × {dimensions.height}
        </div>
      )}
    </div>
  );
}
