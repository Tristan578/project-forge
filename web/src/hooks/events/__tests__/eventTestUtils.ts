/**
 * Shared test utilities for domain event handler tests.
 */
import { vi } from 'vitest';

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
    setSceneGraph: vi.fn(),
    updateSceneGraph: vi.fn(),
    setSelection: vi.fn(),
    setPrimaryTransform: vi.fn(),
    setEngineMode: vi.fn(),
    setHistory: vi.fn(),
    setHistoryState: vi.fn(),
    setSnapSettings: vi.fn(),
    setCurrentCameraPreset: vi.fn(),
    saveScene: vi.fn(),
    clearSelection: vi.fn(),
    autoSaveEnabled: true,
    engineMode: 'edit' as const,
    // Physics events
    setPrimaryPhysics: vi.fn(),
    setPhysicsEnabled: vi.fn(),
    setPrimaryJoint: vi.fn(),
    setJoint: vi.fn(),
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
    setEntityAnimation: vi.fn(),
    setAnimationClip: vi.fn(),
    primaryId: null as string | null,
    primaryAnimationClip: null,
    skeletons2d: {} as Record<string, unknown>,
    // Game events
    setGameComponents: vi.fn(),
    setGameCamera: vi.fn(),
    setEntityGameCamera: vi.fn(),
    setActiveGameCameraId: vi.fn(),
    allGameComponents: {} as Record<string, unknown>,
    primaryGameComponents: [],
    // Sprite events
    setSpriteData: vi.fn(),
    setSpriteSheet: vi.fn(),
    setSpriteAnimator: vi.fn(),
    setAnimationStateMachine: vi.fn(),
    setProjectType: vi.fn(),
    setCamera2dData: vi.fn(),
    setTilemapData: vi.fn(),
    removeTilemapData: vi.fn(),
    setTileset: vi.fn(),
    setSkeleton2d: vi.fn(),
    // Particle events
    setPrimaryParticle: vi.fn(),
    setParticleEnabled: vi.fn(),
  };
}
