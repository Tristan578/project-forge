'use client';

import { useState, useEffect, useCallback } from 'react';
import { AlertTriangle, RefreshCw, RotateCcw, Save } from 'lucide-react';
import { onEngineCrash, isEngineCrashed, getEngineCrashMessage, resetEngine, recoverEngine } from '@/hooks/useEngine';

export function EngineCrashOverlay() {
  const [crashed, setCrashed] = useState(() => isEngineCrashed());
  const [crashMessage, setCrashMessage] = useState<string | null>(() => getEngineCrashMessage());
  const [recovering, setRecovering] = useState(false);

  useEffect(() => {
    const unsubscribe = onEngineCrash((message) => {
      setCrashed(true);
      setCrashMessage(message);
    });
    return unsubscribe;
  }, []);

  const handleRecoverEngine = useCallback(async () => {
    setRecovering(true);
    const success = await recoverEngine('forge-canvas');
    if (success) {
      setCrashed(false);
      setCrashMessage(null);
    }
    setRecovering(false);
    // If recovery failed, the overlay stays up — user can still use
    // the full reload buttons below.
  }, []);

  const handleReloadEngine = useCallback(() => {
    resetEngine();
    window.location.reload();
  }, []);

  const handleSaveAndRefresh = useCallback(() => {
    try {
      const editorState = localStorage.getItem('forge-editor-store');
      if (editorState) {
        const timestamp = new Date().toISOString();
        localStorage.setItem('forge-editor-crash-backup', JSON.stringify({ timestamp, state: editorState }));
      }
    } catch { /* If localStorage fails, still reload */ }
    resetEngine();
    window.location.reload();
  }, []);

  if (!crashed) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/80 backdrop-blur-sm" role="alertdialog" aria-modal="true" aria-labelledby="engine-crash-title" aria-describedby="engine-crash-desc">
      <div className="mx-4 max-w-md rounded-lg border border-zinc-700 bg-zinc-900 p-6 shadow-2xl">
        <div className="mb-4 flex items-center gap-3">
          <AlertTriangle className="h-8 w-8 shrink-0 text-red-500" />
          <h2 id="engine-crash-title" className="text-lg font-bold text-white">Engine Crashed</h2>
        </div>
        <p id="engine-crash-desc" className="mb-4 text-sm text-zinc-300">The game engine encountered a fatal error and stopped responding. Try recovering the engine first, or reload the page if recovery fails.</p>
        {process.env.NODE_ENV === 'development' && crashMessage && (
          <details className="mb-4 rounded border border-zinc-700 bg-zinc-950 p-3">
            <summary className="cursor-pointer text-xs font-semibold text-zinc-400">Technical Details</summary>
            <pre className="mt-2 max-h-32 overflow-auto text-xs text-red-400">{crashMessage}</pre>
          </details>
        )}
        <div className="flex flex-col gap-2">
          <button onClick={handleRecoverEngine} disabled={recovering} className="flex items-center justify-center gap-2 rounded bg-green-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 disabled:opacity-50">
            <RotateCcw className={`h-4 w-4 ${recovering ? 'animate-spin' : ''}`} />{recovering ? 'Recovering...' : 'Recover Engine'}
          </button>
          <button onClick={handleSaveAndRefresh} className="flex items-center justify-center gap-2 rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500">
            <Save className="h-4 w-4" />Save &amp; Refresh
          </button>
          <button onClick={handleReloadEngine} className="flex items-center justify-center gap-2 rounded bg-zinc-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-600 focus:outline-none focus:ring-2 focus:ring-blue-500">
            <RefreshCw className="h-4 w-4" />Reload Page
          </button>
        </div>
      </div>
    </div>
  );
}
