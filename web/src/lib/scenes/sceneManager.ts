/**
 * Multi-scene management — handles creating, switching, duplicating, and
 * deleting named scenes within a project.
 */

import { CURRENT_FORMAT_VERSION } from '../sceneFile';

export interface SceneFileData {
  formatVersion: number;
  sceneName: string;
  entities: unknown[];
  environment?: unknown;
  postProcessing?: unknown;
}

export interface SceneEntry {
  id: string;
  name: string;
  isStartScene: boolean;
  data: SceneFileData | null;  // null = not yet saved (current active scene)
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
 * their behalf) chose. Restoring one replaces the active project with the
 * snapshot through the same atomic {@link saveProjectScenes} path, so a
 * restore can never leave a half-written project behind (scene.FR-3.OP-02).
 */
export interface SceneCheckpoint {
  id: string;
  label: string;
  createdAt: string;
  snapshot: ProjectScenes;
}

const SCENES_STORAGE_KEY = 'forge-project-scenes';
const CHECKPOINTS_STORAGE_KEY = 'forge-project-scene-checkpoints';

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

/** Load project scenes from localStorage */
export function loadProjectScenes(): ProjectScenes {
  try {
    const stored = localStorage.getItem(SCENES_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed.version && parsed.scenes?.length > 0) {
        return parsed;
      }
    }
  } catch { /* ignore */ }
  return createInitialProject();
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
 */
export function saveProjectScenes(project: ProjectScenes): void {
  let serialized: string;
  try {
    serialized = JSON.stringify(project);
  } catch {
    throw new Error('Refusing to save project: payload did not serialize cleanly');
  }

  // Validate the payload parses back into a structurally valid project. A save
  // that cannot be read back must never replace the last good one.
  let roundTrip: ProjectScenes;
  try {
    roundTrip = JSON.parse(serialized) as ProjectScenes;
  } catch {
    throw new Error('Refusing to save project: payload did not round-trip');
  }
  if (
    !roundTrip ||
    typeof roundTrip.version !== 'string' ||
    typeof roundTrip.activeSceneId !== 'string' ||
    !Array.isArray(roundTrip.scenes) ||
    roundTrip.scenes.length === 0
  ) {
    throw new Error('Refusing to save project: payload failed validation');
  }

  // Single, all-or-nothing write. On quota/interruption this throws having
  // written nothing, so the prior value remains the last valid project.
  localStorage.setItem(SCENES_STORAGE_KEY, serialized);
}

/** Create a new empty scene */
export function createScene(project: ProjectScenes, name: string): { project: ProjectScenes; sceneId: string } {
  const id = generateSceneId();
  const now = new Date().toISOString();
  const newScene: SceneEntry = {
    id,
    name: name || `Scene ${project.scenes.length + 1}`,
    isStartScene: false,
    data: { formatVersion: CURRENT_FORMAT_VERSION, sceneName: name, entities: [] },
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
      name: sceneData.sceneName || 'Main',
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
 * Read the stored checkpoints, newest first. A corrupt or missing checkpoint
 * store is treated as "no checkpoints" — it must never take down the editor or
 * the active project.
 */
export function listCheckpoints(): SceneCheckpoint[] {
  try {
    const stored = localStorage.getItem(CHECKPOINTS_STORAGE_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    if (Array.isArray(parsed)) {
      return parsed.filter(
        (c): c is SceneCheckpoint =>
          !!c && typeof c.id === 'string' && !!c.snapshot && Array.isArray(c.snapshot.scenes)
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
function persistCheckpoints(checkpoints: SceneCheckpoint[]): SceneCheckpoint[] {
  let candidate = checkpoints.slice(0, MAX_CHECKPOINTS);
  for (;;) {
    try {
      localStorage.setItem(CHECKPOINTS_STORAGE_KEY, JSON.stringify(candidate));
      return candidate;
    } catch (err) {
      if (candidate.length <= 1) {
        throw err instanceof Error ? err : new Error('Failed to persist checkpoint');
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
 */
export function createCheckpoint(
  project: ProjectScenes,
  label?: string
): { checkpoint: SceneCheckpoint; checkpoints: SceneCheckpoint[] } {
  const snapshot = JSON.parse(JSON.stringify(project)) as ProjectScenes;
  const checkpoint: SceneCheckpoint = {
    id: generateCheckpointId(),
    label: label?.trim() || `Checkpoint ${new Date().toISOString()}`,
    createdAt: new Date().toISOString(),
    snapshot,
  };
  // Newest first, then persist (with eviction under quota pressure).
  const checkpoints = persistCheckpoints([checkpoint, ...listCheckpoints()]);
  return { checkpoint, checkpoints };
}

/**
 * Restore a checkpoint by ID, replacing the active project with a deep clone of
 * its snapshot through the atomic {@link saveProjectScenes} path. Restoring an
 * older checkpoint after newer saves is fully supported — the snapshot is
 * self-contained and does not depend on current state.
 */
export function restoreCheckpoint(
  checkpointId: string
): { project: ProjectScenes } | { error: string } {
  const found = listCheckpoints().find((c) => c.id === checkpointId);
  if (!found) return { error: 'Checkpoint not found' };
  const restored = JSON.parse(JSON.stringify(found.snapshot)) as ProjectScenes;
  // Same atomic write everything else uses; throws rather than half-write.
  saveProjectScenes(restored);
  return { project: restored };
}

/** Delete a checkpoint by ID. Missing IDs are a no-op. */
export function deleteCheckpoint(checkpointId: string): SceneCheckpoint[] {
  const remaining = listCheckpoints().filter((c) => c.id !== checkpointId);
  localStorage.setItem(CHECKPOINTS_STORAGE_KEY, JSON.stringify(remaining));
  return remaining;
}
