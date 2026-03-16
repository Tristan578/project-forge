'use client';

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { captureException } from '@/lib/monitoring/sentry-client';
import { safeLocalStorageSet } from '@/lib/storage/storageQuota';
import { saveToIndexedDB, loadFromIndexedDB, deleteFromIndexedDB } from '@/lib/storage/indexedDBFallback';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  hasIndexedDBBackup: boolean;
}

/**
 * Error boundary specifically for WASM crashes and runtime errors.
 * Auto-saves scene state before crash, offers graceful recovery.
 */
export class WasmErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null, hasIndexedDBBackup: false };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    // Update state so next render shows fallback UI
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // Save scene state to localStorage (or IndexedDB fallback).
    // autoSaveScene sets hasIndexedDBBackup directly on IDB success,
    // eliminating the race with a separate async check.
    this.autoSaveScene();

    captureException(error, {
      boundary: 'WasmErrorBoundary',
      componentStack: errorInfo.componentStack,
    });
    console.error('WASM Error Boundary caught error:', error, errorInfo);

    this.setState({ errorInfo });
  }

  private autoSaveScene() {
    // Isolate localStorage read into its own try/catch so the IndexedDB
    // fallback path still runs if localStorage throws SecurityError.
    let editorStoreData: string | null = null;
    try {
      editorStoreData = localStorage.getItem('forge-editor-store');
    } catch (err) {
      console.error('[CrashBackup] localStorage read failed:', err);
    }
    if (!editorStoreData) return;

    const timestamp = new Date().toISOString();
    const backupPayload = JSON.stringify({ timestamp, state: editorStoreData });
    const BACKUP_KEY = 'forge-editor-crash-backup';

    try {
      // Try localStorage first (with LRU eviction on quota failure)
      const result = safeLocalStorageSet(BACKUP_KEY, backupPayload);
      if (result.success) {
        console.info('[CrashBackup] Saved to localStorage (evicted ' + result.evicted + ' bytes).');
        return;
      }
    } catch (err) {
      console.error('[CrashBackup] localStorage write failed:', err);
    }

    // Fall back to IndexedDB
    console.warn('[CrashBackup] localStorage write failed — falling back to IndexedDB.');
    saveToIndexedDB(BACKUP_KEY, backupPayload)
      .then((ok) => {
        if (ok) {
          // Set hasIndexedDBBackup directly here — no separate async check needed
          this.setState({ hasIndexedDBBackup: true });
          console.info('[CrashBackup] Saved to IndexedDB.');
        } else {
          console.error('[CrashBackup] Both localStorage and IndexedDB failed.');
        }
      })
      .catch((err: unknown) => {
        console.error('[CrashBackup] IndexedDB error:', err);
      });
  }

  private handleReload = () => {
    // Clear error state and reload page
    window.location.reload();
  };

  private handleRestore = () => {
    /** Attempt to restore editor state from a backup payload. Returns true on success. */
    const restoreFromPayload = (payload: string): boolean => {
      try {
        const parsed = JSON.parse(payload) as Record<string, unknown>;
        if (typeof parsed.state === 'string') {
          // Protect autosave keys from eviction during restore — the editor
          // store is the priority, but we want to preserve autosave data in
          // case the user also has unsaved scene changes.
          const protectedKeys = new Set([
            'forge:autosave',
            'forge:autosave:name',
            'forge:autosave:time',
            'forge-autosave-',
          ]);
          const result = safeLocalStorageSet('forge-editor-store', parsed.state, protectedKeys);
          return result.success;
        }
      } catch (err) {
        console.error('Failed to restore backup payload:', err);
      }
      return false;
    };

    try {
      // Try localStorage first
      const backupData = localStorage.getItem('forge-editor-crash-backup');
      if (backupData) {
        if (restoreFromPayload(backupData)) {
          localStorage.removeItem('forge-editor-crash-backup');
          window.location.reload();
        } else {
          // Restore failed (e.g. quota still exceeded) — preserve backup
          console.error('[CrashBackup] Restore into localStorage failed; preserving backup.');
        }
        return;
      }
    } catch (err) {
      console.error('Failed to restore from localStorage:', err);
    }

    // Fall back to IndexedDB
    loadFromIndexedDB('forge-editor-crash-backup')
      .then((data) => {
        if (data) {
          if (restoreFromPayload(data)) {
            return deleteFromIndexedDB('forge-editor-crash-backup').then(() => {
              window.location.reload();
            });
          }
          // Restore failed — preserve the IndexedDB backup
          console.error('[CrashBackup] Restore from IndexedDB payload failed; preserving backup.');
        }
        return undefined;
      })
      .catch((err: unknown) => {
        console.error('Failed to restore from IndexedDB:', err);
      });
  };

  render() {
    if (this.state.hasError) {
      let hasLocalStorageBackup = false;
      try {
        hasLocalStorageBackup = !!localStorage.getItem('forge-editor-crash-backup');
      } catch {
        // localStorage may throw SecurityError in restricted contexts — default to false
      }
      const hasBackup = hasLocalStorageBackup || this.state.hasIndexedDBBackup;

      return (
        <div className="flex h-screen w-full items-center justify-center bg-zinc-950 p-4">
          <div className="max-w-md rounded-lg bg-zinc-900 p-6 shadow-lg">
            <div className="mb-4 flex items-center gap-3">
              <AlertTriangle className="h-8 w-8 text-red-500" />
              <h1 className="text-xl font-bold text-white">
                Engine Error
              </h1>
            </div>

            <p className="mb-4 text-sm text-zinc-300">
              The game engine encountered an unexpected error and needs to restart.
            </p>

            {hasBackup && (
              <div className="mb-4 rounded bg-blue-900/30 p-3 text-sm text-blue-300">
                <p className="font-semibold">Auto-save detected</p>
                <p className="mt-1 text-xs">
                  Your work was automatically saved before the crash.
                </p>
              </div>
            )}

            <div className="flex flex-col gap-2">
              {hasBackup ? (
                <button
                  onClick={this.handleRestore}
                  className="flex items-center justify-center gap-2 rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
                >
                  <RefreshCw className="h-4 w-4" />
                  Restore & Reload Engine
                </button>
              ) : null}

              <button
                onClick={this.handleReload}
                className="flex items-center justify-center gap-2 rounded bg-zinc-700 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-600 transition-colors"
              >
                <RefreshCw className="h-4 w-4" />
                Reload Engine
              </button>
            </div>

            {process.env.NODE_ENV === 'development' && this.state.error && (
              <details className="mt-4 rounded bg-zinc-950 p-3">
                <summary className="cursor-pointer text-xs font-semibold text-zinc-400">
                  Technical Details
                </summary>
                <pre className="mt-2 max-h-40 overflow-auto text-xs text-red-400">
                  {this.state.error.toString()}
                  {this.state.errorInfo?.componentStack}
                </pre>
              </details>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
