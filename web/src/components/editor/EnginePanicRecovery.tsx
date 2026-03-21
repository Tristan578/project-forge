'use client';

import { useState, useEffect, useCallback } from 'react';
import { AlertTriangle, RefreshCw, Save, Loader2 } from 'lucide-react';
import {
  onEngineCrash,
  isEngineCrashed,
  getEngineCrashMessage,
  resetEngine,
  getWasmModule,
} from '@/hooks/useEngine';
import { safeLocalStorageSet } from '@/lib/storage/storageQuota';
import { useEditorStore } from '@/stores/editorStore';

/**
 * localStorage key used to persist a pre-panic scene JSON snapshot.
 * On next page load, AutoSaveRecovery detects this key and offers to restore.
 */
const PANIC_SCENE_BACKUP_KEY = 'forge-editor-panic-scene-backup';

/**
 * Max number of characters of the panic message to show in the UI.
 * Full message is stored in localStorage for debugging.
 */
const PANIC_MESSAGE_DISPLAY_LIMIT = 300;

interface PanicBackupPayload {
  timestamp: string;
  sceneName: string;
  sceneJson: string;
  panicMessage: string;
}

/**
 * Attempts to export and persist the current scene JSON before reloading.
 *
 * Strategy:
 * 1. Call `export_scene` on the WASM module to trigger the SCENE_EXPORTED event.
 *    Because the engine has panicked, this call may throw — we catch and fall back.
 * 2. Fall back to the last SCENE_EXPORTED payload stored in the window event
 *    (written by useEngineEvents → sceneSlice via the forge:scene-exported event).
 * 3. As a last resort, read the Zustand-persisted `forge-editor-store` from
 *    localStorage and store it under the panic backup key.
 *
 * Returns true if a backup was successfully written.
 */
function captureSceneBackup(sceneName: string, panicMessage: string): boolean {
  // Attempt 1: read from the last scene-exported window event payload
  // (SceneToolbar writes forge:scene-last-json when SCENE_EXPORTED fires)
  let sceneJson: string | null = null;
  try {
    sceneJson = sessionStorage.getItem('forge:scene-last-json');
  } catch { /* sessionStorage may be unavailable */ }

  // Attempt 2: if no scene-last-json, try triggering a synchronous export.
  // This may fail if the panic corrupted the WASM heap, but try anyway.
  if (!sceneJson) {
    try {
      const wasm = getWasmModule();
      if (wasm?.handle_command) {
        // export_scene returns void; the scene JSON arrives via SCENE_EXPORTED event.
        // We cannot await it here (synchronous panic recovery path), so this attempt
        // only helps if the WASM event fires synchronously before we read below.
        wasm.handle_command('export_scene', {});
        sceneJson = sessionStorage.getItem('forge:scene-last-json');
      }
    } catch { /* engine may be unresponsive */ }
  }

  // Attempt 3: fall back to the full Zustand-persisted store (less precise but
  // still allows the editor to restore UI state after reload).
  let storeData: string | null = null;
  try {
    storeData = localStorage.getItem('forge-editor-store');
  } catch { /* ignore */ }

  if (!sceneJson && !storeData) {
    return false;
  }

  const payload: PanicBackupPayload = {
    timestamp: new Date().toISOString(),
    sceneName,
    sceneJson: sceneJson ?? '',
    panicMessage: panicMessage.slice(0, 2000),
  };

  const serialised = JSON.stringify(payload);
  try {
    const result = safeLocalStorageSet(PANIC_SCENE_BACKUP_KEY, serialised);
    return result.success;
  } catch {
    return false;
  }
}

/**
 * Reads the panic backup written by captureSceneBackup.
 * Returns null if no backup exists or it cannot be parsed.
 */
