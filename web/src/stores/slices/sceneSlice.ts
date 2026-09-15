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
  readPrefabDefinitions,
  writePrefabInstances,
  writePrefabDefinitions,
  createCheckpoint as createCheckpointIn,
  listCheckpoints as listCheckpointsIn,
  restoreCheckpoint as restoreCheckpointIn,
  deleteCheckpoint as deleteCheckpointIn,
  type ProjectScenes,
  type SceneFileData,
  type SceneCheckpoint,
} from '@/lib/scenes/sceneManager';
import { captureActiveScene, type SceneCapture } from '@/lib/scenes/captureScene';
import { newSceneExportRequestId } from '@/lib/engine/sceneExportWire';
import { emptySceneFile, setSceneValidator } from '@/lib/scenes/sceneValidation';
import { applyCheckpointScene, captureCheckpointScene } from '@/lib/scenes/checkpointRecovery';
import {
  loadPrefabInstances,
  savePrefabInstancesToStorage,
  mergeImportedPrefabDefinitions,
  collectTransitivePrefabDefinitions,
  loadPrefabs,
  getBuiltInPrefabs,
  savePrefabsToStorage,
  stagePrefabInstancesForExport,
  discardStagedPrefabInstancesForExport,
  type Prefab,
} from '@/lib/prefabs/prefabStore';
import type { PrefabInstance } from '@/lib/prefabs/prefabInstance';
import { stageSceneAudio, clearStagedSceneAudio } from '@/lib/audio/sceneAudioManifest';
import { showError } from '@/lib/toast';
import {
  buildTemplateSceneFile,
  buildTemplateGameComponents,
} from '@/lib/templates/templateSceneFile';

/** Project scenes reduced to the shape the store mirrors for the Scene Browser. */
function toSceneList(project: ProjectScenes) {
  return project.scenes.map((s) => ({ id: s.id, name: s.name, isStartScene: s.isStartScene }));
}

/**
 * A scene the editor asked the engine to load and that was REJECTED — the
 * viewport therefore does not show the scene the caller asked for (#10056).
 *
 * Deliberately NOT the same fact as `loadScene` returning `false`: that boolean
 * conflates rejection with *deferral*, because `loadScene` also returns false
 * when there is no dispatcher yet (the engine mounts after the editor page, so
 * a healthy cold open takes that branch every time). Only the rejection branches
 * set this, which is what makes it safe to gate saving and to show an error on.
 */
export interface SceneLoadError {
  /** User-facing sentence naming what went wrong. Never blank. */
  reason: string;
  /** `Date.now()` at rejection, so a repeat rejection is a distinguishable value. */
  at: number;
}

/**
 * The scene JSON could not be turned into prefab state — malformed or
 * non-array `prefabDefinitions`, or a definition graph with a missing
 * reference or a cycle (`mergeImportedPrefabDefinitions` fail-hard rejects
 * those; individual malformed entries are dropped fail-soft before it).
 */
const PREFAB_LOAD_REJECTION =
  'This scene could not be opened: its prefab data is invalid or its prefab references form a cycle.';

/** The engine itself answered `{ success: false }` — e.g. the scene JSON is too large. */
const ENGINE_LOAD_REJECTION =
  'This scene could not be opened: the engine refused to load it.';

