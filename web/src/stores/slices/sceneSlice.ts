/**
 * Scene slice - manages scene file state, multi-scene, export, cloud state, terrain, and scene transitions.
 */

import { StateCreator, StoreApi } from 'zustand';
import type { GameComponentData, SceneGraph, SceneTransitionConfig, TerrainDataState } from './types';
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
import {
  buildTemplateSceneFile,
  buildTemplateGameComponents,
} from '@/lib/templates/templateSceneFile';

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
  /**
   * Apply a built-in game template to the live scene.
   *
   * Resolves only once the entities are actually in `sceneGraph`, so a caller
   * that reports success is reporting something that happened. `load_scene` is
   * queued and applied a frame later, and `apply_scene_load` returns silently
   * on a payload it cannot deserialize — a resolved promise on its own proves
   * nothing, which is what let the gallery and the chat handler both claim a
   * success the stub never achieved.
   */
  loadTemplate: (templateId: string, options?: { timeoutMs?: number }) => Promise<TemplateLoadResult>;
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

/**
 * What a dispatch can answer with. Structurally identical to `CommandResponse`
 * in `@/hooks/useEngine`, restated here so a store slice does not import a hook
 * module (which imports the store back). Only an explicit `success: false` is a
 * rejection — every test double and every pre-PF-1098 caller returns nothing.
 */
type DispatchResult = { success: boolean; error?: string } | void;

let dispatchCommand: ((command: string, payload: unknown) => DispatchResult) | null = null;

export function setSceneDispatcher(
  dispatcher: (command: string, payload: unknown) => DispatchResult,
): void {
  dispatchCommand = dispatcher;
}

/** Outcome of {@link SceneSlice.loadTemplate}. */
export type TemplateLoadResult =
  | { success: true; entityCount: number; skippedEntityIds: string[] }
  | { success: false; error: string };

/**
 * How long to wait for `load_scene` to show up as entities in `sceneGraph`.
 *
 * The engine acknowledges a load synchronously and applies it in a later frame,
 * so there is no response to await — only the resulting state. Overridable per
 * call so tests do not have to sit through the real budget.
 */
export const TEMPLATE_APPLY_TIMEOUT_MS = 10_000;

/**
 * State `loadTemplate` reads and writes across slice boundaries.
 *
 * Widening the generic is how a slice reaches a neighbour without depending on
 * its whole interface — `createScriptSlice` does the same for `primaryId`.
 */
export type TemplateApplyDeps = {
  sceneGraph: SceneGraph;
  nodeCount: number;
  setScript: (entityId: string, source: string, enabled: boolean, template?: string) => void;
  setInputPreset: (preset: 'fps' | 'platformer' | 'topdown' | 'racing') => void;
  addGameComponent: (entityId: string, component: GameComponentData) => void;
};

const INPUT_PRESETS = ['fps', 'platformer', 'topdown', 'racing'] as const;

/**
 * Resolve `true` once a scene load has visibly landed, `false` on timeout.
 *
 * The watch is armed BEFORE the command goes out, because a synchronous
 * dispatcher (the test doubles, and a same-frame engine) can finish the load
 * before `dispatchCommand` returns. `sceneGraph` identity is part of the
 * predicate so a scene that already had entities cannot satisfy it instantly.
 */
