/**
 * Pointer lock hook for FirstPerson camera mouse look.
 *
 * When in Play mode with a FirstPerson camera active, this hook:
 * 1. Requests pointer lock on the canvas when clicked
 * 2. Captures raw mouse movement deltas (movementX/Y)
 * 3. Sends them to the engine as 'mouse_delta' commands
 * 4. Releases pointer lock when Play mode ends or camera mode changes
 */

import { useEffect } from 'react';
import { useEditorStore } from '@/stores/editorStore';
import { getWasmModule } from './useEngine';

export function usePointerLock(canvasId: string): void {
  const isPlaying = useEditorStore(
    (s) => s.engineMode === 'play'
  );
  const activeCamera = useEditorStore((s) => s.activeGameCameraId);
  const cameraMode = useEditorStore((s) => {
    if (!activeCamera) return null;
    const cam = s.allGameCameras[activeCamera];
    return cam?.mode ?? null;
  });
  const isFirstPerson = cameraMode === 'firstPerson';

  useEffect(() => {
    const canvas = document.getElementById(canvasId) as HTMLCanvasElement | null;
    if (!canvas || !isPlaying || !isFirstPerson) return;

    const requestLock = () => {
      if (document.pointerLockElement !== canvas) {
        canvas.requestPointerLock();
      }
    };

    let pendingDx = 0, pendingDy = 0;
    let rafId: number | null = null;

    const handleMouseMove = (e: MouseEvent) => {
      if (document.pointerLockElement !== canvas) return;
      pendingDx += e.movementX;
      pendingDy += e.movementY;
      if (rafId === null) {
        rafId = requestAnimationFrame(() => {
          rafId = null;
          const wasm = getWasmModule();
          if (wasm && (pendingDx !== 0 || pendingDy !== 0)) {
            try {
              wasm.handle_command('mouse_delta', { dx: pendingDx, dy: pendingDy });
            } catch {
              // Silently ignore command errors during mouse movement
            }
            pendingDx = 0;
            pendingDy = 0;
          }
        });
      }
    };

    canvas.addEventListener('click', requestLock);
    document.addEventListener('mousemove', handleMouseMove, { passive: true });

    // Auto-request pointer lock on Play start
    requestLock();

    return () => {
      canvas.removeEventListener('click', requestLock);
      document.removeEventListener('mousemove', handleMouseMove);
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      if (document.pointerLockElement === canvas) {
        document.exitPointerLock();
      }
    };
  }, [canvasId, isPlaying, isFirstPerson]);
}
