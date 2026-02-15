/**
 * Zustand store for editor state management (REFACTORED).
 *
 * This store is now composed of domain slices for better maintainability.
 * All original exports are preserved for backward compatibility.
 */

import { create } from 'zustand';

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
  & AssetSlice;

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
}));

// Command dispatcher type - will be set by useEngine hook
type CommandDispatcher = (command: string, payload: unknown) => void;
let _dispatchCommand: CommandDispatcher | null = null;

export function setCommandDispatcher(dispatcher: CommandDispatcher): void {
  _dispatchCommand = dispatcher;

  // Set dispatcher for all slices
  setSelectionDispatcher(dispatcher);
  setSceneGraphDispatcher(dispatcher);
  setTransformDispatcher(dispatcher);
  setMaterialDispatcher(dispatcher);
  setLightingDispatcher(dispatcher);
  setPhysicsDispatcher(dispatcher);
  setAudioDispatcher(dispatcher);
  setAnimationDispatcher(dispatcher);
  setParticleDispatcher(dispatcher);
  setScriptDispatcher(dispatcher);
  setGameDispatcher(dispatcher);
  setSpriteDispatcher(dispatcher);
  setHistoryDispatcher(dispatcher);
  setSceneDispatcher(dispatcher);
  setAssetDispatcher(dispatcher);
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
