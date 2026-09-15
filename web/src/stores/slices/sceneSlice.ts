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
  createCheckpoint as createCheckpointIn,
  listCheckpoints as listCheckpointsIn,
  restoreCheckpoint as restoreCheckpointIn,
  deleteCheckpoint as deleteCheckpointIn,
  type ProjectScenes,
  type SceneCheckpoint,
} from '@/lib/scenes/sceneManager';
import { captureActiveScene, type SceneCapture } from '@/lib/scenes/captureScene';
import { emptySceneFile, setSceneValidator } from '@/lib/scenes/sceneValidation';
import { applyCheckpointScene, captureCheckpointScene } from '@/lib/scenes/checkpointRecovery';
import { stageSceneAudio, clearStagedSceneAudio } from '@/lib/audio/sceneAudioManifest';
import {
  buildTemplateSceneFile,
  buildTemplateGameComponents,
} from '@/lib/templates/templateSceneFile';
import { useMusicArrangementStore, readArrangementFromSceneData } from '@/lib/music/arrangementStore';

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
  projectRevision: number;
  sceneOperationRevision: number;
  checkpointBusy: boolean;
  checkpointError: string | null;
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
  /**
   * Queue scene JSON in the engine. True means accepted for later application,
   * not that the viewport changed. Recovery waits for SCENE_LOADED and a
   * correlated export before committing its active save.
   */
  loadScene: (json: string) => boolean;
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
   * Resolves with success only after a fresh graph contains the expected
   * entities and their scripts/gameplay components have been attached. Rejected
   * or superseded requests resolve with failure. A timeout also resolves with
   * failure but does not cancel an accepted engine load: the scene may appear
   * later without script/gameplay setup. Callers must show the returned error
   * and offer a retry after the engine responds.
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
  /**
   * Capture a named recovery checkpoint of the whole project (scene.FR-3.OP-02).
   * Reads the live scene back out of the engine first — same guard as switch /
   * duplicate — so the snapshot reflects on-screen work. Returns the new
   * checkpoint, or `null` if the capture failed or storage refused the write.
   */
  createCheckpoint: (label?: string) => Promise<SceneCheckpoint | null>;
  /** List stored recovery checkpoints, newest first. */
  listCheckpoints: () => SceneCheckpoint[];
  /**
   * Restore a checkpoint for this project. Resolves true after the engine
   * confirms the scene and the active save is committed. Failure preserves
   * the previous save and attempts to restore prior unsaved viewport data.
   * checkpointError contains user-facing recovery guidance.
   */
  restoreCheckpoint: (checkpointId: string) => Promise<boolean>;
  /** Delete a checkpoint by ID. */
  deleteCheckpoint: (checkpointId: string) => SceneCheckpoint[];
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
  dispatcher: ((command: string, payload: unknown) => DispatchResult) | null,
): void {
  dispatchCommand = dispatcher;
  setSceneValidator(dispatcher ? (json) => {
    if (!dispatchCommand) return false;
    return dispatchCommand('validate_scene', { json })?.success === true;
  } : null);
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

/**
 * Resolve `true` once the expected scene graph lands, `false` on timeout or supersession.
 *
 * The watch is armed BEFORE the command goes out, because a synchronous
 * dispatcher (the test doubles, and a same-frame engine) can finish the load
 * before `dispatchCommand` returns. A fresh nodes map with the expected entity
 * IDs is required; SCENE_LOADED alone still carries the outgoing scene nodes.
 */
function watchForSceneApplied(
  api: StoreApi<SceneSlice & TemplateApplyDeps>,
  timeoutMs: number,
  expectedEntityIds: readonly string[],
  operationRevision: number,
): { applied: Promise<boolean>; abandon: () => void } {
  const previousNodes = api.getState().sceneGraph.nodes;
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
      if (state.sceneOperationRevision !== operationRevision) {
        finish(false);
        return;
      }
      if (
        state.sceneGraph.nodes !== previousNodes
        && state.nodeCount === expectedEntityIds.length
        && expectedEntityIds.every((id) => state.sceneGraph.nodes[id] !== undefined)
      ) finish(true);
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
export function requestSceneExport(requestId?: string): boolean {
  if (!dispatchCommand) return false;
  const result = dispatchCommand('export_scene', requestId ? { requestId } : {});
  return result?.success !== false;
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

/**
 * Restore the music arrangement carried by a just-loaded scene, or clear it
 * when the scene has none. Without this, `loadScene`/`newScene` left whatever
 * arrangement was in the store from the PREVIOUS scene — stale tracks/clips
 * that then rode along into the new scene's next cloud save (#10058). `json`
 * is untrusted (AI/chat input, a local file pick, an auto-save entry), so a
 * parse failure clears rather than throws.
 */
function syncArrangementFromLoadedScene(json: string): void {
  try {
    useMusicArrangementStore.getState().hydrate(readArrangementFromSceneData(JSON.parse(json)));
  } catch {
    useMusicArrangementStore.getState().hydrate(null);
  }
}

/** Dispatch a load owned by the current recovery transaction. */
function dispatchSceneLoad(json: string): boolean {
  if (!dispatchCommand) return false;
  const rollbackAudio = stageSceneAudio(json);
  try {
    const response = dispatchCommand('load_scene', { json });
    if (response?.success === false) {
      rollbackAudio();
      return false;
    }
    return true;
  } catch (error) {
    rollbackAudio();
    throw error;
  }
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
  projectRevision: 0,
  sceneOperationRevision: 0,
  checkpointBusy: false,
  checkpointError: null,
  cloudSaveStatus: 'idle',
  lastCloudSave: null,

  saveScene: (requestId) => {
    // Built conditionally rather than `{ requestId }`: the engine validates a
    // `requestId` key that is present, and an explicit `undefined` can survive
    // as `null` depending on how the payload is marshalled.
    if (dispatchCommand) dispatchCommand('export_scene', requestId ? { requestId } : {});
  },
  loadScene: (json) => {
    if (!dispatchSceneLoad(json)) return false;
    // A rejected request must not invalidate an unrelated recovery operation.
    set({ sceneOperationRevision: get().sceneOperationRevision + 1 });
    // Swap in this scene's own arrangement (or clear it) — see
    // `syncArrangementFromLoadedScene` (#10058).
    syncArrangementFromLoadedScene(json);
    return true;
  },
  newScene: () => {
    if (!dispatchCommand) return;
    // new_scene emits SCENE_LOADED too. Anything staged by a load the engine
    // rejected would otherwise be adopted by this empty scene.
    const rollbackAudio = clearStagedSceneAudio();
    try {
      const response = dispatchCommand('new_scene', {});
      if (response?.success === false) {
        rollbackAudio();
        return;
      }
      set({ sceneOperationRevision: get().sceneOperationRevision + 1 });
      // A blank scene has no saved arrangement — clear whatever the previous
      // scene left behind (#10058).
      useMusicArrangementStore.getState().hydrate(null);
    } catch (error) {
      rollbackAudio();
      throw error;
    }
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
  setProjectId: (id) => {
    if (get().projectId === id) return;
    set({ projectId: id, projectRevision: get().projectRevision + 1, scenes: [], activeSceneId: null, checkpointError: null });
  },
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

    let operationRevision = get().sceneOperationRevision + 1;
    set({ sceneOperationRevision: operationRevision });
    const supersededResult: TemplateLoadResult = {
      success: false,
      error: 'Another scene was requested before this template finished loading.',
    };

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
    // Importing a template yields to other scene operations. An older request
    // must not replace the registry or queue a load over the newer scene.
    if (get().sceneOperationRevision !== operationRevision) return supersededResult;
    if (!dispatchCommand) {
      return { success: false, error: 'The engine is not ready yet — try again in a moment.' };
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

    const skipped = new Set(skippedEntityIds);
    const expectedEntityIds = template.sceneData.entities
      .filter((entity) => !skipped.has(entity.entityId))
      .map((entity) => entity.entityId);
    // Imports can yield to a new checkpoint capture. Invalidate that recovery
    // immediately before dispatch, while retaining this template's ownership.
    operationRevision += 1;
    set({ sceneOperationRevision: operationRevision });
    const { applied, abandon } = watchForSceneApplied(
      api,
      options?.timeoutMs ?? TEMPLATE_APPLY_TIMEOUT_MS,
      expectedEntityIds,
      operationRevision,
    );

    // Staged for the SCENE_LOADED handler, same contract as `loadScene`.
    // `stageSceneAudio` REPLACES the stash rather than adding to it, so this
    // also displaces anything a previous rejected load left armed — the reason
    // it runs even though no template currently declares audio. The accepted
    // stash remains armed across a timeout because the queued load may still
    // emit SCENE_LOADED.
    const rollbackAudio = stageSceneAudio(sceneJson);
    let response: DispatchResult;
    try {
      response = dispatchCommand('load_scene', { json: sceneJson });
    } catch (error) {
      abandon();
      rollbackAudio();
      return {
        success: false,
        error: `Could not load template "${templateId}": ${error instanceof Error ? error.message : String(error)}`,
      };
    }
    if (response && response.success === false) {
      abandon();
      rollbackAudio();
      return {
        success: false,
        error: response.error ?? `The engine refused to load template "${templateId}".`,
      };
    }

    const didApply = await applied;
    if (get().sceneOperationRevision !== operationRevision) return supersededResult;
    if (!didApply) {
      return {
        success: false,
        error: `Template "${templateId}" is still waiting for the engine. It may appear without its scripts or gameplay setup. Wait for the engine to respond, then load the template again.`,
      };
    }

    // Only now that the entities exist can anything be attached to them.
    // Scripts and game components go through the store's own actions rather
    // than riding inside the scene JSON: the engine only re-emits either one
    // for the SELECTED entity, so a template applied through the file alone
    // would leave `allScripts` empty — and that map, not the engine, is what
    // the script worker runs in Play mode.
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
    // NO GENRE PRESET IS APPLIED. Loading a template used to call
    // `setInputPreset(template.inputPreset)`, which replaced the scene's whole
    // action map with one genre's handful of bindings — and after presets became
    // additive it was worse, not better: `fps` defines `move_forward` and
    // `move_right` as AXES under the same names the defaults use for digital
    // actions, so merging it left `move_forward` answering true for W *or* S
    // while digital `move_backward` answered for S alone. The shooter's
    // `dz -= SPEED` and `dz += SPEED` then cancelled, and backward movement was
    // dead — the very failure this work exists to remove, reintroduced by the
    // template's own genre label.
    //
    // A template needs nothing a preset provides: every action its scripts name
    // is in `InputMap::default()`, which `inputActionConformance` enforces. A
    // template that wants an action of its own declares it in
    // `sceneData.inputBindings`, which `templateSceneFile` now carries through.
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
    if (!dispatchCommand) return;
    const captured = await captureActiveScene(requestSceneExport);
    if (!dispatchCommand) return;
    const project = withCapturedScene(loadProjectScenes(get().projectId), captured);
    if (!project) {
      console.error(
        `[Scenes] Refusing to switch scenes: ${captured.status === 'failed' ? captured.reason : ''} ` +
          'Switching now would discard unsaved work in the current scene.'
      );
      return;
    }
    const result = switchSceneIn(project, sceneId);
    if ('error' in result) return;
    saveProjectScenes(result.project, get().projectId);
    get().setScenes(toSceneList(result.project), result.project.activeSceneId);
    if (result.sceneToLoad) {
      get().loadScene(JSON.stringify(result.sceneToLoad));
    } else {
      get().newScene();
    }
  },
  createNewScene: (name) => {
    if (!dispatchCommand) return;
    const { project } = createSceneIn(loadProjectScenes(get().projectId), name ?? 'New Scene');
    saveProjectScenes(project, get().projectId);
    get().setScenes(toSceneList(project), project.activeSceneId);
  },
  deleteScene: (sceneId) => {
    if (!dispatchCommand) return;
    const result = deleteSceneIn(loadProjectScenes(get().projectId), sceneId);
    if (result.error) return;
    saveProjectScenes(result.project, get().projectId);
    get().setScenes(toSceneList(result.project), result.project.activeSceneId);
  },
  duplicateScene: async (sceneId) => {
    if (!dispatchCommand) return;
    const captured = await captureActiveScene(requestSceneExport);
    if (!dispatchCommand) return;
    const project = withCapturedScene(loadProjectScenes(get().projectId), captured);
    if (!project) {
      console.error(
        `[Scenes] Refusing to duplicate: ${captured.status === 'failed' ? captured.reason : ''} ` +
          'The copy would be made from stale scene data.'
      );
      return;
    }
    const result = duplicateSceneIn(project, sceneId);
    if ('error' in result) return;
    saveProjectScenes(result.project, get().projectId);
    get().setScenes(toSceneList(result.project), result.project.activeSceneId);
  },
  // Recovery checkpoints (scene.FR-3.OP-02). The chat handlers
  // (`create_checkpoint` / `restore_checkpoint` / `list_checkpoints` /
  // `delete_checkpoint`) drive the same sceneManager functions, so manual and
  // AI paths persist identical state.
  createCheckpoint: async (label) => {
    if (get().checkpointBusy) return null;
    const { projectId, projectRevision, sceneOperationRevision, activeSceneId } = get();
    const isCurrent = () => get().projectId === projectId && get().projectRevision === projectRevision && get().sceneOperationRevision === sceneOperationRevision && get().activeSceneId === activeSceneId;
    set({ checkpointBusy: true, checkpointError: null });
    try {
      const captured = await captureCheckpointScene(requestSceneExport);
      if (!isCurrent()) throw new Error('The project or scene changed while capturing. Try again in the intended scene.');
      const project = saveCurrentSceneData(loadProjectScenes(projectId), captured);
      // A checkpoint is independent of the active save. Failure must not alter
      // that save, and all scenes validate before any quota eviction occurs.
      return createCheckpointIn(project, label, projectId).checkpoint;
    } catch (error) {
      set({ checkpointError: (error instanceof Error || error instanceof DOMException) ? error.message : 'The checkpoint could not be saved. Try again.' });
      return null;
    } finally {
      set({ checkpointBusy: false });
    }
  },
  listCheckpoints: () => listCheckpointsIn(get().projectId),
  restoreCheckpoint: async (checkpointId) => {
    if (get().checkpointBusy) return false;
    const before = get();
    const { projectId, projectRevision, activeSceneId } = before;
    let sceneOperationRevision = before.sceneOperationRevision;
    const isCurrent = () => get().projectId === projectId && get().projectRevision === projectRevision && get().sceneOperationRevision === sceneOperationRevision && get().activeSceneId === activeSceneId;
    set({ checkpointBusy: true, checkpointError: null, autoSaveEnabled: false });
    let prior: Awaited<ReturnType<typeof captureCheckpointScene>> | undefined;
    let attempted = false;
    try {
      const result = restoreCheckpointIn(checkpointId, projectId);
      if ('error' in result) throw new Error(result.error);
      // A valid restore supersedes earlier template imports and pending setup.
      sceneOperationRevision += 1;
      set({ sceneOperationRevision });
      // Preserve the live, possibly unsaved scene before sending any load.
      prior = await captureCheckpointScene(requestSceneExport);
      if (!isCurrent()) throw new Error('The project changed while restoring. Try again in the intended project.');
      const active = result.project.scenes.find((scene) => scene.id === result.project.activeSceneId)!;
      await applyCheckpointScene(active.data ?? emptySceneFile(active.name), (json) => {
        attempted = true;
        const accepted = dispatchSceneLoad(json);
        attempted = accepted;
        return accepted;
      }, requestSceneExport, isCurrent);
      if (!isCurrent()) throw new Error('The project changed while restoring.');
      saveProjectScenes(result.project, projectId);
      get().setScenes(toSceneList(result.project), result.project.activeSceneId);
      set({ sceneModified: false });
      return true;
    } catch (error) {
      let message = (error instanceof Error || error instanceof DOMException) ? error.message : 'The checkpoint could not be restored.';
      if (attempted && prior && isCurrent()) {
        try {
          await applyCheckpointScene(prior, dispatchSceneLoad, requestSceneExport, isCurrent);
          set({ sceneName: before.sceneName, sceneModified: before.sceneModified });
        } catch {
          message += ' The previous save is intact, but the viewport could not be recovered. Reload the project before editing.';
        }
      }
      // Dispatch rejection restores its own staging. Accepted loads can still
      // complete after timeout, so recovery must not clear their audio here.
      set({ checkpointError: message });
      return false;
    } finally {
      set({ checkpointBusy: false, autoSaveEnabled: before.autoSaveEnabled });
    }
  },
  deleteCheckpoint: (checkpointId) => {
    if (get().checkpointBusy) return listCheckpointsIn(get().projectId);
    set({ checkpointError: null });
    try {
      return deleteCheckpointIn(checkpointId, get().projectId);
    } catch (error) {
      set({ checkpointError: (error instanceof Error || error instanceof DOMException) ? error.message : 'The checkpoint could not be deleted. Try again.' });
      return listCheckpointsIn(get().projectId);
    }
  },
});
