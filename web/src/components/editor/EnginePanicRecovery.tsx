'use client';

/**
 * EnginePanicRecovery
 *
 * Renders a full-screen recovery overlay whenever the WASM engine panics.
 * Listens for crash events emitted by `useEngine.ts` / the Rust panic hook,
 * auto-saves the last known scene state to IndexedDB before recovery, then
 * re-initialises the engine without a full page reload.
 *
 * After a successful restart the parent can replay scene state via the
 * `onRestartComplete` callback.
 */

import { useState, useEffect, useCallback } from 'react';
import { AlertTriangle, RefreshCw, RotateCcw } from 'lucide-react';
import {
  onEngineCrash,
  isEngineCrashed,
  getEngineCrashMessage,
  restartEngine,
  resetEngine,
} from '@/hooks/useEngine';
import { useEditorStore } from '@/stores/editorStore';
import { saveAutoSaveEntry } from '@/lib/storage/autoSave';
import { captureException } from '@/lib/monitoring/sentry-client';

export interface EnginePanicRecoveryProps {
  /** Canvas element ID used by the engine — passed to `restartEngine()`. */
  canvasId: string;
  /**
   * Called after the engine has been successfully restarted.
   * The caller should replay scene state (e.g., call `loadScene`) here.
   */
  onRestartComplete?: () => void;
}

type RecoveryState = 'idle' | 'saving' | 'restarting' | 'error';

/**
 * Attempt to persist the current scene to IndexedDB before restarting so
 * the user does not lose work if the re-init also fails.
 *
 * Strategy:
 * 1. Try to read the last exported scene JSON from localStorage (mirror written
 *    by the SCENE_EXPORTED event handler in transformEvents.ts).
 * 2. Persist it to IndexedDB via saveAutoSaveEntry.
 *
 * This is best-effort: failures are swallowed so the restart proceeds regardless.
 */
async function persistBeforeRestart(projectId: string | null, sceneName: string): Promise<void> {
  if (!projectId || typeof window === 'undefined') return;

  // The SCENE_EXPORTED event handler writes the latest scene JSON to localStorage
  // under the key 'forge:autosave'. Read it here for the panic-time backup.
  const raw = window.localStorage.getItem('forge:autosave');
  if (!raw) return;

  await saveAutoSaveEntry({
    sceneJson: raw,
    sceneName,
    savedAt: new Date().toISOString(),
    projectId,
  });
}

export function EnginePanicRecovery({
  canvasId,
  onRestartComplete,
}: EnginePanicRecoveryProps): React.ReactElement | null {
  const [visible, setVisible] = useState<boolean>(() => isEngineCrashed());
  const [panicMessage, setPanicMessage] = useState<string | null>(() => getEngineCrashMessage());
  const [recoveryState, setRecoveryState] = useState<RecoveryState>('idle');
  const [recoveryError, setRecoveryError] = useState<string | null>(null);

  const projectId = useEditorStore((s) => s.projectId);
  const sceneName = useEditorStore((s) => s.sceneName);

  // Subscribe to crash events emitted by the panic hook or console.error interceptor.
  useEffect(() => {
    const unsubscribe = onEngineCrash((message: string) => {
      setPanicMessage(message);
      setVisible(true);
      setRecoveryState('idle');
      setRecoveryError(null);
    });
    return unsubscribe;
  }, []);

  // Attempt in-place engine restart without page reload.
  const handleRestart = useCallback(async () => {
    setRecoveryState('saving');
    setRecoveryError(null);

    // Save before restart (best-effort).
    try {
      await persistBeforeRestart(projectId, sceneName);
    } catch (saveErr) {
      captureException(saveErr instanceof Error ? saveErr : new Error(String(saveErr)), {
        source: 'EnginePanicRecovery.persistBeforeRestart',
      });
    }

    setRecoveryState('restarting');

    try {
      await restartEngine(canvasId);
      // Hide the overlay and notify parent so it can replay scene state.
      setVisible(false);
      onRestartComplete?.();
    } catch (restartErr) {
      const msg = restartErr instanceof Error ? restartErr.message : String(restartErr);
      captureException(restartErr instanceof Error ? restartErr : new Error(msg), {
        source: 'EnginePanicRecovery.restartEngine',
        canvasId,
      });
      setRecoveryState('error');
      setRecoveryError(msg);
    }
  }, [canvasId, projectId, sceneName, onRestartComplete]);

  // Fall back to a full page reload when in-place restart is not viable.
  const handleHardReload = useCallback(() => {
    resetEngine();
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  }, []);

  if (!visible) return null;

  const isWorking = recoveryState === 'saving' || recoveryState === 'restarting';

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="panic-title"
      aria-describedby="panic-desc"
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm"
    >
      <div className="mx-4 w-full max-w-md rounded-lg border border-zinc-700 bg-zinc-900 p-6 shadow-2xl">
        <div className="mb-4 flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-6 w-6 shrink-0 text-red-400" aria-hidden="true" />
          <div>
            <h2 id="panic-title" className="text-base font-semibold text-zinc-100">
              Engine Crash Detected
            </h2>
            <p id="panic-desc" className="mt-1 text-sm text-zinc-400">
              The WASM engine encountered an unrecoverable error. Your work has been
              auto-saved. You can restart the engine without reloading the page.
            </p>
          </div>
        </div>

        {panicMessage && (
          <details className="mb-4 rounded border border-zinc-700 bg-zinc-950 p-3">
            <summary className="cursor-pointer text-xs font-semibold text-zinc-400 select-none">
              Technical details
            </summary>
            <pre className="mt-2 max-h-32 overflow-auto break-all whitespace-pre-wrap text-xs text-red-400">
              {panicMessage}
            </pre>
          </details>
        )}

        {recoveryError && (
          <div className="mb-4 rounded border border-red-800 bg-red-950/40 p-3">
            <p className="text-xs text-red-300">
              Restart failed: {recoveryError}
            </p>
          </div>
        )}

        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={handleRestart}
            disabled={isWorking}
            aria-busy={isWorking}
            className="flex items-center justify-center gap-2 rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors duration-150 hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-zinc-900 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            {recoveryState === 'saving' && 'Saving…'}
            {recoveryState === 'restarting' && 'Restarting engine…'}
            {(recoveryState === 'idle' || recoveryState === 'error') && 'Reload Engine'}
          </button>

          <button
            type="button"
            onClick={handleHardReload}
            className="flex items-center justify-center gap-2 rounded border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-300 transition-colors duration-150 hover:border-zinc-600 hover:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-500 focus:ring-offset-2 focus:ring-offset-zinc-900"
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            Hard Reload Page
          </button>
        </div>

        <p className="mt-3 text-center text-xs text-zinc-600">
          Use Hard Reload Page if the engine keeps crashing after restart.
        </p>
      </div>
    </div>
  );
}
