import { describe, it, expect, vi } from 'vitest';
import { buildSceneContext } from '../context';
import { makeEntity, makeMaterialData, makeLightData, makePhysicsData } from '@/test/utils/fixtures';

// Mock scriptLibraryStore — it's imported by context.ts
vi.mock('@/stores/scriptLibraryStore', () => ({
  loadScripts: vi.fn(() => []),
}));

type ContextState = Parameters<typeof buildSceneContext>[0];

/** Minimal valid state for buildSceneContext */
function baseState(overrides: Partial<ContextState> = {}): ContextState {
  return {
    sceneGraph: { nodes: {}, rootIds: [] },
    selectedIds: new Set<string>(),
    primaryId: null,
    primaryTransform: null,
    primaryMaterial: null,
    primaryLight: null,
    ambientLight: { color: [1, 1, 1], brightness: 1 },
    environment: {} as ContextState['environment'],
    canUndo: false,
    canRedo: false,
    undoDescription: null,
    redoDescription: null,
    ...overrides,
  } as ContextState;
}

describe('buildSceneContext', () => {
  // ---------------------------------------------------------------------------
  // Project type & engine mode
  // ---------------------------------------------------------------------------
  describe('project type and engine mode', () => {
    it('defaults to 3D project type', () => {
      const ctx = buildSceneContext(baseState());
      expect(ctx).toContain('## Project Type: 3D');
    });

    it('shows 2D project type when set', () => {
      const ctx = buildSceneContext(baseState({ projectType: '2d' } as Partial<ContextState>));
      expect(ctx).toContain('## Project Type: 2D');
    });

    it('shows engine mode when not edit', () => {
      const ctx = buildSceneContext(baseState({ engineMode: 'play' }));
      expect(ctx).toContain('## Engine Mode: PLAY');
      expect(ctx).toContain('editing commands are disabled');
    });

    it('omits engine mode section when in edit mode', () => {
      const ctx = buildSceneContext(baseState({ engineMode: 'edit' }));
      expect(ctx).not.toContain('Engine Mode');
    });
  });

  // ---------------------------------------------------------------------------
  // Scene name
  // ---------------------------------------------------------------------------
  describe('scene name', () => {
    it('shows scene name when not Untitled', () => {
      const ctx = buildSceneContext(baseState({ sceneName: 'My Level' }));
      expect(ctx).toContain('"My Level"');
    });

    it('omits scene name when Untitled', () => {
      const ctx = buildSceneContext(baseState({ sceneName: 'Untitled' }));
      expect(ctx).not.toContain('"Untitled"');
    });
  });

  // ---------------------------------------------------------------------------
  // Scene sizes: empty / small / medium / large
  // ---------------------------------------------------------------------------
  describe('scene size rendering', () => {
    it('reports empty scene', () => {
      const ctx = buildSceneContext(baseState());
      expect(ctx).toContain('(Empty scene — no entities yet)');
      expect(ctx).toContain('Entities: 0');
    });

    it('lists entities in small scene (<=20)', () => {
      const nodes = {
        e1: { ...makeEntity({ entityId: 'e1', name: 'Box' }), components: ['Transform', 'Mesh3d'] },
        e2: { ...makeEntity({ entityId: 'e2', name: 'Sun' }), components: ['Transform', 'DirectionalLight'] },
      };
      const ctx = buildSceneContext(baseState({
        sceneGraph: { nodes, rootIds: ['e1', 'e2'] },
      }));
      expect(ctx).toContain('"Box" (mesh, id: e1)');
      expect(ctx).toContain('"Sun" (directional_light, id: e2)');
    });

    it('walks children in small scene', () => {
      const nodes = {
        parent: { ...makeEntity({ entityId: 'parent', name: 'Parent' }), children: ['child'], components: ['Transform'] },
        child: { ...makeEntity({ entityId: 'child', name: 'Child', parentId: 'parent' }), components: ['Transform', 'Mesh3d'] },
      };
      const ctx = buildSceneContext(baseState({
        sceneGraph: { nodes, rootIds: ['parent'] },
      }));
      expect(ctx).toContain('"Parent"');
      expect(ctx).toContain('"Child"');
    });

    it('shows children count in medium scene (21-100)', () => {
      const nodes: Record<string, ReturnType<typeof makeEntity>> = {};
      const rootIds: string[] = [];
      // 5 root nodes, each with 5 children = 30 total
      for (let r = 0; r < 5; r++) {
        const rootId = `root${r}`;
        const childIds = Array.from({ length: 5 }, (_, c) => `child${r}_${c}`);
        nodes[rootId] = { ...makeEntity({ entityId: rootId, name: `Group ${r}` }), children: childIds, components: ['Transform'] };
        rootIds.push(rootId);
        for (const cid of childIds) {
          nodes[cid] = { ...makeEntity({ entityId: cid, name: cid, parentId: rootId }), components: ['Transform', 'Mesh3d'] };
        }
      }
      const ctx = buildSceneContext(baseState({
        sceneGraph: { nodes, rootIds },
      }));
      expect(ctx).toContain('(5 children)');
      expect(ctx).toContain('Entities: 30');
    });

    it('summarizes large scene (>100) by type counts', () => {
      const nodes: Record<string, ReturnType<typeof makeEntity>> = {};
      for (let i = 0; i < 110; i++) {
        const comps = i < 100 ? ['Transform', 'Mesh3d'] : ['Transform', 'PointLight'];
        nodes[`e${i}`] = { ...makeEntity({ entityId: `e${i}`, name: `Entity${i}` }), components: comps };
      }
      const ctx = buildSceneContext(baseState({
        sceneGraph: { nodes, rootIds: Object.keys(nodes) },
      }));
      expect(ctx).toContain('Scene summary: 100 meshes, 10 lights, 0 other');
    });

    it('classifies entity types correctly in large scene summary', () => {
      const nodes: Record<string, ReturnType<typeof makeEntity>> = {};
      for (let i = 0; i < 105; i++) {
        let comps: string[];
        if (i < 50) comps = ['Transform', 'Mesh3d'];
        else if (i < 60) comps = ['Transform', 'PointLight'];
        else if (i < 70) comps = ['Transform', 'DirectionalLight'];
        else if (i < 80) comps = ['Transform', 'SpotLight'];
        else comps = ['Transform'];
        nodes[`e${i}`] = { ...makeEntity({ entityId: `e${i}`, name: `E${i}` }), components: comps };
      }
      const ctx = buildSceneContext(baseState({
        sceneGraph: { nodes, rootIds: Object.keys(nodes) },
      }));
      expect(ctx).toContain('50 meshes, 30 lights, 25 other');
    });
  });

  // ---------------------------------------------------------------------------
  // Selected entity detail
  // ---------------------------------------------------------------------------
  describe('selected entity detail', () => {
    function stateWithSelectedEntity(overrides: Partial<ContextState> = {}): ContextState {
      const node = { ...makeEntity({ entityId: 'sel', name: 'SelectedCube' }), components: ['Transform', 'Mesh3d'] };
      return baseState({
        sceneGraph: { nodes: { sel: node }, rootIds: ['sel'] },
        selectedIds: new Set(['sel']),
        primaryId: 'sel',
        primaryTransform: { position: [1, 2, 3], rotation: [0, Math.PI / 2, 0], scale: [2, 2, 2] } as ContextState['primaryTransform'],
        primaryMaterial: makeMaterialData({ baseColor: [1, 0, 0, 1], metallic: 0.8, perceptualRoughness: 0.2 }),
        ...overrides,
      });
    }

    it('shows transform data', () => {
      const ctx = buildSceneContext(stateWithSelectedEntity());
      expect(ctx).toContain('Position: [1, 2, 3]');
      expect(ctx).toContain('Scale: [2, 2, 2]');
      expect(ctx).toContain('Rotation:');
    });

    it('shows material data', () => {
      const ctx = buildSceneContext(stateWithSelectedEntity());
      expect(ctx).toContain('Material: color=[1, 0, 0]');
      expect(ctx).toContain('metallic=0.8');
      expect(ctx).toContain('roughness=0.2');
    });

    it('shows unlit material mode', () => {
      const ctx = buildSceneContext(stateWithSelectedEntity({
        primaryMaterial: makeMaterialData({ unlit: true }),
      }));
      expect(ctx).toContain('Material mode: unlit');
    });

    it('shows clearcoat when > 0', () => {
      const ctx = buildSceneContext(stateWithSelectedEntity({
        primaryMaterial: makeMaterialData({ clearcoat: 0.5 }),
      }));
      expect(ctx).toContain('Clearcoat: 0.5');
    });

    it('shows specular transmission', () => {
      const ctx = buildSceneContext(stateWithSelectedEntity({
        primaryMaterial: makeMaterialData({ specularTransmission: 0.9, ior: 1.3 }),
      }));
      expect(ctx).toContain('Transmission: specular=0.9, ior=1.3');
    });

    it('shows diffuse transmission', () => {
      const ctx = buildSceneContext(stateWithSelectedEntity({
        primaryMaterial: makeMaterialData({ diffuseTransmission: 0.4 }),
      }));
      expect(ctx).toContain('Diffuse transmission: 0.4');
    });

    it('shows light data', () => {
      const ctx = buildSceneContext(stateWithSelectedEntity({
        primaryLight: makeLightData('point', { intensity: 500, color: [1, 0.5, 0] }),
      }));
      expect(ctx).toContain('Light: point');
      expect(ctx).toContain('intensity=500');
    });

    it('shows shadows enabled', () => {
      const ctx = buildSceneContext(stateWithSelectedEntity({
        primaryLight: makeLightData('directional', { shadowsEnabled: true }),
      }));
      expect(ctx).toContain('Shadows: enabled');
    });

    it('shows physics data', () => {
      const ctx = buildSceneContext(stateWithSelectedEntity({
        primaryPhysics: makePhysicsData({ bodyType: 'dynamic', colliderShape: 'ball', restitution: 0.8 }),
        physicsEnabled: true,
      }));
      expect(ctx).toContain('Physics: dynamic, collider=ball, restitution=0.8');
    });

    it('shows physics sensor flag', () => {
      const ctx = buildSceneContext(stateWithSelectedEntity({
        primaryPhysics: makePhysicsData({ isSensor: true }),
        physicsEnabled: true,
      }));
      expect(ctx).toContain('Sensor: true');
    });

    it('shows custom gravity scale', () => {
      const ctx = buildSceneContext(stateWithSelectedEntity({
        primaryPhysics: makePhysicsData({ gravityScale: 0.5 }),
        physicsEnabled: true,
      }));
      expect(ctx).toContain('Gravity scale: 0.5');
    });

    it('shows physics enabled but default settings when no physics data', () => {
      const ctx = buildSceneContext(stateWithSelectedEntity({
        primaryPhysics: undefined,
        physicsEnabled: true,
      }));
      expect(ctx).toContain('Physics: enabled (default settings)');
    });

    it('shows hidden entity', () => {
      const node = { ...makeEntity({ entityId: 'sel', name: 'Hidden', visible: false }), components: ['Transform', 'Mesh3d'] };
      const ctx = buildSceneContext(baseState({
        sceneGraph: { nodes: { sel: node }, rootIds: ['sel'] },
        selectedIds: new Set(['sel']),
        primaryId: 'sel',
        primaryTransform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } as ContextState['primaryTransform'],
      }));
      expect(ctx).toContain('Visibility: hidden');
    });

    it('shows custom shader effect', () => {
      const ctx = buildSceneContext(stateWithSelectedEntity({
        primaryShaderEffect: { shaderType: 'dissolve', emissionStrength: 2.5 } as ContextState['primaryShaderEffect'],
      }));
      expect(ctx).toContain('Custom shader: dissolve, emission=2.5');
    });

    it('shows children names', () => {
      const nodes = {
        sel: { ...makeEntity({ entityId: 'sel', name: 'Parent' }), children: ['c1', 'c2'], components: ['Transform', 'Mesh3d'] },
        c1: { ...makeEntity({ entityId: 'c1', name: 'ChildA', parentId: 'sel' }), components: ['Transform'] },
        c2: { ...makeEntity({ entityId: 'c2', name: 'ChildB', parentId: 'sel' }), components: ['Transform'] },
      };
      const ctx = buildSceneContext(baseState({
        sceneGraph: { nodes, rootIds: ['sel'] },
        selectedIds: new Set(['sel']),
        primaryId: 'sel',
        primaryTransform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } as ContextState['primaryTransform'],
      }));
      expect(ctx).toContain('Children: ChildA, ChildB');
    });

    it('shows terrain data', () => {
      const ctx = buildSceneContext(stateWithSelectedEntity({
        terrainData: {
          sel: {
            noiseType: 'perlin',
            resolution: 128,
            size: 100,
            octaves: 4,
            frequency: 0.02,
            amplitude: 1.0,
            heightScale: 20,
            seed: 42,
          },
        } as unknown as ContextState['terrainData'],
      }));
      expect(ctx).toContain('Terrain: perlin noise, resolution=128x128, size=100');
      expect(ctx).toContain('seed=42');
    });

    it('shows game components', () => {
      const ctx = buildSceneContext(stateWithSelectedEntity({
        allGameComponents: {
          sel: [
            { type: 'characterController', config: {} },
            { type: 'health', config: {} },
          ],
        } as unknown as ContextState['allGameComponents'],
      }));
      expect(ctx).toContain('Game components: character_controller, health');
    });

    it('shows game camera', () => {
      const ctx = buildSceneContext(stateWithSelectedEntity({
        allGameCameras: {
          sel: { mode: 'ThirdPerson', targetEntity: 'player-1' },
        } as unknown as ContextState['allGameCameras'],
        activeGameCameraId: 'sel',
      }));
      expect(ctx).toContain('Game camera: ThirdPerson (target: player-1) [ACTIVE]');
    });

    it('shows joint data', () => {
      const ctx = buildSceneContext(stateWithSelectedEntity({
        primaryJoint: {
          jointType: 'revolute',
          connectedEntityId: 'other',
          anchorSelf: [0, 0, 0] as [number, number, number],
          anchorOther: [1, 0, 0] as [number, number, number],
          limits: { min: -90, max: 90 },
          motor: null,
        } as unknown as ContextState['primaryJoint'],
        sceneGraph: {
          nodes: {
            sel: { ...makeEntity({ entityId: 'sel', name: 'Arm' }), components: ['Transform', 'Mesh3d'] },
            other: { ...makeEntity({ entityId: 'other', name: 'Body' }), components: ['Transform', 'Mesh3d'] },
          },
          rootIds: ['sel', 'other'],
        },
      }));
      expect(ctx).toContain('Joint: revolute → "Body"');
      expect(ctx).toContain('limits=[-90, 90]');
    });
  });

  // ---------------------------------------------------------------------------
  // Multi-selection (no primary)
  // ---------------------------------------------------------------------------
  describe('multi-selection', () => {
    it('shows selection count when multiple selected but no primary', () => {
      const nodes = {
        e1: { ...makeEntity({ entityId: 'e1', name: 'A' }), components: ['Transform'] },
        e2: { ...makeEntity({ entityId: 'e2', name: 'B' }), components: ['Transform'] },
      };
      const ctx = buildSceneContext(baseState({
        sceneGraph: { nodes, rootIds: ['e1', 'e2'] },
        selectedIds: new Set(['e1', 'e2']),
        primaryId: null,
      }));
      expect(ctx).toContain('2 entities selected');
    });

    it('shows no selection when nothing selected', () => {
      const ctx = buildSceneContext(baseState());
      expect(ctx).toContain('No entity selected.');
    });
  });

  // ---------------------------------------------------------------------------
  // Environment
  // ---------------------------------------------------------------------------
  describe('environment', () => {
    it('shows ambient light', () => {
      const ctx = buildSceneContext(baseState({
        ambientLight: { color: [0.5, 0.5, 0.5], brightness: 0.8 },
      } as Partial<ContextState>));
      expect(ctx).toContain('Ambient light: color=[0.5, 0.5, 0.5], brightness=0.8');
    });

    it('shows skybox preset', () => {
      const ctx = buildSceneContext(baseState({
        environment: {
          skyboxPreset: 'sunset',
          skyboxBrightness: 1.5,
          iblIntensity: 0.8,
          iblRotationDegrees: 90,
        } as ContextState['environment'],
      }));
      expect(ctx).toContain('Skybox: preset=sunset');
      expect(ctx).toContain('brightness=1.5');
    });

    it('shows fog', () => {
      const ctx = buildSceneContext(baseState({
        environment: {
          fogEnabled: true,
          fogColor: [0.8, 0.8, 0.9],
          fogStart: 10,
          fogEnd: 100,
        } as ContextState['environment'],
      }));
      expect(ctx).toContain('Fog: enabled');
      expect(ctx).toContain('range=10-100');
    });
  });

  // ---------------------------------------------------------------------------
  // Post-processing
  // ---------------------------------------------------------------------------
  describe('post-processing', () => {
    it('shows enabled effects', () => {
      const ctx = buildSceneContext(baseState({
        postProcessing: {
          bloom: { enabled: true, intensity: 0.5 },
          chromaticAberration: { enabled: false, intensity: 0 },
          colorGrading: { enabled: true, global: { exposure: 1.2 } },
          sharpening: { enabled: false, sharpeningStrength: 0 },
        } as unknown as ContextState['postProcessing'],
      }));
      expect(ctx).toContain('bloom (intensity=0.50)');
      expect(ctx).toContain('color grading (exposure=1.20)');
      expect(ctx).not.toContain('chromatic aberration');
    });

    it('omits section when no effects enabled', () => {
      const ctx = buildSceneContext(baseState({
        postProcessing: {
          bloom: { enabled: false, intensity: 0 },
          chromaticAberration: { enabled: false, intensity: 0 },
          colorGrading: { enabled: false, global: { exposure: 1 } },
          sharpening: { enabled: false, sharpeningStrength: 0 },
        } as unknown as ContextState['postProcessing'],
      }));
      expect(ctx).not.toContain('Post-Processing');
    });
  });

  // ---------------------------------------------------------------------------
  // Assets, Scripts, Audio
  // ---------------------------------------------------------------------------
  describe('assets and scripts', () => {
    it('shows asset registry summary', () => {
      const ctx = buildSceneContext(baseState({
        assetRegistry: {
          a1: { kind: 'gltf_model', name: 'character.glb' },
          a2: { kind: 'gltf_model', name: 'tree.glb' },
          a3: { kind: 'texture', name: 'grass.png' },
        } as unknown as ContextState['assetRegistry'],
      }));
      expect(ctx).toContain('3 assets: 2 models, 1 texture');
    });

    it('shows script summary', () => {
      const ctx = buildSceneContext(baseState({
        allScripts: {
          e1: { enabled: true, template: null } as unknown,
          e2: { enabled: false, template: 'player_controller' } as unknown,
        } as unknown as ContextState['allScripts'],
      }));
      expect(ctx).toContain('2 scripted entities');
      expect(ctx).toContain('1 enabled');
      expect(ctx).toContain('1 from templates');
    });

    it('shows audio assets', () => {
      const ctx = buildSceneContext(baseState({
        assetRegistry: {
          a1: { kind: 'audio', name: 'explosion.wav' },
          a2: { kind: 'audio', name: 'bgm.mp3' },
        } as unknown as ContextState['assetRegistry'],
      }));
      expect(ctx).toContain('2 audio files: explosion.wav, bgm.mp3');
    });

    it('shows audio buses', () => {
      const ctx = buildSceneContext(baseState({
        audioBuses: [
          { name: 'Master', volume: 1, muted: false, soloed: false, effects: [] },
          { name: 'SFX', volume: 0.8, muted: true, soloed: false, effects: [{}] },
        ] as unknown as ContextState['audioBuses'],
      }));
      expect(ctx).toContain('Master: vol=100%');
      expect(ctx).toContain('SFX: vol=80% (muted, 1 FX)');
    });
  });

  // ---------------------------------------------------------------------------
  // Animation
  // ---------------------------------------------------------------------------
  describe('animation', () => {
    it('shows animation clips', () => {
      const ctx = buildSceneContext(baseState({
        primaryId: 'e1',
        sceneGraph: {
          nodes: { e1: { ...makeEntity({ entityId: 'e1', name: 'Player' }), components: ['Transform', 'Mesh3d'] } },
          rootIds: ['e1'],
        },
        selectedIds: new Set(['e1']),
        primaryTransform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } as ContextState['primaryTransform'],
        primaryAnimation: {
          availableClips: [
            { name: 'walk', durationSecs: 1.2 },
            { name: 'idle', durationSecs: 2.0 },
          ],
          activeClipName: 'walk',
          isPlaying: true,
          isPaused: false,
          speed: 1,
          isLooping: true,
        } as unknown as ContextState['primaryAnimation'],
      }));
      expect(ctx).toContain('2 clips: walk (1.2s), idle (2.0s)');
      expect(ctx).toContain('active: "walk", playing');
    });

    it('shows keyframe animation clip', () => {
      const ctx = buildSceneContext(baseState({
        primaryId: 'e1',
        sceneGraph: {
          nodes: { e1: { ...makeEntity({ entityId: 'e1', name: 'Box' }), components: ['Transform', 'Mesh3d'] } },
          rootIds: ['e1'],
        },
        selectedIds: new Set(['e1']),
        primaryTransform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } as ContextState['primaryTransform'],
        primaryAnimationClip: {
          tracks: [{}, {}],
          duration: 3.5,
          playMode: 'loop',
          speed: 2,
          autoplay: true,
        } as unknown as ContextState['primaryAnimationClip'],
      }));
      expect(ctx).toContain('2 tracks, duration=3.5s');
      expect(ctx).toContain('speed=2x, autoplay=true');
    });
  });

  // ---------------------------------------------------------------------------
  // Input bindings & History
  // ---------------------------------------------------------------------------
  describe('input bindings and history', () => {
    it('shows input bindings with preset', () => {
      const ctx = buildSceneContext(baseState({
        inputBindings: [
          { actionName: 'jump' },
          { actionName: 'fire' },
        ] as unknown as ContextState['inputBindings'],
        inputPreset: 'FPS' as ContextState['inputPreset'],
      }));
      expect(ctx).toContain('Input Bindings (preset: FPS)');
      expect(ctx).toContain('2 actions: jump, fire');
    });

    it('shows custom input bindings without preset', () => {
      const ctx = buildSceneContext(baseState({
        inputBindings: [{ actionName: 'move' }] as unknown as ContextState['inputBindings'],
      }));
      expect(ctx).toContain('(custom)');
    });

    it('shows undo/redo history', () => {
      const ctx = buildSceneContext(baseState({
        canUndo: true,
        canRedo: true,
        undoDescription: 'Move entity',
        redoDescription: 'Delete entity',
      }));
      expect(ctx).toContain('can undo: "Move entity"');
      expect(ctx).toContain('can redo: "Delete entity"');
    });

    it('omits history when nothing to undo/redo', () => {
      const ctx = buildSceneContext(baseState());
      expect(ctx).not.toContain('## History');
    });
  });

  // ---------------------------------------------------------------------------
  // Scenes & Generations
  // ---------------------------------------------------------------------------
  describe('scenes and generations', () => {
    it('shows multiple scenes', () => {
      const ctx = buildSceneContext(baseState({
        scenes: [
          { id: 's1', name: 'Main Menu', isStartScene: true },
          { id: 's2', name: 'Level 1', isStartScene: false },
        ],
        activeSceneId: 's2',
      }));
      expect(ctx).toContain('Main Menu (start)');
      expect(ctx).toContain('Level 1 (active)');
    });

    it('omits scenes section for single scene', () => {
      const ctx = buildSceneContext(baseState({
        scenes: [{ id: 's1', name: 'Only', isStartScene: true }],
      }));
      expect(ctx).not.toContain('Scenes:');
    });

    it('shows active AI generations', () => {
      const ctx = buildSceneContext(baseState({
        activeGenerations: [
          { type: 'model', prompt: 'A detailed medieval castle with towers and walls', status: 'processing', progress: 45 },
          { type: 'texture', prompt: 'Stone wall texture seamless', status: 'queued', progress: 0 },
        ] as unknown as ContextState['activeGenerations'],
      }));
      expect(ctx).toContain('Active AI Generations');
      expect(ctx).toContain('3D Model: "A detailed medieval castle with towers a..."');
      expect(ctx).toContain('(processing, 45%)');
      expect(ctx).toContain('Texture:');
    });
  });

  // ---------------------------------------------------------------------------
  // Entity reference hint & prefabs
  // ---------------------------------------------------------------------------
  it('always includes entity reference hint', () => {
    const ctx = buildSceneContext(baseState());
    expect(ctx).toContain('## Entity References');
    expect(ctx).toContain('@EntityName');
  });

  it('always includes prefabs hint', () => {
    const ctx = buildSceneContext(baseState());
    expect(ctx).toContain('Prefabs: Use list_prefabs');
  });
});
