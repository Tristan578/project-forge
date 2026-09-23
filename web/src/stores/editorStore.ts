/**
 * Zustand store for editor state management.
 *
 * This store is composed of domain slices for better maintainability.
 * All original exports are preserved for backward compatibility.
 */

import { create } from 'zustand';
import { trackCommandDispatched } from '@/lib/analytics/events';
import { addBreadcrumb, captureException } from '@/lib/monitoring/sentry-client';
import { checkCommandBatch, checkCommandPayload } from '@/lib/engine/commandPayloadGuard';
import { showError } from '@/lib/toast';
// Namespace import so partial test mocks of `@/hooks/useEngine` (which omit
// the snapshot setter) don't throw at module load. We feature-detect the
// export at runtime instead of relying on the named binding being present.
import * as engineModule from '@/hooks/useEngine';
import type { BatchResult, CommandResponse } from '@/hooks/useEngine';

// Import all slices
import {
  SelectionSlice,
  createSelectionSlice,
  setSelectionDispatcher,
  SceneGraphSlice,
  createSceneGraphSlice,
  setSceneGraphDispatcher,
  TransformSlice,
  createTransformSlice,
  setTransformDispatcher,
  MaterialSlice,
  createMaterialSlice,
  setMaterialDispatcher,
  LightingSlice,
  createLightingSlice,
  setLightingDispatcher,
  PhysicsSlice,
  createPhysicsSlice,
  setPhysicsDispatcher,
  AudioSlice,
  createAudioSlice,
  setAudioDispatcher,
  AnimationSlice,
  createAnimationSlice,
  setAnimationDispatcher,
  ParticleSlice,
  createParticleSlice,
  setParticleDispatcher,
  ScriptSlice,
  createScriptSlice,
  setScriptDispatcher,
  GameSlice,
  createGameSlice,
  setGameDispatcher,
  setWinnabilityStateReader,
  SpriteSlice,
  createSpriteSlice,
  setSpriteDispatcher,
  HistorySlice,
  createHistorySlice,
  setHistoryDispatcher,
  SceneSlice,
  createSceneSlice,
  setSceneDispatcher,
  AssetSlice,
  createAssetSlice,
  setAssetDispatcher,
  EditModeSlice,
  createEditModeSlice,
  setEditModeDispatcher,
  BridgeSlice,
  createBridgeSlice,
  SceneLightSlice,
  createSceneLightSlice,
  LocalizationSlice,
  createLocalizationSlice,
  OrchestratorSlice,
  createOrchestratorSlice,
} from './slices';

// Re-export all types for backward compatibility
export * from './slices/types';

// Combined editor state type
export type EditorState =
  & SelectionSlice
  & SceneGraphSlice
  & TransformSlice
  & MaterialSlice
  & LightingSlice
  & PhysicsSlice
  & AudioSlice
  & AnimationSlice
  & ParticleSlice
  & ScriptSlice
  & GameSlice
  & SpriteSlice
  & HistorySlice
  & SceneSlice
  & AssetSlice
  & EditModeSlice
  & BridgeSlice
  & SceneLightSlice
  & LocalizationSlice
  & OrchestratorSlice;

// Create the store by composing all slices
export const useEditorStore = create<EditorState>()((...args) => ({
  ...createSelectionSlice(...args),
  ...createSceneGraphSlice(...args),
  ...createTransformSlice(...args),
  ...createMaterialSlice(...args),
  ...createLightingSlice(...args),
  ...createPhysicsSlice(...args),
  ...createAudioSlice(...args),
  ...createAnimationSlice(...args),
  ...createParticleSlice(...args),
  ...createScriptSlice(...args),
  ...createGameSlice(...args),
  ...createSpriteSlice(...args),
  ...createHistorySlice(...args),
  ...createSceneSlice(...args),
  ...createAssetSlice(...args),
  ...createEditModeSlice(...args),
  ...createBridgeSlice(...args),
  ...createSceneLightSlice(...args),
  ...createLocalizationSlice(...args),
  ...createOrchestratorSlice(...args),
}));

