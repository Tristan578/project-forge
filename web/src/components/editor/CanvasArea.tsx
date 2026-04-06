'use client';

import { useCallback } from 'react';
import { useViewport } from '@/hooks/useViewport';
import { useEngineEvents } from '@/hooks/useEngineEvents';
import { usePointerLock } from '@/hooks/usePointerLock';
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

  // Pointer lock for FirstPerson camera mouse look
  usePointerLock(CANVAS_ID);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLCanvasElement>) => {
    // Play mode: Bevy handles keyboard natively, except Escape to exit
    if (engineMode === 'play') {
      if (e.key === 'Escape') {
        getWasmModule()?.handle_command('stop', {});
        e.preventDefault();
      }
      return;
    }

    // Skip when focus is in an input/textarea (shouldn't happen on canvas, but guard)
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;

    const wasm = getWasmModule();
    const ctrl = e.ctrlKey || e.metaKey;

    switch (e.key) {
      // Gizmo modes
      case 'w':
      case 'W':
        if (!ctrl) { wasm?.handle_command('set_gizmo_mode', { mode: 'translate' }); e.preventDefault(); }
        break;
      case 'e':
      case 'E':
        if (!ctrl) { wasm?.handle_command('set_gizmo_mode', { mode: 'rotate' }); e.preventDefault(); }
        break;
      case 'r':
      case 'R':
        if (!ctrl) { wasm?.handle_command('set_gizmo_mode', { mode: 'scale' }); e.preventDefault(); }
        break;

      // Delete
      case 'Delete':
      case 'Backspace':
        wasm?.handle_command('delete_entities', { entityIds: Array.from(useEditorStore.getState().selectedIds) });
        e.preventDefault();
        break;

      // Duplicate
      case 'd':
      case 'D':
        if (ctrl) {
          const primaryId = useEditorStore.getState().primaryId;
          if (primaryId) { wasm?.handle_command('duplicate_entity', { entityId: primaryId }); }
          e.preventDefault();
        }
        break;

      // Undo/Redo
      case 'z':
      case 'Z':
        if (ctrl && e.shiftKey) { wasm?.handle_command('redo', {}); e.preventDefault(); }
        else if (ctrl) { wasm?.handle_command('undo', {}); e.preventDefault(); }
        break;

      // Focus selected
      case 'f':
      case 'F':
        if (!ctrl) { wasm?.handle_command('focus_camera', {}); e.preventDefault(); }
        break;

      // Deselect all
      case 'Escape':
        wasm?.handle_command('clear_selection', {});
        e.preventDefault();
        break;
    }
  }, [engineMode]);

  return (
    <div className="relative h-full w-full overflow-hidden bg-zinc-950">
      <canvas
        id={CANVAS_ID}
        tabIndex={isReady ? 0 : -1}
        role="application"
        aria-label="3D viewport — use keyboard shortcuts to navigate"
        onKeyDown={handleKeyDown}
        className={`block h-full w-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-purple-500/50${isReady ? '' : ' invisible'}`}
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
        <div className="absolute bottom-2 right-2 rounded bg-zinc-900/80 px-2 py-1 text-xs text-zinc-400">
          {dimensions.width} × {dimensions.height}
        </div>
      )}
    </div>
  );
}
