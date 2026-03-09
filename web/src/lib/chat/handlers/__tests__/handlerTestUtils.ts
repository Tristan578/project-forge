/**
 * Shared test utilities for chat handler tests.
 */
import { vi } from 'vitest';
import type { ToolCallContext, ExecutionResult } from '../types';

/**
 * Creates a mock store with vi.fn() for all commonly used actions.
 * Override specific fields as needed per test.
 */
export function createMockStore(overrides: Record<string, unknown> = {}): ToolCallContext['store'] {
  return {
    // Selection
    selectedIds: new Set<string>(),
    primaryId: null,
    selectEntity: vi.fn(),
    setSelection: vi.fn(),
    clearSelection: vi.fn(),

    // Scene graph
    sceneGraph: { nodes: {}, rootIds: [] },

    // Transform
    updateTransform: vi.fn(),

    // Entity lifecycle
    spawnEntity: vi.fn(),
    deleteSelectedEntities: vi.fn(),
    duplicateSelectedEntity: vi.fn(),
    renameEntity: vi.fn(),
    reparentEntity: vi.fn(),
    toggleVisibility: vi.fn(),

    // Gizmo
    setGizmoMode: vi.fn(),
    coordinateMode: 'world',
    toggleCoordinateMode: vi.fn(),
    toggleGrid: vi.fn(),
    setSnapSettings: vi.fn(),

    // Camera
    currentCameraPreset: 'perspective',
    setCameraPreset: vi.fn(),

    // History
    undo: vi.fn(),
    redo: vi.fn(),

    // Material
    primaryMaterial: null,
    updateMaterial: vi.fn(),
    updateShaderEffect: vi.fn(),
    removeShaderEffect: vi.fn(),

    // Light
    primaryLight: null,
    updateLight: vi.fn(),
    updateAmbientLight: vi.fn(),

    // Environment
    updateEnvironment: vi.fn(),
    setSkybox: vi.fn(),
    removeSkybox: vi.fn(),
    updateSkybox: vi.fn(),
    updatePostProcessing: vi.fn(),
    postProcessing: null,

    // Physics
    primaryPhysics: null,
    physicsEnabled: false,
    updatePhysics: vi.fn(),
    togglePhysics: vi.fn(),
    toggleDebugPhysics: vi.fn(),
    primaryJoint: null,
    createJoint: vi.fn(),
    updateJoint: vi.fn(),
    removeJoint: vi.fn(),

    // Audio
    primaryAudio: null,
    audioBuses: [],
    audioSnapshots: {},
    setAdaptiveMusicIntensity: vi.fn(),
    setCurrentMusicSegment: vi.fn(),
    updateAudioBus: vi.fn(),
    setBusEffects: vi.fn(),
    saveAudioSnapshot: vi.fn(),
    loadAudioSnapshot: vi.fn(),
    deleteAudioSnapshot: vi.fn(),

    // Animation
    primaryAnimation: null,
    primaryAnimationClip: null,

    // Scripts
    allScripts: {},
    primaryScript: null,

    // Game
    allGameComponents: {},
    allGameCameras: {},
    activeGameCameraId: null,
    addGameComponent: vi.fn(),
    updateGameComponent: vi.fn(),
    removeGameComponent: vi.fn(),
    setGameCamera: vi.fn(),
    setActiveGameCamera: vi.fn(),
    cameraShake: vi.fn(),

    // Sprites
    sprites: {},
    physics2d: {},
    tilemaps: {},
    skeletons2d: {},

    // Scene
    sceneName: 'Untitled',
    sceneModified: false,
    scenes: [],
    activeSceneId: null,
    saveScene: vi.fn(),
    loadScene: vi.fn(),
    newScene: vi.fn(),
    setScenes: vi.fn(),
    startSceneTransition: vi.fn().mockResolvedValue(undefined),
    setDefaultTransition: vi.fn(),
    loadTemplate: vi.fn().mockResolvedValue(undefined),

    // Input
    inputBindings: [],
    inputPreset: 'wasd',
    setInputBinding: vi.fn(),
    removeInputBinding: vi.fn(),
    setInputPreset: vi.fn(),

    // Quality
    qualityPreset: 'medium',
    setQualityPreset: vi.fn(),

    // Terrain
    terrainData: {},
    spawnTerrain: vi.fn(),
    updateTerrain: vi.fn(),
    sculptTerrain: vi.fn(),

    // CSG / Procedural
    csgUnion: vi.fn(),
    csgSubtract: vi.fn(),
    csgIntersect: vi.fn(),
    extrudeShape: vi.fn(),
    latheShape: vi.fn(),
    arrayEntity: vi.fn(),
    combineMeshes: vi.fn(),

    // Particle
    primaryParticle: null,
    particleEnabled: false,
    setParticle: vi.fn(),
    removeParticle: vi.fn(),
    toggleParticle: vi.fn(),
    setParticlePreset: vi.fn(),
    playParticle: vi.fn(),
    stopParticle: vi.fn(),
    burstParticle: vi.fn(),

    // Animation actions
    playAnimation: vi.fn(),
    pauseAnimation: vi.fn(),
    resumeAnimation: vi.fn(),
    stopAnimation: vi.fn(),
    seekAnimation: vi.fn(),
    setAnimationSpeed: vi.fn(),
    setAnimationLoop: vi.fn(),
    setAnimationBlendWeight: vi.fn(),
    setClipSpeed: vi.fn(),
    createAnimationClip: vi.fn(),
    addClipKeyframe: vi.fn(),
    removeClipKeyframe: vi.fn(),
    updateClipKeyframe: vi.fn(),
    setClipProperty: vi.fn(),
    previewClip: vi.fn(),
    removeAnimationClip: vi.fn(),

    // Edit mode
    enterEditMode: vi.fn(),
    exitEditMode: vi.fn(),
    setSelectionMode: vi.fn(),
    performMeshOperation: vi.fn(),
    recalcNormals: vi.fn(),

    // Transform (primary)
    primaryTransform: null,

    // Asset
    assetRegistry: {},

    // Export
    isExporting: false,
    engineMode: 'edit',
    setExporting: vi.fn(),

    // Runtime mode
    play: vi.fn(),
    stop: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),

    // Custom skybox
    setCustomSkybox: vi.fn(),

    ...overrides,
  } as unknown as ToolCallContext['store'];
}

/**
 * Convenience wrapper to invoke a handler with mock context.
 */
export async function invokeHandler(
  handlers: Record<string, (args: Record<string, unknown>, ctx: ToolCallContext) => Promise<ExecutionResult>>,
  name: string,
  args: Record<string, unknown> = {},
  storeOverrides: Record<string, unknown> = {}
): Promise<{ result: ExecutionResult; store: ToolCallContext['store'] }> {
  const store = createMockStore(storeOverrides);
  const result = await handlers[name](args, { store, dispatchCommand: vi.fn() });
  return { result, store };
}
