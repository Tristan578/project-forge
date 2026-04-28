/**
 * Zustand store for editor state management.
 *
 * This store is composed of domain slices for better maintainability.
 * All original exports are preserved for backward compatibility.
 */

import { create } from 'zustand';
import { trackCommandDispatched } from '@/lib/analytics/events';
import { addBreadcrumb } from '@/lib/monitoring/sentry-client';
// Namespace import so partial test mocks of `@/hooks/useEngine` (which omit
// the snapshot setter) don't throw at module load. We feature-detect the
// export at runtime instead of relying on the named binding being present.
import * as engineModule from '@/hooks/useEngine';
import { setAutoWireDispatchers } from './generationAutoWire';

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

// Wire generation auto-wire to editor actions. Resolves the store at call time
// so the latest action references are used (slices may be replaced in tests via
// resetForTest helpers). Decoupled via the registered-handler pattern in
// generationAutoWire to avoid editorStore <-> generationStore import cycles.
setAutoWireDispatchers({
  importGltf: (dataBase64, name) => useEditorStore.getState().importGltf(dataBase64, name),
  loadTexture: (dataBase64, name, entityId, slot) =>
    useEditorStore.getState().loadTexture(dataBase64, name, entityId, slot),
  importAudio: (dataBase64, name) => useEditorStore.getState().importAudio(dataBase64, name),
  setAudio: (entityId, data) => useEditorStore.getState().setAudio(entityId, data),
});

// Best-effort store exposure for E2E tests (dev/test only).
// The primary exposure happens in EditorLayout's useEffect (guaranteed client-side).
// This module-level fallback may not fire reliably due to Next.js SSR evaluation.
if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') {
  (window as unknown as Record<string, unknown>).__EDITOR_STORE = useEditorStore;
}

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

// Command dispatcher type - will be set by useEngine hook
type CommandDispatcher = (command: string, payload: unknown) => void;
let _dispatchCommand: CommandDispatcher | null = null;

export function setCommandDispatcher(dispatcher: CommandDispatcher): void {
  // Wrap dispatcher to emit Vercel analytics + Sentry breadcrumb for every
  // engine command. Tracking is fire-and-forget and never blocks dispatch.
  const tracked: CommandDispatcher = (command, payload) => {
    trackCommandDispatched(command);
    recordCommand(command);
    dispatcher(command, payload);
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
  setSpriteDispatcher(tracked);
  setHistoryDispatcher(tracked);
  setSceneDispatcher(tracked);
  setAssetDispatcher(tracked);
  setEditModeDispatcher(tracked);
}

/** Get the raw command dispatcher for direct engine communication. */
export function getCommandDispatcher(): ((command: string, payload: unknown) => void) | null {
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
    return dispatcher(commands);
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
