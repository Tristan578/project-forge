/**
 * Scene slice - manages scene file state, multi-scene, export, cloud state, terrain, and scene transitions.
 */

import { StateCreator } from 'zustand';
import type { SceneTransitionConfig, TerrainDataState } from './types';
import { DEFAULT_TRANSITION } from './types';
import {
  loadProjectScenes,
  saveProjectScenes,
  createScene as createSceneIn,
  deleteScene as deleteSceneIn,
  duplicateScene as duplicateSceneIn,
  switchScene as switchSceneIn,
  saveCurrentSceneData,
  type ProjectScenes,
} from '@/lib/scenes/sceneManager';
import { captureActiveScene, type SceneCapture } from '@/lib/scenes/captureScene';
import { stageSceneAudio, clearStagedSceneAudio } from '@/lib/audio/sceneAudioManifest';

/** Project scenes reduced to the shape the store mirrors for the Scene Browser. */
function toSceneList(project: ProjectScenes) {
  return project.scenes.map((s) => ({ id: s.id, name: s.name, isStartScene: s.isStartScene }));
}

export interface SceneSlice {
  sceneName: string;
  sceneModified: boolean;
  autoSaveEnabled: boolean;
  scenes: Array<{ id: string; name: string; isStartScene: boolean }>;
  activeSceneId: string | null;
  sceneSwitching: boolean;
  sceneTransition: {
    active: boolean;
    config: SceneTransitionConfig | null;
    targetScene: string | null;
    transitionId: string | null;
  };
  defaultTransition: SceneTransitionConfig;
  terrainData: Record<string, TerrainDataState>;
  isExporting: boolean;
  projectId: string | null;
  cloudSaveStatus: 'idle' | 'saving' | 'saved' | 'error';
  lastCloudSave: string | null;

  /**
   * Ask the engine to serialize the current scene.
   *
   * The result arrives asynchronously as the `forge:scene-exported` DOM event.
   * Pass `requestId` (from `newSceneExportRequestId()`) to have it echoed back
   * on that event so a listener can tell its own answer from an export someone
   * else triggered (PF-1103). Callers that just want the scene persisted (the
   * debounced autosave, the chat tool) can omit it.
   */
  saveScene: (requestId?: string) => void;
  loadScene: (json: string) => void;
  newScene: () => void;
  setSceneName: (name: string) => void;
  setSceneModified: (modified: boolean) => void;
  setAutoSaveEnabled: (enabled: boolean) => void;
  setScenes: (scenes: Array<{ id: string; name: string; isStartScene: boolean }>, activeId: string | null) => void;
  setSceneSwitching: (switching: boolean) => void;
  startSceneTransition: (targetScene: string, configOverride?: Partial<SceneTransitionConfig>) => Promise<void>;
  setDefaultTransition: (config: Partial<SceneTransitionConfig>) => void;
  /**
   * Spawn a terrain. Returns the new entity's id **synchronously** so callers can
   * immediately target it (reparent/transform/material) without waiting for the
   * async SELECTION_CHANGED round-trip. Returns `undefined` when the engine isn't
   * loaded yet (`dispatchCommand` is null) and nothing was spawned — callers MUST
   * guard on the result. Do NOT read `primaryId` after calling this; it is not
   * updated until the engine emits SELECTION_CHANGED.
   */
  spawnTerrain: (terrainData?: Partial<TerrainDataState>, name?: string) => string | undefined;
  updateTerrain: (entityId: string, terrainData: TerrainDataState) => void;
  sculptTerrain: (entityId: string, position: [number, number], radius: number, strength: number) => void;
  setTerrainData: (entityId: string, data: TerrainDataState) => void;
  csgUnion: (entityIdA: string, entityIdB: string, deleteSources?: boolean) => void;
  csgSubtract: (entityIdA: string, entityIdB: string, deleteSources?: boolean) => void;
  csgIntersect: (entityIdA: string, entityIdB: string, deleteSources?: boolean) => void;
  extrudeShape: (shape: string, params: Record<string, unknown>) => void;
  latheShape: (profile: [number, number][], params: Record<string, unknown>) => void;
  arrayEntity: (entityId: string, params: Record<string, unknown>) => void;
  combineMeshes: (entityIds: string[], deleteSources?: boolean, name?: string) => void;
  setExporting: (value: boolean) => void;
  setProjectId: (id: string | null) => void;
  /** Trigger the export whose event drives the cloud-save PUT. See {@link saveScene} for `requestId`. */
  saveToCloud: (requestId?: string) => void;
  setCloudSaveStatus: (status: 'idle' | 'saving' | 'saved' | 'error') => void;
  /** Set the ISO-8601 timestamp of the most recent successful cloud save (PF-540). */
  setLastCloudSave: (timestamp: string) => void;
  loadTemplate: (templateId: string) => Promise<void>;
  /**
   * Persist the live scene, then activate `sceneId`. Async because the scene
   * has to be read back out of the engine first — resolves once the switch has
   * happened (or been refused), so callers awaiting it can trust the new state.
   */
  switchScene: (sceneId: string) => Promise<void>;
  createNewScene: (name?: string) => void;
  deleteScene: (sceneId: string) => void;
  /** Persist the live scene first, so duplicating the ACTIVE scene copies its current contents. */
  duplicateScene: (sceneId: string) => Promise<void>;
}

