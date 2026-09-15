/**
 * Multi-scene management — handles creating, switching, duplicating, and
 * deleting named scenes within a project.
 */

import { emptySceneFile, isSceneFileEnvelope, isValidSceneFile } from './sceneValidation';

/** Scene payload retained losslessly; persistence validates its full Rust SceneFile schema. */
export interface SceneFileData {
  formatVersion: number;
  sceneName?: string;
  metadata?: { name: string; createdAt?: string; modifiedAt?: string };
  entities: unknown[];
  environment?: unknown;
  postProcessing?: unknown;
}

export interface SceneEntry {
  id: string;
  name: string;
  isStartScene: boolean;
  data: SceneFileData | null;  // null represents an empty scene without a capture
  createdAt: string;
  updatedAt: string;
}

export interface ProjectScenes {
  version: string;
  activeSceneId: string;
  scenes: SceneEntry[];
}

/**
 * A named recovery point — a deep, immutable snapshot of the whole
 * {@link ProjectScenes} taken at a moment the creator (or the AI acting on
 * their behalf) chose. Records are isolated by editor project identity.
 * The store confirms engine application before committing the snapshot through
 * the atomic {@link saveProjectScenes} write.
 */
export interface SceneCheckpoint {
  id: string;
  projectId: string | null;
  label: string;
  createdAt: string;
  snapshot: ProjectScenes;
}

const SCENES_STORAGE_KEY = 'forge-project-scenes';
const CHECKPOINTS_STORAGE_KEY = 'forge-project-scene-checkpoints:v2';

function storageKey(base: string, projectId: string | null): string {
  if (projectId !== null && (typeof projectId !== 'string' || !projectId.trim())) {
    throw new Error('A valid project identity is required.');
  }
  return projectId === null ? base : `${base}:project:${encodeURIComponent(projectId)}`;
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && Number.isFinite(Date.parse(value));
}

/**
 * Upper bound on stored checkpoints. Each snapshot is a full copy of every
 * scene's entity/environment/postProcessing trees, so an unbounded list would
 * march straight into the browser's ~5–10 MB localStorage quota. The newest
 * checkpoint is always retained; the oldest is evicted first.
 */
export const MAX_CHECKPOINTS = 10;

/** Generate a unique scene ID */
function generateSceneId(): string {
  return `scene_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Generate a unique checkpoint ID */
function generateCheckpointId(): string {
  return `ckpt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Create initial project with one empty scene */
export function createInitialProject(): ProjectScenes {
  const id = generateSceneId();
  return {
    version: '1.0',
    activeSceneId: id,
    scenes: [{
      id,
      name: 'Main',
      isStartScene: true,
      data: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }],
  };
}

/** Validate entry metadata and every nonempty scene with the engine decoder. */
function isValidSceneEntry(value: unknown, requireEngine = true): value is SceneEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<SceneEntry>;
  return (
    typeof entry.id === 'string' &&
    entry.id.length > 0 &&
    typeof entry.name === 'string' &&
    typeof entry.isStartScene === 'boolean' &&
    isTimestamp(entry.createdAt) && isTimestamp(entry.updatedAt) &&
    (entry.data === null || (requireEngine ? isValidSceneFile(entry.data) : isSceneFileEnvelope(entry.data)))
  );
}

/**
 * Check container identity, timestamps, one start scene, and full SceneFile
 * payloads before any persistence write or checkpoint eviction.
 */
function isValidProjectScenes(value: unknown, requireEngine = true): value is ProjectScenes {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ProjectScenes>;
  if (candidate.version !== '1.0') return false;
  if (typeof candidate.activeSceneId !== 'string') return false;
  if (!Array.isArray(candidate.scenes) || candidate.scenes.length === 0) return false;
  if (!candidate.scenes.every((scene) => isValidSceneEntry(scene, requireEngine))) return false;
  const ids = new Set(candidate.scenes.map((s) => s.id));
  if (ids.size !== candidate.scenes.length) return false; // duplicate scene ids
  if (!ids.has(candidate.activeSceneId)) return false; // activeSceneId names no scene
  if (candidate.scenes.filter((scene) => scene.isStartScene).length !== 1) return false;
  return true;
}

/** Load one project namespace; numeric legacy container version 1 becomes 1.0.
 *
 * @param projectId Project namespace; null selects the local unassigned project.
 * @returns The saved project with known legacy empty scenes normalized in memory, or a new project only when no value exists.
 * @throws On storage access failure or unsupported/damaged stored data; existing bytes are never rewritten.
 */