/** The dispatch threw. The message is appended so the cause is not swallowed. */
const ENGINE_LOAD_THREW = 'This scene could not be opened: the engine failed while loading it.';

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
  projectRevision: number;
  checkpointBusy: boolean;
  checkpointError: string | null;
  cloudSaveStatus: 'idle' | 'saving' | 'saved' | 'error';
  lastCloudSave: string | null;
  /**
   * Set while the scene the editor last asked for was REJECTED, so what the
   * engine holds is NOT this project's scene; null whenever the viewport is
   * trustworthy. See {@link SceneLoadError} for why this exists alongside
   * `loadScene`'s boolean rather than instead of it.
   *
   * Two consumers, and both are load-bearing: `SceneLoadErrorNotice` renders
   * the rejection instead of leaving an empty viewport unexplained, and every
   * save path refuses while it is set — otherwise the next Ctrl+S, cloud save
   * or autosave tick would serialize the engine's (empty) scene over the
   * project's stored `sceneData` (#10056).
   */
  sceneLoadError: SceneLoadError | null;

  /**
   * Ask the engine to serialize the current scene.
   *
   * The result arrives asynchronously as the `forge:scene-exported` DOM event.
   * Pass `requestId` (from `newSceneExportRequestId()`) to have it echoed back
   * on that event so a listener can tell its own answer from an export someone
   * else triggered (PF-1103). Callers that just want the scene persisted (the
   * debounced autosave, the chat tool) can omit it.
   *
   * No-ops while {@link sceneLoadError} is set: the engine is not holding this
   * project's scene, so exporting it would write an empty scene over the stored
   * one (#10056).
   */
  saveScene: (requestId?: string) => void;
  /**
   * Queue scene JSON in the engine. True means accepted for later application,
   * not that the viewport changed. Recovery waits for SCENE_LOADED and a
   * correlated export before committing its active save. Returns false when
   * validation or engine dispatch rejects the load, in which case the prefab
   * registry (and any merged definitions) are rolled back to what they were
   * before this call.
   *
   * A `false` return is NOT by itself an error: it also means "no dispatcher
   * yet", which is the normal cold-open path. {@link sceneLoadError} is the
   * field that distinguishes a rejection, and only the rejection branches set
   * it. A `true` return clears it.
   *
   * `rejectionStrandsEditor` says what a REJECTION means for this caller, and
   * defaults to `true`. `true` is the primitive's safe default and the
   * cold-open case: a rejection leaves no trustworthy scene on screen, so it
   * sets {@link sceneLoadError} and every save path locks down. A caller that
   * is loading a scene OVER an intact outgoing scene — a scene switch, a file
   * import, an auto-save restore — passes `false`: the rejected INCOMING scene
   * never displaced the outgoing one, so the editor is not stranded, the
   * `false` return still tells the caller to surface its own error, and saving
   * of the still-live outgoing scene stays enabled (#10056).
   */
  loadScene: (json: string, opts?: { rejectionStrandsEditor?: boolean }) => boolean;
  /**
   * Return false when no engine is available or it rejects the new scene.
   * A successful new scene clears {@link sceneLoadError}: an empty scene the
   * user asked for deliberately IS trustworthy, so saving is allowed again.
   */
  newScene: () => boolean;
  /**
   * Is the engine's command dispatcher attached to this slice yet?
   *
   * The disambiguator for `newScene`'s (and `loadScene`'s) boolean, which is
   * `false` for two unrelated facts: the engine REJECTED the request, or there
   * was no engine to ask and the request was DEFERRED. The second is the normal
   * cold open — the engine mounts after the editor page — so a UI surface that
   * reports every `false` as a refusal accuses a healthy editor of an error it
   * did not commit (#10056). Read this immediately after the call to tell them
   * apart; both are synchronous, so nothing can change in between.
   *
   * NOT the same fact as `sceneLoadError`: a rejected `new_scene` deliberately
   * leaves the (still trustworthy) outgoing scene's saves enabled and so sets
   * no error, which is exactly why the boolean needs this rather than that.
   */
  isEngineAttached: () => boolean;
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
   *
   * Tracks {@link sceneLoadError} on the same terms as {@link loadScene}: an
   * accepted load clears it (restoring a checkpoint is a way OUT of a rejected
   * scene, so saving comes back), a refused one sets it. That applies to the
   * recovery load of the outgoing scene too.
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
 * Capture the live scene with its prefab registry folded in, ATOMICALLY.
 *
 * The engine export knows nothing about linked instances — they live in the
 * prefab store, not the ECS — so a scene switch/duplicate that only captured
 * the engine scene would drop every instance, override and link the user built
 * (scene.FR-1 N1). The fold itself already happens once, in the SCENE_EXPORTED
 * handler (`hooks/events/transformEvents.ts`), which is the only dispatcher of
 * the `forge:scene-exported` event this capture awaits.
 *
 * This used to ask with NO request id and then fold a SECOND time on the way
 * out, re-reading the live registry. Two reads of one registry either side of
 * an up-to-5s engine round trip are not one fact: an instance of a prefab
 * created inside that window landed in `prefabInstances` from the late read
 * while `prefabDefinitions` still came from the early one, so the saved scene
 * referenced a definition it did not carry and reopening dropped the link.
 * Staging at REQUEST time and letting the single upstream fold consume that
 * snapshot makes instances and their transitive definitions one read, taken
 * before the request goes out — which is precisely what the staging mechanism
 * exists for. Empty registry stages an empty snapshot, and the upstream fold
 * leaves the JSON untouched for one, so instance-free scenes stay
 * byte-identical.
 *
 * The request id is deliberately UN-prefixed: a checkpoint prefix would divert
 * the export past autosave and the panic backup, and a scene switch's capture
 * is a user-facing save that should still tick both.
 */
