'use client';

import { useCallback, useMemo } from 'react';
import { useViewport } from '@/hooks/useViewport';
import { useEngineEvents } from '@/hooks/useEngineEvents';
import { usePointerLock } from '@/hooks/usePointerLock';
import { getWasmModule } from '@/hooks/useEngine';
import { useEditorStore } from '@/stores/editorStore';
import { useChatStore } from '@/stores/chatStore';
import { getCanvasKeyMap, eventToKeyCombo } from '@/lib/workspace/keybindings';
import { InitOverlay } from './InitOverlay';
import { ViewPresetButtons } from './ViewPresetButtons';
import { UICanvasOverlay } from './ui-builder/UICanvasOverlay';
import { UIRuntimeRenderer } from './ui-builder/UIRuntimeRenderer';

const CANVAS_ID = 'game-canvas';

/** Map keybinding action names to WASM engine commands. */
const ACTION_COMMANDS: Record<string, (wasm: ReturnType<typeof getWasmModule>) => void> = {
  translate: (w) => w?.handle_command('set_gizmo_mode', { mode: 'translate' }),
  rotate: (w) => w?.handle_command('set_gizmo_mode', { mode: 'rotate' }),
  scale: (w) => w?.handle_command('set_gizmo_mode', { mode: 'scale' }),
  delete: (w) => w?.handle_command('delete_entities', { entityIds: Array.from(useEditorStore.getState().selectedIds) }),
  duplicate: (w) => { const id = useEditorStore.getState().primaryId; if (id) w?.handle_command('duplicate_entity', { entityId: id }); },
  undo: (w) => w?.handle_command('undo', {}),
  redo: (w) => w?.handle_command('redo', {}),
  focus: (w) => { const id = useEditorStore.getState().primaryId; if (id) w?.handle_command('focus_camera', { entityId: id }); },
  deselect: (w) => w?.handle_command('clear_selection', {}),
};

export function CanvasArea() {
  const { dimensions, isReady } = useViewport(CANVAS_ID);
  const hudElements = useEditorStore((s) => s.hudElements);
  const engineMode = useEditorStore((s) => s.engineMode);
  const rightPanelTab = useChatStore((s) => s.rightPanelTab);

  // Connect engine events to Zustand store
  useEngineEvents({ wasmModule: getWasmModule() });

  // Pointer lock for FirstPerson camera mouse look
  usePointerLock(CANVAS_ID);

  // Build key→action map from customizable registry (re-reads on each render
  // so localStorage changes take effect immediately)
  const keyMap = useMemo(() => getCanvasKeyMap(), []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLCanvasElement>) => {
    // Play/Paused mode: Bevy handles keyboard natively, except Escape to exit
    if (engineMode === 'play' || engineMode === 'paused') {
      if (e.key === 'Escape') {
        getWasmModule()?.handle_command('stop', {});
        e.preventDefault();
      }
      return;
    }

    // Skip when focus is in an input/textarea (shouldn't happen on canvas, but guard)
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;

    const combo = eventToKeyCombo(e.nativeEvent);
    if (!combo) return;

    const action = keyMap.get(combo);
    if (!action) return;

    const handler = ACTION_COMMANDS[action];
    if (handler) {
      handler(getWasmModule());
      e.preventDefault();
    }
  }, [engineMode, keyMap]);

  return (
    <div className="relative h-full w-full overflow-hidden bg-zinc-900">
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
