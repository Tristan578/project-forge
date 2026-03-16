/**
 * Periodic auto-save to IndexedDB with crash recovery support.
 *
 * Saves serialized scene state every 30 seconds using the existing
 * IndexedDB wrapper (forge-backup / crash-backups store).
 *
 * Key format: `forge:autosave:<projectId>` with a sibling timestamp key.
 */

import { saveToIndexedDB, loadFromIndexedDB, deleteFromIndexedDB } from './indexedDBFallback';

/** Shape of the data blob persisted to IndexedDB. */
export interface AutoSaveEntry {
  /** Serialized scene JSON from the engine. */
  sceneJson: string;
  /** Human-readable scene name. */
  sceneName: string;
  /** ISO-8601 timestamp of when the save was written. */
  savedAt: string;
  /** Project ID this auto-save belongs to. */
  projectId: string;
}

/** Default interval between auto-saves in milliseconds (30 s). */
export const AUTO_SAVE_INTERVAL_MS = 30_000;

/** Build the IndexedDB key for a given project. */
export function autoSaveKey(projectId: string): string {
  return `forge:autosave:${projectId}`;
}

/**
 * Persist a scene snapshot to IndexedDB.
 * Returns `true` on success, `false` on any failure.
 */
export async function saveAutoSaveEntry(entry: AutoSaveEntry): Promise<boolean> {
  const key = autoSaveKey(entry.projectId);
  const payload = JSON.stringify(entry);
  return saveToIndexedDB(key, payload);
}

/**
 * Load the most recent auto-save for a project.
 * Returns `null` if none exists or on error.
 */
export async function loadAutoSaveEntry(projectId: string): Promise<AutoSaveEntry | null> {
  const key = autoSaveKey(projectId);
  const raw = await loadFromIndexedDB(key);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      'sceneJson' in parsed &&
      'sceneName' in parsed &&
      'savedAt' in parsed &&
      'projectId' in parsed
    ) {
      return parsed as AutoSaveEntry;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Delete the auto-save entry for a project.
 */
export async function deleteAutoSaveEntry(projectId: string): Promise<void> {
  const key = autoSaveKey(projectId);
  await deleteFromIndexedDB(key);
}

/** Callback that returns the current scene state to persist. */
export type GetSceneState = () => {
  projectId: string | null;
  sceneName: string;
  sceneModified: boolean;
  autoSaveEnabled: boolean;
};

/** Callback that triggers the engine to export scene JSON. */
export type TriggerExport = () => void;

/** Handle returned by `startAutoSave` for cleanup. */
export interface AutoSaveHandle {
  /** Stop the periodic auto-save timer. */
  stop: () => void;
}

/**
 * Cache the most recent scene JSON received from the engine export event.
 * Updated by `setLastExportedScene` (called from the event handler).
 */
let lastExportedSceneJson: string | null = null;
let lastExportedSceneName: string | null = null;

/**
 * Called by the SCENE_EXPORTED event handler to cache the latest scene data.
 * The periodic timer will pick this up and persist it to IndexedDB.
 */
export function setLastExportedScene(json: string, name: string): void {
  lastExportedSceneJson = json;
  lastExportedSceneName = name;
}

/** @internal Reset cached scene data — for tests only. */
export function _resetLastExportedScene(): void {
  lastExportedSceneJson = null;
  lastExportedSceneName = null;
}

/**
 * Start a periodic auto-save timer.
 *
 * Every `intervalMs` milliseconds:
 * 1. Checks if auto-save is enabled and a project is loaded.
 * 2. If cached scene data exists, persists it to IndexedDB.
 * 3. Then requests a fresh engine export for the *next* cycle.
 *
 * @returns A handle with a `stop()` method to clear the timer.
 */
export function startAutoSave(
  getState: GetSceneState,
  triggerExport: TriggerExport,
  intervalMs = AUTO_SAVE_INTERVAL_MS,
): AutoSaveHandle {
  const timerId = setInterval(() => {
    const state = getState();
    if (!state.autoSaveEnabled || !state.projectId) return;
    if (!state.sceneModified) return;

    // Persist the most recently exported scene data
    if (lastExportedSceneJson && lastExportedSceneName) {
      void saveAutoSaveEntry({
        sceneJson: lastExportedSceneJson,
        sceneName: lastExportedSceneName,
        savedAt: new Date().toISOString(),
        projectId: state.projectId,
      });
    }

    // Request a fresh export from the engine for the next cycle
    triggerExport();
  }, intervalMs);

  // Trigger an initial export so the first cycle has data
  triggerExport();

  return {
    stop: () => clearInterval(timerId),
  };
}
