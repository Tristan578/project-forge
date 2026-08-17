/**
 * Tests for compoundHandlers — 8 multi-step AI compound tools.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockStore } from './handlerTestUtils';
import { compoundHandlers } from '../compoundHandlers';
import { generationHandlers } from '../generationHandlers';
import type { ToolCallContext, ExecutionResult } from '../types';

// Capture jobs registered by the REAL generate_texture handler so the compound
// flow can be exercised end-to-end against the handler that actually consumes
// the dispatched payload (rather than asserting only against a vi.fn mock).
const mockAddJob = vi.fn();
vi.mock('@/stores/generationStore', () => ({
  useGenerationStore: { getState: () => ({ addJob: mockAddJob }) },
}));

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
      expect(data.inputBindings).toBeDefined();
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
        spawnEntity: vi.fn((_t: unknown, n: string) => `id-${n}`),
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
        spawnEntity: vi.fn(() => 'spawned-1'),
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
        spawnEntity: vi.fn(() => 'e1'),
      });

      expect(mockGetPresetById).toHaveBeenCalledWith('glossy-red');
      expect(store.updateMaterial).toHaveBeenCalled();
    });

    it('applies physics when entity has physics config', async () => {
      const { store } = await invoke('create_scene_from_description', {
        entities: [{ type: 'cube', name: 'Box', physics: { bodyType: 'dynamic' } }],
      }, {
        spawnEntity: vi.fn(() => 'e1'),
      });

      expect(store.togglePhysics).toHaveBeenCalledWith('e1', true);
      expect(store.updatePhysics).toHaveBeenCalled();
    });

    it('attaches a dialogue_trigger game component', async () => {
      // REGRESSION (PF-1142): this handler used to own a private component
      // builder that covered 12 of the 13 types — dialogue_trigger fell to its
      // `default:` arm and returned null, so a compound scene could never
      // attach one and nothing anywhere reported the drop.
      const { store } = await invoke('create_scene_from_description', {
        entities: [
          {
            type: 'cube',
            name: 'Elder',
            gameComponent: 'dialogue_trigger',
            gameComponentProps: { treeId: 'intro', triggerRadius: 5 },
          },
        ],
      }, {
        spawnEntity: vi.fn(() => 'e1'),
      });

      expect(store.addGameComponent).toHaveBeenCalledWith('e1', {
        type: 'dialogueTrigger',
        dialogueTrigger: {
          treeId: 'intro',
          triggerRadius: 5,
          requireInteract: true,
          interactKey: 'interact',
          oneShot: false,
        },
      });
    });

    it.each([
      // [supplied value, what the engine's u32 coercion leaves]
      [9_999_999, 1_000_000], // above U32_MAXES.collectible.value → clamped down
      [-5, 0],                // below zero → clamped up; u32 has no negatives
      [2.7, 3],               // fractional → rounded, as `prop_u32` rounds
      ['not-a-number', 1],    // not a number at all → the field's default
    ])('coerces an out-of-range collectible value %o to %o', async (supplied, expected) => {
      // The private builder cast every field straight through (`props.x as number`),
      // so an LLM-supplied absurd value reached the engine verbatim. Assert the
      // EXACT resulting number: a `typeof === 'number'` check would still pass if
      // the clamp were deleted, which is the failure this test exists to catch.
      const { store } = await invoke('create_scene_from_description', {
        entities: [
          {
            type: 'cube',
            name: 'Coin',
            gameComponent: 'collectible',
            gameComponentProps: { value: supplied },
          },
        ],
      }, {
        spawnEntity: vi.fn(() => 'e1'),
      });

      expect(store.addGameComponent).toHaveBeenCalledWith('e1', {
        type: 'collectible',
        collectible: {
          value: expected,
          destroyOnCollect: true,
          pickupSoundAsset: null,
          rotateSpeed: 90,
        },
      });
    });

    it('collapses a win conditionType the engine cannot parse to its default', async () => {
      // The handler's own builder used to cast `conditionType` straight through,
      // so an LLM answering `'collect_all'` was STORED verbatim while the engine's
      // `match` fell through to `WinConditionType::Score`. `dispatchCommand`
      // returns void, so nothing reported that the inspector and the running game
      // were describing different win conditions. Pinned here at the handler level
      // — `gameComponentWire.test.ts` pins the same collapse at the builder.
      const { store } = await invoke('create_scene_from_description', {
        entities: [
          {
            type: 'cube',
            name: 'Flag',
            gameComponent: 'win_condition',
            gameComponentProps: { conditionType: 'collect_all', targetScore: 25 },
          },
        ],
      }, {
        spawnEntity: vi.fn(() => 'e1'),
      });

      expect(store.addGameComponent).toHaveBeenCalledWith('e1', {
        type: 'winCondition',
        winCondition: {
          conditionType: 'score',
          targetScore: 25,
          targetEntityId: null,
        },
      });
    });

    it('reparents entities using the distinct ids returned by spawnEntity', async () => {
      // Each spawn returns a distinct id derived from the name, proving the
      // name→id map is built from spawnEntity's return value (not stale primaryId).
      const { store } = await invoke('create_scene_from_description', {
        entities: [
          { type: 'cube', name: 'Parent' },
          { type: 'sphere', name: 'Child', parentName: 'Parent' },
        ],
      }, {
        spawnEntity: vi.fn((_t: unknown, n: string) => `id-${n}`),
      });

      expect(store.reparentEntity).toHaveBeenCalledWith('id-Child', 'id-Parent');
    });

    it('handles spawn failure gracefully', async () => {
      const { result } = await invoke('create_scene_from_description', {
        entities: [{ type: 'cube', name: 'Broken' }],
      }, {
        spawnEntity: vi.fn(() => null),
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
        spawnEntity: vi.fn(() => 'root-1'),
      });

      expect(result.success).toBe(true);
      expect(store.spawnEntity).toHaveBeenCalledWith('cube', 'Level1');
      const data = result.result as Record<string, unknown>;
      expect(data.entityIds).toHaveProperty('Level1', 'root-1');
    });

    it('returns error when root spawn returns no id', async () => {
      const { result } = await invoke('create_level_layout', {}, {
        spawnEntity: vi.fn(() => null),
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to create level root');
    });

    it('uses default level name "Level"', async () => {
      const { store } = await invoke('create_level_layout', {}, {
        spawnEntity: vi.fn(() => 'root'),
      });

      expect(store.spawnEntity).toHaveBeenCalledWith('cube', 'Level');
    });

    it('sets input preset when provided', async () => {
      const { store } = await invoke('create_level_layout', {
        inputPreset: 'platformer',
      }, {
        spawnEntity: vi.fn(() => 'root'),
      });

      expect(store.setInputPreset).toHaveBeenCalledWith('platformer');
    });

    // #8749: the terrain ground used to be built from a `primaryId` read, which
    // is only written by the async SELECTION_CHANGED event — null on a fresh
    // scene, so the ground was always reported as a failure. `spawnTerrain` now
    // returns the id it handed the engine, so the happy path actually works.
    it('parents the terrain ground using the id spawnTerrain returns', async () => {
      const { result, store } = await invoke('create_level_layout', {
        levelName: 'TerrainLevel',
        ground: { useTerrain: true, terrainConfig: { size: 64 } },
      }, {
        spawnEntity: vi.fn(() => 'root-1'),
        spawnTerrain: vi.fn(() => 'terrain-1'),
        // A NON-null primaryId that is deliberately the WRONG answer. Leaving it
        // null only proves the handler doesn't crash without it; a mutant that
        // went back to reading the store would then yield `undefined` and fail
        // for the wrong reason. With a real-looking stale value, the pre-fix
        // code reparents to 'stale-selection' and the assertion below names
        // exactly what regressed.
        primaryId: 'stale-selection',
      });

      expect(store.spawnTerrain).toHaveBeenCalledWith({ size: 64 });
      expect(store.reparentEntity).toHaveBeenCalledWith('terrain-1', 'root-1');

      const data = result.result as {
        success: boolean;
        operations: Array<{ action: string; success: boolean; entityId?: string }>;
      };
      const groundOp = data.operations.find((op) => op.action === 'create terrain ground');
      expect(groundOp?.success).toBe(true);
      expect(groundOp?.entityId).toBe('terrain-1');
    });

    it('reports the terrain ground as an explicit failure when the engine is not ready', async () => {
      // `spawnTerrain` returns undefined only when nothing was dispatched. The
      // handler must surface that as a failed operation — never silently drop it
      // and imply the ground exists.
      const { result, store } = await invoke('create_level_layout', {
        levelName: 'TerrainLevel',
        ground: { useTerrain: true, terrainConfig: { size: 64 } },
      }, {
        spawnEntity: vi.fn(() => 'root-1'),
        spawnTerrain: vi.fn(() => undefined),
      });

      expect(store.spawnTerrain).toHaveBeenCalled();
      expect(store.reparentEntity).not.toHaveBeenCalled();
      const data = result.result as {
        success: boolean;
        operations: Array<{ action: string; success: boolean; error?: string }>;
        partialSuccess: boolean;
      };
      const groundOp = data.operations.find((op) => op.action === 'create terrain ground');
      expect(groundOp).toBeDefined();
      expect(groundOp?.success).toBe(false);
      expect(groundOp?.error).toContain('engine not ready');
      // Root succeeded, ground failed -> the compound result reports partial
      // success, not a clean success that would imply the ground exists.
      expect(data.success).toBe(false);
      expect(data.partialSuccess).toBe(true);
    });
  });

  // ===========================================================================
  // setup_character
  // ===========================================================================

  describe('setup_character', () => {
    it('spawns a character with default settings', async () => {
      const { result, store } = await invoke('setup_character', {}, {
        spawnEntity: vi.fn(() => 'char-1'),
      });

      expect(result.success).toBe(true);
      expect(store.spawnEntity).toHaveBeenCalledWith('capsule', 'Player');
      // primaryId stays null on a fresh scene — all follow-ups target the returned id.
      expect(store.primaryId).toBeNull();
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
        spawnEntity: vi.fn(() => 'char-2'),
      });

      expect(store.spawnEntity).toHaveBeenCalledWith('sphere', 'Hero');
      expect(store.updateTransform).toHaveBeenCalledWith('char-2', 'position', [5, 0, 3]);
    });

    it('applies material when provided', async () => {
      const { store } = await invoke('setup_character', {
        material: { baseColor: [1, 0, 0, 1] },
      }, {
        spawnEntity: vi.fn(() => 'char-3'),
      });

      expect(store.updateMaterial).toHaveBeenCalled();
    });

    it('skips health component when health is null', async () => {
      const { store } = await invoke('setup_character', {
        health: null,
      }, {
        spawnEntity: vi.fn(() => 'char-4'),
      });

      // addGameComponent should be called once for character_controller only
      expect(store.addGameComponent).toHaveBeenCalledTimes(1);
    });

    it('adds camera follow script when cameraFollow is true', async () => {
      const { store } = await invoke('setup_character', {
        cameraFollow: true,
      }, {
        spawnEntity: vi.fn(() => 'char-5'),
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
        spawnEntity: vi.fn(() => 'char-6'),
      });

      expect(store.setScript).not.toHaveBeenCalled();
    });

    it('handles spawn failure gracefully (spawnEntity returns no id)', async () => {
      const { result } = await invoke('setup_character', {}, {
        spawnEntity: vi.fn(() => null),
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

  // ===========================================================================
  // setup_game_from_description
  // ===========================================================================

  describe('setup_game_from_description', () => {
    // createMockStore does NOT include setProjectType — every test must supply it
    // (the handler calls it unconditionally and would throw on undefined).
    function gameOverrides(extra: Record<string, unknown> = {}) {
      return {
        spawnEntity: vi.fn((_t: unknown, n: string) => `id-${n}`),
        setProjectType: vi.fn(),
        ...extra,
      };
    }

    it('rejects an empty description with an Invalid arguments error', async () => {
      const { result, store } = await invoke('setup_game_from_description', { description: '' }, gameOverrides());

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid arguments');
      // No scaffolding happened — validation is the very first step.
      expect(store.spawnEntity).not.toHaveBeenCalled();
      expect(store.setProjectType).not.toHaveBeenCalled();
    });

    it('rejects a missing description', async () => {
      const { result, store } = await invoke('setup_game_from_description', {}, gameOverrides());

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid arguments');
      expect(store.spawnEntity).not.toHaveBeenCalled();
    });

    it('rejects an invalid targetTier enum', async () => {
      const { result } = await invoke(
        'setup_game_from_description',
        { description: 'a game', targetTier: 'ultra' },
        gameOverrides(),
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid arguments');
    });

    it('scaffolds a playable game in a fixed, ordered sequence', async () => {
      const { result, store, dispatchCommand } = await invoke(
        'setup_game_from_description',
        { description: 'a platformer with 3 enemies and 4 coins' },
        gameOverrides(),
      );

      expect(result.success).toBe(true);
      const spawn = store.spawnEntity as ReturnType<typeof vi.fn>;
      const spawnedNames = spawn.mock.calls.map((c) => c[1]);

      // Deterministic naming: Ground, Player, Enemy_0..2, Coin_0..3, Goal.
      expect(spawnedNames).toEqual([
        'Ground',
        'Player',
        'Enemy_0',
        'Enemy_1',
        'Enemy_2',
        'Coin_0',
        'Coin_1',
        'Coin_2',
        'Coin_3',
        'Goal',
      ]);

      // Ordering: project type is set BEFORE the first spawn.
      const setProjectTypeOrder = (store.setProjectType as ReturnType<typeof vi.fn>).mock
        .invocationCallOrder[0];
      const firstSpawnOrder = spawn.mock.invocationCallOrder[0];
      expect(setProjectTypeOrder).toBeLessThan(firstSpawnOrder);
      expect(store.setProjectType).toHaveBeenCalledWith('3d');

      // Player wiring: controller + health game components, dynamic physics.
      expect(store.togglePhysics).toHaveBeenCalledWith('id-Player', true);
      expect(store.addGameComponent).toHaveBeenCalledWith(
        'id-Player',
        {
          type: 'characterController',
          characterController: { speed: 5, jumpHeight: 8, gravityScale: 1, canDoubleJump: false },
        },
      );
      // The Player must be a DYNAMIC body — that is what generates the collision
      // PAIRS with the static sensor coins/goal. A non-dynamic player produces
      // no relative motion and (with two fixed bodies) no collision events.
      const playerPhysics = (store.updatePhysics as ReturnType<typeof vi.fn>).mock.calls.find(
        (c) => c[0] === 'id-Player',
      );
      expect(playerPhysics).toBeDefined();
      expect((playerPhysics?.[1] as { bodyType?: string })?.bodyType).toBe('dynamic');

      // Coins are collectibles with a trigger zone.
      expect(store.addGameComponent).toHaveBeenCalledWith(
        'id-Coin_0',
        {
          type: 'collectible',
          collectible: { value: 1, destroyOnCollect: true, pickupSoundAsset: null, rotateSpeed: 90 },
        },
      );

      // WINNABILITY / INTERACTIVITY GUARD (#8541, #8764) — the regression this
      // suite exists to catch. The engine's system_win_condition /
      // system_collectible / system_trigger_zone only fire on entries in
      // runtime.active_collisions, which is populated ONLY from Rapier
      // CollisionEvents — and Rapier colliders + ActiveEvents attach ONLY to
      // entities with PhysicsEnabled (engine/src/core/physics.rs). So EVERY
      // collision-driven entity (the Goal and every Coin) MUST have physics
      // enabled as a static SENSOR, or the scaffold is structurally un-winnable
      // and the coins never collect. Asserting only that the .type strings were
      // set (collectible/winCondition) does NOT prove this — it passed on the
      // broken code. We assert the actual togglePhysics + sensor physics calls.
      for (const coin of ['id-Coin_0', 'id-Coin_1', 'id-Coin_2', 'id-Coin_3']) {
        expect(store.togglePhysics).toHaveBeenCalledWith(coin, true);
        const coinPhysics = (store.updatePhysics as ReturnType<typeof vi.fn>).mock.calls.find(
          (c) => c[0] === coin,
        );
        expect(coinPhysics, `${coin} must have physics enabled to ever collect`).toBeDefined();
        expect((coinPhysics?.[1] as { isSensor?: boolean })?.isSensor).toBe(true);
      }

      // Goal: physics enabled as a static sensor so reaching it can fire the win.
      expect(store.togglePhysics).toHaveBeenCalledWith('id-Goal', true);
      const goalPhysics = (store.updatePhysics as ReturnType<typeof vi.fn>).mock.calls.find(
        (c) => c[0] === 'id-Goal',
      );
      expect(goalPhysics, 'Goal must have physics enabled to ever win').toBeDefined();
      expect((goalPhysics?.[1] as { isSensor?: boolean })?.isSensor).toBe(true);
      expect((goalPhysics?.[1] as { bodyType?: string })?.bodyType).toBe('fixed');

      // Goal carries exactly one win_condition.
      expect(store.addGameComponent).toHaveBeenCalledWith(
        'id-Goal',
        {
          type: 'winCondition',
          winCondition: { conditionType: 'reachGoal', targetScore: 10, targetEntityId: 'id-Goal' },
        },
      );
      const winCalls = (store.addGameComponent as ReturnType<typeof vi.fn>).mock.calls.filter(
        (c) => (c[1] as { type?: string })?.type === 'winCondition',
      );
      expect(winCalls).toHaveLength(1);

      // Input preset + camera-follow script targeting the player by id.
      expect(store.setInputPreset).toHaveBeenCalledWith('platformer');
      const scriptCall = (store.setScript as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(scriptCall[0]).toBe('id-Player');
      expect(scriptCall[1]).toContain('forge.camera.setTarget("id-Player")');

      // No generation requested → no generate_* dispatched.
      expect(dispatchCommand).not.toHaveBeenCalled();
      const data = result.result as Record<string, unknown>;
      expect(data.generationJobs).toBe(0);
    });

    it('is deterministic — identical descriptions produce identical spawn sequences', async () => {
      const a = await invoke(
        'setup_game_from_description',
        { description: '2 enemies, 3 coins' },
        gameOverrides(),
      );
      const b = await invoke(
        'setup_game_from_description',
        { description: '2 enemies, 3 coins' },
        gameOverrides(),
      );

      const namesA = (a.store.spawnEntity as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[1]);
      const namesB = (b.store.spawnEntity as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[1]);
      expect(namesA).toEqual(namesB);
    });

    it('plan-with-no-assets: omits all generate_* dispatch when targetTier is absent', async () => {
      const { dispatchCommand, result } = await invoke(
        'setup_game_from_description',
        { description: 'a simple maze game' },
        gameOverrides(),
      );

      expect(dispatchCommand).not.toHaveBeenCalled();
      const data = result.result as Record<string, unknown>;
      expect(data.generationJobs).toBe(0);
    });

    it('dispatches parallel generation jobs keyed to the param each handler consumes', async () => {
      const { dispatchCommand, store, result } = await invoke(
        'setup_game_from_description',
        { description: 'a shooter game', targetTier: 'high' },
        gameOverrides(),
      );

      // generate_3d_model on the player (its handler consumes targetEntityId).
      expect(dispatchCommand).toHaveBeenCalledWith(
        'generate_3d_model',
        expect.objectContaining({ targetEntityId: 'id-Player' }),
      );

      // generate_texture on the goal. Its handler schema accepts ONLY `entityId`,
      // so the goal id MUST ride under that key — under `targetEntityId` it is
      // silently stripped by Zod and the texture never wires onto the goal.
      const textureCall = dispatchCommand.mock.calls.find((c) => c[0] === 'generate_texture');
      expect(textureCall, 'generate_texture must be dispatched').toBeDefined();
      const texturePayload = textureCall![1] as Record<string, unknown>;
      expect(texturePayload.entityId).toBe('id-Goal');
      // Guard against regressing to the wrong key (the pre-fix contract).
      expect(texturePayload).not.toHaveProperty('targetEntityId');

      expect(dispatchCommand).toHaveBeenCalledWith('generate_music', expect.any(Object));

      const data = result.result as Record<string, unknown>;
      expect(data.generationJobs).toBe(3);

      // End-to-end: feed the EXACT dispatched payload into the REAL
      // generate_texture handler and assert the goal id survives the handler's
      // own schema + reaches the tracked job. This fails on the pre-fix payload
      // ({ targetEntityId }) because Zod strips the unknown key before tracking.
      mockAddJob.mockClear();
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ jobId: 'prov-1', provider: 'p', usageId: 'u-1' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
      try {
        const handlerCtx: ToolCallContext = {
          store,
          dispatchCommand: dispatchCommand as unknown as ToolCallContext['dispatchCommand'],
        };
        const handlerResult = await generationHandlers.generate_texture(texturePayload, handlerCtx);
        expect(handlerResult.success).toBe(true);
        // The POST body the handler sends carries the goal id under entityId.
        const sentBody = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);
        expect(sentBody.entityId).toBe('id-Goal');
        // The tracked job records the goal as both entityId and targetEntityId.
        expect(mockAddJob).toHaveBeenCalledWith(
          expect.objectContaining({ entityId: 'id-Goal', targetEntityId: 'id-Goal' }),
        );
      } finally {
        fetchSpy.mockRestore();
      }
    });

    it('picks the follower behavior for chase-type enemy descriptions', async () => {
      const { store } = await invoke(
        'setup_game_from_description',
        { description: '1 enemy that will chase the player' },
        gameOverrides(),
      );

      // The single enemy is a follower targeting the player id.
      expect(store.addGameComponent).toHaveBeenCalledWith(
        'id-Enemy_0',
        {
          type: 'follower',
          follower: { targetEntityId: 'id-Player', speed: 3, stopDistance: 1.5, lookAtTarget: true },
        },
      );
    });

    it('falls back to patrol (never a null-target follower) when the player spawn fails', async () => {
      // Regression: a 'follower' enemy was built with targetEntityId: playerId
      // unconditionally. If the player spawn returns null, the follower would
      // chase nothing. Spawn everything normally EXCEPT the Player, which fails.
      const { store } = await invoke(
        'setup_game_from_description',
        { description: '1 enemy that will chase the player' },
        gameOverrides({
          spawnEntity: vi.fn((_t: unknown, n: string) => (n === 'Player' ? null : `id-${n}`)),
        }),
      );

      const componentTypes = (store.addGameComponent as ReturnType<typeof vi.fn>).mock.calls.map(
        ([, component]) => (component as { type?: string }).type,
      );
      // No follower was created (it would have a null target) ...
      expect(componentTypes).not.toContain('follower');
      // ... the enemy patrols instead, keeping it functional. The patrol input
      // key 'moving_platform' builds a component with the camelCase discriminant.
      expect(store.addGameComponent).toHaveBeenCalledWith(
        'id-Enemy_0',
        {
          type: 'movingPlatform',
          movingPlatform: {
            speed: 2,
            waypoints: [[0, 1, 8], [0, 1, 4]],
            pauseDuration: 0.5,
            loopMode: 'pingPong',
          },
        },
      );
    });
  });

  // ===========================================================================
  // Model-supplied values are validated on the live path (PF-1160)
  //
  // These assert through the handlers rather than against `helpers.ts`
  // directly, because the defect being fixed was that the handlers had their
  // own unvalidated copies of those builders. A test that imports helpers can
  // pass while production runs something else entirely, which is exactly what
  // happened; only a handler-level assertion proves the validation runs.
  // ===========================================================================

  describe('validation of model-supplied specs', () => {
    async function spawnWith(entity: Record<string, unknown>) {
      return invoke('create_scene_from_description', { entities: [{ type: 'cube', name: 'X', ...entity }] }, {
        spawnEntity: vi.fn(() => 'e1'),
      });
    }

    function lastCallArg(fn: unknown, index: number): unknown {
      const calls = (fn as ReturnType<typeof vi.fn>).mock.calls;
      return calls[calls.length - 1][index];
    }

    it('clamps out-of-range material values into the range the field can mean', async () => {
      const { store } = await spawnWith({ material: { metallic: 5, perceptualRoughness: -3, ior: 99 } });

      const mat = lastCallArg(store.updateMaterial, 1) as Record<string, number>;
      // 5 reads as "as metallic as it goes", so it clamps rather than falling
      // back to the 0 default, which would read the intent backwards.
      expect(mat.metallic).toBe(1);
      expect(mat.perceptualRoughness).toBe(0);
      expect(mat.ior).toBe(3);
    });

    it('keeps a finite-but-enormous number out of the f32 overflow band', async () => {
      // 1e40 is a valid JSON number and survives every `as number` cast, but
      // past f32::MAX it reaches the engine as `inf` and NaNs the graph.
      const { store } = await spawnWith({ physics: { bodyType: 'dynamic', friction: 1e40 } });

      const phys = lastCallArg(store.updatePhysics, 1) as Record<string, number>;
      // Asserted as the exact bound, not merely as "finite": every value up to
      // 1e30 is finite and below f32::MAX, so a looser assertion stays green
      // with the 100 deleted and friction falling back to the generic cap.
      expect(phys.friction).toBe(100);
    });

    it('refuses a zero density, which Rapier cannot integrate', async () => {
      const { store } = await spawnWith({ physics: { bodyType: 'dynamic', density: 0 } });

      expect((lastCallArg(store.updatePhysics, 1) as Record<string, number>).density).toBe(0.0001);
    });

    it('clamps a restitution above 1, which would return more energy than the impact carried', async () => {
      const { store } = await spawnWith({ physics: { bodyType: 'dynamic', restitution: 3, gravityScale: 1e6 } });

      const phys = lastCallArg(store.updatePhysics, 1) as Record<string, number>;
      expect(phys.restitution).toBe(1);
      expect(phys.gravityScale).toBe(1000);
    });

    it('falls back to the default for a value of the wrong type, keeping the rest of the spec', async () => {
      const { result, store } = await spawnWith({
        physics: { bodyType: 'dynamic', restitution: 'bouncy' },
      });

      const phys = lastCallArg(store.updatePhysics, 1) as Record<string, unknown>;
      expect(phys.restitution).toBe(0.3);
      // The one bad field must not take the good ones down with it.
      expect(phys.bodyType).toBe('dynamic');
      expect(result.success).toBe(true);
      const operations = (result.result as Record<string, unknown>).operations as Array<Record<string, unknown>>;
      expect(operations[0].success).toBe(true);
    });

    it('survives a spec that is not an object at all', async () => {
      const { result, store } = await spawnWith({ light: 'bright' });

      // Nothing can be read out of a string, so every default applies —
      // the same answer as supplying no fields, and no throw. Asserted as the
      // whole object rather than a couple of keys: the claim is that EVERY
      // field defaults, and objectContaining is blind to one that stopped.
      expect(lastCallArg(store.updateLight, 1)).toEqual({
        lightType: 'point',
        color: [1, 1, 1],
        intensity: 800,
        shadowsEnabled: false,
        shadowDepthBias: 0.02,
        shadowNormalBias: 1.8,
        range: 20,
        radius: 0,
        innerAngle: 0.4,
        outerAngle: 0.8,
      });
      expect(result.success).toBe(true);
    });

    it('clamps light values to what the field can mean', async () => {
      const { store } = await spawnWith({
        light: { lightType: 'spot', intensity: -5, outerAngle: 3, shadowDepthBias: 1e9 },
      });

      const light = lastCallArg(store.updateLight, 1) as Record<string, number>;
      expect(light.intensity).toBe(0);
      // A cone's half-angle past pi/2 is a hemisphere, not a spotlight.
      expect(light.outerAngle).toBe(Math.PI / 2);
      expect(light.shadowDepthBias).toBe(100);
    });

    it('rounds a fractional value for a field the engine deserializes as u32', async () => {
      // serde has no float-to-int coercion: 1.5 against CollectibleData::value
      // fails the whole payload, and dispatchCommand reports nothing.
      const { store } = await spawnWith({
        gameComponent: 'collectible',
        gameComponentProps: { value: 1.5 },
      });

      const comp = lastCallArg(store.addGameComponent, 1) as { collectible: { value: number } };
      expect(comp.collectible.value).toBe(2);
      expect(Number.isInteger(comp.collectible.value)).toBe(true);
    });

    it('floors a negative value for a u32 field rather than passing it through', async () => {
      const { store } = await spawnWith({
        gameComponent: 'collectible',
        gameComponentProps: { value: -10 },
      });

      expect((lastCallArg(store.addGameComponent, 1) as { collectible: { value: number } }).collectible.value)
        .toBe(0);
    });

    const controllerFrom = (store: { addGameComponent: unknown }): Record<string, number> => {
      const calls = (store.addGameComponent as ReturnType<typeof vi.fn>).mock.calls;
      const controller = calls.find(([, c]) => (c as { type?: string }).type === 'characterController');
      return (controller?.[1] as { characterController: Record<string, number> }).characterController;
    };

    it('validates game component props reaching setup_character too', async () => {
      const { store } = await invoke('setup_character', {
        controller: { speed: 1e6, jumpHeight: -5 },
      }, {
        spawnEntity: vi.fn(() => 'char-1'),
      });

      // 1000 is the engine's own ceiling for `speed`, not a number chosen here
      // — `helpers.test.ts` reads every one of these bounds out of the Rust.
      const cc = controllerFrom(store);
      expect(cc.speed).toBe(1000);
      expect(cc.jumpHeight).toBe(0);
    });

    it('takes the engine default, not the ceiling, for a value f32 cannot hold', async () => {
      // `prop_f32` is `as_f64() as f32` then `is_finite().then(|| clamp(..))`, so a
      // double that overflows f32 answers `None` and the field keeps its `Default`
      // — it is never clamped to `max`. Clamping here instead would leave the store
      // showing 1000 for a controller the engine is running at 5, which is the exact
      // silent split this whole module exists to close.
      const { store } = await invoke('setup_character', {
        controller: { speed: 1e40 },
      }, {
        spawnEntity: vi.fn(() => 'char-1'),
      });

      expect(controllerFrom(store).speed).toBe(5);
    });

    // Each compound tool reaches the builders by its own path, and the defect
    // was precisely that a builder was not on the path production ran. So the
    // other two entry points that consume model-supplied specs get their own
    // assertion rather than inheriting create_scene_from_description's.
    it('validates specs reaching create_level_layout', async () => {
      const { store } = await invoke('create_level_layout', {
        theme: 'platformer',
        obstacles: [{ type: 'cube', position: [0, 0, 0], physics: { bodyType: 'dynamic', restitution: 3 } }],
      }, {
        spawnEntity: vi.fn(() => 'e1'),
      });

      expect((lastCallArg(store.updatePhysics, 1) as Record<string, number>).restitution).toBe(1);
    });

    it('validates specs reaching configure_game_mechanics', async () => {
      mockFindEntityByName.mockReturnValue('e1');
      const { store } = await invoke('configure_game_mechanics', {
        entityConfigs: [{
          entityName: 'Coin',
          gameComponents: [{ type: 'collectible', props: { value: 1.5 } }],
        }],
      });

      const comp = lastCallArg(store.addGameComponent, 1) as { collectible: { value: number } };
      expect(comp.collectible.value).toBe(2);
    });
  });
});
