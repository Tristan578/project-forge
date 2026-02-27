/**
 * Tests for compound AI action tools.
 * These tools combine multiple primitive operations into single high-level actions.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executeToolCall } from './executor';
import type { EditorState } from '@/stores/editorStore';

function makeMockStore(overrides?: Partial<EditorState>): EditorState {
  return {
    selectedIds: new Set(),
    primaryId: null,
    primaryName: null,
    hierarchyFilter: '',
    sceneGraph: { nodes: {}, rootIds: [] },
    transforms: {},
    engineMode: 'edit',
    gizmoMode: 'translate',
    coordinateMode: 'world',
    currentCameraPreset: 'perspective',
    snapSettings: {
      snapEnabled: false,
      translationSnap: 0.5,
      rotationSnapDegrees: 15,
      scaleSnap: 0.1,
      gridVisible: true,
      gridSize: 1,
      gridExtent: 10,
    },
    primaryMaterial: null,
    primaryShaderEffect: null,
    primaryLight: null,
    lights: {},
    ambientLight: { color: [1, 1, 1], brightness: 0.3 },
    environment: {
      skyboxBrightness: 1,
      iblIntensity: 1,
      iblRotationDegrees: 0,
      clearColor: [0.1, 0.1, 0.15],
      fogEnabled: false,
      fogColor: [1, 1, 1],
      fogStart: 10,
      fogEnd: 100,
      skyboxPreset: null,
      skyboxAssetId: null,
    },
    postProcessing: {
      bloom: { enabled: false, intensity: 0.15, lowFrequencyBoost: 0.7, lowFrequencyBoostCurvature: 0.95, highPassFrequency: 1.0, prefilterThreshold: 0.0, prefilterThresholdSoftness: 0.0, compositeMode: 'energy_conserving', maxMipDimension: 512 },
      chromaticAberration: { enabled: false, intensity: 0.02, maxSamples: 8 },
      colorGrading: { enabled: false, global: { exposure: 0, temperature: 0, tint: 0, hue: 0, postSaturation: 1 }, shadows: { saturation: 1, contrast: 1, gamma: 1, gain: 1, lift: 0 }, midtones: { saturation: 1, contrast: 1, gamma: 1, gain: 1, lift: 0 }, highlights: { saturation: 1, contrast: 1, gamma: 1, gain: 1, lift: 0 } },
      sharpening: { enabled: false, sharpeningStrength: 0.6, denoise: false },
      ssao: null,
      depthOfField: null,
      motionBlur: null,
    },
    canUndo: false,
    canRedo: false,
    undoDescription: null,
    redoDescription: null,
    inputBindings: [],
    inputPreset: null,
    primaryPhysics: null,
    physicsData: {},
    physicsEnabled: {},
    debugPhysicsEnabled: false,
    assetRegistry: {},
    allScripts: {},
    primaryAudio: null,
    audioData: {},
    audioEnabled: {},
    audioBuses: [],
    primaryParticle: null,
    particleData: {},
    particleEnabled: {},
    primaryAnimation: null,
    animationData: {},
    isExporting: false,
    sceneName: 'Untitled',
    sceneModified: false,
    projectId: null,
    cloudSaveStatus: 'idle',
    lastCloudSave: null,
    qualityPreset: 'high',
    terrainData: {},
    allGameComponents: {},
    primaryGameComponents: null,
    allGameCameras: {},
    activeGameCameraId: null,
    primaryGameCamera: null,
    mobileTouchConfig: { enabled: false, autoDetect: true, preset: 'platformer', joystick: null, buttons: [], preferredOrientation: 'any', autoReduceQuality: false },
    hudElements: [],
    scenes: [],
    activeSceneId: null,
    sceneSwitching: false,
    sceneTransition: { active: false, config: null, targetScene: null },
    defaultTransition: { type: 'fade', duration: 500, color: '#000000', easing: 'ease-in-out' },
    autoSaveEnabled: false,
    projectType: '3d',
    sprites: {},
    camera2dData: null,
    sortingLayers: [],
    grid2d: { enabled: false, size: 1, color: '#888888', opacity: 0.5, snapToGrid: false },
    spriteSheets: {},
    spriteAnimators: {},
    animationStateMachines: {},
    tilesets: {},
    tilemaps: {},
    activeTilesetId: null,
    tilemapActiveTool: null,
    tilemapActiveLayerIndex: null,
    editModeActive: false,
    editModeEntityId: null,
    selectionMode: 'face',
    selectedIndices: [],
    wireframeVisible: true,
    xrayMode: false,
    vertexCount: 0,
    edgeCount: 0,
    faceCount: 0,

    spawnEntity: vi.fn(),
    setSelection: vi.fn(),
    deleteSelectedEntities: vi.fn(),
    selectEntity: vi.fn(),
    duplicateSelectedEntity: vi.fn(),
    updateTransform: vi.fn(),
    renameEntity: vi.fn(),
    reparentEntity: vi.fn(),
    toggleVisibility: vi.fn(),
    clearSelection: vi.fn(),
    selectRange: vi.fn(),
    setHierarchyFilter: vi.fn(),
    clearHierarchyFilter: vi.fn(),
    updateMaterial: vi.fn(),
    setPrimaryMaterial: vi.fn(),
    setPrimaryShaderEffect: vi.fn(),
    updateShaderEffect: vi.fn(),
    removeShaderEffect: vi.fn(),
    updateLight: vi.fn(),
    updateAmbientLight: vi.fn(),
    updateEnvironment: vi.fn(),
    updatePostProcessing: vi.fn(),
    setGizmoMode: vi.fn(),
    toggleCoordinateMode: vi.fn(),
    toggleGrid: vi.fn(),
    setSnapSettings: vi.fn(),
    setCameraPreset: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    setHistoryState: vi.fn(),
    play: vi.fn(),
    stop: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    setEngineMode: vi.fn(),
    updatePhysics: vi.fn(),
    togglePhysics: vi.fn(),
    toggleDebugPhysics: vi.fn(),
    importGltf: vi.fn(),
    loadTexture: vi.fn(),
    removeTexture: vi.fn(),
    placeAsset: vi.fn(),
    deleteAsset: vi.fn(),
    setScript: vi.fn(),
    removeScript: vi.fn(),
    applyScriptTemplate: vi.fn(),
    setAudio: vi.fn(),
    removeAudio: vi.fn(),
    playAudio: vi.fn(),
    stopAudio: vi.fn(),
    pauseAudio: vi.fn(),
    importAudio: vi.fn(),
    updateAudioBus: vi.fn(),
    createAudioBus: vi.fn(),
    deleteAudioBus: vi.fn(),
    setBusEffects: vi.fn(),
    crossfadeAudio: vi.fn(),
    fadeInAudio: vi.fn(),
    fadeOutAudio: vi.fn(),
    playOneShotAudio: vi.fn(),
    addAudioLayer: vi.fn(),
    removeAudioLayer: vi.fn(),
    setDuckingRule: vi.fn(),
    setParticle: vi.fn(),
    removeParticle: vi.fn(),
    toggleParticle: vi.fn(),
    setParticlePreset: vi.fn(),
    playParticle: vi.fn(),
    stopParticle: vi.fn(),
    burstParticle: vi.fn(),
    playAnimation: vi.fn(),
    pauseAnimation: vi.fn(),
    resumeAnimation: vi.fn(),
    stopAnimation: vi.fn(),
    seekAnimation: vi.fn(),
    setAnimationSpeed: vi.fn(),
    setAnimationLoop: vi.fn(),
    setAnimationBlendWeight: vi.fn(),
    setClipSpeed: vi.fn(),
    saveScene: vi.fn(),
    loadScene: vi.fn(),
    newScene: vi.fn(),
    setInputBinding: vi.fn(),
    removeInputBinding: vi.fn(),
    setInputPreset: vi.fn(),
    csgUnion: vi.fn(),
    csgSubtract: vi.fn(),
    csgIntersect: vi.fn(),
    spawnTerrain: vi.fn(),
    updateTerrain: vi.fn(),
    sculptTerrain: vi.fn(),
    extrudeShape: vi.fn(),
    latheShape: vi.fn(),
    arrayEntity: vi.fn(),
    combineMeshes: vi.fn(),
    setExporting: vi.fn(),
    setQualityPreset: vi.fn(),
    addGameComponent: vi.fn(),
    updateGameComponent: vi.fn(),
    removeGameComponent: vi.fn(),
    setGameCamera: vi.fn(),
    removeGameCamera: vi.fn(),
    setActiveGameCamera: vi.fn(),
    cameraShake: vi.fn(),
    setEntityGameCamera: vi.fn(),
    setActiveGameCameraId: vi.fn(),
    setMobileTouchConfig: vi.fn(),
    updateMobileTouchConfig: vi.fn(),
    setHudElements: vi.fn(),
    setSceneName: vi.fn(),
    setSceneModified: vi.fn(),
    setAutoSaveEnabled: vi.fn(),
    setScenes: vi.fn(),
    setSceneSwitching: vi.fn(),
    startSceneTransition: vi.fn(),
    setDefaultTransition: vi.fn(),
    setTerrainData: vi.fn(),
    setProjectId: vi.fn(),
    saveToCloud: vi.fn(),
    setCloudSaveStatus: vi.fn(),
    loadTemplate: vi.fn(),
    enterEditMode: vi.fn(),
    exitEditMode: vi.fn(),
    setSelectionMode: vi.fn(),
    selectElements: vi.fn(),
    performMeshOperation: vi.fn(),
    recalcNormals: vi.fn(),
    setEditModeState: vi.fn(),
    toggleWireframe: vi.fn(),
    toggleXray: vi.fn(),
    setProjectType: vi.fn(),
    setSpriteData: vi.fn(),
    removeSpriteData: vi.fn(),
    setCamera2dData: vi.fn(),
    setSortingLayers: vi.fn(),
    addSortingLayer: vi.fn(),
    removeSortingLayer: vi.fn(),
    toggleLayerVisibility: vi.fn(),
    setGrid2d: vi.fn(),
    setSpriteSheet: vi.fn(),
    removeSpriteSheet: vi.fn(),
    setSpriteAnimator: vi.fn(),
    removeSpriteAnimator: vi.fn(),
    setAnimationStateMachine: vi.fn(),
    removeAnimationStateMachine: vi.fn(),
    setTileset: vi.fn(),
    removeTileset: vi.fn(),
    setTilemapData: vi.fn(),
    removeTilemapData: vi.fn(),
    setActiveTileset: vi.fn(),
    setTilemapActiveTool: vi.fn(),
    setTilemapActiveLayerIndex: vi.fn(),

    ...overrides,
  } as unknown as EditorState;
}

describe('compound tools: describe_scene', () => {
  let store: EditorState;

  beforeEach(() => {
    store = makeMockStore({
      sceneGraph: {
        nodes: {
          e1: { entityId: 'e1', name: 'Cube', parentId: null, children: [], components: ['Transform', 'Mesh'], visible: true },
          e2: { entityId: 'e2', name: 'Light', parentId: null, children: [], components: ['Transform', 'PointLight'], visible: true },
        },
        rootIds: ['e1', 'e2'],
      },
      sceneName: 'TestScene',
    });
  });

  it('returns summary with entity count and scene name', async () => {
    const result = await executeToolCall('describe_scene', { detail: 'summary' }, store);
    expect(result.success).toBe(true);
    const data = result.result as { entityCount: number; sceneName: string };
    expect(data.entityCount).toBe(2);
    expect(data.sceneName).toBe('TestScene');
  });

  it('returns standard detail with entities array', async () => {
    const result = await executeToolCall('describe_scene', { detail: 'standard' }, store);
    expect(result.success).toBe(true);
    const data = result.result as { entities: Array<{ id: string; name: string }> };
    expect(data.entities).toHaveLength(2);
    expect(data.entities.some(e => e.name === 'Cube')).toBe(true);
  });

  it('returns full detail with environment data', async () => {
    const result = await executeToolCall('describe_scene', { detail: 'full' }, store);
    expect(result.success).toBe(true);
    const data = result.result as { environment: unknown; entities: Array<unknown> };
    expect(data.environment).toBeDefined();
    expect(data.entities).toHaveLength(2);
  });

  it('filters by entityIds when provided', async () => {
    const result = await executeToolCall('describe_scene', { detail: 'standard', filterEntityIds: ['e1'] }, store);
    expect(result.success).toBe(true);
    const data = result.result as { entities: Array<{ id: string }> };
    expect(data.entities).toHaveLength(1);
    expect(data.entities[0].id).toBe('e1');
  });
});

describe('compound tools: analyze_gameplay', () => {
  it('returns analysis object with entityCount', async () => {
    const store = makeMockStore({
      sceneGraph: {
        nodes: {
          e1: { entityId: 'e1', name: 'Player', parentId: null, children: [], components: ['CharacterController'], visible: true },
        },
        rootIds: ['e1'],
      },
      allGameComponents: {
        e1: [{ type: 'characterController', characterController: { speed: 5, jumpHeight: 2, gravityScale: 1, canDoubleJump: false } }],
      },
    });

    const result = await executeToolCall('analyze_gameplay', {}, store);
    expect(result.success).toBe(true);
    const data = result.result as { entityCount: number; mechanics: string[]; issues: string[]; suggestions: string[] };
    expect(data.entityCount).toBe(1);
    expect(data.mechanics).toBeInstanceOf(Array);
    expect(data.issues).toBeInstanceOf(Array);
    expect(data.suggestions).toBeInstanceOf(Array);
  });

  it('detects missing input bindings issue when player exists', async () => {
    const store = makeMockStore({
      sceneGraph: {
        nodes: {
          e1: { entityId: 'e1', name: 'Player', parentId: null, children: [], components: ['CharacterController'], visible: true },
        },
        rootIds: ['e1'],
      },
      allGameComponents: {
        e1: [{ type: 'characterController', characterController: { speed: 5, jumpHeight: 2, gravityScale: 1, canDoubleJump: false } }],
      },
      inputBindings: [],
    });

    const result = await executeToolCall('analyze_gameplay', {}, store);
    expect(result.success).toBe(true);
    const data = result.result as { issues: string[] };
    expect(data.issues.some(i => i.includes('input bindings'))).toBe(true);
  });

  it('returns empty scene analysis for empty scene', async () => {
    const store = makeMockStore();
    const result = await executeToolCall('analyze_gameplay', {}, store);
    expect(result.success).toBe(true);
    const data = result.result as { entityCount: number };
    expect(data.entityCount).toBe(0);
  });
});

describe('compound tools: arrange_entities', () => {
  it('arranges entities in a line pattern', async () => {
    const store = makeMockStore({
      sceneGraph: {
        nodes: {
          e1: { entityId: 'e1', name: 'A', parentId: null, children: [], components: [], visible: true },
          e2: { entityId: 'e2', name: 'B', parentId: null, children: [], components: [], visible: true },
          e3: { entityId: 'e3', name: 'C', parentId: null, children: [], components: [], visible: true },
        },
        rootIds: ['e1', 'e2', 'e3'],
      },
    });

    const result = await executeToolCall('arrange_entities', {
      entityIds: ['e1', 'e2', 'e3'],
      pattern: 'line',
      spacing: 2.0,
    }, store);

    expect(result.success).toBe(true);
    expect(store.updateTransform).toHaveBeenCalledTimes(3);
  });

  it('arranges entities in a circle pattern', async () => {
    const store = makeMockStore({
      sceneGraph: {
        nodes: {
          e1: { entityId: 'e1', name: 'A', parentId: null, children: [], components: [], visible: true },
          e2: { entityId: 'e2', name: 'B', parentId: null, children: [], components: [], visible: true },
        },
        rootIds: ['e1', 'e2'],
      },
    });

    const result = await executeToolCall('arrange_entities', {
      entityIds: ['e1', 'e2'],
      pattern: 'circle',
      radius: 5.0,
    }, store);

    expect(result.success).toBe(true);
    expect(store.updateTransform).toHaveBeenCalledTimes(2);
  });
});

describe('compound tools: create_scene_from_description', () => {
  it('creates entities from description array', async () => {
    let spawnCount = 0;
    const store = makeMockStore();
    (store.spawnEntity as ReturnType<typeof vi.fn>).mockImplementation(() => {
      spawnCount++;
      // Simulate engine assigning a primaryId after spawn
      (store as { primaryId: string | null }).primaryId = `spawned-${spawnCount}`;
    });

    const result = await executeToolCall('create_scene_from_description', {
      entities: [
        { name: 'Ground', type: 'plane', position: [0, 0, 0], scale: [10, 1, 10], material: { baseColor: '#228B22' } },
        { name: 'Tree', type: 'cylinder', position: [3, 1, 2], scale: [0.5, 2, 0.5], material: { baseColor: '#8B4513' } },
        { name: 'Sun', type: 'directional_light', position: [0, 10, 0], light: { color: '#FFFDD0', intensity: 2.0 } },
      ],
    }, store);

    expect(result.success).toBe(true);
    expect(store.spawnEntity).toHaveBeenCalledTimes(3);
    expect(store.updateTransform).toHaveBeenCalled();
    expect(store.updateMaterial).toHaveBeenCalled();
    expect(store.updateLight).toHaveBeenCalled();
  });

  it('clears scene when clearExisting is true', async () => {
    const store = makeMockStore();
    (store.spawnEntity as ReturnType<typeof vi.fn>).mockImplementation(() => {
      (store as { primaryId: string | null }).primaryId = 'new-entity';
    });

    await executeToolCall('create_scene_from_description', {
      clearExisting: true,
      entities: [{ name: 'Box', type: 'cube' }],
    }, store);

    expect(store.newScene).toHaveBeenCalled();
  });

  it('applies physics when entity specifies physics config', async () => {
    const store = makeMockStore();
    (store.spawnEntity as ReturnType<typeof vi.fn>).mockImplementation(() => {
      (store as { primaryId: string | null }).primaryId = 'phys-entity';
    });

    const result = await executeToolCall('create_scene_from_description', {
      entities: [
        { name: 'Crate', type: 'cube', physics: { bodyType: 'dynamic', mass: 5 } },
      ],
    }, store);

    expect(result.success).toBe(true);
    expect(store.togglePhysics).toHaveBeenCalled();
    expect(store.updatePhysics).toHaveBeenCalled();
  });

  it('sets environment when provided', async () => {
    const store = makeMockStore();
    (store.spawnEntity as ReturnType<typeof vi.fn>).mockImplementation(() => {
      (store as { primaryId: string | null }).primaryId = 'e1';
    });

    await executeToolCall('create_scene_from_description', {
      environment: { ambientBrightness: 0.5, skyboxPreset: 'sunset' },
      entities: [{ name: 'Box', type: 'cube' }],
    }, store);

    expect(store.updateAmbientLight).toHaveBeenCalled();
  });
});

describe('compound tools: create_level_layout', () => {
  it('creates ground, walls, obstacles, and spawn points', async () => {
    let spawnCount = 0;
    const store = makeMockStore();
    (store.spawnEntity as ReturnType<typeof vi.fn>).mockImplementation(() => {
      spawnCount++;
      (store as { primaryId: string | null }).primaryId = `level-${spawnCount}`;
    });

    const result = await executeToolCall('create_level_layout', {
      ground: { type: 'plane', size: [20, 20] },
      walls: [
        { start: [0, 0], end: [10, 0], height: 3, thickness: 0.5 },
      ],
      obstacles: [
        { name: 'Rock', type: 'sphere', position: [5, 1, 3] },
      ],
      spawnPoints: [{ position: [0, 1, 0] }],
      goals: [{ position: [10, 1, 10] }],
    }, store);

    expect(result.success).toBe(true);
    // Root + ground + 1 wall + 1 obstacle + 1 spawn + 1 goal = 6 spawns
    expect(store.spawnEntity).toHaveBeenCalledTimes(6);
    expect(store.reparentEntity).toHaveBeenCalled();
  });

  it('sets input preset when provided', async () => {
    let spawnCount = 0;
    const store = makeMockStore();
    (store.spawnEntity as ReturnType<typeof vi.fn>).mockImplementation(() => {
      spawnCount++;
      (store as { primaryId: string | null }).primaryId = `level-${spawnCount}`;
    });

    await executeToolCall('create_level_layout', {
      ground: { type: 'plane', size: [10, 10] },
      inputPreset: 'platformer',
    }, store);

    expect(store.setInputPreset).toHaveBeenCalledWith('platformer');
  });
});

describe('compound tools: setup_character', () => {
  it('creates a character entity with physics and game component', async () => {
    const store = makeMockStore();
    (store.spawnEntity as ReturnType<typeof vi.fn>).mockImplementation(() => {
      (store as { primaryId: string | null }).primaryId = 'player-1';
    });

    const result = await executeToolCall('setup_character', {
      entityType: 'capsule',
      position: [0, 1, 0],
      inputPreset: 'fps',
    }, store);

    expect(result.success).toBe(true);
    expect(store.spawnEntity).toHaveBeenCalledWith('capsule', 'Player');
    expect(store.updateTransform).toHaveBeenCalled();
    expect(store.togglePhysics).toHaveBeenCalled();
    expect(store.addGameComponent).toHaveBeenCalled();
    expect(store.setInputPreset).toHaveBeenCalledWith('fps');
  });

  it('adds health component by default', async () => {
    const store = makeMockStore();
    (store.spawnEntity as ReturnType<typeof vi.fn>).mockImplementation(() => {
      (store as { primaryId: string | null }).primaryId = 'player-1';
    });

    await executeToolCall('setup_character', {}, store);

    // addGameComponent should be called at least twice: characterController + health
    expect(store.addGameComponent).toHaveBeenCalledTimes(2);
  });

  it('injects camera follow script', async () => {
    const store = makeMockStore();
    (store.spawnEntity as ReturnType<typeof vi.fn>).mockImplementation(() => {
      (store as { primaryId: string | null }).primaryId = 'player-1';
    });

    await executeToolCall('setup_character', { cameraFollow: true }, store);

    expect(store.setScript).toHaveBeenCalled();
  });
});

describe('compound tools: apply_style', () => {
  it('applies palette colors to entities', async () => {
    const store = makeMockStore({
      sceneGraph: {
        nodes: {
          e1: { entityId: 'e1', name: 'A', parentId: null, children: [], components: ['Transform', 'Mesh3d'], visible: true },
          e2: { entityId: 'e2', name: 'B', parentId: null, children: [], components: ['Transform', 'Mesh3d'], visible: true },
          e3: { entityId: 'e3', name: 'C', parentId: null, children: [], components: ['Transform', 'Mesh3d'], visible: true },
        },
        rootIds: ['e1', 'e2', 'e3'],
      },
    });

    const result = await executeToolCall('apply_style', {
      palette: {
        primary: '#FF0000',
        secondary: '#00FF00',
        accent: '#0000FF',
      },
    }, store);

    expect(result.success).toBe(true);
    // Should apply material to all 3 mesh entities
    expect(store.updateMaterial).toHaveBeenCalledTimes(3);
  });

  it('applies lighting and post-processing settings', async () => {
    const store = makeMockStore({
      sceneGraph: { nodes: {}, rootIds: [] },
    });

    const result = await executeToolCall('apply_style', {
      lighting: { ambientBrightness: 0.5, skybox: 'sunset' },
      postProcessing: { bloom: { enabled: true, intensity: 0.3 } },
    }, store);

    expect(result.success).toBe(true);
    expect(store.updateAmbientLight).toHaveBeenCalled();
    expect(store.updatePostProcessing).toHaveBeenCalled();
  });

  it('targets specific entities when targetEntityIds provided', async () => {
    const store = makeMockStore({
      sceneGraph: {
        nodes: {
          e1: { entityId: 'e1', name: 'A', parentId: null, children: [], components: ['Mesh3d'], visible: true },
          e2: { entityId: 'e2', name: 'B', parentId: null, children: [], components: ['Mesh3d'], visible: true },
        },
        rootIds: ['e1', 'e2'],
      },
    });

    await executeToolCall('apply_style', {
      targetEntityIds: ['e1'],
      palette: { primary: '#FF0000' },
    }, store);

    // Should only apply to the targeted entity
    expect(store.updateMaterial).toHaveBeenCalledTimes(1);
  });
});

describe('compound tools: configure_game_mechanics', () => {
  it('sets input preset and quality preset', async () => {
    const store = makeMockStore({
      sceneGraph: { nodes: {}, rootIds: [] },
    });

    const result = await executeToolCall('configure_game_mechanics', {
      inputPreset: 'topdown',
      qualityPreset: 'high',
    }, store);

    expect(result.success).toBe(true);
    expect(store.setInputPreset).toHaveBeenCalledWith('topdown');
    expect(store.setQualityPreset).toHaveBeenCalledWith('high');
  });

  it('configures custom input bindings', async () => {
    const store = makeMockStore({
      sceneGraph: { nodes: {}, rootIds: [] },
    });

    await executeToolCall('configure_game_mechanics', {
      customBindings: [
        { action: 'jump', key: 'Space' },
        { action: 'crouch', key: 'ControlLeft' },
      ],
    }, store);

    expect(store.setInputBinding).toHaveBeenCalledTimes(2);
  });

  it('configures entity physics and game components by name lookup', async () => {
    const store = makeMockStore({
      sceneGraph: {
        nodes: {
          e1: { entityId: 'e1', name: 'Enemy', parentId: null, children: [], components: [], visible: true },
        },
        rootIds: ['e1'],
      },
    });

    const result = await executeToolCall('configure_game_mechanics', {
      entityConfigs: [
        {
          entityName: 'Enemy',
          physics: { bodyType: 'dynamic' },
          gameComponents: [{ type: 'health', health: { maxHealth: 50 } }],
        },
      ],
    }, store);

    expect(result.success).toBe(true);
    expect(store.togglePhysics).toHaveBeenCalled();
    expect(store.addGameComponent).toHaveBeenCalled();
  });
});
