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
import { useMusicArrangementStore, readArrangementFromSceneData } from '@/lib/music/arrangementStore';

/** Project scenes reduced to the shape the store mirrors for the Scene Browser. */
function toSceneList(project: ProjectScenes) {
  return project.scenes.map((s) => ({ id: s.id, name: s.name, isStartScene: s.isStartScene }));
}

/**
 * A save lockout after scene validation/rejection or a thrown engine dispatch.
 * The viewport may be empty, stale, or partly overwritten and cannot safely
 * replace the stored scene.
 *
 * Deliberately NOT the same fact as `loadScene` returning `false`: that boolean
 * conflates rejection with *deferral*, because `loadScene` also returns false
 * when there is no dispatcher yet (the engine mounts after the editor page, so
 * a healthy cold open takes that branch every time). Deferral does not create
 * a lockout; rejection policy and thrown-dispatch policy are independent.
 */
export interface SceneLoadError {
  /** User-facing sentence naming what went wrong. Never blank. */
  reason: string;
  /** `Date.now()` when the failure creates this lockout. */
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

/**
 * Was this lockout raised by a THROWN dispatch (as opposed to a clean
 * `{success:false}` rejection)? A throw can have despawned the outgoing scene
 * mid-apply, so a capture taken while such a lockout stands is a capture of a
 * possibly-wrecked viewport — `restoreCheckpoint`'s recovery branch uses this
 * to refuse to re-enable saving over that capture (#10079).
 */
function isEngineLoadThrewLockout(error: SceneLoadError | null): boolean {
  return error !== null && error.reason.startsWith(ENGINE_LOAD_THREW);
}

/** Editor scene metadata, engine operations, persistence, and recovery state. */
export interface SceneSlice {
  /** Name displayed for the active viewport. */
  sceneName: string;
  /** Whether the active viewport has unsaved edits. */
  sceneModified: boolean;
  /** Invalidates asynchronous scene work when another scene is requested. */
  sceneOperationRevision: number;
  /** Whether periodic local saves are enabled. */
  autoSaveEnabled: boolean;
  /** Stored project scene summaries for the Scene Browser. */
  scenes: Array<{ id: string; name: string; isStartScene: boolean }>;
  /** Stored scene currently selected, or null before project setup. */
  activeSceneId: string | null;
  /** Whether a Scene Browser switch is in progress. */
  sceneSwitching: boolean;
  /** Active transition overlay and target metadata. */
  sceneTransition: {
    active: boolean;
    config: SceneTransitionConfig | null;
    targetScene: string | null;
    transitionId: string | null;
  };
  /** Transition defaults merged into scene-switch requests. */
  defaultTransition: SceneTransitionConfig;
  /** Terrain metadata mirrored by entity ID. */
  terrainData: Record<string, TerrainDataState>;
  /** Whether an export UI operation is active. */
  isExporting: boolean;
  /** Current project identifier, or null for an unsaved project. */
  projectId: string | null;
  /** Invalidates asynchronous work when the project changes. */
  projectRevision: number;
  /** Whether checkpoint capture or restore is in progress. */
  checkpointBusy: boolean;
  /** Recovery guidance from the latest checkpoint failure. */
  checkpointError: string | null;
  /** Status of the current or latest cloud-save request. */
  cloudSaveStatus: 'idle' | 'saving' | 'saved' | 'error';
  /** ISO timestamp of the latest successful cloud save. */
  lastCloudSave: string | null;
  /**
   * Set after a stranding rejection or thrown dispatch while the viewport
   * cannot safely be saved. A later non-replacing rejection preserves an
   * existing throw lockout. See {@link SceneLoadError} for why this exists alongside
   * `loadScene`'s boolean rather than instead of it.
   *
   * Two consumers, and both are load-bearing: `SceneLoadErrorNotice` renders
   * the load failure instead of leaving an untrusted viewport unexplained, and every
   * save path refuses while it is set — otherwise the next Ctrl+S, cloud save
   * or autosave tick could serialize the engine's empty or corrupted scene over the
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
   * validation or engine dispatch rejects the load. Audio rollback is attempted
   * and prefab instances/definitions are restored independently on a best-effort
   * basis; storage failures are logged and may leave a partial prefab rollback.
   *
   * A `false` return is NOT by itself an error: it also means "no dispatcher
   * yet", which is the normal cold-open path. {@link sceneLoadError} is the
   * field that records a stranding rejection or thrown dispatch. An accepted
   * load clears it; this primitive does not wait for engine confirmation.
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
   *
   * `strandOnThrow` is a SEPARATE fact and defaults to `true` independently of
   * `rejectionStrandsEditor`. A thrown dispatch is not a clean `{success:false}`
   * rejection: an explicit rejection means the engine kept the outgoing scene,
   * but a throw can leave it despawned mid-apply — the viewport can no longer be
   * trusted. So a caller that passes `rejectionStrandsEditor: false` (a switch /
   * import loading over an intact scene) still wants a THROWN dispatch to strand
   * the editor and lock saving, and gets that by leaving `strandOnThrow` at its
   * `true` default: {@link sceneLoadError} is set with the `ENGINE_LOAD_THREW`
   * reason before the error propagates, so the next autosave / Ctrl+S / cloud
   * save cannot serialize the wrecked engine scene over the stored one (#10079).
   *
   * @param json Serialized scene to load.
   * @param opts Independent rejection and throw lockout policies, both default true.
   * @returns Whether the engine accepted the request, not whether it applied it.
   * @throws The original dispatch error after rollback attempts and optional lockout.
   */
  loadScene: (json: string, opts?: { rejectionStrandsEditor?: boolean; strandOnThrow?: boolean }) => boolean;
  /**
   * Return false when no engine is available or it rejects the new scene.
   * A successful new scene clears {@link sceneLoadError}: an empty scene the
   * user asked for deliberately IS trustworthy, so saving is allowed again.
   * A thrown dispatch sets a save lockout before audio/prefab-instance rollback,
   * logs any storage rollback failure, and rethrows the original engine error.
   *
   * @returns Whether the engine accepted a new scene.
   * @throws The original dispatch error; prefab rollback may remain partial.
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
  /** Update the displayed scene name. */
  setSceneName: (name: string) => void;
  /** Update the active scene dirty flag. */
  setSceneModified: (modified: boolean) => void;
  /** Enable or disable periodic local saving. */
  setAutoSaveEnabled: (enabled: boolean) => void;
  /** Replace stored scene summaries and active scene ID. */
  setScenes: (scenes: Array<{ id: string; name: string; isStartScene: boolean }>, activeId: string | null) => void;
  /** Update the switch-in-progress flag. */
  setSceneSwitching: (switching: boolean) => void;
  /** Run a transition around a scene-switch request. */
  startSceneTransition: (targetScene: string, configOverride?: Partial<SceneTransitionConfig>) => Promise<void>;
  /** Merge new transition defaults. */
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
  /** Dispatch updated terrain parameters for an entity. */
  updateTerrain: (entityId: string, terrainData: TerrainDataState) => void;
  /** Dispatch a terrain brush operation at a local position. */
  sculptTerrain: (entityId: string, position: [number, number], radius: number, strength: number) => void;
  /** Mirror terrain metadata received from the engine. */
  setTerrainData: (entityId: string, data: TerrainDataState) => void;
  /** Dispatch a union of two mesh entities. */
  csgUnion: (entityIdA: string, entityIdB: string, deleteSources?: boolean) => void;
  /** Dispatch subtraction of the second mesh from the first. */
  csgSubtract: (entityIdA: string, entityIdB: string, deleteSources?: boolean) => void;
  /** Dispatch intersection of two mesh entities. */
  csgIntersect: (entityIdA: string, entityIdB: string, deleteSources?: boolean) => void;
  /** Dispatch extrusion using the supplied shape parameters. */
  extrudeShape: (shape: string, params: Record<string, unknown>) => void;
  /** Dispatch a lathe mesh from the supplied profile. */
  latheShape: (profile: [number, number][], params: Record<string, unknown>) => void;
  /** Dispatch a procedural array of an entity. */
  arrayEntity: (entityId: string, params: Record<string, unknown>) => void;
  /** Dispatch mesh combination with optional source deletion. */
  combineMeshes: (entityIds: string[], deleteSources?: boolean, name?: string) => void;
  /** Update the export UI progress flag. */
  setExporting: (value: boolean) => void;
  /** Select a project and invalidate old project work. */
  setProjectId: (id: string | null) => void;
  /** Trigger the export whose event drives the cloud-save PUT. See {@link saveScene} for `requestId`. */
  saveToCloud: (requestId?: string) => void;
  /** Update the cloud-save status. */
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
   * Capture the outgoing scene before requesting a switch. Rejection leaves
   * the outgoing scene active; a thrown dispatch locks saving, attempts rollback,
   * and persists the already-captured outgoing data with reload guidance.
   * Prefab rollback is best-effort and a dispatch acceptance is not SCENE_LOADED.
   *
   * @param sceneId Stored scene to activate.
   * @returns Resolves after the accepted switch is recorded or an error is surfaced.
   */
  switchScene: (sceneId: string) => Promise<void>;
  /** Add an empty scene to the project scene list. */
  createNewScene: (name?: string) => void;
  /** Delete a stored project scene when allowed. */
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
   * Tracks {@link sceneLoadError} on the same terms as {@link loadScene}, with
   * one deliberate refinement: the clear happens ONLY at the SCENE_LOADED-
   * confirmed points (the two `applyCheckpointScene` resolutions), never on a
   * merely-accepted dispatch, because acceptance is not confirmation that the
   * engine applied the scene. A refused or thrown load sets it. The recovery
   * load preserves a throw lockout that was already present when its prior
   * capture was taken: that capture may contain wreckage. A throw during this
   * attempt can be cleared by confirmed recovery of a previously trusted prior.
   * Non-replacing rejections preserve throw provenance across retries; recovery
   * of an untrusted prior capture explicitly restores its original throw lockout.
   *
   * @param checkpointId Stored checkpoint to restore.
   * @returns Whether engine confirmation and active-save commitment succeeded.
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

/**
 * Attach the engine command dispatcher and matching scene validator.
 * @param dispatcher Engine dispatch function, or null when detached.
 * @returns Nothing.
 */
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
 * @param requestId Optional correlation identifier echoed by the export event.
 * @returns Whether export dispatch was accepted; no scene data is returned here.
 * @throws An engine dispatch error.
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

/**
 * Roll BOTH prefab-store storage keys back to a snapshot `restorePrefabInstances`
 * took. Every one of this function's six call sites sits either inside a
 * `catch` block or right before returning a rejection — none of them expect
 * (or are wrapped to handle) a SECOND exception from the rollback write
 * itself, so a `localStorage.setItem` failure here (quota exceeded, private
 * browsing) must not propagate: that would replace the original, already
 * diagnosed rejection with an unhandled exception loadScene's own callers
 * never see coming. Logged, not silent, so a real storage failure is still
 * visible; the prefab store may be left only partially rolled back.
 */
function rollbackPrefabState(snapshot: PrefabRestoreSnapshot): void {
  // Guarded INDEPENDENTLY so a throw from the instances write does not skip the
  // library rollback. Wrapping both in one `try` let a `localStorage.setItem`
  // failure on the first write abandon the second, leaving a rejected scene's
  // embedded prefab DEFINITIONS installed permanently even though the engine
  // never loaded it (scene.FR-1 N1 BUG-5 / #10079). Each write logs its own
  // failure so a real storage fault is still visible.
  try {
    savePrefabInstancesToStorage(snapshot.instances);
  } catch (error) {
    console.error('[Scenes] Failed to roll back prefab instances; storage may be inconsistent:', error);
  }
  try {
    savePrefabsToStorage(snapshot.prefabs);
  } catch (error) {
    console.error('[Scenes] Failed to roll back prefab library; storage may be inconsistent:', error);
  }
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

/**
 * Create scene actions and initial state for the combined editor Zustand store.
 * @param set Combined-store state updater.
 * @param get Combined-store state reader.
 * @param api Combined-store subscriptions and lifecycle API.
 * @returns Initial scene state and bound actions.
 */
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
    // A THROWN dispatch strands the editor even when a clean rejection would
    // not: a throw can leave the outgoing scene despawned mid-apply, so the
    // viewport is untrustworthy and saving must lock regardless of
    // `rejectionStrandsEditor` (#10079). Defaults on independently.
    const strandOnThrow = opts?.strandOnThrow ?? true;
    const setLockout = (reason: string) => set({ sceneLoadError: { reason, at: Date.now() } });
    const rejectEditor = (reason: string) => {
      // A non-replacing rejection cannot make a previously wrecked viewport
      // trustworthy or downgrade the provenance used by checkpoint retries.
      if (strandOnReject && !isEngineLoadThrewLockout(get().sceneLoadError)) setLockout(reason);
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
      // Set the lockout on `strandOnThrow`, NOT `strandOnReject`: a caller that
      // treats a clean rejection as non-stranding (a switch/import over an
      // intact scene) still needs a throw to lock saving, because a throw can
      // have wrecked the very scene it was falling back on (#10079).
      if (strandOnThrow) setLockout(`${ENGINE_LOAD_THREW} ${error instanceof Error ? error.message : String(error)}`);
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
    // Swap in this scene's own arrangement (or clear it) — see
    // `syncArrangementFromLoadedScene` (#10058).
    syncArrangementFromLoadedScene(json);
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
      // A blank scene has no saved arrangement — clear whatever the previous
      // scene left behind (#10058).
      useMusicArrangementStore.getState().hydrate(null);
      return true;
    } catch (error) {
      // Mirrors `loadScene`'s `strandOnThrow` default (Sentry, #10079): a
      // THROWN `new_scene` dispatch can have despawned the outgoing scene
      // mid-apply, same as a thrown `load_scene`, so the viewport can no
      // longer be trusted and saving must lock until reload. Both
      // `switchScene` (above) and its chat-handler mirror
      // `sceneManagementHandlers.switch_scene` fall back to calling this
      // function when the target scene's stored `data` is null, and both
      // already assume — and TELL THE USER — that saving is locked when this
      // throws. Before this fix that was false: no lockout was ever set on
      // this path, so autosave could silently overwrite the previous scene
      // with the wrecked engine viewport's corrupted state.
      set({
        sceneLoadError: {
          reason: `${ENGINE_LOAD_THREW} ${error instanceof Error ? error.message : String(error)}`,
          at: Date.now(),
        },
      });
      // The engine lockout must stand even if registry rollback storage fails.
      rollbackAudio();
      try {
        savePrefabInstancesToStorage(previousInstances);
      } catch (rollbackError) {
        console.error('[Scenes] Failed to restore prefab instances after new-scene failure:', rollbackError);
      }
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
    // A template never carries its own arrangement, but the arrangement store
    // from whatever scene was active before this template loaded is still
    // sitting there — clear it the same way `loadScene` does (#10058).
    syncArrangementFromLoadedScene(sceneJson);

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
    let accepted: boolean;
    try {
      accepted = result.sceneToLoad
        // `strandOnThrow: true` (the default, restated for the reader) is what
        // makes the catch below honest: a clean rejection leaves the outgoing
        // scene intact and non-stranding, but a THROWN dispatch sets
        // `sceneLoadError(ENGINE_LOAD_THREW)` so saving locks over the wrecked
        // viewport rather than being folded into a no-op (#10079). `newScene()`
        // sets the same lockout on its own throw path, so both branches below
        // leave saving locked identically (#10079 follow-up, Sentry).
        ? get().loadScene(JSON.stringify(result.sceneToLoad), { rejectionStrandsEditor: false, strandOnThrow: true })
        : get().newScene();
    } catch (error) {
      // `loadScene`/`newScene` attempted audio and prefab registry rollback
      // before rethrowing; prefab storage restoration is best-effort —
      // and both have already set `sceneLoadError(ENGINE_LOAD_THREW)` on this
      // throw, so every save path is now locked. What they
      // cannot roll back is this function's own outgoing capture: without the
      // `saveProjectScenes` below, a thrown dispatch error skips both persists
      // and the scene captured at the top of this function — the user's unsaved
      // work in the OUTGOING scene — is silently lost, and `SceneBrowser.tsx`
      // awaits this with a bare `void`, so the exception would otherwise become
      // an unhandled rejection too. Persisting that capture is safe even with
      // the lockout set: it writes the already-captured outgoing data, not a
      // fresh export of the wrecked engine scene.
      console.error('[Scenes] Switch scene dispatch threw; persisting the outgoing scene and locking saving until reload:', error);
      saveProjectScenes(project, get().projectId);
      showError('The scene could not be opened due to an engine error. Reload the editor before continuing — the viewport can no longer be trusted, and saving is locked to protect your stored scene.');
      return;
    }
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
    // A lockout standing when this restore begins is the lockout the `prior`
    // capture (taken below, before any dispatch) is made under. If it was
    // raised by a THROWN dispatch, that capture is of a possibly-wrecked
    // viewport, so the recovery branch must NOT clear the lockout when it
    // re-applies `prior` — confirming SCENE_LOADED for the wreckage does not
    // make it trustworthy (#10079, finding 4).
    const priorCapturedUnderThrowLockout = isEngineLoadThrewLockout(before.sceneLoadError);
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
    // Rejection is set here immediately: it is certain the instant the engine
    // answers, exactly like `loadScene`'s own rejection branch. Clearing on
    // ACCEPTANCE is deliberately NOT done here (Sentry) — `dispatchSceneLoad`
    // only reports that the dispatch was not immediately refused, not that
    // `SCENE_LOADED` has confirmed the engine actually applied it. Callers
    // clear `sceneLoadError` themselves once `applyCheckpointScene`'s await
    // resolves, so an accepted-but-still-applying restore does not open a
    // window where a manual save could pass the `sceneLoadError` gate against
    // a viewport that has not yet caught up.
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
      if (!accepted && !isEngineLoadThrewLockout(get().sceneLoadError)) {
        // Keep an existing throw lockout across failed retries: a later
        // recovery must still know that its prior capture is untrusted.
        set({ sceneLoadError: { reason: ENGINE_LOAD_REJECTION, at: Date.now() } });
      }
      return accepted;
    };
    // `dispatchRestoreLoad`, plus the arrangement sync `loadScene`/`newScene`/
    // `loadTemplate` get. Used ONLY for the primary restore below, never for
    // this function's own rollback (restoring `prior` on failure): `prior` is
    // the scene that was already active — and whose arrangement is still
    // correctly sitting in the store, untouched — before the restore attempt
    // began, so re-syncing there would read "this scene has none" and wipe out
    // the very arrangement the rollback is putting the user back onto. A
    // checkpoint never captures the arrangement either way (#10058).
    const dispatchRestoreLoadAndSyncArrangement = (json: string): boolean => {
      const accepted = dispatchRestoreLoad(json);
      if (accepted) syncArrangementFromLoadedScene(json);
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
        const accepted = dispatchRestoreLoadAndSyncArrangement(json);
        attempted = accepted;
        return accepted;
      }, requestSceneExport, isCurrent);
      if (!isCurrent()) throw new Error('The project changed while restoring.');
      // `applyCheckpointScene` above only resolves once SCENE_LOADED confirms
      // the engine actually applied this scene — only now is the viewport
      // trustworthy enough to clear the save lockout (Sentry).
      saveProjectScenes(result.project, projectId);
      get().setScenes(toSceneList(result.project), result.project.activeSceneId);
      set({ sceneModified: false, sceneLoadError: null });
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
          // Plain `dispatchRestoreLoad`, deliberately not the arrangement-
          // syncing variant: `prior` is the scene that was ALREADY active (and
          // whose arrangement is still sitting in the store, untouched) before
          // this restore attempt began, so re-syncing here would incorrectly
          // clear it — a checkpoint capture never carries an arrangement, so
          // the sync would read as "this scene has none" and wipe out the very
          // arrangement the rollback is putting the user back onto (#10058).
          await applyCheckpointScene(prior, dispatchRestoreLoad, requestSceneExport, isCurrent);
          // Confirmed by the same SCENE_LOADED wait as the success path above —
          // the prior scene is back, so its name/dirty flag come back with it.
          // The save lockout comes off too UNLESS `prior` was captured under a
          // THREW lockout: re-applying a capture of a viewport a throw may have
          // wrecked, and confirming SCENE_LOADED for it, does not make it
          // trustworthy, so saving stays locked until the user reloads (#10079).
          set({
            sceneName: before.sceneName,
            sceneModified: before.sceneModified,
            sceneLoadError: priorCapturedUnderThrowLockout ? before.sceneLoadError : null,
          });
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