export function loadProjectScenes(projectId: string | null = null): ProjectScenes {
  const stored = localStorage.getItem(storageKey(SCENES_STORAGE_KEY, projectId));
  if (!stored) return createInitialProject();
  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    throw new Error('The saved project is damaged. Its stored data has been preserved; restore a valid checkpoint or backup.');
  }
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const candidate = parsed as Record<string, unknown>;
    if (candidate.version === 1) candidate.version = '1.0';
    if (Array.isArray(candidate.scenes)) {
      for (const entry of candidate.scenes) {
        if (!entry || typeof entry !== 'object' || !entry.data || typeof entry.data !== 'object') continue;
        const data = entry.data as Record<string, unknown>;
        // The old createScene producer emitted only these three fields for
        // empty scenes. Never reinterpret entity-bearing or unknown payloads.
        if (Number.isInteger(data.formatVersion) && (data.formatVersion as number) >= 1 &&
            (data.formatVersion as number) <= 3 && typeof data.sceneName === 'string' &&
            Array.isArray(data.entities) && data.entities.length === 0 &&
            Object.keys(data).every((key) => ['formatVersion', 'sceneName', 'entities'].includes(key))) {
          entry.data = emptySceneFile(data.sceneName);
        }
      }
    }
  }
  if (!isValidProjectScenes(parsed, false)) {
    throw new Error('The saved project uses unsupported or invalid scene data. Its stored data has been preserved; open a supported backup.');
  }
  return parsed;
}

/**
 * Save project scenes to localStorage atomically (scene.FR-3.OP-02).
 *
 * The entire payload is serialized and validated to round-trip BEFORE a single
 * `setItem` write. If serialization or validation fails, the function throws
 * having touched nothing, so the last valid project is preserved rather than
 * overwritten with a partial or corrupt scene. `localStorage.setItem` is itself
 * all-or-nothing, so a quota error or interruption during the write leaves the
 * previously stored value intact — this is the only write to the key, never an
 * incremental one.
 *
 * @param project Complete project whose scenes must pass the running Rust validator.
 * @param projectId Project namespace; null selects the local unassigned project.
 * @returns Nothing; replaces the selected storage value with one validated JSON write.
 * @throws On serialization, validation, namespace, or storage failure; the previous value is preserved.
 */
export function saveProjectScenes(project: ProjectScenes, projectId: string | null = null): void {
  let serialized: string;
  try {
    serialized = JSON.stringify(project);
  } catch {
    throw new Error('Refusing to save project: payload did not serialize cleanly');
  }

  // Validate the exact serialized payload, including Rust component schemas,
  // before replacing the previous saved value.
  let roundTrip: unknown;
  try {
    roundTrip = JSON.parse(serialized);
  } catch {
    throw new Error('Refusing to save project: payload did not round-trip');
  }
  if (!isValidProjectScenes(roundTrip)) {
    throw new Error('Refusing to save project: payload failed validation');
  }

  // Single, all-or-nothing write. On quota/interruption this throws having
  // written nothing, so the prior value remains the last valid project.
  localStorage.setItem(storageKey(SCENES_STORAGE_KEY, projectId), serialized);
}

/** Create a new empty scene */
export function createScene(project: ProjectScenes, name: string): { project: ProjectScenes; sceneId: string } {
  const id = generateSceneId();
  const now = new Date().toISOString();
  const newScene: SceneEntry = {
    id,
    name: name || `Scene ${project.scenes.length + 1}`,
    isStartScene: false,
    data: emptySceneFile(name),
    createdAt: now,
    updatedAt: now,
  };
  return {
    project: { ...project, scenes: [...project.scenes, newScene] },
    sceneId: id,
  };
}

/** Delete a scene by ID. Can't delete last scene or active scene. */
export function deleteScene(project: ProjectScenes, sceneId: string): { project: ProjectScenes; error?: string } {
  // Check if scene exists first
  const sceneExists = project.scenes.some(s => s.id === sceneId);
  if (!sceneExists) {
    return { project, error: 'Scene not found' };
  }
  if (project.scenes.length <= 1) {
    return { project, error: 'Cannot delete the last scene' };
  }
  if (project.activeSceneId === sceneId) {
    return { project, error: 'Cannot delete the active scene. Switch to another scene first.' };
  }
  const filtered = project.scenes.filter(s => s.id !== sceneId);
  // If deleted scene was start scene, make first remaining scene the start
  const hadStart = project.scenes.find(s => s.id === sceneId)?.isStartScene;
  if (hadStart && filtered.length > 0) {
    filtered[0].isStartScene = true;
  }
  return { project: { ...project, scenes: filtered } };
}

/** Rename a scene */
export function renameScene(project: ProjectScenes, sceneId: string, newName: string): ProjectScenes {
  return {
    ...project,
    scenes: project.scenes.map(s =>
      s.id === sceneId ? { ...s, name: newName, updatedAt: new Date().toISOString() } : s
    ),
  };
}

