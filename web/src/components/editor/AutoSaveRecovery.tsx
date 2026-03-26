'use client';

import { useEffect, useState, useCallback } from 'react';
import { AlertTriangle, Loader2, RefreshCw, X } from 'lucide-react';
import { useEditorStore } from '@/stores/editorStore';
import { getWasmModule } from '@/hooks/useEngine';
import {
  loadAutoSaveEntry,
  deleteAutoSaveEntry,
  type AutoSaveEntry,
} from '@/lib/storage/autoSave';

/** How old (in ms) an auto-save entry can be before we consider it stale. */
const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * On mount, checks IndexedDB for a stale auto-save belonging to the current
 * project. If one is found that is newer than the last cloud save, shows a
 * recovery prompt offering to reload the scene from the backup.
 */
export function AutoSaveRecovery() {
  const projectId = useEditorStore((s) => s.projectId);
  const lastCloudSave = useEditorStore((s) => s.lastCloudSave);
  const loadScene = useEditorStore((s) => s.loadScene);
  const setSceneName = useEditorStore((s) => s.setSceneName);

  const [entry, setEntry] = useState<AutoSaveEntry | null>(null);
  const [dismissed, setDismissed] = useState(false);

  // Track whether the WASM engine is ready to accept commands (PF-587).
  // Initialise from the current module state; poll only when the dialog is
  // visible and the engine is not yet initialised.
  const [engineReady, setEngineReady] = useState(() => getWasmModule() !== null);

  // Only start the poll when we have an entry to show and the engine is not yet ready.
  // This avoids an unnecessary interval when the dialog is hidden.
  useEffect(() => {
    if (engineReady || !entry) return;
    const poll = setInterval(() => {
      if (getWasmModule() !== null) {
        setEngineReady(true);
      }
    }, 200);
    return () => clearInterval(poll);
  }, [engineReady, entry]);

  useEffect(() => {
    if (!projectId) return;

    let cancelled = false;

    void loadAutoSaveEntry(projectId).then((loaded) => {
      if (cancelled || !loaded) return;

      const savedAt = new Date(loaded.savedAt).getTime();
      const now = Date.now();

      // Discard entries older than 24 h
      if (now - savedAt > STALE_THRESHOLD_MS) {
        void deleteAutoSaveEntry(projectId);
        return;
      }

      // Only offer recovery if the auto-save is newer than the last cloud save
      if (lastCloudSave) {
        const cloudSaveTime = new Date(lastCloudSave).getTime();
        if (savedAt <= cloudSaveTime) {
          void deleteAutoSaveEntry(projectId);
          return;
        }
      }

      setEntry(loaded);
    });

    return () => {
      cancelled = true;
    };
  }, [projectId, lastCloudSave]);

  const handleRecover = useCallback(() => {
    if (!entry) return;
    // Guard: do not dispatch load_scene before the engine is initialised.
    // If we delete the auto-save entry before the engine is ready the backup is
    // permanently lost even though the scene was never loaded (PF-587).
    if (!engineReady) return;

    loadScene(entry.sceneJson);
    setSceneName(entry.sceneName);

    // Only delete the auto-save entry after successfully dispatching the load.
    void deleteAutoSaveEntry(entry.projectId);
    setEntry(null);
  }, [entry, engineReady, loadScene, setSceneName]);

  const handleDismiss = useCallback(() => {
    if (entry) {
      void deleteAutoSaveEntry(entry.projectId);
    }
    setDismissed(true);
    setEntry(null);
  }, [entry]);

  if (!entry || dismissed) return null;

  const timeAgo = formatTimeAgo(entry.savedAt);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" role="dialog" aria-modal="true" aria-labelledby="autosave-recovery-title">
      <div className="mx-4 w-full max-w-md rounded-lg bg-zinc-800 p-6 shadow-xl">
        <div className="mb-4 flex items-start justify-between">
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-6 w-6 shrink-0 text-amber-400" />
            <h2 id="autosave-recovery-title" className="text-lg font-semibold text-white">
              Unsaved work recovered
            </h2>
          </div>
          <button
            onClick={handleDismiss}
            className="rounded p-1 text-zinc-400 hover:bg-zinc-700 hover:text-white"
            aria-label="Dismiss recovery"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="mb-2 text-sm text-zinc-300">
          An auto-save of <span className="font-medium text-white">{entry.sceneName}</span> was
          found from {timeAgo}.
        </p>
        <p className="mb-5 text-xs text-zinc-400">
          This may contain work that was not saved to the cloud before the browser
          was closed or crashed.
        </p>

        <div className="flex gap-3">
          <button
            onClick={handleRecover}
            disabled={!engineReady}
            aria-disabled={!engineReady}
            title={engineReady ? undefined : 'Waiting for engine to load\u2026'}
            className="flex flex-1 items-center justify-center gap-2 rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {engineReady ? (
              <RefreshCw className="h-4 w-4" />
            ) : (
              <Loader2 className="h-4 w-4 animate-spin" />
            )}
            {engineReady ? 'Restore' : 'Loading engine\u2026'}
          </button>
          <button
            onClick={handleDismiss}
            className="flex flex-1 items-center justify-center rounded bg-zinc-700 px-4 py-2 text-sm font-medium text-zinc-200 transition-colors hover:bg-zinc-600"
          >
            Discard
          </button>
        </div>
      </div>
    </div>
  );
}

/** Format an ISO timestamp as a human-readable relative time string. */
function formatTimeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return 'a few seconds ago';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours} hour${hours === 1 ? '' : 's'} ago`;
}
