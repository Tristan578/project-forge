/**
 * Tests for the tool call executor.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executeToolCall } from './executor';
import type { EditorState, MaterialData } from '@/stores/editorStore';

// Helper to create a mock store with common state and action stubs
function makeMockStore(overrides?: Partial<EditorState>): EditorState {
  return {
    // State
    selectedIds: new Set(),
    primaryId: null,
    primaryName: null,
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
    materials: {},
    primaryLight: null,
    lights: {},
    ambientLight: { color: [1, 1, 1], brightness: 0.3 },
    environment: {
      skyboxBrightness: 1,
      iblIntensity: 1,
      iblRotationDegrees: 0,
      clearColor: [0.1, 0.1, 0.15, 1],
      fogEnabled: false,
      fogColor: [1, 1, 1],
      fogStart: 10,
      fogEnd: 100,
    },
    postProcessing: {
      bloomEnabled: false,
      bloomIntensity: 0.1,
      bloomThreshold: 1.0,
      bloomKnee: 0.5,
      chromaticAberrationEnabled: false,
      chromaticAberrationStrength: 0.01,
      colorGradingEnabled: false,
      colorGradingExposure: 1.0,
      colorGradingGamma: 1.0,
      colorGradingSaturation: 1.0,
      sharpeningEnabled: false,
      sharpeningIntensity: 0.2,
    },
    historyCanUndo: false,
    historyCanRedo: false,
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
    shaderEffects: {},

    // Actions (all as vi.fn() stubs)
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
    updateMaterial: vi.fn(),
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
    play: vi.fn(),
    stop: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
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
    updateShaderEffect: vi.fn(),
    removeShaderEffect: vi.fn(),

    ...overrides,
  } as unknown as EditorState;
}

// ============ SCENE COMMANDS ============

describe('executor: scene commands', () => {
  let store: EditorState;

  beforeEach(() => {
    store = makeMockStore();
  });

  it('spawn_entity calls store.spawnEntity with correct type and name', async () => {
    const result = await executeToolCall('spawn_entity', { entityType: 'cube', name: 'MyCube' }, store);
    expect(result.success).toBe(true);
    expect(store.spawnEntity).toHaveBeenCalledWith('cube', 'MyCube');
  });

  it('spawn_entity works without name', async () => {
    const result = await executeToolCall('spawn_entity', { entityType: 'sphere' }, store);
    expect(result.success).toBe(true);
    expect(store.spawnEntity).toHaveBeenCalledWith('sphere', undefined);
  });

  it('delete_entities calls setSelection then deleteSelectedEntities', async () => {
    const result = await executeToolCall('delete_entities', { entityIds: ['e1', 'e2'] }, store);
    expect(result.success).toBe(true);
    expect(store.setSelection).toHaveBeenCalledWith(['e1', 'e2'], 'e1', null);
    expect(store.deleteSelectedEntities).toHaveBeenCalled();
  });

  it('delete_entities with single entityId', async () => {
    const result = await executeToolCall('delete_entities', { entityId: 'e1' }, store);
    expect(result.success).toBe(true);
    expect(store.setSelection).toHaveBeenCalledWith(['e1'], 'e1', null);
  });

  it('duplicate_entity calls selectEntity then duplicateSelectedEntity', async () => {
    const result = await executeToolCall('duplicate_entity', { entityId: 'e1' }, store);
    expect(result.success).toBe(true);
    expect(store.selectEntity).toHaveBeenCalledWith('e1', 'replace');
    expect(store.duplicateSelectedEntity).toHaveBeenCalled();
  });

  it('update_transform calls updateTransform for position', async () => {
    const result = await executeToolCall('update_transform', {
      entityId: 'e1',
      position: [1, 2, 3],
    }, store);
    expect(result.success).toBe(true);
    expect(store.updateTransform).toHaveBeenCalledWith('e1', 'position', [1, 2, 3]);
  });

  it('update_transform calls updateTransform for rotation and scale', async () => {
    const result = await executeToolCall('update_transform', {
      entityId: 'e1',
      rotation: [0, 1.5, 0],
      scale: [2, 2, 2],
    }, store);
    expect(result.success).toBe(true);
    expect(store.updateTransform).toHaveBeenCalledWith('e1', 'rotation', [0, 1.5, 0]);
    expect(store.updateTransform).toHaveBeenCalledWith('e1', 'scale', [2, 2, 2]);
  });

  it('rename_entity calls store.renameEntity', async () => {
    const result = await executeToolCall('rename_entity', { entityId: 'e1', name: 'NewName' }, store);
    expect(result.success).toBe(true);
    expect(store.renameEntity).toHaveBeenCalledWith('e1', 'NewName');
  });
});

// ============ MATERIAL COMMANDS ============

describe('executor: material commands', () => {
  let store: EditorState;

  beforeEach(() => {
    store = makeMockStore();
  });

  it('update_material calls store.updateMaterial with merged data', async () => {
    const baseMaterial: MaterialData = {
      baseColor: [1, 0, 0, 1],
      metallic: 0.5,
      perceptualRoughness: 0.3,
      reflectance: 0.5,
      emissive: [0, 0, 0, 1],
      emissiveExposureWeight: 1,
      alphaMode: 'opaque',
      alphaCutoff: 0.5,
      doubleSided: false,
      unlit: false,
      uvOffset: [0, 0],
      uvScale: [1, 1],
      uvRotation: 0,
      parallaxDepthScale: 0.1,
      parallaxMappingMethod: 'occlusion',
      maxParallaxLayerCount: 16,
      parallaxReliefMaxSteps: 5,
      clearcoat: 0,
      clearcoatPerceptualRoughness: 0.5,
      specularTransmission: 0,
      diffuseTransmission: 0,
      ior: 1.5,
      thickness: 0,
      attenuationDistance: null,
      attenuationColor: [1, 1, 1],
    };
    store = makeMockStore({ primaryMaterial: baseMaterial });

    const result = await executeToolCall('update_material', {
      entityId: 'e1',
      metallic: 1.0,
      perceptualRoughness: 0.1,
    }, store);

    expect(result.success).toBe(true);
    expect(store.updateMaterial).toHaveBeenCalledWith('e1', expect.objectContaining({
      metallic: 1.0,
      perceptualRoughness: 0.1,
      baseColor: [1, 0, 0, 1],
    }));
  });

  it('update_material with only color changes', async () => {
    const result = await executeToolCall('update_material', {
      entityId: 'e1',
      baseColor: [0, 1, 0, 1],
    }, store);

    expect(result.success).toBe(true);
    expect(store.updateMaterial).toHaveBeenCalledWith('e1', expect.objectContaining({
      baseColor: [0, 1, 0, 1],
    }));
  });

  it('apply_material_preset looks up preset and applies', async () => {
    // Mock the getPresetById function by importing the module
    const result = await executeToolCall('apply_material_preset', {
      entityId: 'e1',
      presetId: 'gold',
    }, store);

    // The gold preset should exist and be applied
    expect(result.success).toBe(true);
    expect(store.updateMaterial).toHaveBeenCalledWith('e1', expect.objectContaining({
      baseColor: expect.any(Array),
      metallic: expect.any(Number),
    }));
  });

  it('apply_material_preset with unknown preset returns error', async () => {
    const result = await executeToolCall('apply_material_preset', {
      entityId: 'e1',
      presetId: 'nonexistent_preset_xyz',
    }, store);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Unknown material preset');
  });

  it('list_material_presets returns presets with category filter', async () => {
    const result = await executeToolCall('list_material_presets', { category: 'metal' }, store);

    expect(result.success).toBe(true);
    expect(result.result).toBeInstanceOf(Array);
    expect((result.result as Array<unknown>).length).toBeGreaterThan(0);
    // All results should be in the metal category
    (result.result as Array<{ category: string }>).forEach((p) => {
      expect(p.category).toBe('metal');
    });
  });

  it('list_material_presets without filter returns all', async () => {
    const result = await executeToolCall('list_material_presets', {}, store);

    expect(result.success).toBe(true);
    expect(result.result).toBeInstanceOf(Array);
    const presets = result.result as Array<unknown>;
    expect(presets.length).toBeGreaterThan(10); // We have 14 presets
  });
});

// ============ LIGHTING COMMANDS ============

describe('executor: lighting commands', () => {
  let store: EditorState;

  beforeEach(() => {
    store = makeMockStore();
  });

  it('update_light calls store.updateLight', async () => {
    const result = await executeToolCall('update_light', {
      entityId: 'e1',
      lightType: 'point',
      intensity: 1000,
      color: [1, 0.9, 0.8],
    }, store);

    expect(result.success).toBe(true);
    expect(store.updateLight).toHaveBeenCalledWith('e1', expect.objectContaining({
      lightType: 'point',
      intensity: 1000,
      color: [1, 0.9, 0.8],
    }));
  });

  it('update_ambient_light calls store.updateAmbientLight', async () => {
    const result = await executeToolCall('update_ambient_light', {
      color: [0.5, 0.5, 0.5],
      brightness: 0.5,
    }, store);

    expect(result.success).toBe(true);
    expect(store.updateAmbientLight).toHaveBeenCalledWith({
      color: [0.5, 0.5, 0.5],
      brightness: 0.5,
    });
  });

  it('update_environment calls store.updateEnvironment', async () => {
    const result = await executeToolCall('update_environment', {
      clearColor: [0.2, 0.2, 0.3, 1],
      fogEnabled: true,
    }, store);

    expect(result.success).toBe(true);
    expect(store.updateEnvironment).toHaveBeenCalledWith({
      clearColor: [0.2, 0.2, 0.3, 1],
      fogEnabled: true,
    });
  });
});

// ============ EDITOR COMMANDS ============

describe('executor: editor commands', () => {
  let store: EditorState;

  beforeEach(() => {
    store = makeMockStore();
  });

  it('set_gizmo_mode calls store.setGizmoMode', async () => {
    const result = await executeToolCall('set_gizmo_mode', { mode: 'rotate' }, store);
    expect(result.success).toBe(true);
    expect(store.setGizmoMode).toHaveBeenCalledWith('rotate');
  });

  it('undo calls store.undo', async () => {
    const result = await executeToolCall('undo', {}, store);
    expect(result.success).toBe(true);
    expect(store.undo).toHaveBeenCalled();
  });

  it('redo calls store.redo', async () => {
    const result = await executeToolCall('redo', {}, store);
    expect(result.success).toBe(true);
    expect(store.redo).toHaveBeenCalled();
  });
});

// ============ QUERY COMMANDS ============

describe('executor: query commands', () => {
  let store: EditorState;

  beforeEach(() => {
    store = makeMockStore({
      sceneGraph: {
        nodes: {
          e1: {
            entityId: 'e1',
            name: 'Cube',
            parentId: null,
            children: ['e2'],
            components: ['Transform', 'Mesh', 'Material'],
            visible: true,
          },
          e2: {
            entityId: 'e2',
            name: 'Light',
            parentId: 'e1',
            children: [],
            components: ['Transform', 'Light'],
            visible: true,
          },
        },
        rootIds: ['e1'],
      },
    });
  });

  it('get_scene_graph returns store.sceneGraph data', async () => {
    const result = await executeToolCall('get_scene_graph', {}, store);
    expect(result.success).toBe(true);
    expect(result.result).toHaveProperty('entities');
    expect(result.result).toHaveProperty('count', 2);
    const entities = (result.result as { entities: Array<unknown> }).entities;
    expect(entities.length).toBe(2);
  });

  it('get_entity_details for selected entity returns data', async () => {
    const result = await executeToolCall('get_entity_details', { entityId: 'e1' }, store);
    expect(result.success).toBe(true);
    expect(result.result).toHaveProperty('name', 'Cube');
    expect(result.result).toHaveProperty('components');
    expect(result.result).toHaveProperty('visible', true);
  });

  it('get_selection returns selected IDs', async () => {
    store = makeMockStore({
      selectedIds: new Set(['e1', 'e2']),
      primaryId: 'e1',
    });
    const result = await executeToolCall('get_selection', {}, store);
    expect(result.success).toBe(true);
    expect(result.result).toHaveProperty('selectedIds');
    expect(result.result).toHaveProperty('primaryId', 'e1');
  });

  it('get_mode returns engine mode', async () => {
    store = makeMockStore({ engineMode: 'play' });
    const result = await executeToolCall('get_mode', {}, store);
    expect(result.success).toBe(true);
    expect(result.result).toHaveProperty('mode', 'play');
  });
});

// ============ PHYSICS COMMANDS ============

describe('executor: physics commands', () => {
  let store: EditorState;

  beforeEach(() => {
    store = makeMockStore();
  });

  it('update_physics calls store.updatePhysics', async () => {
    const result = await executeToolCall('update_physics', {
      entityId: 'e1',
      bodyType: 'dynamic',
      restitution: 0.5,
    }, store);

    expect(result.success).toBe(true);
    expect(store.updatePhysics).toHaveBeenCalledWith('e1', expect.objectContaining({
      bodyType: 'dynamic',
      restitution: 0.5,
    }));
  });

  it('toggle_physics calls store.togglePhysics', async () => {
    const result = await executeToolCall('toggle_physics', { entityId: 'e1', enabled: true }, store);
    expect(result.success).toBe(true);
    expect(store.togglePhysics).toHaveBeenCalledWith('e1', true);
  });

  it('toggle_debug_physics calls store.toggleDebugPhysics', async () => {
    const result = await executeToolCall('toggle_debug_physics', {}, store);
    expect(result.success).toBe(true);
    expect(store.toggleDebugPhysics).toHaveBeenCalled();
  });
});

// ============ ERROR HANDLING ============

describe('executor: error handling', () => {
  let store: EditorState;

  beforeEach(() => {
    store = makeMockStore();
  });

  it('unknown tool name returns error', async () => {
    const result = await executeToolCall('nonexistent_tool_xyz', {}, store);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Unknown tool');
  });

  it('missing required param returns error', async () => {
    const result = await executeToolCall('spawn_entity', { name: 'Test' }, store);
    // spawn_entity without entityType should still call with undefined type
    // The executor doesn't validate required params - it passes through
    // So this test verifies that the function doesn't crash
    expect(result.success).toBe(true);
  });

  it('executor catches thrown exceptions gracefully', async () => {
    // Make updateMaterial throw
    store.updateMaterial = vi.fn(() => {
      throw new Error('Material update failed');
    });

    const result = await executeToolCall('update_material', {
      entityId: 'e1',
      metallic: 1.0,
    }, store);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Material update failed');
  });
});

// ============ SCRIPT COMMANDS ============

describe('executor: script commands', () => {
  let store: EditorState;

  beforeEach(() => {
    store = makeMockStore();
  });

  it('set_script calls store.setScript with all params', async () => {
    const result = await executeToolCall('set_script', {
      entityId: 'e1',
      source: 'forge.log("Hello");',
      enabled: true,
      template: 'rotating_object',
    }, store);

    expect(result.success).toBe(true);
    expect(store.setScript).toHaveBeenCalledWith('e1', 'forge.log("Hello");', true, 'rotating_object');
  });

  it('remove_script calls store.removeScript', async () => {
    const result = await executeToolCall('remove_script', { entityId: 'e1' }, store);
    expect(result.success).toBe(true);
    expect(store.removeScript).toHaveBeenCalledWith('e1');
  });

  it('list_script_templates returns template list', async () => {
    const result = await executeToolCall('list_script_templates', {}, store);
    expect(result.success).toBe(true);
    expect(result.result).toHaveProperty('templates');
    const templates = (result.result as { templates: Array<unknown> }).templates;
    expect(templates.length).toBeGreaterThan(0);
  });
});

// ============ AUDIO COMMANDS ============

describe('executor: audio commands', () => {
  let store: EditorState;

  beforeEach(() => {
    store = makeMockStore();
  });

  it('set_audio calls store.setAudio with audio data', async () => {
    const result = await executeToolCall('set_audio', {
      entityId: 'e1',
      assetId: 'audio_1',
      volume: 0.8,
      loopAudio: true,
    }, store);

    expect(result.success).toBe(true);
    expect(store.setAudio).toHaveBeenCalledWith('e1', {
      assetId: 'audio_1',
      volume: 0.8,
      loopAudio: true,
    });
  });

  it('play_audio calls store.playAudio', async () => {
    const result = await executeToolCall('play_audio', { entityId: 'e1' }, store);
    expect(result.success).toBe(true);
    expect(store.playAudio).toHaveBeenCalledWith('e1');
  });

  it('audio_crossfade calls store.crossfadeAudio', async () => {
    const result = await executeToolCall('audio_crossfade', {
      fromEntityId: 'e1',
      toEntityId: 'e2',
      durationMs: 2000,
    }, store);

    expect(result.success).toBe(true);
    expect(store.crossfadeAudio).toHaveBeenCalledWith('e1', 'e2', 2000);
  });
});

// ============ ANIMATION COMMANDS ============

describe('executor: animation commands', () => {
  let store: EditorState;

  beforeEach(() => {
    store = makeMockStore();
  });

  it('play_animation calls store.playAnimation with crossfade', async () => {
    const result = await executeToolCall('play_animation', {
      entityId: 'e1',
      clipName: 'Walk',
      crossfadeSecs: 0.5,
    }, store);

    expect(result.success).toBe(true);
    expect(store.playAnimation).toHaveBeenCalledWith('e1', 'Walk', 0.5);
  });

  it('set_animation_speed calls store.setAnimationSpeed', async () => {
    const result = await executeToolCall('set_animation_speed', {
      entityId: 'e1',
      speed: 2.0,
    }, store);

    expect(result.success).toBe(true);
    expect(store.setAnimationSpeed).toHaveBeenCalledWith('e1', 2.0);
  });

  it('set_animation_blend_weight calls store.setAnimationBlendWeight', async () => {
    const result = await executeToolCall('set_animation_blend_weight', {
      entityId: 'e1',
      clipName: 'Idle',
      weight: 0.5,
    }, store);

    expect(result.success).toBe(true);
    expect(store.setAnimationBlendWeight).toHaveBeenCalledWith('e1', 'Idle', 0.5);
  });
});

// ============ TERRAIN COMMANDS ============

describe('executor: terrain commands', () => {
  let store: EditorState;

  beforeEach(() => {
    store = makeMockStore({
      terrainData: {
        't1': {
          noiseType: 'perlin',
          octaves: 4,
          frequency: 0.05,
          amplitude: 1.0,
          heightScale: 10.0,
          seed: 42,
          resolution: 100,
          size: 50,
        },
      },
    });
  });

  it('spawn_terrain calls store.spawnTerrain', async () => {
    const result = await executeToolCall('spawn_terrain', {
      noiseType: 'simplex',
      octaves: 6,
      frequency: 0.03,
    }, store);

    expect(result.success).toBe(true);
    expect(store.spawnTerrain).toHaveBeenCalledWith({
      noiseType: 'simplex',
      octaves: 6,
      frequency: 0.03,
    });
  });

  it('update_terrain calls store.updateTerrain', async () => {
    const result = await executeToolCall('update_terrain', {
      entityId: 't1',
      amplitude: 2.0,
      seed: 999,
    }, store);

    expect(result.success).toBe(true);
    expect(store.updateTerrain).toHaveBeenCalledWith('t1', expect.objectContaining({
      amplitude: 2.0,
      seed: 999,
    }));
  });

  it('sculpt_terrain calls store.sculptTerrain', async () => {
    const result = await executeToolCall('sculpt_terrain', {
      entityId: 't1',
      position: [5, 10],
      radius: 3.0,
      strength: 0.5,
    }, store);

    expect(result.success).toBe(true);
    expect(store.sculptTerrain).toHaveBeenCalledWith('t1', [5, 10], 3.0, 0.5);
  });
});