async function capturePrefabAwareScene(): Promise<SceneCapture> {
  const requestId = newSceneExportRequestId();
  stagePrefabInstancesForExport(requestId, loadPrefabInstances());
  const capture = await captureActiveScene(() => requestSceneExport(requestId));
  // Unconditional: the fold consumes the entry synchronously while dispatching
  // the event this await resolves on, so by here a consumed entry is already
  // gone and discarding is a no-op. What this actually releases is the entry no
  // fold ever reached — no engine, a timeout, an unusable answer, or an engine
  // binary old enough not to echo the id back — which would otherwise sit in
  // the staging map for the rest of the page's life.
  discardStagedPrefabInstancesForExport(requestId);
  return capture;
}

/**
 * Fold the live prefab-instance registry AND the definitions it transitively
 * links into a captured checkpoint scene (scene.FR-1 N1). A checkpoint is a
 * recovery snapshot: without this the engine export it records carries no
 * `prefabInstances`/`prefabDefinitions` at all, so restoring it would silently
 * discard every linked instance and override — and, because the local library
 * may have changed since, embedding the definitions is what lets
 * `restorePrefabInstances` re-resolve those links on restore rather than drop
 * them as dangling. Empty registry is left un-attached so instance-free
 * checkpoints stay byte-identical; `writePrefabDefinitions` also no-ops on an
 * empty definition set.
 */
