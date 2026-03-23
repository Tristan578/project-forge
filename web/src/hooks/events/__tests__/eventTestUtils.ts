/**
 * Shared test utilities for domain event handler tests.
 */
import { vi } from 'vitest';
import type { useEditorStore } from '@/stores/editorStore';

/** Store state type alias for type-safe mock casts */
export type StoreState = ReturnType<typeof useEditorStore.getState>;

/**
 * Creates mock set/get functions for event handler testing.
 */
export function createMockSetGet() {
  const set = vi.fn() as import('../types').SetFn;
  const get = vi.fn(() => ({})) as unknown as import('../types').GetFn;
  return { set, get };
}

/**
 * Creates a mock store actions object with vi.fn() for common actions.
 * Use with vi.mocked(useEditorStore.getState).mockReturnValue(actions).
 */
export function createMockActions() {
  return {
    setPrimaryMaterial: vi.fn(),
    setPrimaryLight: vi.fn(),
    setAmbientLight: vi.fn(),
    setEnvironment: vi.fn(),
    setPostProcessing: vi.fn(),
    setPrimaryShaderEffect: vi.fn(),
    setTerrainData: vi.fn(),
    setQualityFromEngine: vi.fn(),
    // Transform events
    setFullGraph: vi.fn(),
    setSceneGraph: vi.fn(),
    setSelection: vi.fn(),
    setPrimaryTransform: vi.fn(),
    setEngineMode: vi.fn(),
    setHistory: vi.fn(),
    clearSelection: vi.fn(),
    updateSceneGraph: vi.fn(),
    setHistoryState: vi.fn(),
    setSnapSettings: vi.fn(),
    setCurrentCameraPreset: vi.fn(),
    saveScene: vi.fn(),
    // Physics events
    setPrimaryPhysics: vi.fn(),
    setPhysicsEnabled: vi.fn(),
    setJoint: vi.fn(),
    setPrimaryJoint: vi.fn(),
    setDebugPhysics: vi.fn(),
    setPhysics2d: vi.fn(),
    setJoint2d: vi.fn(),
    removePhysics2d: vi.fn(),
    // Audio events
    setEntityAudio: vi.fn(),
    setAudioBuses: vi.fn(),
    setReverbZone: vi.fn(),
    removeReverbZone: vi.fn(),
    setEntityScript: vi.fn(),
    setInputBindings: vi.fn(),
    addAssetToRegistry: vi.fn(),
    removeAssetFromRegistry: vi.fn(),
    setAssetRegistry: vi.fn(),
    // Animation events
    setPrimaryAnimation: vi.fn(),
    setAnimationClip: vi.fn(),
    // Game events
    setGameComponents: vi.fn(),
    setGameCamera: vi.fn(),
    setEntityGameCamera: vi.fn(),
    setActiveGameCameraId: vi.fn(),
    // Sprite events
    setSpriteData: vi.fn(),
    setTilemapData: vi.fn(),
    setSkeleton2d: vi.fn(),
    // Particle events
    setPrimaryParticle: vi.fn(),
    setParticleEnabled: vi.fn(),
    setEntityParticle: vi.fn(),
    // Animation events
    setEntityAnimation: vi.fn(),
    // Sprite events
    setSpriteSheet: vi.fn(),
    setSpriteAnimator: vi.fn(),
    setAnimationStateMachine: vi.fn(),
    setProjectType: vi.fn(),
    setCamera2dData: vi.fn(),
    removeTilemapData: vi.fn(),
    setTileset: vi.fn(),
    // SceneLight events
    recomputeLightState: vi.fn(),
    onLightNodeAdded: vi.fn(),
    onLightNodeRemoved: vi.fn(),
    setSceneLightAmbient: vi.fn(),
    // SceneGraph mutations
    addNode: vi.fn(),
    removeNode: vi.fn(),
    updateNode: vi.fn(),
    // State properties used by animation tests
    primaryId: null as string | null,
    skeletons2d: {} as Record<string, unknown>,
  };
}
