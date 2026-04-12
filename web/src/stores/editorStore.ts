/**
 * Zustand store for editor state management.
 *
 * This store is composed of domain slices for better maintainability.
 * All original exports are preserved for backward compatibility.
 */

import { create } from 'zustand';
import { trackCommandDispatched } from '@/lib/analytics/events';

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
  & LocalizationSlice;

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
}));

// Best-effort store exposure for E2E tests (dev/test only).
// The primary exposure happens in EditorLayout's useEffect (guaranteed client-side).
// This module-level fallback may not fire reliably due to Next.js SSR evaluation.
if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') {
  (window as unknown as Record<string, unknown>).__EDITOR_STORE = useEditorStore;
}

// Command dispatcher type - will be set by useEngine hook
type CommandDispatcher = (command: string, payload: unknown) => void;
let _dispatchCommand: CommandDispatcher | null = null;

export function setCommandDispatcher(dispatcher: CommandDispatcher): void {
  // Wrap dispatcher to emit Vercel analytics for every engine command.
  // Tracking is fire-and-forget and never blocks the dispatch path.
  const tracked: CommandDispatcher = (command, payload) => {
    trackCommandDispatched(command);
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

export function setCommandBatchDispatcher(dispatcher: BatchCommandDispatcher): void {
  _dispatchCommandBatch = dispatcher;
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
