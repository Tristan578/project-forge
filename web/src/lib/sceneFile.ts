/**
 * Scene file I/O utilities — download, upload, and localStorage auto-save.
 */

import { safeLocalStorageSet, wouldExceedThreshold, evictOldAutoSaves } from '@/lib/storage/storageQuota';

/** Maximum scene format version the web client supports. Must match engine. */
export const CURRENT_FORMAT_VERSION = 3;

// ---------------------------------------------------------------------------
// Scene format migration
// ---------------------------------------------------------------------------

/** Scene data with at least a formatVersion field. */
interface SceneData {
  formatVersion: number;
  [key: string]: unknown;
}

/**
 * Migrate a v1 scene to v2.
 *
 * v2 added: postProcessing, audioBuses, gameUi fields with defaults.
 */
function migrateV1ToV2(data: SceneData): SceneData {
  return {
    ...data,
    formatVersion: 2,
    postProcessing: data.postProcessing ?? {},
    audioBuses: data.audioBuses ?? {},
    gameUi: data.gameUi ?? null,
  };
}

/**
 * Migrate a v2 scene to v3.
 *
 * v3 added: customWgslSource, assets map with defaults.
 */
function migrateV2ToV3(data: SceneData): SceneData {
  return {
    ...data,
    formatVersion: 3,
    customWgslSource: data.customWgslSource ?? null,
    assets: data.assets ?? {},
  };
}

/** Registry of migration functions keyed by source version. */
const MIGRATIONS: Record<number, (data: SceneData) => SceneData> = {
  1: migrateV1ToV2,
  2: migrateV2ToV3,
};

/**
 * Run the migration chain from fromVersion up to toVersion.
 *
 * Each step is applied sequentially (v1 -> v2 -> v3 -> ...).
 * Returns the migrated scene data with formatVersion set to toVersion.
 *
 * @throws if any step in the chain is missing a registered migration.
 */
export function migrateScene(
  data: SceneData,
  fromVersion: number,
  toVersion: number,
): SceneData {
  let current = { ...data };
  for (let v = fromVersion; v < toVersion; v++) {
    const migrateFn = MIGRATIONS[v];
    if (!migrateFn) {
      throw new Error(
        `No migration registered for format version ${v} -> ${v + 1}`,
      );
    }
    current = migrateFn(current);
  }
  return current;
}

const AUTOSAVE_KEY = 'forge:autosave';
const AUTOSAVE_NAME_KEY = 'forge:autosave:name';
const AUTOSAVE_TIME_KEY = 'forge:autosave:time';

/** Trigger a browser file download of the scene JSON. */
export function downloadSceneFile(json: string, name: string): void {
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name || 'Untitled'}.forge`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Read a .forge file from a File object. Validates formatVersion and migrates older formats. */
export async function readSceneFile(file: File): Promise<string> {
  const text = await file.text();
  // Basic validation
  const parsed = JSON.parse(text) as SceneData;
  if (typeof parsed.formatVersion !== 'number') {
    throw new Error('Invalid scene file: missing formatVersion');
  }
  if (parsed.formatVersion < 1 || parsed.formatVersion > CURRENT_FORMAT_VERSION) {
    throw new Error(`Unsupported scene format version: ${parsed.formatVersion}`);
  }

  // Migrate older formats to current version
  if (parsed.formatVersion < CURRENT_FORMAT_VERSION) {
    console.warn(
      `[SceneFile] Migrating scene from format v${parsed.formatVersion} to v${CURRENT_FORMAT_VERSION}`,
    );
    const migrated = migrateScene(parsed, parsed.formatVersion, CURRENT_FORMAT_VERSION);
    return JSON.stringify(migrated);
  }

  return text;
}

/** Open a file picker and return the chosen .forge file contents. */
export function openSceneFilePicker(): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.forge,.json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      try {
        const json = await readSceneFile(file);
        resolve(json);
      } catch (err) {
        console.error('[SceneFile] Failed to read file:', err);
        resolve(null);
      }
    };
    input.click();
  });
}

/** Get the auto-saved scene from localStorage. */
export function getAutoSave(): { json: string; name: string; time: string } | null {
  try {
    const json = localStorage.getItem(AUTOSAVE_KEY);
    if (!json) return null;
    const name = localStorage.getItem(AUTOSAVE_NAME_KEY) || 'Untitled';
    const time = localStorage.getItem(AUTOSAVE_TIME_KEY) || '';
    return { json, name, time };
  } catch {
    return null;
  }
}

/** Clear the auto-save from localStorage. */
export function clearAutoSave(): void {
  try {
    localStorage.removeItem(AUTOSAVE_KEY);
    localStorage.removeItem(AUTOSAVE_NAME_KEY);
    localStorage.removeItem(AUTOSAVE_TIME_KEY);
  } catch {
    // ignore
  }
}

/**
 * Persist scene JSON to localStorage as the active auto-save.
 *
 * Before writing, checks whether the payload would push usage above 80 %.
 * If it would, the oldest auto-save entries are evicted first.  Uses
 * safeLocalStorageSet for an additional eviction pass on QuotaExceededError.
 * Logs a warning (without importing UI code) if storage is still unavailable.
 */
export function saveAutoSave(json: string, name: string): void {
  // UTF-16: each character occupies 2 bytes in storage.
  // Account for all 3 key names, the timestamp value (~24 chars for ISO string),
  // and the json + name values.
  const ISO_TIMESTAMP_LENGTH = 24; // e.g. "2026-03-10T12:00:00.000Z"
  const keyNamesLength = AUTOSAVE_KEY.length + AUTOSAVE_NAME_KEY.length + AUTOSAVE_TIME_KEY.length;
  const estimatedSize = (json.length + name.length + ISO_TIMESTAMP_LENGTH + keyNamesLength) * 2;

  if (wouldExceedThreshold(estimatedSize)) {
    evictOldAutoSaves(1);
  }

  // Protect all three autosave keys from being evicted while writing the triplet
  const autosaveKeys = new Set([AUTOSAVE_KEY, AUTOSAVE_NAME_KEY, AUTOSAVE_TIME_KEY]);
  const jsonResult = safeLocalStorageSet(AUTOSAVE_KEY, json, autosaveKeys);
  const nameResult = safeLocalStorageSet(AUTOSAVE_NAME_KEY, name, autosaveKeys);
  const timeResult = safeLocalStorageSet(AUTOSAVE_TIME_KEY, new Date().toISOString(), autosaveKeys);

  if (!jsonResult.success || !nameResult.success || !timeResult.success) {
    console.warn('[AutoSave] localStorage write failed after eviction attempt.');
  }
}
