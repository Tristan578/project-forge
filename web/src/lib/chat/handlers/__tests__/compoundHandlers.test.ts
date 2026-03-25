/**
 * Tests for compoundHandlers — 8 multi-step AI compound tools.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockStore } from './handlerTestUtils';
import { compoundHandlers } from '../compoundHandlers';
import type { ToolCallContext, ExecutionResult } from '../types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGetPresetById = vi.fn();
const mockBuildEntityIndex = vi.fn();
const mockFindEntityByName = vi.fn();

vi.mock('@/lib/materialPresets', () => ({
  getPresetById: (...args: unknown[]) => mockGetPresetById(...args),
}));

vi.mock('@/lib/engine/entityIndex', () => ({
  buildEntityIndex: (...args: unknown[]) => mockBuildEntityIndex(...args),
  findEntityByName: (...args: unknown[]) => mockFindEntityByName(...args),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSceneNode(overrides: Record<string, unknown> = {}) {
  return {
    entityId: 'e1',
    name: 'Cube',
    visible: true,
    parentId: null,
    children: [],
    components: ['Mesh3d'],
    ...overrides,
  };
}

function makeStore(overrides: Record<string, unknown> = {}) {
  return createMockStore({
    environment: {
      clearColor: [0, 0, 0],
      fogEnabled: false,
      skyboxPreset: null,
    },
    ambientLight: { color: [1, 1, 1], brightness: 1 },
    allGameComponents: {},
    setScript: vi.fn(),
    importGltf: vi.fn(),
    loadTexture: vi.fn(),
    removeTexture: vi.fn(),
    placeAsset: vi.fn(),
    deleteAsset: vi.fn(),
    importAudio: vi.fn(),
    ...overrides,
  });
}

async function invoke(
  name: string,
  args: Record<string, unknown> = {},
  storeOverrides: Record<string, unknown> = {},
): Promise<{ result: ExecutionResult; store: ToolCallContext['store']; dispatchCommand: ReturnType<typeof vi.fn> }> {
  const store = makeStore(storeOverrides);
  const dispatchCommand = vi.fn();
  const result = await compoundHandlers[name](args, { store, dispatchCommand });
  return { result, store, dispatchCommand };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetPresetById.mockReturnValue(null);
  mockBuildEntityIndex.mockReturnValue({ byName: new Map(), byComponent: new Map() });
  mockFindEntityByName.mockReturnValue(null);
});

// ===========================================================================
// describe_scene
// ===========================================================================

describe('compoundHandlers', () => {
  describe('describe_scene', () => {
    it('returns summary when detail is "summary"', async () => {
      const node = makeSceneNode();
      const { result } = await invoke('describe_scene', { detail: 'summary' }, {
        sceneGraph: { nodes: { e1: node }, rootIds: ['e1'] },
        sceneName: 'TestScene',
        engineMode: 'edit',
        physicsEnabled: true,
        allScripts: { e1: 'code' },
      });

      expect(result.success).toBe(true);
      const data = result.result as Record<string, unknown>;
      expect(data.entityCount).toBe(1);
      expect(data.sceneName).toBe('TestScene');
      expect(data.hasPhysics).toBe(true);
      expect(data.hasScripts).toBe(true);
      expect((data.summary as string)).toContain('1 entities');
    });

    it('returns standard detail by default', async () => {
      const node = makeSceneNode({ entityId: 'e1', name: 'Player', components: ['Mesh3d', 'Physics'] });
      const { result } = await invoke('describe_scene', {}, {
        sceneGraph: { nodes: { e1: node }, rootIds: ['e1'] },
        allScripts: {},
        allGameComponents: {},
        environment: { clearColor: [0, 0, 0], fogEnabled: false, skyboxPreset: 'sunset' },
        ambientLight: { color: [1, 1, 1], brightness: 1 },
        inputPreset: 'wasd',
        engineMode: 'edit',
      });

      expect(result.success).toBe(true);
      const data = result.result as Record<string, unknown>;
      const entities = data.entities as Array<Record<string, unknown>>;
      expect(entities).toHaveLength(1);
      expect(entities[0].name).toBe('Player');
      expect(entities[0].hasPhysics).toBe(true);
    });

    it('returns full detail when requested', async () => {
      const node = makeSceneNode({ components: ['Mesh3d', 'Particle'] });
      const { result } = await invoke('describe_scene', { detail: 'full' }, {
        sceneGraph: { nodes: { e1: node }, rootIds: ['e1'] },
        allScripts: {},
        allGameComponents: {},
        environment: { clearColor: [0, 0, 0], fogEnabled: false },
        ambientLight: { color: [1, 1, 1], brightness: 1 },
        inputBindings: [],
        inputPreset: 'wasd',
        audioBuses: [],
        scenes: [],
        engineMode: 'edit',
        postProcessing: null,
      });

      expect(result.success).toBe(true);
      const data = result.result as Record<string, unknown>;
      const entities = data.entities as Array<Record<string, unknown>>;
      expect(entities[0].hasParticles).toBe(true);
      expect(data.inputBindings).not.toBeUndefined();
    });

    it('filters by entity IDs when filterEntityIds provided', async () => {
      const node1 = makeSceneNode({ entityId: 'e1', name: 'A' });
      const node2 = makeSceneNode({ entityId: 'e2', name: 'B' });
      const { result } = await invoke('describe_scene', { detail: 'summary', filterEntityIds: ['e1'] }, {
        sceneGraph: { nodes: { e1: node1, e2: node2 }, rootIds: ['e1', 'e2'] },
        sceneName: 'Test',
        engineMode: 'edit',
        physicsEnabled: false,
        allScripts: {},
      });

      const data = result.result as Record<string, unknown>;
      expect(data.entityCount).toBe(1);
    });

    it('returns empty entities for empty scene graph', async () => {
      const { result } = await invoke('describe_scene', { detail: 'summary' }, {
        sceneGraph: { nodes: {}, rootIds: [] },
        sceneName: 'Empty',
        engineMode: 'edit',
        physicsEnabled: false,
        allScripts: {},
      });

      const data = result.result as Record<string, unknown>;
      expect(data.entityCount).toBe(0);
    });
  });

  // ===========================================================================
  // analyze_gameplay
  // ===========================================================================

  describe('analyze_gameplay', () => {
    it('returns empty analysis for empty scene', async () => {
      const { result } = await invoke('analyze_gameplay', {}, {
        sceneGraph: { nodes: {}, rootIds: [] },
        allGameComponents: {},
        allScripts: {},
        inputBindings: [],
        physicsEnabled: false,
        environment: { fogEnabled: false },
      });

      expect(result.success).toBe(true);
      const analysis = result.result as Record<string, unknown>;
      expect(analysis.entityCount).toBe(0);
      expect((analysis.mechanics as string[])).toEqual([]);
    });

    it('detects player character from character_controller component', async () => {
      const node = makeSceneNode({ entityId: 'p1', name: 'Hero', components: ['Mesh3d'] });
      const { result } = await invoke('analyze_gameplay', {}, {
        sceneGraph: { nodes: { p1: node }, rootIds: ['p1'] },
        allGameComponents: { p1: [{ type: 'characterController' }] },
        allScripts: {},
        inputBindings: [{ actionName: 'jump' }],
        physicsEnabled: true,
        environment: { fogEnabled: false },
      });

      const analysis = result.result as Record<string, unknown>;
      expect((analysis.mechanics as string[])).toContain('player_character');
      expect((analysis.mechanics as string[])).toContain('input_system');
      expect((analysis.mechanics as string[])).toContain('physics');
    });

    it('flags missing player character as issue', async () => {
      const node = makeSceneNode({ entityId: 'e1', name: 'Box', components: ['Mesh3d'] });
      const { result } = await invoke('analyze_gameplay', {}, {
        sceneGraph: { nodes: { e1: node }, rootIds: ['e1'] },
        allGameComponents: {},
        allScripts: {},
        inputBindings: [],
        physicsEnabled: false,
        environment: { fogEnabled: false },
      });

      const analysis = result.result as Record<string, unknown>;
      expect((analysis.issues as string[])).toContain(
        'No player character found. Consider adding a character_controller component.'
      );
    });

    it('suggests adding win condition when collectibles exist without one', async () => {
      const node = makeSceneNode({ entityId: 'c1', name: 'Coin', components: ['Mesh3d'] });
      const { result } = await invoke('analyze_gameplay', {}, {
        sceneGraph: { nodes: { c1: node }, rootIds: ['c1'] },
        allGameComponents: { c1: [{ type: 'collectible' }] },
        allScripts: {},
        inputBindings: [],
        physicsEnabled: false,
        environment: { fogEnabled: false },
      });

      const analysis = result.result as Record<string, unknown>;
      expect((analysis.suggestions as string[])).toEqual(
        expect.arrayContaining([expect.stringContaining('win condition')])
      );
    });

    it('detects scripting mechanic when scripts exist', async () => {
      const node = makeSceneNode({ entityId: 's1', name: 'Script' });
      const { result } = await invoke('analyze_gameplay', {}, {
        sceneGraph: { nodes: { s1: node }, rootIds: ['s1'] },
        allGameComponents: {},
        allScripts: { s1: 'console.log("hi")' },
        inputBindings: [],
        physicsEnabled: false,
        environment: { fogEnabled: false },
      });

      const analysis = result.result as Record<string, unknown>;
      expect((analysis.mechanics as string[])).toContain('scripting');
    });
  });

  // ===========================================================================
  // arrange_entities
  // ===========================================================================

  describe('arrange_entities', () => {
    it('arranges entities in a line pattern', async () => {
      const nodes = {
        e1: makeSceneNode({ entityId: 'e1', name: 'A' }),
        e2: makeSceneNode({ entityId: 'e2', name: 'B' }),
      };
      const { result, store } = await invoke('arrange_entities', {
        entityIds: ['e1', 'e2'],
        pattern: 'line',
        center: [0, 0, 0],
        spacing: 3,
      }, {
        sceneGraph: { nodes, rootIds: ['e1', 'e2'] },
      });

      expect(result.success).toBe(true);
      expect(store.updateTransform).toHaveBeenCalled();
      const data = result.result as Record<string, unknown>;
      expect(data.arranged).toBe(2);
    });

    it('arranges entities in a grid pattern', async () => {
      const nodes = {
        e1: makeSceneNode({ entityId: 'e1', name: 'A' }),
        e2: makeSceneNode({ entityId: 'e2', name: 'B' }),
        e3: makeSceneNode({ entityId: 'e3', name: 'C' }),
        e4: makeSceneNode({ entityId: 'e4', name: 'D' }),
      };
      const { result, store } = await invoke('arrange_entities', {
        entityIds: ['e1', 'e2', 'e3', 'e4'],
        pattern: 'grid',
        spacing: 2,
        gridColumns: 2,
      }, {
        sceneGraph: { nodes, rootIds: ['e1', 'e2', 'e3', 'e4'] },
      });

      expect(result.success).toBe(true);
      expect(store.updateTransform).toHaveBeenCalledTimes(4);
    });

    it('arranges entities in a circle pattern', async () => {
      const nodes = {
        e1: makeSceneNode({ entityId: 'e1', name: 'A' }),
        e2: makeSceneNode({ entityId: 'e2', name: 'B' }),
      };
      const { result } = await invoke('arrange_entities', {
        entityIds: ['e1', 'e2'],
        pattern: 'circle',
        radius: 5,
      }, {
        sceneGraph: { nodes, rootIds: ['e1', 'e2'] },
      });

      expect(result.success).toBe(true);
      const data = result.result as Record<string, unknown>;
      expect(data.arranged).toBe(2);
    });

    it('skips entities not found in scene graph', async () => {
      const { result } = await invoke('arrange_entities', {
        entityIds: ['missing1', 'missing2'],
        pattern: 'line',
      }, {
        sceneGraph: { nodes: {}, rootIds: [] },
      });

      expect(result.success).toBe(false);
      const data = result.result as Record<string, unknown>;
      expect(data.arranged).toBe(0);
    });
  });

  // ===========================================================================
  // create_scene_from_description
  // ===========================================================================

  describe('create_scene_from_description', () => {
    it('spawns entities from description', async () => {
      const { result, store } = await invoke('create_scene_from_description', {
        entities: [
          { type: 'cube', name: 'Floor', position: [0, 0, 0] },
          { type: 'sphere', name: 'Ball', position: [0, 2, 0] },
        ],
      }, {
        primaryId: 'spawned-1',
      });

      expect(result.success).toBe(true);
      expect(store.spawnEntity).toHaveBeenCalledTimes(2);
      const data = result.result as Record<string, unknown>;
      const operations = (data as Record<string, unknown>).operations as Array<Record<string, unknown>>;
      expect(operations).toHaveLength(2);
    });

    it('clears scene when clearExisting is true', async () => {
      const { store } = await invoke('create_scene_from_description', {
        entities: [],
        clearExisting: true,
      }, {
        primaryId: 'spawned-1',
      });

      expect(store.newScene).toHaveBeenCalled();
    });

    it('applies environment settings', async () => {
      const { store } = await invoke('create_scene_from_description', {
        entities: [],
        environment: {
          ambientColor: [1, 0.5, 0],
          ambientBrightness: 2,
          skyboxPreset: 'sunset',
          fogEnabled: true,
          fogColor: [0.5, 0.5, 0.5],
        },
      });

      expect(store.updateAmbientLight).toHaveBeenCalled();
      expect(store.setSkybox).toHaveBeenCalledWith('sunset');
      expect(store.updateEnvironment).toHaveBeenCalled();
    });

    it('applies material preset when presetId is provided', async () => {
      mockGetPresetById.mockReturnValue({ data: { baseColor: [1, 0, 0, 1] } });

      const { store } = await invoke('create_scene_from_description', {
        entities: [{ type: 'cube', name: 'Red', material: { presetId: 'glossy-red' } }],
      }, {
        primaryId: 'e1',
      });

      expect(mockGetPresetById).toHaveBeenCalledWith('glossy-red');
      expect(store.updateMaterial).toHaveBeenCalled();
    });

    it('applies physics when entity has physics config', async () => {
      const { store } = await invoke('create_scene_from_description', {
        entities: [{ type: 'cube', name: 'Box', physics: { bodyType: 'dynamic' } }],
      }, {
        primaryId: 'e1',
      });

      expect(store.togglePhysics).toHaveBeenCalledWith('e1', true);
      expect(store.updatePhysics).toHaveBeenCalled();
    });

    it('reparents entities when parentName is specified', async () => {
      let callCount = 0;
      const { store } = await invoke('create_scene_from_description', {
        entities: [
          { type: 'cube', name: 'Parent' },
          { type: 'sphere', name: 'Child', parentName: 'Parent' },
        ],
      }, {
        get primaryId() {
          callCount++;
          return `e${callCount}`;
        },
      });

      expect(store.reparentEntity).toHaveBeenCalled();
    });

    it('handles spawn failure gracefully', async () => {
      const { result } = await invoke('create_scene_from_description', {
        entities: [{ type: 'cube', name: 'Broken' }],
      }, {
        primaryId: null,
      });

      expect(result.success).toBe(true);
      const data = result.result as Record<string, unknown>;
      const operations = data.operations as Array<Record<string, unknown>>;
      expect(operations[0].success).toBe(false);
    });
  });

  // ===========================================================================
  // create_level_layout
  // ===========================================================================

  describe('create_level_layout', () => {
    it('creates a level root entity', async () => {
      const { result, store } = await invoke('create_level_layout', {
        levelName: 'Level1',
      }, {
        primaryId: 'root-1',
      });

      expect(result.success).toBe(true);
      expect(store.spawnEntity).toHaveBeenCalledWith('cube', 'Level1');
      const data = result.result as Record<string, unknown>;
      expect(data.entityIds).toHaveProperty('Level1', 'root-1');
    });

    it('returns error when root spawn fails', async () => {
      const { result } = await invoke('create_level_layout', {}, {
        primaryId: null,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to create level root');
    });

    it('uses default level name "Level"', async () => {
      const { store } = await invoke('create_level_layout', {}, {
        primaryId: 'root',
      });

      expect(store.spawnEntity).toHaveBeenCalledWith('cube', 'Level');
    });

    it('sets input preset when provided', async () => {
      const { store } = await invoke('create_level_layout', {
        inputPreset: 'platformer',
      }, {
        primaryId: 'root',
      });

      expect(store.setInputPreset).toHaveBeenCalledWith('platformer');
    });
  });

  // ===========================================================================
  // setup_character
  // ===========================================================================

  describe('setup_character', () => {
    it('spawns a character with default settings', async () => {
      const { result, store } = await invoke('setup_character', {}, {
        primaryId: 'char-1',
      });

      expect(result.success).toBe(true);
      expect(store.spawnEntity).toHaveBeenCalledWith('capsule', 'Player');
      expect(store.updateTransform).toHaveBeenCalledWith('char-1', 'position', [0, 1, 0]);
      expect(store.togglePhysics).toHaveBeenCalledWith('char-1', true);
      expect(store.updatePhysics).toHaveBeenCalled();
      expect(store.addGameComponent).toHaveBeenCalled();
      expect(store.setInputPreset).toHaveBeenCalledWith('platformer');
    });

    it('uses custom name, position, and entityType', async () => {
      const { store } = await invoke('setup_character', {
        name: 'Hero',
        position: [5, 0, 3],
        entityType: 'sphere',
      }, {
        primaryId: 'char-2',
      });

      expect(store.spawnEntity).toHaveBeenCalledWith('sphere', 'Hero');
      expect(store.updateTransform).toHaveBeenCalledWith('char-2', 'position', [5, 0, 3]);
    });

    it('applies material when provided', async () => {
      const { store } = await invoke('setup_character', {
        material: { baseColor: [1, 0, 0, 1] },
      }, {
        primaryId: 'char-3',
      });

      expect(store.updateMaterial).toHaveBeenCalled();
    });

    it('skips health component when health is null', async () => {
      const { store } = await invoke('setup_character', {
        health: null,
      }, {
        primaryId: 'char-4',
      });

      // addGameComponent should be called once for character_controller only
      expect(store.addGameComponent).toHaveBeenCalledTimes(1);
    });

    it('adds camera follow script when cameraFollow is true', async () => {
      const { store } = await invoke('setup_character', {
        cameraFollow: true,
      }, {
        primaryId: 'char-5',
      });

      expect(store.setScript).toHaveBeenCalled();
      const scriptCall = (store.setScript as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(scriptCall[0]).toBe('char-5');
      expect(scriptCall[1]).toContain('forge.camera.setTarget');
    });

    it('does not add camera follow script when cameraFollow is false', async () => {
      const { store } = await invoke('setup_character', {
        cameraFollow: false,
      }, {
        primaryId: 'char-6',
      });

      expect(store.setScript).not.toHaveBeenCalled();
    });

    it('handles spawn failure gracefully', async () => {
      const { result } = await invoke('setup_character', {}, {
        primaryId: null,
      });

      expect(result.success).toBe(true);
      const data = result.result as Record<string, unknown>;
      expect(data.success).toBe(false);
    });
  });

  // ===========================================================================
  // configure_game_mechanics
  // ===========================================================================

  describe('configure_game_mechanics', () => {
    it('sets input preset when provided', async () => {
      const { result, store } = await invoke('configure_game_mechanics', {
        inputPreset: 'fps',
      });

      expect(result.success).toBe(true);
      expect(store.setInputPreset).toHaveBeenCalledWith('fps');
    });

    it('adds custom input bindings', async () => {
      const { result, store } = await invoke('configure_game_mechanics', {
        customBindings: [
          { actionName: 'fire', actionType: 'digital', sources: ['mouse_left'] },
        ],
      });

      expect(result.success).toBe(true);
      expect(store.setInputBinding).toHaveBeenCalledWith(expect.objectContaining({
        actionName: 'fire',
        actionType: 'digital',
      }));
    });

    it('configures entities found by name', async () => {
      mockFindEntityByName.mockReturnValue('e1');
      const { result, store } = await invoke('configure_game_mechanics', {
        entityConfigs: [
          {
            entityName: 'Player',
            physics: { bodyType: 'dynamic' },
            gameComponents: [{ type: 'health', props: { maxHealth: 100 } }],
          },
        ],
      });

      expect(result.success).toBe(true);
      expect(store.togglePhysics).toHaveBeenCalledWith('e1', true);
      expect(store.addGameComponent).toHaveBeenCalled();
    });

    it('reports error when entity not found', async () => {
      mockFindEntityByName.mockReturnValue(null);
      const { result } = await invoke('configure_game_mechanics', {
        entityConfigs: [{ entityName: 'Ghost' }],
      });

      expect(result.success).toBe(false);
      const data = result.result as Record<string, unknown>;
      const operations = data.operations as Array<Record<string, unknown>>;
      expect(operations[0].success).toBe(false);
      expect(operations[0].error).toBe('Entity not found');
    });

    it('sets quality preset when provided', async () => {
      const { store } = await invoke('configure_game_mechanics', {
        qualityPreset: 'ultra',
      });

      expect(store.setQualityPreset).toHaveBeenCalledWith('ultra');
    });

    it('adds script when entity config has script', async () => {
      mockFindEntityByName.mockReturnValue('e1');
      const { store } = await invoke('configure_game_mechanics', {
        entityConfigs: [
          { entityName: 'NPC', script: { source: 'console.log("hi")' } },
        ],
      });

      expect(store.setScript).toHaveBeenCalledWith('e1', 'console.log("hi")', true, undefined);
    });
  });

  // ===========================================================================
  // apply_style
  // ===========================================================================

  describe('apply_style', () => {
    it('applies palette colors to target entities', async () => {
      const nodes = {
        e1: makeSceneNode({ entityId: 'e1', name: 'A', components: ['Mesh3d'] }),
        e2: makeSceneNode({ entityId: 'e2', name: 'B', components: ['Mesh3d'] }),
        e3: makeSceneNode({ entityId: 'e3', name: 'C', components: ['Mesh3d'] }),
      };
      const { result, store } = await invoke('apply_style', {
        targetEntityIds: ['e1', 'e2', 'e3'],
        palette: {
          primary: [1, 0, 0, 1] as [number, number, number, number],
          secondary: [0, 1, 0, 1] as [number, number, number, number],
          accent: [0, 0, 1, 1] as [number, number, number, number],
        },
      }, {
        sceneGraph: { nodes, rootIds: ['e1', 'e2', 'e3'] },
      });

      expect(result.success).toBe(true);
      expect(store.updateMaterial).toHaveBeenCalledTimes(3);
    });

    it('updates ambient light from lighting settings', async () => {
      const { store } = await invoke('apply_style', {
        targetEntityIds: [],
        lighting: {
          ambientColor: [0.5, 0.5, 0.5],
          ambientBrightness: 2,
        },
      });

      expect(store.updateAmbientLight).toHaveBeenCalledWith({
        color: [0.5, 0.5, 0.5],
        brightness: 2,
      });
    });

    it('sets skybox from lighting settings', async () => {
      const { store } = await invoke('apply_style', {
        targetEntityIds: [],
        lighting: { skyboxPreset: 'night' },
      });

      expect(store.setSkybox).toHaveBeenCalledWith('night');
    });

    it('applies fog from lighting settings', async () => {
      const { store } = await invoke('apply_style', {
        targetEntityIds: [],
        lighting: { fogEnabled: true, fogColor: [0.8, 0.8, 0.8] },
      });

      expect(store.updateEnvironment).toHaveBeenCalledWith(
        expect.objectContaining({ fogEnabled: true, fogColor: [0.8, 0.8, 0.8] })
      );
    });

    it('updates post-processing when provided', async () => {
      const { store } = await invoke('apply_style', {
        targetEntityIds: [],
        postProcessing: { bloomEnabled: true },
      });

      expect(store.updatePostProcessing).toHaveBeenCalledWith({ bloomEnabled: true });
    });

    it('applies material overrides to all targets', async () => {
      const nodes = {
        e1: makeSceneNode({ entityId: 'e1', name: 'A', components: ['Mesh3d'] }),
      };
      const { store } = await invoke('apply_style', {
        targetEntityIds: ['e1'],
        materialOverrides: { metallic: 0.9, roughness: 0.1 },
      }, {
        sceneGraph: { nodes, rootIds: ['e1'] },
      });

      expect(store.updateMaterial).toHaveBeenCalled();
      const matCall = (store.updateMaterial as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(matCall[0]).toBe('e1');
      expect(matCall[1].metallic).toBe(0.9);
      expect(matCall[1].perceptualRoughness).toBe(0.1);
    });

    it('auto-discovers mesh entities when no targetEntityIds provided', async () => {
      const meshSet = new Set(['e1', 'e2']);
      mockBuildEntityIndex.mockReturnValue({
        byName: new Map(),
        byComponent: new Map([['Mesh3d', meshSet]]),
      });

      const nodes = {
        e1: makeSceneNode({ entityId: 'e1', name: 'A' }),
        e2: makeSceneNode({ entityId: 'e2', name: 'B' }),
      };
      const { result } = await invoke('apply_style', {
        palette: { primary: [1, 0, 0, 1] as [number, number, number, number] },
      }, {
        sceneGraph: { nodes, rootIds: ['e1', 'e2'] },
      });

      expect(result.success).toBe(true);
      const data = result.result as Record<string, unknown>;
      expect(data.appliedTo).toBe(2);
    });

    it('succeeds with no operations when no style args provided', async () => {
      const { result } = await invoke('apply_style', {
        targetEntityIds: [],
      });

      expect(result.success).toBe(true);
      const data = result.result as Record<string, unknown>;
      expect(data.appliedTo).toBe(0);
    });
  });
});