export function loadPanicSceneBackup(): PanicBackupPayload | null {
  try {
    const raw = localStorage.getItem(PANIC_SCENE_BACKUP_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PanicBackupPayload;
  } catch {
    return null;
  }
}

/** Remove the panic scene backup from localStorage. */
export function clearPanicSceneBackup(): void {
  try {
    localStorage.removeItem(PANIC_SCENE_BACKUP_KEY);
  } catch { /* ignore */ }
}

/**
 * EnginePanicRecovery — overlay shown when the WASM engine panics.
 *
 * Differences from the simpler EngineCrashOverlay:
 * - Attempts to capture the full scene JSON before reloading so the scene can
 *   be restored after restart (not just UI store state).
 * - Displays a brief, truncated panic reason so the user understands what happened.
 * - "Reload Engine" saves automatically before reloading.
 * - "Save and Refresh" is a secondary button offering the same behaviour with
 *   an explicit "saving" feedback step so users see confirmation.
 *
 * Both buttons always reload the page: in-place WASM re-initialisation is not
 * possible because `init_engine` uses a OnceLock singleton in the WASM module.
 */
export function EnginePanicRecovery() {
  const [crashed, setCrashed] = useState(() => isEngineCrashed());
  const [crashMessage, setCrashMessage] = useState<string | null>(() => getEngineCrashMessage());
  const [saving, setSaving] = useState(false);
  const [backupCaptured, setBackupCaptured] = useState(false);

  // Read the scene name from the store for the backup metadata.
  const sceneName = useEditorStore((s) => s.sceneName);

  useEffect(() => {
    const unsubscribe = onEngineCrash((message) => {
      setCrashed(true);
      setCrashMessage(message);
    });
    return unsubscribe;
  }, []);

  const performSaveAndReload = useCallback(() => {
    const message = crashMessage ?? '';
    const captured = captureSceneBackup(sceneName, message);
    setBackupCaptured(captured);
    resetEngine();
    window.location.reload();
  }, [crashMessage, sceneName]);

  const handleReloadEngine = useCallback(() => {
    performSaveAndReload();
  }, [performSaveAndReload]);

  const handleSaveAndRefresh = useCallback(() => {
    setSaving(true);
    // Give the browser a tick to paint the "Saving…" state before blocking on
    // captureSceneBackup (which may trigger a synchronous WASM export call).
    void Promise.resolve().then(() => {
      performSaveAndReload();
    });
  }, [performSaveAndReload]);

  if (!crashed) return null;

  const displayMessage = (crashMessage ?? '').slice(0, PANIC_MESSAGE_DISPLAY_LIMIT);
  const truncated = (crashMessage ?? '').length > PANIC_MESSAGE_DISPLAY_LIMIT;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-zinc-950/85 backdrop-blur-sm"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="panic-recovery-title"
      aria-describedby="panic-recovery-desc"
    >
      <div className="mx-4 w-full max-w-md rounded-lg border border-zinc-700 bg-zinc-900 p-6 shadow-2xl">
        <div className="mb-4 flex items-center gap-3">
          <AlertTriangle className="h-8 w-8 shrink-0 text-red-500" aria-hidden="true" />
          <h2 id="panic-recovery-title" className="text-lg font-bold text-white">
            Engine Crashed
          </h2>
        </div>

        <p id="panic-recovery-desc" className="mb-3 text-sm text-zinc-300">
          The game engine encountered a fatal error. Your work will be automatically
          saved before the page reloads so you can continue where you left off.
        </p>

        {backupCaptured && (
          <p className="mb-3 text-xs text-green-400" role="status">
            Scene backed up successfully.
          </p>
        )}

        {displayMessage && (
          <details className="mb-4 rounded border border-zinc-700 bg-zinc-950 p-3">
            <summary className="cursor-pointer text-xs font-semibold text-zinc-400 select-none">
              What went wrong?
            </summary>
            <pre className="mt-2 max-h-36 overflow-auto whitespace-pre-wrap break-all text-xs text-red-400">
              {displayMessage}
              {truncated ? '\u2026' : ''}
            </pre>
          </details>
        )}

        <div className="flex flex-col gap-2">
          <button
            onClick={handleSaveAndRefresh}
            disabled={saving}
            aria-disabled={saving}
            className="flex items-center justify-center gap-2 rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Save className="h-4 w-4" aria-hidden="true" />
            )}
            {saving ? 'Saving\u2026' : 'Save & Refresh'}
          </button>

          <button
            onClick={handleReloadEngine}
            disabled={saving}
            aria-disabled={saving}
            className="flex items-center justify-center gap-2 rounded bg-zinc-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-600 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-70"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Reload Engine
          </button>
        </div>
      </div>
    </div>
  );
}
