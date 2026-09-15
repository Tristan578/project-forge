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
  readPrefabInstances,
  type ProjectScenes,
  type SceneFileData,
} from '@/lib/scenes/sceneManager';
import { captureActiveScene, attachPrefabInstances, type SceneCapture } from '@/lib/scenes/captureScene';
import {
  loadPrefabInstances,
  savePrefabInstancesToStorage,
  mergeImportedPrefabDefinitions,
  loadPrefabs,
  getBuiltInPrefabs,
  savePrefabsToStorage,
  type Prefab,
} from '@/lib/prefabs/prefabStore';
import type { PrefabInstance } from '@/lib/prefabs/prefabInstance';
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
  /** Invalidates asynchronous scene work when another scene is requested. */
  sceneOperationRevision: number;
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
  /** Return false when validation or engine dispatch rejects the load. */
  loadScene: (json: string) => boolean;
  /** Return false when no engine is available or it rejects the new scene. */
  newScene: () => boolean;
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

/**
 * Resolve `true` once the expected scene has landed, `false` on timeout or supersession.
 *
 * The watch is armed BEFORE the command goes out, because a synchronous
 * dispatcher (the test doubles, and a same-frame engine) can finish the load
 * before `dispatchCommand` returns. Require the expected entities in a new
 * nodes map: SCENE_LOADED clones the outgoing graph before the actual graph
 * update arrives, so graph identity alone can report success too early.
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

/**
 * Fold the live prefab-instance registry into a capture before it is persisted
 * (scene.FR-1 N1). The engine export knows nothing about linked instances — they
 * live in the prefab store, not the ECS — so a scene switch/duplicate that only
 * captured the engine scene would drop every instance, override and link the
 * user built. `attachPrefabInstances` no-ops on a non-`captured` status, so the
 * "abort rather than overwrite" contract survives. Empty registry is left
 * un-attached so instance-free scenes stay byte-identical: `saveCurrentSceneData`
 * replaces the whole `data` with this fresh capture, so a scene that had
 * instances deleted persists as having none (no resurrection on reopen).
 */
function withPrefabInstances(capture: SceneCapture): SceneCapture {
  const instances = loadPrefabInstances();
  return instances.length ? attachPrefabInstances(capture, instances) : capture;
}

/** The prefab-store state a scene-load mutates, snapshotted so it can be rolled back. */
interface PrefabRestoreSnapshot {
  instances: PrefabInstance[];
  prefabs: Prefab[];
}

/**
 * Restore a loaded scene's prefab-instance registry into the prefab store
 * (scene.FR-1 N1) so `PrefabLibraryPanel` and the AI instance commands see the
 * instances the scene was saved with. The registry mirrors the ACTIVE scene, so
 * a scene with no instances (or unparseable JSON) resets it to empty rather than
 * carrying the previous scene's instances forward. Also merges any prefab
 * DEFINITIONS the scene embedded (`readPrefabDefinitions`) into the local
 * library first, so a linked instance from a portable scene (another browser,
 * a remixed project) resolves instead of dangling.
 *
 * Returns a snapshot of BOTH storage keys as they stood BEFORE this call.
 * `loadScene` installs the new state eagerly — before the engine confirms the
 * load, for the same reason audio is staged early — so a caller whose dispatch
 * then REJECTS can pass this to `rollbackPrefabState` and put the previous
 * scene's registry AND library back, rather than leave either one installed
 * over a scene that never actually changed (scene.FR-1 N1 BUG-2/BUG-5): the
 * library snapshot matters too, because `mergeImportedPrefabDefinitions` is
 * NOT part of the rejected dispatch and would otherwise permanently install a
 * foreign scene's definitions even though the engine never loaded it.
 */
function restorePrefabInstances(json: string): PrefabRestoreSnapshot | null {
  const snapshot: PrefabRestoreSnapshot = { instances: loadPrefabInstances(), prefabs: loadPrefabs() };
  try {
    const parsed = JSON.parse(json) as SceneFileData;
    if (parsed.prefabDefinitions !== undefined && !Array.isArray(parsed.prefabDefinitions)) {
      throw new Error('Invalid prefab definitions');
    }
    if (!mergeImportedPrefabDefinitions(parsed.prefabDefinitions ?? [])) {
      throw new Error('Invalid prefab dependency graph');
    }
    const availableIds = new Set([...loadPrefabs(), ...getBuiltInPrefabs()].map((prefab) => prefab.id));
    // Deleted and otherwise missing sources cannot become dangling scene links.
    savePrefabInstancesToStorage(readPrefabInstances(parsed).filter((instance) => availableIds.has(instance.prefabId)));
  } catch {
    rollbackPrefabState(snapshot);
    return null;
  }
  return snapshot;
}

/** Roll BOTH prefab-store storage keys back to a snapshot `restorePrefabInstances` took. */
function rollbackPrefabState(snapshot: PrefabRestoreSnapshot): void {
  savePrefabInstancesToStorage(snapshot.instances);
  savePrefabsToStorage(snapshot.prefabs);
}

export const createSceneSlice: StateCreator<
  SceneSlice & TemplateApplyDeps,
  [],
  [],
  SceneSlice