function withCheckpointPrefabData(scene: SceneFileData): SceneFileData {
  const instances = loadPrefabInstances();
  if (!instances.length) return scene;
  return writePrefabDefinitions(
    writePrefabInstances(scene, instances),
    collectTransitivePrefabDefinitions(instances),
  );
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
    // Sanitize/bound the embedded definitions through `readPrefabDefinitions`
    // BEFORE merging. That funnel is fail-SOFT on an individual entry (a
    // malformed or oversized definition is dropped, e.g. a prefab snapshot
    // carrying a >256 KiB `script`), so one bad entry no longer rejects the
    // ENTIRE scene load the way passing the raw array to
    // `mergeImportedPrefabDefinitions` did (`prepareImportedDefinitions`
    // returns null on the first `sanitizePrefabDefinition` rejection). The
    // merge still fail-HARD rejects graph-level problems (missing references,
    // cycles); a dropped entry that others depend on surfaces there.
    if (!mergeImportedPrefabDefinitions(readPrefabDefinitions(parsed))) {
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

/**
 * Dispatch a load owned by the current recovery transaction — the shared
 * audio-staging + dispatch primitive `loadScene`, `newScene`'s sibling paths,
 * and checkpoint restoration all go through. Rolls the staged audio back
 * (via the closure `stageSceneAudio` now returns) on an explicit engine
 * rejection or a thrown dispatch error; the CALLER is responsible for its own
 * additional state (the prefab registry/library via
 * `restorePrefabInstances`/`rollbackPrefabState` above), since this primitive
 * only owns the audio stash and the dispatch itself.
 */
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
  projectRevision: 0,
  checkpointBusy: false,
  checkpointError: null,
  cloudSaveStatus: 'idle',
  lastCloudSave: null,
  sceneLoadError: null,

  saveScene: (requestId) => {
    // A rejected load leaves the engine holding something that is NOT this
    // project's scene. Every persistence consumer downstream of the resulting
    // SCENE_EXPORTED event (localStorage autosave, the IndexedDB cache, the
    // sessionStorage panic backup, the cloud PUT) writes whatever JSON comes
    // back, so refusing to ASK is what keeps an empty scene from overwriting
    // the project's stored `sceneData` (#10056).
    if (get().sceneLoadError) return;
    // Built conditionally rather than `{ requestId }`: the engine validates a
    // `requestId` key that is present, and an explicit `undefined` can survive
    // as `null` depending on how the payload is marshalled.
    if (dispatchCommand) dispatchCommand('export_scene', requestId ? { requestId } : {});
  },
  loadScene: (json, opts) => {
    // Whether a REJECTION should strand the editor. Default `true` keeps the
    // cold-open contract and every direct caller that has no trustworthy scene
    // to fall back on; a caller loading over an intact outgoing scene passes
    // `false` so its rejection surfaces a toast without locking saving (#10056).
    const strandOnReject = opts?.rejectionStrandsEditor ?? true;
    const rejectEditor = (reason: string) => {
      if (strandOnReject) set({ sceneLoadError: { reason, at: Date.now() } });
    };
    // The engine reveals a loaded scene's audio one selection at a time
    // (`emit_audio_on_selection`), and SCENE_LOADED carries only a name — so
    // this JSON is the only chance to know what the scene sounds like. Staged
    // here (inside `dispatchSceneLoad`), claimed by the SCENE_LOADED handler.
    //
    // Inside the guard: with no dispatcher the engine never loads and never
    // emits SCENE_LOADED, so a stash written here would sit until whatever
    // scene loads next claimed another scene's sounds. Staging only alongside
    // the dispatch keeps the stash and the pending load a single fact.
    //
    // `sceneLoadError` is deliberately NOT set here. No dispatcher means the
    // load is DEFERRED, not rejected — the editor page calls this before
    // `EditorLayout` (and therefore `useEngineEvents`' `setCommandDispatcher`)
    // has mounted, so every healthy cold open takes this branch. Flagging it
    // would put an error banner on a working editor and block its saves.
    if (!dispatchCommand) return false;
    // Restore the scene's linked prefab instances (and merge its embedded
    // definitions) into the prefab store before the engine load. Done
    // alongside the dispatch for the same reason audio is: with no
    // dispatcher the engine never loads, so mutating the store here would
    // desync it from what is actually rendered.
    const snapshot = restorePrefabInstances(json);
    if (!snapshot) {
      rejectEditor(PREFAB_LOAD_REJECTION);
      return false;
    }
    let accepted: boolean;
    try {
      accepted = dispatchSceneLoad(json);
    } catch (error) {
      // `dispatchSceneLoad` already rolled its own (audio) state back; the
      // prefab registry/library are this caller's state, so they roll back
      // here before the error propagates (scene.FR-1 N1 BUG-2/BUG-5). A
      // thrown dispatch error is a harder failure than an explicit
      // `{success:false}` rejection, so it is rethrown rather than folded
      // into the boolean contract — callers that need to distinguish it
      // (`restoreCheckpoint`'s own recovery flow) rely on exactly this.
      rollbackPrefabState(snapshot);
      rejectEditor(`${ENGINE_LOAD_THREW} ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
    if (!accepted) {
      // The engine never adopted the incoming scene — the scene still on
      // screen is the previous one, so its instance registry AND its prefab
      // LIBRARY must both come back (scene.FR-1 N1 BUG-2/BUG-5): the merge
      // above is not itself part of the rejected dispatch, so without this
      // a rejected scene's embedded definitions would install permanently,
      // and the next save would persist the wrong instances onto the scene
      // that is actually still active.
      rollbackPrefabState(snapshot);
      rejectEditor(ENGINE_LOAD_REJECTION);
      return false;
    }
    // A rejected request must not invalidate an unrelated recovery operation.
    // Clearing `sceneLoadError` here is the ONLY way saving comes back after a
    // rejection: the engine has now accepted a scene, so serializing it is
    // once again describing the project rather than overwriting it.
    set((state) => ({ sceneOperationRevision: state.sceneOperationRevision + 1, sceneLoadError: null }));
    return true;
  },
  newScene: () => {
    if (!dispatchCommand) {
      // No engine to change scenes at all — the scene, and therefore its
      // registry, is unchanged. Clearing here (as the dispatched path below
      // does) would describe a scene that never actually went empty
      // (scene.FR-1 N1 BUG-4).
      return false;
    }
    // new_scene emits SCENE_LOADED too. Anything staged by a load the engine
    // rejected would otherwise be adopted by this empty scene.
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
    try {
      const response = dispatchCommand('new_scene', {});
      if (response?.success === false) {
        rollbackAudio();
        // The engine never accepted the new scene — the scene on screen is
        // unchanged, so its registry must come back rather than stay cleared
        // out from under it (scene.FR-1 N1 BUG-4).
        savePrefabInstancesToStorage(previousInstances);
        return false;
      }
      // An empty scene the user asked for deliberately IS a trustworthy scene,
      // so this is a recovery route out of a rejected load: saving is allowed
      // again from here (#10056). A REJECTED new_scene leaves any existing
      // `sceneLoadError` standing, because the untrustworthy scene is still up.
      set((state) => ({ sceneOperationRevision: state.sceneOperationRevision + 1, sceneLoadError: null }));
      return true;
    } catch (error) {
      rollbackAudio();
      savePrefabInstancesToStorage(previousInstances);
      throw error;
    }
  },
  isEngineAttached: () => dispatchCommand !== null,
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
    // Same refusal as `saveScene`, and the one that matters most: this path
    // PUTs straight over the project's stored `sceneData` (#10056).
    if (get().sceneLoadError) return;
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

    // The engine has adopted a scene the editor built, so whatever rejection
    // preceded this no longer describes the viewport — same clear as
    // `loadScene`'s accepted path, and the reason a template load is a way out
    // of a rejected scene rather than a banner that never leaves (#10056).
    set({ sceneLoadError: null });

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
    // Capturing here would export the engine's scene and `saveCurrentSceneData`
    // it over the OUTGOING scene's stored data — and `captureActiveScene` uses
    // an un-prefixed request id, so the export also ticks autosave and the
    // panic backup. After a rejected load that scene is not the project's, so
    // refuse rather than persist it (#10056).
    const switchLoadError = get().sceneLoadError;
    if (switchLoadError) {
      console.error(`[Scenes] Refusing to switch scenes: ${switchLoadError.reason}`);
      return;
    }
    const captured = await capturePrefabAwareScene();
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
    const accepted = result.sceneToLoad
      ? get().loadScene(JSON.stringify(result.sceneToLoad), { rejectionStrandsEditor: false })
      : get().newScene();
    if (!accepted) {
      // Retain the outgoing capture without relabelling the unchanged engine
      // scene as the rejected target. `rejectionStrandsEditor: false` above is
      // what makes this safe: the outgoing scene is still on screen and still
      // this project's, so its saves must stay enabled — a rejected TARGET is a
      // failed navigation, not a corrupted editor (#10056). Surface it as a
      // toast (the Scene Browser has no other channel) rather than the save-
      // locking banner `sceneLoadError` would raise.
      saveProjectScenes(project, get().projectId);
      showError('The scene could not be opened, so the switch was cancelled. You are still on the current scene, which is unchanged.');
      return;
    }
    saveProjectScenes(result.project, get().projectId);
    get().setScenes(toSceneList(result.project), result.project.activeSceneId);
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
    // Same refusal as `switchScene` — see its comment (#10056).
    const duplicateLoadError = get().sceneLoadError;
    if (duplicateLoadError) {
      console.error(`[Scenes] Refusing to duplicate: ${duplicateLoadError.reason}`);
      return;
    }
    const captured = await capturePrefabAwareScene();
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
    // A checkpoint of a scene the engine never accepted would record an empty
    // scene as this project's recoverable state — the opposite of a safety net
    // (#10056). Surfaced through the existing `checkpointError` channel.
    const loadError = get().sceneLoadError;
    if (loadError) {
      set({ checkpointError: `${loadError.reason} No checkpoint was saved.` });
      return null;
    }
    const { projectId, projectRevision, sceneOperationRevision, activeSceneId } = get();
    const isCurrent = () => get().projectId === projectId && get().projectRevision === projectRevision && get().sceneOperationRevision === sceneOperationRevision && get().activeSceneId === activeSceneId;
    set({ checkpointBusy: true, checkpointError: null });
    try {
      // Fold the live prefab registry into the captured scene so the checkpoint
      // records the linked instances/definitions the engine export omits
      // (scene.FR-1 N1) — otherwise restoring silently discards them.
      const captured = withCheckpointPrefabData(await captureCheckpointScene(requestSceneExport));
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
    // The checkpoint's linked prefab registry is installed eagerly (like
    // `loadScene`), so it must be rolled back if the restore does not complete.
    let prefabSnapshot: PrefabRestoreSnapshot | null = null;
    // EVERY scene dispatch this restore makes goes through here, so
    // `sceneLoadError` keeps describing what the ENGINE is actually holding —
    // the same accepted/rejected contract `loadScene` maintains, applied to the
    // one scene-load path that does not go through it. Without the clear, an
    // ACCEPTED restore leaves an earlier rejection standing forever and the
    // correctly restored scene is permanently unsavable: `saveScene`,
    // `saveToCloud`, `EditorLayout`'s autosave ticker, `exportGame`,
    // `switchScene`, `duplicateScene`, `createCheckpoint` and the chat
    // export/switch/duplicate handlers all refuse while it is set, and
    // `SceneLoadErrorNotice` keeps saying saving is off (#10056). Without the
    // set, a REFUSED restore (including the recovery load of the outgoing
    // scene) would leave saving enabled over a viewport the engine never
    // adopted. A missing dispatcher cannot reach this: `captureCheckpointScene`
    // above already fails the restore when there is no engine to ask.
    const dispatchRestoreLoad = (json: string): boolean => {
      let accepted: boolean;
      try {
        accepted = dispatchSceneLoad(json);
      } catch (error) {
        set({
          sceneLoadError: {
            reason: `${ENGINE_LOAD_THREW} ${error instanceof Error ? error.message : String(error)}`,
            at: Date.now(),
          },
        });
        throw error;
      }
      set({ sceneLoadError: accepted ? null : { reason: ENGINE_LOAD_REJECTION, at: Date.now() } });
      return accepted;
    };
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
      const activeData = active.data ?? emptySceneFile(active.name);
      // Install the checkpoint's linked prefab registry (and merge its embedded
      // definitions) BEFORE the load, exactly as `loadScene` does — the engine
      // scene carries none of this, so without it the OUTGOING scene's registry
      // stays installed over the restored checkpoint and the next save folds
      // those foreign instances onto it (scene.FR-1 N1 / #10056). The `prefabSnapshot`
      // is this caller's rollback handle, mirroring `loadScene`'s
      // `restorePrefabInstances`/`rollbackPrefabState` pairing.
      prefabSnapshot = restorePrefabInstances(JSON.stringify(activeData));
      if (!prefabSnapshot) {
        throw new Error("The checkpoint's prefab data is invalid or its prefab references form a cycle. The checkpoint was not restored.");
      }
      await applyCheckpointScene(activeData, (json) => {
        attempted = true;
        const accepted = dispatchRestoreLoad(json);
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
      // The registry was installed eagerly. If the restore did not complete,
      // put the OUTGOING scene's registry AND library back before recovering
      // its scene — otherwise the prefab store would keep the checkpoint's
      // instances over a viewport that is being rolled back to the prior scene
      // (scene.FR-1 N1). No-op when nothing was installed yet.
      if (prefabSnapshot) rollbackPrefabState(prefabSnapshot);
      if (attempted && prior && isCurrent()) {
        try {
          await applyCheckpointScene(prior, dispatchRestoreLoad, requestSceneExport, isCurrent);
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
