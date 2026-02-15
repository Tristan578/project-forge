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

    // Audio
    primaryAudio: null,
    audioBuses: [],

    // Animation
    primaryAnimation: null,
    primaryAnimationClip: null,

    // Scripts
    allScripts: {},

    // Game
    allGameComponents: {},
    allGameCameras: {},
    activeGameCameraId: null,

    // Sprites
    sprites: {},
    physics2d: {},
    tilemaps: {},
    skeletons2d: {},

    // Scene
    sceneName: 'Untitled',
    sceneModified: false,

    // Input
    inputBindings: [],
    inputPreset: 'wasd',

    // Quality
    qualityPreset: 'medium',

    // Terrain
    terrainData: {},

    // Particle
    primaryParticle: null,
    particleEnabled: false,

    // Asset
    assetRegistry: {},

    // Export
    isExporting: false,
    engineMode: 'edit',

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
  const result = await handlers[name](args, { store });
  return { result, store };
}