> = (set, get, api) => ({
  sceneName: 'Untitled',
  sceneModified: false,
  sceneOperationRevision: 0,
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
      const rollbackAudio = stageSceneAudio(json);
      // Restore the scene's linked prefab instances (and merge its embedded
      // definitions) into the prefab store before the engine load. Done
      // alongside the dispatch for the same reason audio is: with no
      // dispatcher the engine never loads, so mutating the store here would
      // desync it from what is actually rendered.
      const snapshot = restorePrefabInstances(json);
      if (!snapshot) {
        rollbackAudio();
        return false;
      }
      // A rejected load never emits SCENE_LOADED, so a stash left armed here
      // waits for the NEXT scene's SCENE_LOADED and attaches this scene's
      // sounds to it. `new_scene` already clears for the same reason; a
      // rejection is the other way the stash outlives its load.
      let response: DispatchResult;
      try {
        response = dispatchCommand('load_scene', { json });
      } catch {
        rollbackAudio();
        rollbackPrefabState(snapshot);
        return false;
      }
      if (response && response.success === false) {
        rollbackAudio();
        // The engine never adopted the incoming scene — the scene still on
        // screen is the previous one, so its instance registry AND its prefab
        // LIBRARY must both come back (scene.FR-1 N1 BUG-2/BUG-5): the merge
        // above is not itself part of the rejected dispatch, so without this
        // a rejected scene's embedded definitions would install permanently,
        // and the next save would persist the wrong instances onto the scene
        // that is actually still active.
        rollbackPrefabState(snapshot);
        return false;
      }
      set((state) => ({ sceneOperationRevision: state.sceneOperationRevision + 1 }));
      return true;
    }
    return false;
  },
  newScene: () => {
    if (!dispatchCommand) {
      // No engine to change scenes at all — the scene, and therefore its
      // registry, is unchanged. Clearing here (as the dispatched path below
      // does) would describe a scene that never actually went empty
      // (scene.FR-1 N1 BUG-4).
      return false;
    }
    // An accepted empty scene must consume no audio. Restore any pending load's
    // staging if this command is rejected before it can replace that scene.
    const rollbackAudio = clearStagedSceneAudio();
    const previousInstances = loadPrefabInstances();
    // The new scene has no linked instances of its own — leaving the outgoing
    // scene's registry in place would attach its instances to this empty
    // scene on the next save (scene.FR-1 N1 BUG-1). Cleared BEFORE dispatch,
    // mirroring `restorePrefabInstances`' "install eagerly, roll back on
    // rejection" contract: `new_scene` also emits SCENE_LOADED, so the
    // registry must already describe the empty scene the instant that event
    // could land.
    savePrefabInstancesToStorage([]);
    let response: DispatchResult;
    try {
      response = dispatchCommand('new_scene', {});
    } catch {
      rollbackAudio();
      savePrefabInstancesToStorage(previousInstances);
      return false;
    }
    if (response && response.success === false) {
      rollbackAudio();
      // The engine never accepted the new scene — the scene on screen is
      // unchanged, so its registry must come back rather than stay cleared
      // out from under it (scene.FR-1 N1 BUG-4).
      savePrefabInstancesToStorage(previousInstances);
      return false;
    }
    set((state) => ({ sceneOperationRevision: state.sceneOperationRevision + 1 }));
    return true;
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

    const operationRevision = get().sceneOperationRevision + 1;
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
    // Same registry handling as `loadScene` (scene.FR-1 N1) — this used to
    // dispatch `load_scene` directly and never touch the prefab-instance
    // registry at all, so the OUTGOING scene's instances rode along into the
    // template. A template's freshly-built `sceneJson` carries no
    // `prefabInstances`, so this clears the registry outright. Only a rejected
    // dispatch can restore the outgoing registry: a timeout cannot cancel a
    // load that the engine has already queued.
    const snapshot = restorePrefabInstances(sceneJson);
    if (!snapshot) {
      abandon();
      rollbackAudio();
      return { success: false, error: 'The template contains invalid prefab metadata.' };
    }
    let response: DispatchResult;
    try {
      response = dispatchCommand('load_scene', { json: sceneJson });
    } catch (error) {
      abandon();
      rollbackAudio();
      rollbackPrefabState(snapshot);
      return {
        success: false,
        error: `Could not load template "${templateId}": ${error instanceof Error ? error.message : String(error)}`,
      };
    }
    if (response && response.success === false) {
      abandon();
      rollbackAudio();
      rollbackPrefabState(snapshot);
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
    const captured = withPrefabInstances(await captureActiveScene(requestSceneExport));
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
    const accepted = result.sceneToLoad
      ? get().loadScene(JSON.stringify(result.sceneToLoad))
      : get().newScene();
    if (!accepted) {
      // Retain the outgoing capture without relabelling the unchanged engine
      // scene as the rejected target.
      saveProjectScenes(project);
      return;
    }
    saveProjectScenes(result.project);
    get().setScenes(toSceneList(result.project), result.project.activeSceneId);
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
    const captured = withPrefabInstances(await captureActiveScene(requestSceneExport));
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