/** Duplicate a scene */
export function duplicateScene(project: ProjectScenes, sceneId: string, newName?: string): { project: ProjectScenes; newSceneId: string } | { error: string } {
  const source = project.scenes.find(s => s.id === sceneId);
  if (!source) return { error: 'Scene not found' };

  const id = generateSceneId();
  const now = new Date().toISOString();
  const duplicate: SceneEntry = {
    id,
    name: newName || `${source.name} Copy`,
    isStartScene: false,
    data: source.data ? JSON.parse(JSON.stringify(source.data)) : null,
    createdAt: now,
    updatedAt: now,
  };
  return {
    project: { ...project, scenes: [...project.scenes, duplicate] },
    newSceneId: id,
  };
}

/** Set which scene is the start scene (only one at a time) */
export function setStartScene(project: ProjectScenes, sceneId: string): ProjectScenes {
  return {
    ...project,
    scenes: project.scenes.map(s => ({
      ...s,
      isStartScene: s.id === sceneId,
    })),
  };
}

/** Get scene entry by ID */
export function getSceneById(project: ProjectScenes, sceneId: string): SceneEntry | undefined {
  return project.scenes.find(s => s.id === sceneId);
}

/** Get scene by name */
export function getSceneByName(project: ProjectScenes, name: string): SceneEntry | undefined {
  return project.scenes.find(s => s.name === name);
}

/** Get the active scene */
export function getActiveScene(project: ProjectScenes): SceneEntry | undefined {
  return project.scenes.find(s => s.id === project.activeSceneId);
}

/** Save current scene data into the project */
export function saveCurrentSceneData(project: ProjectScenes, sceneData: SceneFileData): ProjectScenes {
  return {
    ...project,
    scenes: project.scenes.map(s =>
      s.id === project.activeSceneId
        ? { ...s, data: sceneData, updatedAt: new Date().toISOString() }
        : s
    ),
  };
}

/** Switch active scene. Returns the new project state and the scene data to load. */
export function switchScene(project: ProjectScenes, targetSceneId: string): { project: ProjectScenes; sceneToLoad: SceneFileData | null } | { error: string } {
  const target = project.scenes.find(s => s.id === targetSceneId);
  if (!target) return { error: 'Scene not found' };
  if (targetSceneId === project.activeSceneId) return { error: 'Already on this scene' };

  return {
    project: { ...project, activeSceneId: targetSceneId },
    sceneToLoad: target.data,
  };
}

/** Get list of scene names */
export function getSceneNames(project: ProjectScenes): string[] {
  return project.scenes.map(s => s.name);
}

/** Get scene count */
export function getSceneCount(project: ProjectScenes): number {
  return project.scenes.length;
}

/** Import from old single-scene .forge format */
export function importSingleScene(sceneData: SceneFileData): ProjectScenes {
  const id = generateSceneId();
  return {
    version: '1.0',
    activeSceneId: id,
    scenes: [{
      id,
      name: sceneData.metadata?.name || sceneData.sceneName || 'Main',
      isStartScene: true,
      data: sceneData,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }],
  };
}

/** Export all scenes for file save or cloud */
export function exportAllScenes(project: ProjectScenes): ProjectScenes {
  return JSON.parse(JSON.stringify(project));
}

// ---------------------------------------------------------------------------
// Recovery checkpoints (scene.FR-3.OP-02)
// ---------------------------------------------------------------------------

/**
 * Read this project's recovery points without requiring the engine to be ready.
 * Invalid metadata, project references, and scene envelopes are filtered out.
 * Restore and write paths additionally validate every component with Rust.
 * Anonymous records from the old shared checkpoint key are never adopted.
 *
 * @param projectId Project namespace; null selects local unassigned recovery points.
 * @returns Stored records in newest-first order with invalid records filtered out; an unreadable store yields an empty list.
 */
export function listCheckpoints(projectId: string | null = null): SceneCheckpoint[] {
  try {
    const stored = localStorage.getItem(storageKey(CHECKPOINTS_STORAGE_KEY, projectId));
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    if (Array.isArray(parsed)) {
      return parsed.filter(
        (c): c is SceneCheckpoint =>
          !!c && typeof c.id === 'string' && c.id.length > 0 &&
          c.projectId === projectId && typeof c.label === 'string' && c.label.trim().length > 0 &&
          isTimestamp(c.createdAt) && isValidProjectScenes(c.snapshot, false)
      );
    }
  } catch { /* ignore corrupt checkpoint store */ }
  return [];
}