function watchForSceneApplied(
  api: StoreApi<SceneSlice & TemplateApplyDeps>,
  timeoutMs: number,
): { applied: Promise<boolean>; abandon: () => void } {
  const previousGraph = api.getState().sceneGraph;
  let settle: ((value: boolean) => void) | null = null;
  let unsubscribe: (() => void) | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const finish = (value: boolean) => {
    if (!settle) return;
    const resolve = settle;
    settle = null;
    unsubscribe?.();
    if (timer !== null) clearTimeout(timer);
    resolve(value);
  };

  const applied = new Promise<boolean>((resolve) => {
    settle = resolve;
    unsubscribe = api.subscribe((state) => {
      if (state.sceneGraph !== previousGraph && state.nodeCount > 0) finish(true);
    });
    timer = setTimeout(() => finish(false), timeoutMs);
  });

  return { applied, abandon: () => finish(false) };
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

export const createSceneSlice: StateCreator<
  SceneSlice & TemplateApplyDeps,
  [],
  [],
  SceneSlice
> = (set, get, api) => ({
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
    //
    // Inside the guard: with no dispatcher the engine never loads and never
    // emits SCENE_LOADED, so a stash written here would sit until whatever
    // scene loads next claimed another scene's sounds. Staging only alongside
    // the dispatch keeps the stash and the pending load a single fact.
    if (dispatchCommand) {
      stageSceneAudio(json);
      // A rejected load never emits SCENE_LOADED, so a stash left armed here
      // waits for the NEXT scene's SCENE_LOADED and attaches this scene's
      // sounds to it. `new_scene` already clears for the same reason; a
      // rejection is the other way the stash outlives its load.
      const response = dispatchCommand('load_scene', { json });
      if (response && response.success === false) clearStagedSceneAudio();
    }
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

    const config = { ...state.defaultTransition, ...(configOverride ?? {}) };
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
    dispatchCommand('spawn_terrain', { ...(terrainData ?? {}), id, name });
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
  loadTemplate: async (templateId, options) => {
    if (!dispatchCommand) {
      return { success: false, error: 'The engine is not ready yet — try again in a moment.' };
    }

    // Dynamic so the registry and its eleven lazily-imported scene files stay
    // out of the store bundle, and so nothing in `@/data/templates` is reachable
    // from a module an API route pulls in.
    const { loadTemplate: readTemplate } = await import('@/data/templates');
    let template;
    try {
      template = await readTemplate(templateId);
    } catch (error) {
      return {
        success: false,
        error: `Could not read template "${templateId}": ${error instanceof Error ? error.message : String(error)}`,
      };
    }
    // A registry miss returns null. Reporting that as success is exactly the
    // bug this action had: the gallery closed and the chat handler said
    // "Loaded template" for an id that names nothing.
    if (!template) return { success: false, error: `Unknown template: ${templateId}` };

    const { sceneJson, entityCount, skippedEntityIds } = buildTemplateSceneFile(template);
    if (entityCount === 0) {
      return {
        success: false,
        error: `Template "${templateId}" contains no entities the engine can spawn.`,
      };
    }

    const { applied, abandon } = watchForSceneApplied(
      api,
      options?.timeoutMs ?? TEMPLATE_APPLY_TIMEOUT_MS,
    );

    // Staged for the SCENE_LOADED handler, same contract as `loadScene`.
    // `stageSceneAudio` REPLACES the stash rather than adding to it, so this
    // also displaces anything a previous rejected load left armed — the reason
    // it runs even though no template currently declares audio, and the reason
    // neither failure path below needs its own clear.
    stageSceneAudio(sceneJson);
    const response = dispatchCommand('load_scene', { json: sceneJson });
    if (response && response.success === false) {
      abandon();
      return {
        success: false,
        error: response.error ?? `The engine refused to load template "${templateId}".`,
      };
    }

    if (!(await applied)) {
      return {
        success: false,
        error: `Template "${templateId}" was sent to the engine but no entities appeared. The scene was not changed.`,
      };
    }

    // Only now that the entities exist can anything be attached to them.
    // Scripts and game components go through the store's own actions rather
    // than riding inside the scene JSON: the engine only re-emits either one
    // for the SELECTED entity, so a template applied through the file alone
    // would leave `allScripts` empty — and that map, not the engine, is what
    // the script worker runs in Play mode.
    const skipped = new Set(skippedEntityIds);
    const state = get();
    for (const entity of template.sceneData.entities) {
      if (skipped.has(entity.entityId)) continue;
      for (const component of buildTemplateGameComponents(entity)) {
        state.addGameComponent(entity.entityId, component);
      }
    }
    for (const [entityId, script] of Object.entries(template.scripts)) {
      if (skipped.has(entityId)) continue;
      state.setScript(entityId, script.source, script.enabled);
    }
    const preset = template.inputPreset;
    if (preset !== undefined && (INPUT_PRESETS as readonly string[]).includes(preset)) {
      state.setInputPreset(preset as (typeof INPUT_PRESETS)[number]);
    }

    return { success: true, entityCount, skippedEntityIds };
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