let dispatchCommand: ((command: string, payload: unknown) => void) | null = null;

export function setSceneDispatcher(dispatcher: (command: string, payload: unknown) => void): void {
  dispatchCommand = dispatcher;
}

/**
 * Ask the engine to export the active scene. Returns `false` when there is no
 * engine to ask, which `captureActiveScene` reads as "nothing to capture"
 * rather than "asked and got no answer".
 */
export function requestSceneExport(): boolean {
  if (!dispatchCommand) return false;
  dispatchCommand('export_scene', {});
  return true;
}

/**
 * Fold the live scene into the stored project before a mutation moves off it.
 *
 * Returns `null` when the capture failed — a live scene exists and could not be
 * read, so the caller must abort rather than write a stale copy over it. On
 * `unavailable` there is no live scene to lose, so the project passes through.
 */
function withCapturedScene(project: ProjectScenes, capture: SceneCapture): ProjectScenes | null {
  if (capture.status === 'failed') return null;
  if (capture.status === 'unavailable') return project;
  return saveCurrentSceneData(project, capture.data);
}

export const createSceneSlice: StateCreator<SceneSlice, [], [], SceneSlice> = (set, get) => ({
  sceneName: 'Untitled',
  sceneModified: false,
  autoSaveEnabled: true,
  scenes: [],
  activeSceneId: null,
  sceneSwitching: false,
  sceneTransition: { active: false, config: null, targetScene: null, transitionId: null },
  defaultTransition: DEFAULT_TRANSITION,
  terrainData: {},
  isExporting: false,
  projectId: null,
  cloudSaveStatus: 'idle',
  lastCloudSave: null,

  saveScene: (requestId) => {
    // Built conditionally rather than `{ requestId }`: the engine validates a
    // `requestId` key that is present, and an explicit `undefined` can survive
    // as `null` depending on how the payload is marshalled.
    if (dispatchCommand) dispatchCommand('export_scene', requestId ? { requestId } : {});
  },
  loadScene: (json) => {
    // The engine reveals a loaded scene's audio one selection at a time
    // (`emit_audio_on_selection`), and SCENE_LOADED carries only a name — so
    // this JSON is the only chance to know what the scene sounds like. Staged
    // here, claimed by the SCENE_LOADED handler.
    stageSceneAudio(json);
    if (dispatchCommand) dispatchCommand('load_scene', { json });
  },
  newScene: () => {
    // new_scene emits SCENE_LOADED too. Anything staged by a load the engine
    // rejected would otherwise be adopted by this empty scene.
    clearStagedSceneAudio();
    if (dispatchCommand) dispatchCommand('new_scene', {});
  },
  setSceneName: (name) => set({ sceneName: name }),
  setSceneModified: (modified) => set({ sceneModified: modified }),
  setAutoSaveEnabled: (enabled) => set({ autoSaveEnabled: enabled }),
  setScenes: (scenes, activeId) => set({ scenes, activeSceneId: activeId }),
  setSceneSwitching: (switching) => set({ sceneSwitching: switching }),
  startSceneTransition: async (targetScene, configOverride) => {
    const state = get();

    // Validate target scene exists
    const targetExists = state.scenes.find(s => s.name === targetScene || s.id === targetScene);
    if (!targetExists) {
      console.error(`Scene "${targetScene}" not found`);
      return;
    }

    const config = { ...state.defaultTransition, ...(configOverride || {}) };
    // Use a per-call ID so concurrent calls don't clobber each other.
    const transitionId = crypto.randomUUID();
    set({ sceneTransition: { active: true, config, targetScene, transitionId } });
    await new Promise(resolve => setTimeout(resolve, config.duration));
    // Only clear if this specific transition is still the active one.
    if (get().sceneTransition.transitionId === transitionId) {
      set({ sceneTransition: { active: false, config: null, targetScene: null, transitionId: null } });
    }
  },
  setDefaultTransition: (config) => {
    const state = get();
    set({ defaultTransition: { ...state.defaultTransition, ...config } });
  },
  spawnTerrain: (terrainData, name) => {
    // Mirror of `spawnEntity`: generate the id client-side and hand it to the
    // engine, which overrides the spawned entity's EntityId to match (a
    // malformed value is ignored engine-side and falls back to a generated
    // UUID, so the returned id would be wrong — hence `crypto.randomUUID()`
    // and nothing else). Only return an id when the command actually went out;
    // returning one while `dispatchCommand` is null would be a phantom
    // reference that every follow-up command targets in vain.
    if (!dispatchCommand) return undefined;
    const id = crypto.randomUUID();
    // `id` and `name` stay AFTER the spread on purpose: `terrainData` can carry
    // LLM-authored keys, and an `id` inside it must never be able to override
    // the one generated here (the returned id would then name no entity).
    dispatchCommand('spawn_terrain', { ...(terrainData || {}), id, name });
    return id;
  },
  updateTerrain: (entityId, terrainData) => {
    if (dispatchCommand) dispatchCommand('update_terrain', { entityId, ...terrainData });
  },
  sculptTerrain: (entityId, position, radius, strength) => {
    if (dispatchCommand) dispatchCommand('sculpt_terrain', { entityId, position, radius, strength });
  },
  setTerrainData: (entityId, data) => {
    set(state => ({ terrainData: { ...state.terrainData, [entityId]: data } }));
  },
  csgUnion: (entityIdA, entityIdB, deleteSources) => {
    if (dispatchCommand) dispatchCommand('csg_union', { entityIdA, entityIdB, deleteSources });
  },
  csgSubtract: (entityIdA, entityIdB, deleteSources) => {
    if (dispatchCommand) dispatchCommand('csg_subtract', { entityIdA, entityIdB, deleteSources });
  },
  csgIntersect: (entityIdA, entityIdB, deleteSources) => {
    if (dispatchCommand) dispatchCommand('csg_intersect', { entityIdA, entityIdB, deleteSources });
  },
  extrudeShape: (shape, params) => {
    if (dispatchCommand) dispatchCommand('extrude_shape', { shape, ...params });
  },
  latheShape: (profile, params) => {
    if (dispatchCommand) dispatchCommand('lathe_shape', { profile, ...params });
  },
  arrayEntity: (entityId, params) => {
    if (dispatchCommand) dispatchCommand('array_entity', { entityId, ...params });
  },
  combineMeshes: (entityIds, deleteSources, name) => {
    if (dispatchCommand) dispatchCommand('combine_meshes', { entityIds, deleteSources, name });
  },
  setExporting: (value) => set({ isExporting: value }),
  setProjectId: (id) => set({ projectId: id }),
  saveToCloud: (requestId) => {
    // Cloud save is orchestrated externally via SceneToolbar which listens for
    // the forge:scene-exported window event to obtain the scene JSON. This
    // action triggers the engine export; SceneToolbar is responsible for calling
    // setCloudSaveStatus and setLastCloudSave on completion (PF-540).
    if (dispatchCommand) {
      dispatchCommand('export_scene', requestId ? { requestId } : {});
    }
  },
  setCloudSaveStatus: (status) => set({ cloudSaveStatus: status }),
  setLastCloudSave: (timestamp) => set({ lastCloudSave: timestamp }),
  loadTemplate: async (_templateId) => {
    // Not yet implemented — log warning instead of throwing to avoid crashing callers
    console.warn('loadTemplate: not yet implemented');
  },
  // PF-1097: these four used to dispatch `switch_scene` / `create_scene` /
  // `delete_scene` / `duplicate_scene`. The engine rejects all four by design —
  // multi-scene management is JS-side — and single dispatch returns void, so every
  // Scene Browser control was silently inert. They now go through sceneManager,
  // mirroring `lib/chat/handlers/sceneManagementHandlers`, and dispatch only
  // commands the engine actually implements.
  // PF-1100: both of these capture the live scene first. `saveCurrentSceneData`
  // had no production caller at all, so every scene's `data` stayed null forever
  // — switching away discarded the outgoing scene's work AND loaded nothing back.
  switchScene: async (sceneId) => {
    const captured = await captureActiveScene(requestSceneExport);
    const project = withCapturedScene(loadProjectScenes(), captured);
    if (!project) {
      console.error(
        `[Scenes] Refusing to switch scenes: ${captured.status === 'failed' ? captured.reason : ''} ` +
          'Switching now would discard unsaved work in the current scene.'
      );
      return;
    }
    const result = switchSceneIn(project, sceneId);
    if ('error' in result) return;
    saveProjectScenes(result.project);
    get().setScenes(toSceneList(result.project), result.project.activeSceneId);
    if (result.sceneToLoad) {
      get().loadScene(JSON.stringify(result.sceneToLoad));
    } else {
      get().newScene();
    }
  },
  createNewScene: (name) => {
    const { project } = createSceneIn(loadProjectScenes(), name ?? 'New Scene');
    saveProjectScenes(project);
    get().setScenes(toSceneList(project), project.activeSceneId);
  },
  deleteScene: (sceneId) => {
    const result = deleteSceneIn(loadProjectScenes(), sceneId);
    if (result.error) return;
    saveProjectScenes(result.project);
    get().setScenes(toSceneList(result.project), result.project.activeSceneId);
  },
  duplicateScene: async (sceneId) => {
    const captured = await captureActiveScene(requestSceneExport);
    const project = withCapturedScene(loadProjectScenes(), captured);
    if (!project) {
      console.error(
        `[Scenes] Refusing to duplicate: ${captured.status === 'failed' ? captured.reason : ''} ` +
          'The copy would be made from stale scene data.'
      );
      return;
    }
    const result = duplicateSceneIn(project, sceneId);
    if ('error' in result) return;
    saveProjectScenes(result.project);
    get().setScenes(toSceneList(result.project), result.project.activeSceneId);
  },
});