// E2E store exposure (__EDITOR_STORE, __CHAT_STORE, __FORGE_DISPATCH) is done
// in a SINGLE place — EditorLayout's post-hydration useEffect — so all three
// globals appear atomically. A module-level fallback here would set only
// __EDITOR_STORE before hydration, letting waitForEditorStore() return while
// __CHAT_STORE is still absent and racing the strict-mode readStore() calls.

// Register a synchronous snapshot of editor state with the WASM panic
// interceptor. The interceptor runs on the panicking caller's stack frame
// (inside `console.error`), so the provider must be sync — async lookups
// would race the crash. The provider is best-effort: if any field is missing
// or throws, the interceptor falls back to an empty snapshot.
//
// Wrapped in try/catch so partial test mocks of `@/hooks/useEngine` that omit
// the setter (vitest 4 raises on missing-export access via a Proxy) don't
// crash module evaluation. In production all exports are present.
try {
  const setter = engineModule.setEngineSnapshotProvider;
  if (typeof setter === 'function') {
    setter(() => {
      const state = useEditorStore.getState();
      const sceneNodes = state.sceneGraph?.nodes;
      return {
        entityCount: sceneNodes ? Object.keys(sceneNodes).length : 0,
        selectionSize: state.selectedIds?.size ?? 0,
        primarySelection: state.primaryId ?? null,
        canUndo: state.canUndo,
        canRedo: state.canRedo,
        undoDescription: state.undoDescription,
        engineMode: state.engineMode,
        recentCommands: _recentCommands.slice(),
      };
    });
  }
} catch {
  /* useEngine mocked without snapshot setter — diagnostics off in this test only */
}

// Ring buffer of the most recent engine commands. Surfaced in WASM panic
// reports so a crash includes the trail of commands that led to it.
const COMMAND_RING_SIZE = 20;
const _recentCommands: string[] = [];

function recordCommand(command: string): void {
  _recentCommands.push(command);
  if (_recentCommands.length > COMMAND_RING_SIZE) {
    _recentCommands.shift();
  }
  addBreadcrumb({
    category: 'engine.command',
    message: command,
    level: 'info',
  });
}

/** Last N engine commands dispatched (oldest first). For crash diagnostics. */
export function getRecentCommands(): readonly string[] {
  return _recentCommands;
}

// Commands whose rejection has already been reported to Sentry this session.
// A rejection inside a per-frame dispatch would otherwise flood the issue
// stream; the console signal below stays unthrottled.
const _reportedRejections = new Set<string>();

const REJECTED_ACTION_LABELS: Readonly<Record<string, string>> = {
  batch: 'apply those changes',
  export_scene: 'save the scene',
  load_scene: 'load the scene',
  new_scene: 'create a new scene',
  save_scene: 'save the scene',
  spawn_entity: 'add the entity',
  delete_entity: 'delete the entity',
};

function rejectedActionMessage(command: string): string {
  const action = REJECTED_ACTION_LABELS[command] ?? 'complete that action';
  return `Couldn't ${action}. The engine rejected the change.`;
}

/**
 * Surface an engine rejection that no caller can observe.
 *
 * The engine answers every command with a `CommandResponse` and rejects a
 * number of them by design, but ~40 single-dispatch call sites ignore the
 * return value — the failure was invisible until someone noticed the effect
 * never happened (PF-1097 lived that way for its whole life). Reporting here,
 * in the wrapper every dispatch already passes through, covers all of them
 * without touching a single caller.
 *
 * Monitoring must never break dispatch, so every step is guarded.
 */
