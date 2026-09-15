/**
 * Multi-scene management — handles creating, switching, duplicating, and
 * deleting named scenes within a project.
 */

import { CURRENT_FORMAT_VERSION } from '../sceneFile';
import type { PrefabInstance } from '../prefabs/prefabInstance';

export interface SceneFileData {
  formatVersion: number;
  sceneName: string;
  entities: unknown[];
  environment?: unknown;
  postProcessing?: unknown;
  /**
   * Linked prefab instances active in this scene, persisted so their stable
   * ids, source-prefab links and per-field overrides survive save/reopen with
   * zero silent data loss (scene.FR-1 N1). Optional so every pre-existing scene
   * file remains valid with no migration.
   */
  prefabInstances?: PrefabInstance[];
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

const SCENES_STORAGE_KEY = 'forge-project-scenes';

/** Generate a unique scene ID */
function generateSceneId(): string {
  return `scene_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
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

/** Save project scenes to localStorage */
export function saveProjectScenes(project: ProjectScenes): void {
  localStorage.setItem(SCENES_STORAGE_KEY, JSON.stringify(project));
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

/**
 * Write the prefab-instance registry into a scene's file data (returns a NEW
 * object; the input is not mutated). This is the save side of the round-trip
 * that keeps instance overrides and stable ids with the scene rather than only
 * in the local prefab store, so a scene copied or reopened elsewhere still
 * carries them (scene.FR-1 N1).
 */
export function writePrefabInstances(
  sceneData: SceneFileData,
  instances: PrefabInstance[],
): SceneFileData {
  return { ...sceneData, prefabInstances: instances.map((i) => ({ ...i, overrides: { ...i.overrides } })) };
}

/**
 * Read the prefab-instance registry back out of a scene's file data. Returns an
 * empty array for a legacy scene that predates the field, so callers never have
 * to guard for its absence.
 */
export function readPrefabInstances(sceneData: SceneFileData | null | undefined): PrefabInstance[] {
  return sceneData?.prefabInstances ?? [];
}
