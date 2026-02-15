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
    setSelection: vi.fn(),
    setPrimaryTransform: vi.fn(),
    setEngineMode: vi.fn(),
    setHistory: vi.fn(),
    clearSelection: vi.fn(),
    // Physics events
    setPrimaryPhysics: vi.fn(),
    setPhysicsEnabled: vi.fn(),
    setJoint: vi.fn(),
    // Audio events
    setEntityAudio: vi.fn(),
    setAudioBuses: vi.fn(),
    setReverbZone: vi.fn(),
    // Animation events
    setPrimaryAnimation: vi.fn(),
    setAnimationClip: vi.fn(),
    // Game events
    setGameComponents: vi.fn(),
    setGameCamera: vi.fn(),
    setActiveGameCameraId: vi.fn(),
    // Sprite events
    setSpriteData: vi.fn(),
    setTilemapData: vi.fn(),
    setSkeleton2d: vi.fn(),
    // Particle events
    setPrimaryParticle: vi.fn(),
    setParticleEnabled: vi.fn(),
  };
}
