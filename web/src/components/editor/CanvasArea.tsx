'use client';

import { useViewport } from '@/hooks/useViewport';
import { useEngineEvents } from '@/hooks/useEngineEvents';
import { getWasmModule } from '@/hooks/useEngine';
import { useEditorStore } from '@/stores/editorStore';
import { useChatStore } from '@/stores/chatStore';
import { InitOverlay } from './InitOverlay';
import { ViewPresetButtons } from './ViewPresetButtons';
import { UICanvasOverlay } from './ui-builder/UICanvasOverlay';
import { UIRuntimeRenderer } from './ui-builder/UIRuntimeRenderer';

const CANVAS_ID = 'game-canvas';

export function CanvasArea() {
  const { dimensions, isReady } = useViewport(CANVAS_ID);
  const hudElements = useEditorStore((s) => s.hudElements);
  const engineMode = useEditorStore((s) => s.engineMode);
  const rightPanelTab = useChatStore((s) => s.rightPanelTab);

  // Connect engine events to Zustand store
  useEngineEvents({ wasmModule: getWasmModule() });

  return (
    <div className="relative h-full w-full overflow-hidden bg-zinc-950">
      <canvas
        id={CANVAS_ID}
        className="block h-full w-full"
      />

      {/* Game HUD overlay - visible during play mode */}
      {engineMode !== 'edit' && hudElements.length > 0 && (
        <div className="pointer-events-none absolute inset-0">
          {hudElements.map((el) => (
            el.visible && (
              <div
                key={el.id}
                className="absolute"
                style={{
                  left: `${el.x}%`,
                  top: `${el.y}%`,
                  fontSize: `${el.fontSize || 24}px`,
                  color: el.color || 'white',
                  textShadow: '1px 1px 2px rgba(0,0,0,0.8)',
                  fontFamily: 'monospace',
                  fontWeight: 'bold',
                }}
              >
                {el.text}
              </div>
            )
          ))}
        </div>
      )}

      {/* UI Builder Canvas Overlay - visible in edit mode when UI tab active */}
      {engineMode === 'edit' && rightPanelTab === 'ui' && <UICanvasOverlay />}

      {/* UI Runtime Renderer - visible in play/paused mode */}
      {engineMode !== 'edit' && <UIRuntimeRenderer />}

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