/**
 * Persist the checkpoint list under quota pressure without ever corrupting the
 * active project — checkpoints live under their own key, so a failed write here
 * leaves `forge-project-scenes` untouched. The list is written newest-first and
 * capped to {@link MAX_CHECKPOINTS}; if the write still exceeds quota the oldest
 * entries are evicted one at a time and retried. The newest checkpoint (index 0)
 * is never dropped. If even a single checkpoint cannot fit, the error is
 * surfaced with the prior store left as-is.
 */
function persistCheckpoints(checkpoints: SceneCheckpoint[], projectId: string | null): SceneCheckpoint[] {
  let candidate = checkpoints.slice(0, MAX_CHECKPOINTS);
  for (;;) {
    try {
      localStorage.setItem(storageKey(CHECKPOINTS_STORAGE_KEY, projectId), JSON.stringify(candidate));
      return candidate;
    } catch (err) {
      if (!(err instanceof DOMException) || err.name !== 'QuotaExceededError' || candidate.length <= 1) {
        throw err instanceof Error || err instanceof DOMException ? err : new Error('Failed to persist checkpoint');
      }
      // Drop the oldest (tail) and retry — never the checkpoint just created.
      candidate = candidate.slice(0, candidate.length - 1);
    }
  }
}

/**
 * Capture a named recovery checkpoint from the given project. The snapshot is a
 * deep clone, so later edits to the live project never mutate a stored
 * checkpoint. Does not touch the active project's storage key.
 *
 * @param project Complete project to clone and validate before any eviction or write.
 * @param label Optional text label; blank or omitted labels use an ISO timestamp.
 * @param projectId Project namespace; null selects local unassigned recovery points.
 * @returns The new checkpoint and the retained newest-first list after count/quota eviction.
 * @throws On invalid data, unavailable validation, invalid label/namespace, or storage failure. A failed write preserves the old checkpoint store.
 */
export function createCheckpoint(
  project: ProjectScenes,
  label?: string,
  projectId: string | null = null,
): { checkpoint: SceneCheckpoint; checkpoints: SceneCheckpoint[] } {
  const snapshot: unknown = JSON.parse(JSON.stringify(project));
  if (!isValidProjectScenes(snapshot)) throw new Error('Checkpoint payload failed validation. Existing recovery points are intact; reload the editor and try again.');
  if (label !== undefined && typeof label !== 'string') throw new Error('Checkpoint label must be text.');
  const checkpoint: SceneCheckpoint = {
    id: generateCheckpointId(),
    projectId,
    label: label?.trim() || `Checkpoint ${new Date().toISOString()}`,
    createdAt: new Date().toISOString(),
    snapshot,
  };
  // Newest first, then persist (with eviction under quota pressure).
  const checkpoints = persistCheckpoints([checkpoint, ...listCheckpoints(projectId)], projectId);
  return { checkpoint, checkpoints };
}

/**
 * Read a validated checkpoint snapshot without mutating storage.
 *
 * The scene store applies and confirms the active scene before calling
 * saveProjectScenes. Keeping preparation separate prevents a rejected engine
 * load from replacing the previous valid save. Unknown IDs and records from
 * another project return an error.
 *
 * @param checkpointId ID of a stored recovery point to prepare.
 * @param projectId Project namespace; null selects local unassigned recovery points.
 * @returns A validated deep-cloned project, or an error for a missing/invalid checkpoint. Does not load the engine or write storage.
 */
export function restoreCheckpoint(
  checkpointId: string,
  projectId: string | null = null,
): { project: ProjectScenes } | { error: string } {
  const found = listCheckpoints(projectId).find((c) => c.id === checkpointId);
  if (!found) return { error: 'Checkpoint not found' };
  const restored = JSON.parse(JSON.stringify(found.snapshot)) as ProjectScenes;
  if (!isValidProjectScenes(restored)) return { error: 'The checkpoint could not be validated by the engine. Reload the editor and try again.' };
  // Preparation only: the caller commits after the engine confirms application.
  return { project: restored };
}

/** Delete a checkpoint by ID. Missing IDs are a no-op.
 *
 * @param checkpointId Checkpoint ID to remove; an unknown ID leaves the list unchanged.
 * @param projectId Project namespace; null selects local unassigned recovery points.
 * @returns The remaining list after writing it to the selected checkpoint store.
 * @throws On namespace or storage write failure.
 */
export function deleteCheckpoint(checkpointId: string, projectId: string | null = null): SceneCheckpoint[] {
  const remaining = listCheckpoints(projectId).filter((c) => c.id !== checkpointId);
  localStorage.setItem(storageKey(CHECKPOINTS_STORAGE_KEY, projectId), JSON.stringify(remaining));
  return remaining;
}
