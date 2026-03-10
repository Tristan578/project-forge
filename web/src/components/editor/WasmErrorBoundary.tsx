'use client';

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { captureException } from '@/lib/monitoring/sentry-client';
import { safeLocalStorageSet } from '@/lib/storage/storageQuota';
import { saveToIndexedDB } from '@/lib/storage/indexedDBFallback';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

/**
 * Error boundary specifically for WASM crashes and runtime errors.
 * Auto-saves scene state before crash, offers graceful recovery.
 */
export class WasmErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    // Update state so next render shows fallback UI
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // Save scene state to localStorage for recovery
    this.autoSaveScene();

    captureException(error, {
      boundary: 'WasmErrorBoundary',
      componentStack: errorInfo.componentStack,
    });
    console.error('WASM Error Boundary caught error:', error, errorInfo);

    this.setState({ errorInfo });
  }

  private autoSaveScene() {
    try {
      // Attempt to save current editor state
      const editorStoreData = localStorage.getItem('forge-editor-store');
      if (!editorStoreData) return;

      const timestamp = new Date().toISOString();
      const backupPayload = JSON.stringify({ timestamp, state: editorStoreData });
      const BACKUP_KEY = 'forge-editor-crash-backup';

      // Try localStorage first (with LRU eviction on quota failure)
      const result = safeLocalStorageSet(BACKUP_KEY, backupPayload);
      if (result.success) {
        console.info('[CrashBackup] Saved to localStorage (evicted ' + result.evicted + ' bytes).');
        return;
      }

      // Fall back to IndexedDB
      console.warn('[CrashBackup] localStorage full — falling back to IndexedDB.');
      saveToIndexedDB(BACKUP_KEY, backupPayload)
        .then((ok) => {
          if (ok) {
            console.info('[CrashBackup] Saved to IndexedDB.');
          } else {
            console.error('[CrashBackup] Both localStorage and IndexedDB failed.');
          }
        })
        .catch((err: unknown) => {
          console.error('[CrashBackup] IndexedDB error:', err);
        });
    } catch (err) {
      console.error('Failed to auto-save scene:', err);
    }
  }

  private handleReload = () => {
    // Clear error state and reload page
    window.location.reload();
  };

  private handleRestore = () => {
    try {
      // Load crash backup
      const backupData = localStorage.getItem('forge-editor-crash-backup');
      if (backupData) {
        const backup = JSON.parse(backupData);
        localStorage.setItem('forge-editor-store', backup.state);
        localStorage.removeItem('forge-editor-crash-backup');
      }
    } catch (err) {
      console.error('Failed to restore backup:', err);
    }

    // Reload page
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      const hasBackup = !!localStorage.getItem('forge-editor-crash-backup');

      return (
        <div className="flex h-screen w-full items-center justify-center bg-gray-900 p-4">
          <div className="max-w-md rounded-lg bg-gray-800 p-6 shadow-lg">
            <div className="mb-4 flex items-center gap-3">
              <AlertTriangle className="h-8 w-8 text-red-500" />
              <h1 className="text-xl font-bold text-white">
                Engine Error
              </h1>
            </div>

            <p className="mb-4 text-sm text-gray-300">
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
                className="flex items-center justify-center gap-2 rounded bg-gray-700 px-4 py-2 text-sm font-medium text-white hover:bg-gray-600 transition-colors"
              >
                <RefreshCw className="h-4 w-4" />
                Reload Engine
              </button>
            </div>

            {process.env.NODE_ENV === 'development' && this.state.error && (
              <details className="mt-4 rounded bg-gray-900 p-3">
                <summary className="cursor-pointer text-xs font-semibold text-gray-400">
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