function reportCommandRejected(command: string, error: string | undefined): void {
  const engineError = error ?? 'no error message';
  console.error(`Engine rejected command '${command}': ${engineError}`);

  const firstRejection = !_reportedRejections.has(command);
  if (firstRejection) {
    _reportedRejections.add(command);
    try {
      // Product wording only: neither the internal command vocabulary nor the
      // raw engine error belongs in a user-visible notification.
      showError(rejectedActionMessage(command));
    } catch {
      /* notifications are best-effort — never let them break dispatch */
    }
  }

  try {
    addBreadcrumb({
      category: 'engine.command.rejected',
      message: `${command}: ${engineError}`,
      level: 'error',
    });
    if (firstRejection) {
      captureException(new Error(`Engine rejected command '${command}'`), {
        command,
        engineError,
      });
    }
  } catch {
    /* monitoring is best-effort — never let it throw into the dispatch path */
  }
}

/**
 * The commands that replace the whole scene. The engine answers each one as
 * soon as it has QUEUED it, applies it on its next frame, and only then emits
 * SCENE_LOADED (`apply_scene_load` / `apply_new_scene` in
 * `engine/src/bridge/scene_io.rs`). Nothing else queues a scene replacement.
 */
const SCENE_REPLACING_COMMANDS: ReadonlySet<string> = new Set(['load_scene', 'new_scene']);

/**
 * Drop every game-component adjustment marker (PF-1148) once the engine has
 * agreed to replace the scene.
 *
 * A marker says "this field holds X because you asked for Y", keyed by entity
 * id. The outgoing scene's markers describe requests made of entities that are
 * about to be despawned, and nothing else removes them: `GAME_COMPONENT_CHANGED`
 * prunes only a marker whose field now holds a DIFFERENT value. Reloading the
 * same scene file, restoring a checkpoint or loading a template with fixed ids
 * brings the same id back holding the applied value, and the marker would then
 * report a request nobody made of the scene on screen.
 *
 * Here, when the engine accepts the command, and NOT in the SCENE_LOADED
 * handler. The scene is applied a frame later, and a caller can already have
 * written the INCOMING scene's components by then: `create_scene_from_description`
 * calls `newScene()` and adds its components in the same task. Clearing on
 * SCENE_LOADED would erase exactly those markers, and they are true.
 */
function forgetOutgoingSceneAdjustments(): void {
  if (Object.keys(useEditorStore.getState().gameComponentAdjustments).length === 0) return;
  useEditorStore.setState({ gameComponentAdjustments: {} });
}

// Command dispatcher type - will be set by useEngine hook.
// The return value is what makes an engine rejection observable; callers that
// do not care may still ignore it (a value-returning function is assignable to
// a `=> void` parameter), which is why widening this needed no call-site churn.
type CommandDispatcher = (command: string, payload: unknown) => CommandResponse | void;
let _dispatchCommand: CommandDispatcher | null = null;

export function setCommandDispatcher(dispatcher: CommandDispatcher): void {
  // Wrap dispatcher to emit Vercel analytics + Sentry breadcrumb for every
  // engine command. Tracking is fire-and-forget and never blocks dispatch.
  const tracked: CommandDispatcher = (command, payload) => {
    if (command === 'load_scene' || command === 'new_scene') {
      // A new scene starts a new user session for rejection notifications.
      _reportedRejections.clear();
    }
    trackCommandDispatched(command);
    recordCommand(command);
    // Bounded here rather than only in the engine. The Rust guard cannot see a
    // payload until `serde_wasm_bindgen` has already walked it recursively to
    // build the value it checks, and on wasm32 overflowing that walk is an
    // unrecoverable trap that kills the engine instance. This is the last point
    // at which the structure is still a JS object.
    const tooBig = checkCommandPayload(command, payload);
    if (tooBig) {
      reportCommandRejected(command, tooBig);
      return { success: false, error: tooBig };
    }
    let response: CommandResponse | void = undefined;
    try {
      response = dispatcher(command, payload);
    } finally {
      // Anything but an explicit refusal replaced the scene, a throw included:
      // a thrown dispatch can have despawned the outgoing scene mid-apply (see
      // `sceneSlice.loadScene`), and a marker on a scene that may be gone is
      // the false report this must not leave behind.
      if (SCENE_REPLACING_COMMANDS.has(command) && !(response && response.success === false)) {
        forgetOutgoingSceneAdjustments();
      }
    }
    // Only an explicit `success: false` is a rejection. A dispatcher that
    // returns nothing (every test double, and any pre-PF-1098 caller) is not
    // reporting failure, and must not be treated as if it were.
    if (response && response.success === false) {
      reportCommandRejected(command, response.error);
    }
    return response;
  };
  _dispatchCommand = tracked;

  // Set tracked dispatcher for all slices so every command emits analytics
  setSelectionDispatcher(tracked);
  setSceneGraphDispatcher(tracked);
  setTransformDispatcher(tracked);
  setMaterialDispatcher(tracked);
  setLightingDispatcher(tracked);
  setPhysicsDispatcher(tracked);
  setAudioDispatcher(tracked);
  setAnimationDispatcher(tracked);
  setParticleDispatcher(tracked);
  setScriptDispatcher(tracked);
  setGameDispatcher(tracked);
  // Wire the pre-play winnability gate's cross-slice reader. play() lives in
  // gameSlice but the validator needs the scene graph from another slice.
  setWinnabilityStateReader(() => {
    const state = useEditorStore.getState();
    return { sceneGraph: state.sceneGraph, allGameComponents: state.allGameComponents };
  });
  setSpriteDispatcher(tracked);
  setHistoryDispatcher(tracked);
  setSceneDispatcher(tracked);
  setAssetDispatcher(tracked);
  setEditModeDispatcher(tracked);
}

/** Get the raw command dispatcher for direct engine communication. */
export function getCommandDispatcher(): CommandDispatcher | null {
  return _dispatchCommand;
}

// Batch command dispatcher - set by useEngine hook
type BatchCommandDispatcher = (commands: Array<{ command: string; payload?: unknown }>) => import('@/hooks/useEngine').BatchResult;
let _dispatchCommandBatch: BatchCommandDispatcher | null = null;

export function setCommandBatchDispatcher(dispatcher: BatchCommandDispatcher | undefined): void {
  if (!dispatcher) {
    _dispatchCommandBatch = null;
    return;
  }
  _dispatchCommandBatch = (commands) => {
    for (const { command } of commands) {
      trackCommandDispatched(command);
      recordCommand(command);
    }
    // The whole envelope, not each payload in turn: the batch crosses into WASM
    // as one value, so it is the envelope that gets walked recursively.
    const tooBig = checkCommandBatch(commands);
    if (tooBig) {
      // One report for one refusal. Reporting per command would emit up to a
      // few hundred console lines for a single event, and — worse — would enter
      // every command in the batch into the session-scoped dedup set, so a
      // later genuine rejection of any of them would never reach Sentry.
      reportCommandRejected('batch', tooBig);
      return {
        success: false,
        // One result per command, in order — callers index into this array.
        results: commands.map(() => ({ success: false, error: tooBig })),
      };
    }
    let result: BatchResult | undefined;
    try {
      result = dispatcher(commands);
      return result;
    } finally {
      // Item by item, on the item's own answer: `useEngineEvents` answers a
      // batch it never ran with no results at all, and that replaced nothing.
      // A throw is taken as the single path takes it.
      const replaced = commands.some(({ command }, i) => SCENE_REPLACING_COMMANDS.has(command)
        && (result === undefined || result.results[i]?.success === true));
      if (replaced) forgetOutgoingSceneAdjustments();
    }
  };
}

export function getCommandBatchDispatcher(): BatchCommandDispatcher | null {
  return _dispatchCommandBatch;
}

// Play tick callback for script runner
type PlayTickCallback = (data: unknown) => void;
let _playTickCallback: PlayTickCallback | null = null;

export function setPlayTickCallback(cb: PlayTickCallback | null) {
  _playTickCallback = cb;
}

export function firePlayTick(data: unknown) {
  _playTickCallback?.(data);
}
