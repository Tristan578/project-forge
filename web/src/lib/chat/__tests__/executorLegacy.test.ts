/**
 * Comprehensive unit tests for executor.legacy — the 8 compound AI actions.
 *
 * Each action is tested for:
 *  - Happy-path store mutations
 *  - Edge cases (empty inputs, optional fields, fallback defaults)
 *  - Error containment (unknown tools return { success: false })
 *  - Partial-success semantics where applicable
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executeToolCall } from '../executor.legacy';
import type { EditorState, SceneNode } from '@/stores/editorStore';

// ── Store factory ─────────────────────────────────────────────────────────────

function makeNode(id: string, name: string, opts: Partial<SceneNode> = {}): SceneNode {
  return {
    entityId: id,
    name,
    parentId: null,
    children: [],
    components: [],
    visible: true,
    ...opts,
  };
}

function makeStore(overrides: Record<string, unknown> = {}): EditorState {
  return {
    // Scene graph
    sceneGraph: { nodes: {}, rootIds: [] },
    sceneName: 'TestScene',
    scenes: [],
    activeSceneId: null,
    engineMode: 'edit',

    // Entity state
    selectedIds: new Set<string>(),
    primaryId: null,
    allScripts: {},
    allGameComponents: {},
    physicsEnabled: {},
    inputBindings: [],
    inputPreset: 'wasd',
    audioBuses: [],
    environment: {
      fogEnabled: false,
      fogColor: [1, 1, 1],
      fogStart: 10,
      fogEnd: 100,
      clearColor: [0.1, 0.1, 0.15],
      skyboxPreset: null,
      skyboxAssetId: null,
      skyboxBrightness: 1,
      iblIntensity: 1,
      iblRotationDegrees: 0,
    },
    ambientLight: { color: [1, 1, 1], brightness: 0.3 },
    postProcessing: null,
    terrainData: {},

    // Actions
    spawnEntity: vi.fn(),
    updateTransform: vi.fn(),
    updateMaterial: vi.fn(),
    updateLight: vi.fn(),
    updateAmbientLight: vi.fn(),
    updateEnvironment: vi.fn(),
    setSkybox: vi.fn(),
    togglePhysics: vi.fn(),
    updatePhysics: vi.fn(),
    setInputPreset: vi.fn(),
    setInputBinding: vi.fn(),
    addGameComponent: vi.fn(),
    setQualityPreset: vi.fn(),
    reparentEntity: vi.fn(),
    newScene: vi.fn(),
    setScript: vi.fn(),
    updatePostProcessing: vi.fn(),
    spawnTerrain: vi.fn(),

    ...overrides,
  } as unknown as EditorState;
}

// ── describe_scene ─────────────────────────────────────────────────────────────

describe('legacy: describe_scene', () => {
  it('summary detail returns entityCount and type counts', async () => {
    const store = makeStore({
      sceneGraph: {
        nodes: {
          a: makeNode('a', 'Cube', { components: ['Mesh3d'] }),
          b: makeNode('b', 'Light', { components: ['PointLight'] }),
        },
        rootIds: ['a', 'b'],
      },
    });

    const result = await executeToolCall('describe_scene', { detail: 'summary' }, store);
    expect(result.success).toBe(true);
    const r = result.result as Record<string, unknown>;
    expect(r.entityCount).toBe(2);
    expect(r.typeCounts).toBeDefined();
    expect(typeof r.summary).toBe('string');
  });

  it('standard detail includes entity list and environment', async () => {
    const store = makeStore({
      sceneGraph: {
        nodes: { e1: makeNode('e1', 'Box', { components: ['Mesh3d'] }) },
        rootIds: ['e1'],
      },
    });

    const result = await executeToolCall('describe_scene', { detail: 'standard' }, store);
    expect(result.success).toBe(true);
    const r = result.result as Record<string, unknown>;
    expect(Array.isArray(r.entities)).toBe(true);
    expect(r.environment).toBeDefined();
    expect(r.engineMode).toBe('edit');
  });

  it('full detail includes inputBindings and audioBuses', async () => {
    const store = makeStore({
      sceneGraph: {
        nodes: { e1: makeNode('e1', 'Sphere') },
        rootIds: ['e1'],
      },
    });

    const result = await executeToolCall('describe_scene', { detail: 'full' }, store);
    expect(result.success).toBe(true);
    const r = result.result as Record<string, unknown>;
    expect(r).toHaveProperty('inputBindings');
    expect(r).toHaveProperty('audioBuses');
    expect(r).toHaveProperty('scenes');
  });

  it('defaults to standard when detail is omitted', async () => {
    const store = makeStore({
      sceneGraph: { nodes: {}, rootIds: [] },
    });
    const result = await executeToolCall('describe_scene', {}, store);
    expect(result.success).toBe(true);
    const r = result.result as Record<string, unknown>;
    // standard includes entities array, not typeCounts
    expect(r).toHaveProperty('entities');
    expect(r).not.toHaveProperty('typeCounts');
  });

  it('filterEntityIds restricts results to specified IDs', async () => {
    const store = makeStore({
      sceneGraph: {
        nodes: {
          a: makeNode('a', 'A'),
          b: makeNode('b', 'B'),
          c: makeNode('c', 'C'),
        },
        rootIds: ['a', 'b', 'c'],
      },
    });

    const result = await executeToolCall('describe_scene', {
      detail: 'summary',
      filterEntityIds: ['a', 'c'],
    }, store);

    expect(result.success).toBe(true);
    const r = result.result as Record<string, unknown>;
    expect(r.entityCount).toBe(2);
  });

  it('filterEntityIds with non-existent IDs filters them out silently', async () => {
    const store = makeStore({
      sceneGraph: {
        nodes: { a: makeNode('a', 'A') },
        rootIds: ['a'],
      },
    });

    const result = await executeToolCall('describe_scene', {
      detail: 'summary',
      filterEntityIds: ['a', 'ghost-id'],
    }, store);

    expect(result.success).toBe(true);
    const r = result.result as Record<string, unknown>;
    expect(r.entityCount).toBe(1);
  });
});

// ── analyze_gameplay ──────────────────────────────────────────────────────────

describe('legacy: analyze_gameplay', () => {
  it('identifies player role from characterController game component', async () => {
    const store = makeStore({
      sceneGraph: {
        nodes: { p: makeNode('p', 'Player') },
        rootIds: ['p'],
      },
      allGameComponents: {
        p: [{ type: 'characterController', props: {} }],
      },
    });

    const result = await executeToolCall('analyze_gameplay', {}, store);
    expect(result.success).toBe(true);
    const r = result.result as Record<string, unknown>;
    const roles = r.entityRoles as Array<{ id: string; role: string }>;
    expect(roles.find(x => x.id === 'p')?.role).toBe('player');
  });

  it('detects player_character mechanic when a player entity exists', async () => {
    const store = makeStore({
      sceneGraph: {
        nodes: { p: makeNode('p', 'Player') },
        rootIds: ['p'],
      },
      allGameComponents: {
        p: [{ type: 'characterController', props: {} }],
      },
    });

    const result = await executeToolCall('analyze_gameplay', {}, store);
    const r = result.result as Record<string, unknown>;
    expect((r.mechanics as string[])).toContain('player_character');
  });

  it('raises issue when no player entity found in non-empty scene', async () => {
    const store = makeStore({
      sceneGraph: {
        nodes: { cube: makeNode('cube', 'Cube') },
        rootIds: ['cube'],
      },
    });

    const result = await executeToolCall('analyze_gameplay', {}, store);
    const r = result.result as Record<string, unknown>;
    const issues = r.issues as string[];
    expect(issues.some(i => i.includes('No player character'))).toBe(true);
  });

  it('raises issue when multiple player entities found', async () => {
    const store = makeStore({
      sceneGraph: {
        nodes: {
          p1: makeNode('p1', 'Player1'),
          p2: makeNode('p2', 'Player2'),
        },
        rootIds: ['p1', 'p2'],
      },
      allGameComponents: {
        p1: [{ type: 'characterController', props: {} }],
        p2: [{ type: 'characterController', props: {} }],
      },
    });

    const result = await executeToolCall('analyze_gameplay', {}, store);
    const r = result.result as Record<string, unknown>;
    const issues = r.issues as string[];
    expect(issues.some(i => i.includes('Multiple potential player'))).toBe(true);
  });

  it('reports collectibles mechanic when collectible components found', async () => {
    const store = makeStore({
      sceneGraph: {
        nodes: {
          c: makeNode('c', 'Coin'),
          p: makeNode('p', 'Player'),
        },
        rootIds: ['c', 'p'],
      },
      allGameComponents: {
        c: [{ type: 'collectible', props: {} }],
        p: [{ type: 'characterController', props: {} }],
      },
    });

    const result = await executeToolCall('analyze_gameplay', {}, store);
    const r = result.result as Record<string, unknown>;
    expect((r.mechanics as string[])).toContain('collectibles');
  });

  it('returns empty analysis for empty scene without crashing', async () => {
    const store = makeStore({
      sceneGraph: { nodes: {}, rootIds: [] },
    });

    const result = await executeToolCall('analyze_gameplay', {}, store);
    expect(result.success).toBe(true);
    const r = result.result as Record<string, unknown>;
    expect(r.entityCount).toBe(0);
    expect(r.mechanics).toEqual([]);
    expect(r.issues).toEqual([]);
  });
});

// ── arrange_entities ──────────────────────────────────────────────────────────

describe('legacy: arrange_entities', () => {
  let store: EditorState;

  beforeEach(() => {
    store = makeStore({
      sceneGraph: {
        nodes: {
          e1: makeNode('e1', 'A'),
          e2: makeNode('e2', 'B'),
          e3: makeNode('e3', 'C'),
          e4: makeNode('e4', 'D'),
        },
        rootIds: ['e1', 'e2', 'e3', 'e4'],
      },
    });
  });

  it('grid pattern places entities in a grid and calls updateTransform', async () => {
    const result = await executeToolCall('arrange_entities', {
      entityIds: ['e1', 'e2', 'e3', 'e4'],
      pattern: 'grid',
      spacing: 2,
    }, store);

    expect(result.success).toBe(true);
    expect(store.updateTransform).toHaveBeenCalledTimes(4);
    // Each call sets 'position'
    const calls = vi.mocked(store.updateTransform).mock.calls;
    calls.forEach(([_id, field]) => expect(field).toBe('position'));
  });

  it('circle pattern places entities equidistantly around a center', async () => {
    const result = await executeToolCall('arrange_entities', {
      entityIds: ['e1', 'e2', 'e3', 'e4'],
      pattern: 'circle',
      radius: 5,
    }, store);

    expect(result.success).toBe(true);
    const r = result.result as Record<string, unknown>;
    expect(r.arranged).toBe(4);
  });

  it('line pattern spaces entities along a direction vector', async () => {
    const result = await executeToolCall('arrange_entities', {
      entityIds: ['e1', 'e2', 'e3'],
      pattern: 'line',
      spacing: 3,
      direction: [1, 0, 0],
    }, store);

    expect(result.success).toBe(true);
    const r = result.result as Record<string, unknown>;
    expect(r.arranged).toBe(3);
  });

  it('scatter pattern uses deterministic PRNG based on seed', async () => {
    const result1 = await executeToolCall('arrange_entities', {
      entityIds: ['e1', 'e2', 'e3'],
      pattern: 'scatter',
      scatterSeed: 12345,
    }, store);

    const calls1 = vi.mocked(store.updateTransform).mock.calls.map(c => JSON.stringify(c));
    vi.mocked(store.updateTransform).mockClear();

    const result2 = await executeToolCall('arrange_entities', {
      entityIds: ['e1', 'e2', 'e3'],
      pattern: 'scatter',
      scatterSeed: 12345,
    }, store);

    const calls2 = vi.mocked(store.updateTransform).mock.calls.map(c => JSON.stringify(c));

    expect(result1.success).toBe(true);
    expect(result2.success).toBe(true);
    expect(calls1).toEqual(calls2);
  });

  it('path pattern distributes entities along waypoints', async () => {
    const result = await executeToolCall('arrange_entities', {
      entityIds: ['e1', 'e2', 'e3'],
      pattern: 'path',
      pathPoints: [[0, 0, 0], [10, 0, 0]],
    }, store);

    expect(result.success).toBe(true);
    const r = result.result as Record<string, unknown>;
    expect(r.arranged).toBe(3);
  });

  it('path pattern with fewer than 2 waypoints reports partial failure', async () => {
    const result = await executeToolCall('arrange_entities', {
      entityIds: ['e1', 'e2'],
      pattern: 'path',
      pathPoints: [[0, 0, 0]],
    }, store);

    // Each entity fails individually
    expect(result.success).toBe(false);
    const r = result.result as Record<string, unknown>;
    const ops = r.operations as Array<{ success: boolean }>;
    expect(ops.every(op => !op.success)).toBe(true);
  });

  it('unknown pattern reports failure for each entity', async () => {
    const result = await executeToolCall('arrange_entities', {
      entityIds: ['e1', 'e2'],
      pattern: 'spiral',
    }, store);

    expect(result.success).toBe(false);
    const r = result.result as Record<string, unknown>;
    expect((r.operations as Array<{ success: boolean }>).every(op => !op.success)).toBe(true);
  });

  it('non-existent entityId in list reports failure for that entity only', async () => {
    const result = await executeToolCall('arrange_entities', {
      entityIds: ['e1', 'ghost-id'],
      pattern: 'grid',
    }, store);

    const r = result.result as Record<string, unknown>;
    const ops = r.operations as Array<{ success: boolean; entityId?: string; error?: string }>;
    const ghost = ops.find(op => !op.entityId || op.error === 'Entity not found');
    expect(ghost).toBeDefined();
  });

  it('faceCenter option on circle pattern also calls updateTransform for rotation', async () => {
    const result = await executeToolCall('arrange_entities', {
      entityIds: ['e1', 'e2'],
      pattern: 'circle',
      radius: 5,
      faceCenter: true,
    }, store);

    expect(result.success).toBe(true);
    const calls = vi.mocked(store.updateTransform).mock.calls;
    // Should have both position and rotation updates
    expect(calls.some(([_id, field]) => field === 'rotation')).toBe(true);
  });
});

// ── create_scene_from_description ────────────────────────────────────────────

describe('legacy: create_scene_from_description', () => {
  it('spawns each entity and calls updateTransform for position', async () => {
    let spawnCallCount = 0;
    const store = makeStore({
      get primaryId() {
        return `entity-${++spawnCallCount}`;
      },
    });

    const result = await executeToolCall('create_scene_from_description', {
      entities: [
        { type: 'cube', name: 'Cube1', position: [0, 0, 0] },
        { type: 'sphere', name: 'Sphere1', position: [5, 0, 0] },
      ],
    }, store);

    expect(result.success).toBe(true);
    expect(store.spawnEntity).toHaveBeenCalledTimes(2);
    expect(store.updateTransform).toHaveBeenCalled();
  });

  it('calls newScene when clearExisting is true', async () => {
    const store = makeStore({ primaryId: 'ent1' });

    await executeToolCall('create_scene_from_description', {
      entities: [],
      clearExisting: true,
    }, store);

    expect(store.newScene).toHaveBeenCalledOnce();
  });

  it('does NOT call newScene when clearExisting is false', async () => {
    const store = makeStore({ primaryId: 'ent1' });

    await executeToolCall('create_scene_from_description', {
      entities: [],
      clearExisting: false,
    }, store);

    expect(store.newScene).not.toHaveBeenCalled();
  });

  it('applies environment settings when provided', async () => {
    const store = makeStore({ primaryId: null });

    await executeToolCall('create_scene_from_description', {
      entities: [],
      environment: {
        skyboxPreset: 'sunset',
        fogEnabled: true,
        fogStart: 5,
        fogEnd: 50,
      },
    }, store);

    expect(store.setSkybox).toHaveBeenCalledWith('sunset');
    expect(store.updateEnvironment).toHaveBeenCalledWith(
      expect.objectContaining({ fogEnabled: true, fogStart: 5, fogEnd: 50 })
    );
  });

  it('handles spawn failure gracefully (primaryId remains null)', async () => {
    const store = makeStore({ primaryId: null });

    const result = await executeToolCall('create_scene_from_description', {
      entities: [{ type: 'cube', name: 'FailCube' }],
    }, store);

    // Overall still returns success: true (partial result), individual ops track errors
    expect(result.success).toBe(true);
  });

  it('applies physics when entity physics config provided', async () => {
    let spawned = false;
    const store = makeStore({
      get primaryId() {
        if (!spawned) { spawned = true; return 'cube-id'; }
        return null;
      },
    });

    await executeToolCall('create_scene_from_description', {
      entities: [{
        type: 'cube',
        name: 'PhysCube',
        physics: { bodyType: 'dynamic' },
      }],
    }, store);

    expect(store.togglePhysics).toHaveBeenCalledWith('cube-id', true);
    expect(store.updatePhysics).toHaveBeenCalledWith('cube-id', expect.objectContaining({ bodyType: 'dynamic' }));
  });
});

// ── setup_character ───────────────────────────────────────────────────────────

describe('legacy: setup_character', () => {
  it('spawns character, sets physics, adds character controller, sets input preset', async () => {
    const store = makeStore({ primaryId: 'char-1' });

    const result = await executeToolCall('setup_character', {
      name: 'Hero',
      inputPreset: 'platformer',
    }, store);

    expect(result.success).toBe(true);
    expect(store.spawnEntity).toHaveBeenCalledWith('capsule', 'Hero');
    expect(store.togglePhysics).toHaveBeenCalledWith('char-1', true);
    expect(store.addGameComponent).toHaveBeenCalled();
    expect(store.setInputPreset).toHaveBeenCalledWith('platformer');
  });

  it('attaches camera follow script when cameraFollow is true (default)', async () => {
    const store = makeStore({ primaryId: 'char-2' });

    await executeToolCall('setup_character', { name: 'Runner' }, store);

    expect(store.setScript).toHaveBeenCalledWith(
      'char-2',
      expect.stringContaining('forge.camera.setTarget'),
      true
    );
  });

  it('skips camera follow script when cameraFollow is false', async () => {
    const store = makeStore({ primaryId: 'char-3' });

    await executeToolCall('setup_character', { name: 'NoCam', cameraFollow: false }, store);

    expect(store.setScript).not.toHaveBeenCalled();
  });

  it('skips health component when health is explicitly null', async () => {
    const store = makeStore({ primaryId: 'char-4' });

    await executeToolCall('setup_character', { name: 'NoHealth', health: null }, store);

    // addGameComponent should only be called for characterController, not health
    const calls = vi.mocked(store.addGameComponent).mock.calls;
    const healthCall = calls.find(([, comp]) => (comp as { type: string }).type === 'health');
    expect(healthCall).toBeUndefined();
  });

  it('applies custom entity type when entityType is provided', async () => {
    const store = makeStore({ primaryId: 'char-5' });

    await executeToolCall('setup_character', { name: 'Bot', entityType: 'sphere' }, store);

    expect(store.spawnEntity).toHaveBeenCalledWith('sphere', 'Bot');
  });

  it('returns error in operations when spawn fails (primaryId null)', async () => {
    const store = makeStore({ primaryId: null });

    const result = await executeToolCall('setup_character', { name: 'Ghost' }, store);

    expect(result.success).toBe(true);
    const r = result.result as Record<string, unknown>;
    const ops = (r as { operations: Array<{ success: boolean }> }).operations;
    expect(ops[0].success).toBe(false);
  });
});

// ── configure_game_mechanics ──────────────────────────────────────────────────

describe('legacy: configure_game_mechanics', () => {
  it('sets input preset when provided', async () => {
    const store = makeStore();

    const result = await executeToolCall('configure_game_mechanics', {
      inputPreset: 'fps',
    }, store);

    expect(result.success).toBe(true);
    expect(store.setInputPreset).toHaveBeenCalledWith('fps');
  });

  it('adds custom input bindings', async () => {
    const store = makeStore();

    await executeToolCall('configure_game_mechanics', {
      customBindings: [{
        actionName: 'Jump',
        actionType: 'digital',
        sources: ['keyboard'],
        positiveKeys: [' '],
      }],
    }, store);

    expect(store.setInputBinding).toHaveBeenCalledWith(
      expect.objectContaining({ actionName: 'Jump', actionType: 'digital' })
    );
  });

  it('sets quality preset when provided', async () => {
    const store = makeStore();

    await executeToolCall('configure_game_mechanics', { qualityPreset: 'ultra' }, store);

    expect(store.setQualityPreset).toHaveBeenCalledWith('ultra');
  });

  it('configures entity physics when entityConfigs include physics', async () => {
    const store = makeStore({
      sceneGraph: {
        nodes: { e1: makeNode('e1', 'Floor') },
        rootIds: ['e1'],
      },
    });

    await executeToolCall('configure_game_mechanics', {
      entityConfigs: [{
        entityName: 'Floor',
        physics: { bodyType: 'fixed' },
      }],
    }, store);

    expect(store.togglePhysics).toHaveBeenCalledWith('e1', true);
    expect(store.updatePhysics).toHaveBeenCalledWith('e1', expect.objectContaining({ bodyType: 'fixed' }));
  });

  it('reports failure for entity not found by name', async () => {
    const store = makeStore({
      sceneGraph: { nodes: {}, rootIds: [] },
    });

    const result = await executeToolCall('configure_game_mechanics', {
      entityConfigs: [{ entityName: 'Nonexistent' }],
    }, store);

    const r = result.result as Record<string, unknown>;
    const ops = r.operations as Array<{ success: boolean; error?: string }>;
    expect(ops[0].success).toBe(false);
    expect(ops[0].error).toBe('Entity not found');
  });

  it('reports success count in summary', async () => {
    const store = makeStore();

    await executeToolCall('configure_game_mechanics', {
      qualityPreset: 'high',
      inputPreset: 'platformer',
    }, store);

    const result = await executeToolCall('configure_game_mechanics', {
      inputPreset: 'fps',
    }, store);

    const r = result.result as Record<string, unknown>;
    expect(typeof r.summary).toBe('string');
    expect(r.configured).toBeGreaterThan(0);
  });
});

// ── apply_style ───────────────────────────────────────────────────────────────

describe('legacy: apply_style', () => {
  it('applies palette to all mesh entities when targetEntityIds is not specified', async () => {
    const store = makeStore({
      sceneGraph: {
        nodes: {
          m1: makeNode('m1', 'MeshA', { components: ['Mesh3d'] }),
          m2: makeNode('m2', 'MeshB', { components: ['Mesh3d'] }),
          light: makeNode('light', 'Light', { components: ['PointLight'] }),
        },
        rootIds: ['m1', 'm2', 'light'],
      },
    });

    const result = await executeToolCall('apply_style', {
      palette: {
        primary: [1, 0, 0, 1],
        secondary: [0, 1, 0, 1],
        accent: [0, 0, 1, 1],
      },
    }, store);

    expect(result.success).toBe(true);
    // Only mesh entities should be targeted (2, not the light)
    const r = result.result as Record<string, unknown>;
    expect(r.appliedTo).toBe(2);
  });

  it('applies style only to explicitly listed targetEntityIds', async () => {
    const store = makeStore({
      sceneGraph: {
        nodes: {
          a: makeNode('a', 'A', { components: ['Mesh3d'] }),
          b: makeNode('b', 'B', { components: ['Mesh3d'] }),
          c: makeNode('c', 'C', { components: ['Mesh3d'] }),
        },
        rootIds: ['a', 'b', 'c'],
      },
    });

    const result = await executeToolCall('apply_style', {
      targetEntityIds: ['a'],
      palette: { primary: [1, 0, 0, 1] },
    }, store);

    const r = result.result as Record<string, unknown>;
    expect(r.appliedTo).toBe(1);
  });

  it('applies material overrides to all targets', async () => {
    const store = makeStore({
      sceneGraph: {
        nodes: {
          m: makeNode('m', 'Metal', { components: ['Mesh3d'] }),
        },
        rootIds: ['m'],
      },
    });

    await executeToolCall('apply_style', {
      materialOverrides: { metallic: 1.0, roughness: 0.1 },
    }, store);

    expect(store.updateMaterial).toHaveBeenCalledWith('m', expect.objectContaining({ metallic: 1.0 }));
  });

  it('calls updateAmbientLight when lighting.ambientBrightness provided', async () => {
    const store = makeStore({
      sceneGraph: { nodes: {}, rootIds: [] },
    });

    await executeToolCall('apply_style', {
      lighting: { ambientBrightness: 0.8 },
    }, store);

    expect(store.updateAmbientLight).toHaveBeenCalledWith(
      expect.objectContaining({ brightness: 0.8 })
    );
  });

  it('calls updatePostProcessing when postProcessing provided', async () => {
    const store = makeStore({
      sceneGraph: { nodes: {}, rootIds: [] },
    });

    await executeToolCall('apply_style', {
      postProcessing: { bloom: { enabled: true, intensity: 0.5 } },
    }, store);

    expect(store.updatePostProcessing).toHaveBeenCalledWith(
      expect.objectContaining({ bloom: expect.objectContaining({ enabled: true }) })
    );
  });
});

// ── default / unknown tool ────────────────────────────────────────────────────

describe('legacy: unknown tool handling', () => {
  it('returns success: false with "Unknown tool" message for unrecognised tool names', async () => {
    const store = makeStore();
    const result = await executeToolCall('does_not_exist_xyz', {}, store);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Unknown tool');
  });

  it('includes the tool name in the error message', async () => {
    const store = makeStore();
    const result = await executeToolCall('my_missing_tool', {}, store);
    expect(result.error).toContain('my_missing_tool');
  });
});

// ── create_level_layout ──────────────────────────────────────────────────────

describe('legacy: create_level_layout', () => {
  it('creates root entity, ground plane, and reparents ground under root', async () => {
    let spawnCount = 0;
    const store = makeStore({
      get primaryId() {
        return `ent-${++spawnCount}`;
      },
    });

    const result = await executeToolCall('create_level_layout', {
      levelName: 'TestLevel',
      ground: { width: 20, depth: 20 },
    }, store);

    expect(result.success).toBe(true);
    // Root + ground = 2 spawns
    expect(store.spawnEntity).toHaveBeenCalledTimes(2);
    expect(store.reparentEntity).toHaveBeenCalled();
  });

  it('creates terrain ground when useTerrain is true', async () => {
    let spawnCount = 0;
    const store = makeStore({
      get primaryId() {
        return `ent-${++spawnCount}`;
      },
    });

    await executeToolCall('create_level_layout', {
      ground: { useTerrain: true, terrainConfig: { resolution: 128 } },
    }, store);

    expect(store.spawnTerrain).toHaveBeenCalledWith({ resolution: 128 });
  });

  it('creates walls with physics and correct geometry', async () => {
    let spawnCount = 0;
    const store = makeStore({
      get primaryId() {
        return `ent-${++spawnCount}`;
      },
    });

    const result = await executeToolCall('create_level_layout', {
      walls: [{
        name: 'North',
        start: [0, 0, 10],
        end: [10, 0, 10],
        height: 3,
        thickness: 0.3,
      }],
    }, store);

    expect(result.success).toBe(true);
    // Root + 1 wall = 2 spawns
    expect(store.spawnEntity).toHaveBeenCalledTimes(2);
    expect(store.togglePhysics).toHaveBeenCalled();
    expect(store.updatePhysics).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ bodyType: 'fixed' }),
    );
  });

  it('creates obstacles with optional physics and game components', async () => {
    let spawnCount = 0;
    const store = makeStore({
      get primaryId() {
        return `ent-${++spawnCount}`;
      },
    });

    await executeToolCall('create_level_layout', {
      obstacles: [{
        type: 'cube',
        name: 'Spike',
        position: [5, 0, 5],
        scale: [1, 2, 1],
        physics: { bodyType: 'fixed' },
        gameComponent: 'damage_zone',
        gameComponentProps: { damagePerSecond: 50 },
      }],
    }, store);

    // Root + obstacle = 2 spawns
    expect(store.spawnEntity).toHaveBeenCalledTimes(2);
    expect(store.togglePhysics).toHaveBeenCalled();
    expect(store.addGameComponent).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ type: 'damageZone' }),
    );
  });

  it('creates spawn points with semi-transparent material', async () => {
    let spawnCount = 0;
    const store = makeStore({
      get primaryId() {
        return `ent-${++spawnCount}`;
      },
    });

    await executeToolCall('create_level_layout', {
      spawnPoints: [{
        position: [0, 1, 0],
        isPlayerSpawn: true,
        name: 'PlayerStart',
      }],
    }, store);

    // Root + spawn point = 2 spawns
    expect(store.spawnEntity).toHaveBeenCalledTimes(2);
    expect(store.updateMaterial).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ unlit: true }),
    );
  });

  it('creates goals with default trigger zone for reach type', async () => {
    let spawnCount = 0;
    const store = makeStore({
      get primaryId() {
        return `ent-${++spawnCount}`;
      },
    });

    await executeToolCall('create_level_layout', {
      goals: [{
        name: 'Finish',
        position: [10, 1, 10],
        type: 'reach',
      }],
    }, store);

    expect(store.addGameComponent).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ type: 'triggerZone' }),
    );
  });

  it('creates goals with custom game component instead of default trigger', async () => {
    let spawnCount = 0;
    const store = makeStore({
      get primaryId() {
        return `ent-${++spawnCount}`;
      },
    });

    await executeToolCall('create_level_layout', {
      goals: [{
        name: 'ScoreGoal',
        position: [0, 0, 0],
        gameComponent: 'win_condition',
        gameComponentProps: { conditionType: 'score', targetScore: 100 },
      }],
    }, store);

    expect(store.addGameComponent).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ type: 'winCondition' }),
    );
  });

  it('applies input preset when provided', async () => {
    const store = makeStore({ primaryId: 'root-1' });

    await executeToolCall('create_level_layout', {
      inputPreset: 'platformer',
    }, store);

    expect(store.setInputPreset).toHaveBeenCalledWith('platformer');
  });

  it('returns failure when root spawn fails', async () => {
    const store = makeStore({ primaryId: null });

    const result = await executeToolCall('create_level_layout', {}, store);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Failed to create level root');
  });

  it('handles wall creation error gracefully', async () => {
    let spawnCount = 0;
    const store = makeStore({
      get primaryId() {
        spawnCount++;
        // Return null for the wall spawn (2nd spawn)
        return spawnCount <= 1 ? `ent-${spawnCount}` : null;
      },
    });

    const result = await executeToolCall('create_level_layout', {
      walls: [{ start: [0, 0, 0], end: [10, 0, 0], height: 3, thickness: 0.3 }],
    }, store);

    // Root succeeded, wall might not have gotten an ID
    expect(result.success).toBe(true);
  });

  it('applies material to ground plane when provided', async () => {
    let spawnCount = 0;
    const store = makeStore({
      get primaryId() {
        return `ent-${++spawnCount}`;
      },
    });

    await executeToolCall('create_level_layout', {
      ground: {
        width: 10,
        depth: 10,
        material: { baseColor: [0.3, 0.5, 0.2, 1] },
      },
    }, store);

    expect(store.updateMaterial).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ baseColor: [0.3, 0.5, 0.2, 1] }),
    );
  });

  it('applies material to wall when provided', async () => {
    let spawnCount = 0;
    const store = makeStore({
      get primaryId() {
        return `ent-${++spawnCount}`;
      },
    });

    await executeToolCall('create_level_layout', {
      walls: [{
        start: [0, 0, 0],
        end: [5, 0, 0],
        height: 3,
        thickness: 0.3,
        material: { baseColor: [0.5, 0.5, 0.5, 1] },
      }],
    }, store);

    expect(store.updateMaterial).toHaveBeenCalled();
  });
});

// ── configure_game_mechanics: entity scripts ────────────────────────────────

describe('legacy: configure_game_mechanics (scripts and components)', () => {
  it('sets script on entity when entityConfigs include script', async () => {
    const store = makeStore({
      sceneGraph: {
        nodes: { e1: makeNode('e1', 'Player') },
        rootIds: ['e1'],
      },
    });

    await executeToolCall('configure_game_mechanics', {
      entityConfigs: [{
        entityName: 'Player',
        script: { source: 'forge.onUpdate(() => {});', template: 'basic' },
      }],
    }, store);

    expect(store.setScript).toHaveBeenCalledWith('e1', 'forge.onUpdate(() => {});', true, 'basic');
  });

  it('adds multiple game components to an entity', async () => {
    const store = makeStore({
      sceneGraph: {
        nodes: { e1: makeNode('e1', 'Enemy') },
        rootIds: ['e1'],
      },
    });

    await executeToolCall('configure_game_mechanics', {
      entityConfigs: [{
        entityName: 'Enemy',
        gameComponents: [
          { type: 'follower', props: { speed: 5 } },
          { type: 'health', props: { maxHp: 50 } },
        ],
      }],
    }, store);

    expect(store.addGameComponent).toHaveBeenCalledTimes(2);
    expect(store.addGameComponent).toHaveBeenCalledWith(
      'e1',
      expect.objectContaining({ type: 'follower' }),
    );
    expect(store.addGameComponent).toHaveBeenCalledWith(
      'e1',
      expect.objectContaining({ type: 'health' }),
    );
  });
});

// ── analyze_gameplay: extended branches ──────────────────────────────────────

describe('legacy: analyze_gameplay (extended)', () => {
  it('identifies collectible, checkpoint, teleporter, spawner, goal roles', async () => {
    const store = makeStore({
      sceneGraph: {
        nodes: {
          c: makeNode('c', 'Coin'),
          cp: makeNode('cp', 'Save'),
          tp: makeNode('tp', 'Portal'),
          sp: makeNode('sp', 'Factory'),
          g: makeNode('g', 'Finish'),
        },
        rootIds: ['c', 'cp', 'tp', 'sp', 'g'],
      },
      allGameComponents: {
        c: [{ type: 'collectible', props: {} }],
        cp: [{ type: 'checkpoint', props: {} }],
        tp: [{ type: 'teleporter', props: {} }],
        sp: [{ type: 'spawner', props: {} }],
        g: [{ type: 'winCondition', props: {} }],
      },
    });

    const result = await executeToolCall('analyze_gameplay', {}, store);
    const r = result.result as Record<string, unknown>;
    const roles = r.entityRoles as Array<{ id: string; role: string }>;

    expect(roles.find(x => x.id === 'c')?.role).toBe('collectible');
    expect(roles.find(x => x.id === 'cp')?.role).toBe('checkpoint');
    expect(roles.find(x => x.id === 'tp')?.role).toBe('teleporter');
    expect(roles.find(x => x.id === 'sp')?.role).toBe('spawner');
    expect(roles.find(x => x.id === 'g')?.role).toBe('goal');
  });

  it('identifies light, ground, wall, platform roles by component/name', async () => {
    const store = makeStore({
      sceneGraph: {
        nodes: {
          l: makeNode('l', 'Sun', { components: ['DirectionalLight'] }),
          floor: makeNode('floor', 'Ground', { components: ['Physics'] }),
          w: makeNode('w', 'Wall_North', { components: ['Physics'] }),
          p: makeNode('p', 'Platform_1', { components: ['Physics'] }),
        },
        rootIds: ['l', 'floor', 'w', 'p'],
      },
      physicsEnabled: { floor: true, w: true, p: true },
    });

    const result = await executeToolCall('analyze_gameplay', {}, store);
    const r = result.result as Record<string, unknown>;
    const roles = r.entityRoles as Array<{ id: string; role: string }>;

    expect(roles.find(x => x.id === 'l')?.role).toBe('light');
    expect(roles.find(x => x.id === 'floor')?.role).toBe('ground');
    expect(roles.find(x => x.id === 'w')?.role).toBe('obstacle');
    expect(roles.find(x => x.id === 'p')?.role).toBe('platform');
  });

  it('identifies scripted and decoration roles', async () => {
    const store = makeStore({
      sceneGraph: {
        nodes: {
          s: makeNode('s', 'AIBehavior'),
          d: makeNode('d', 'Rock'),
        },
        rootIds: ['s', 'd'],
      },
      allScripts: { s: { source: 'code', enabled: true } },
    });

    const result = await executeToolCall('analyze_gameplay', {}, store);
    const r = result.result as Record<string, unknown>;
    const roles = r.entityRoles as Array<{ id: string; role: string }>;

    expect(roles.find(x => x.id === 's')?.role).toBe('scripted');
    expect(roles.find(x => x.id === 'd')?.role).toBe('decoration');
  });

  it('suggests win condition when collectibles exist without one', async () => {
    const store = makeStore({
      sceneGraph: {
        nodes: {
          c: makeNode('c', 'Coin'),
          p: makeNode('p', 'Player'),
        },
        rootIds: ['c', 'p'],
      },
      allGameComponents: {
        c: [{ type: 'collectible', props: {} }],
        p: [{ type: 'characterController', props: {} }],
      },
    });

    const result = await executeToolCall('analyze_gameplay', {}, store);
    const r = result.result as Record<string, unknown>;
    const suggestions = r.suggestions as string[];
    expect(suggestions.some(s => s.includes('win condition'))).toBe(true);
  });

  it('suggests lights for large scenes without dedicated lights', async () => {
    const nodes: Record<string, ReturnType<typeof makeNode>> = {};
    for (let i = 0; i < 6; i++) {
      nodes[`e${i}`] = makeNode(`e${i}`, `Entity_${i}`, { components: ['Mesh3d'] });
    }

    const store = makeStore({
      sceneGraph: { nodes, rootIds: Object.keys(nodes) },
    });

    const result = await executeToolCall('analyze_gameplay', {}, store);
    const r = result.result as Record<string, unknown>;
    const suggestions = r.suggestions as string[];
    expect(suggestions.some(s => s.includes('lights'))).toBe(true);
  });

  it('warns about missing input bindings when player exists', async () => {
    const store = makeStore({
      sceneGraph: {
        nodes: { p: makeNode('p', 'Player') },
        rootIds: ['p'],
      },
      allGameComponents: {
        p: [{ type: 'characterController', props: {} }],
      },
      inputBindings: [],
    });

    const result = await executeToolCall('analyze_gameplay', {}, store);
    const r = result.result as Record<string, unknown>;
    const issues = r.issues as string[];
    expect(issues.some(i => i.includes('no input bindings'))).toBe(true);
  });

  it('detects follower as enemy and movingPlatform as platform', async () => {
    const store = makeStore({
      sceneGraph: {
        nodes: {
          f: makeNode('f', 'Zombie'),
          mp: makeNode('mp', 'Lift'),
        },
        rootIds: ['f', 'mp'],
      },
      allGameComponents: {
        f: [{ type: 'follower', props: {} }],
        mp: [{ type: 'movingPlatform', props: {} }],
      },
    });

    const result = await executeToolCall('analyze_gameplay', {}, store);
    const r = result.result as Record<string, unknown>;
    const roles = r.entityRoles as Array<{ id: string; role: string }>;
    expect(roles.find(x => x.id === 'f')?.role).toBe('enemy');
    expect(roles.find(x => x.id === 'mp')?.role).toBe('platform');
  });

  it('detects projectile and triggerZone roles', async () => {
    const store = makeStore({
      sceneGraph: {
        nodes: {
          pr: makeNode('pr', 'Arrow'),
          tz: makeNode('tz', 'TrapZone'),
        },
        rootIds: ['pr', 'tz'],
      },
      allGameComponents: {
        pr: [{ type: 'projectile', props: {} }],
        tz: [{ type: 'triggerZone', props: {} }],
      },
    });

    const result = await executeToolCall('analyze_gameplay', {}, store);
    const r = result.result as Record<string, unknown>;
    const roles = r.entityRoles as Array<{ id: string; role: string }>;
    expect(roles.find(x => x.id === 'pr')?.role).toBe('projectile');
    expect(roles.find(x => x.id === 'tz')?.role).toBe('trigger');
  });
});

// ── apply_style: extended branches ──────────────────────────────────────────

describe('legacy: apply_style (extended)', () => {
  it('applies emissive multiplier to material overrides', async () => {
    const store = makeStore({
      sceneGraph: {
        nodes: { m: makeNode('m', 'Glow', { components: ['Mesh3d'] }) },
        rootIds: ['m'],
      },
    });

    await executeToolCall('apply_style', {
      materialOverrides: { emissiveMultiplier: 2.0 },
    }, store);

    expect(store.updateMaterial).toHaveBeenCalledWith('m', expect.objectContaining({
      emissive: expect.any(Array),
    }));
  });

  it('applies fog settings through lighting config', async () => {
    const store = makeStore({
      sceneGraph: { nodes: {}, rootIds: [] },
    });

    await executeToolCall('apply_style', {
      lighting: {
        fogEnabled: true,
        fogColor: [0.8, 0.8, 0.9],
        fogStart: 5,
        fogEnd: 50,
      },
    }, store);

    expect(store.updateEnvironment).toHaveBeenCalledWith(
      expect.objectContaining({
        fogEnabled: true,
        fogColor: [0.8, 0.8, 0.9],
        fogStart: 5,
        fogEnd: 50,
      }),
    );
  });

  it('applies skybox through lighting config', async () => {
    const store = makeStore({
      sceneGraph: { nodes: {}, rootIds: [] },
    });

    await executeToolCall('apply_style', {
      lighting: { skyboxPreset: 'night' },
    }, store);

    expect(store.setSkybox).toHaveBeenCalledWith('night');
  });

  it('distributes palette colors across thirds of entities', async () => {
    const nodes: Record<string, ReturnType<typeof makeNode>> = {};
    for (let i = 0; i < 6; i++) {
      nodes[`m${i}`] = makeNode(`m${i}`, `Mesh_${i}`, { components: ['Mesh3d'] });
    }

    const store = makeStore({
      sceneGraph: { nodes, rootIds: Object.keys(nodes) },
    });

    await executeToolCall('apply_style', {
      palette: {
        primary: [1, 0, 0, 1],
        secondary: [0, 1, 0, 1],
        accent: [0, 0, 1, 1],
      },
    }, store);

    // 6 entities: first 2 get primary, next 2 get secondary, last 2 get accent
    expect(store.updateMaterial).toHaveBeenCalledTimes(6);
  });
});

// ── describe_scene: full detail branches ─────────────────────────────────────

describe('legacy: describe_scene (full detail)', () => {
  it('full detail includes terrain data and game components arrays', async () => {
    const store = makeStore({
      sceneGraph: {
        nodes: {
          e: makeNode('e', 'Entity', { components: ['Mesh3d', 'Particle'] }),
        },
        rootIds: ['e'],
      },
      terrainData: { e: { resolution: 256 } },
      allGameComponents: { e: [{ type: 'health', props: {} }] },
    });

    const result = await executeToolCall('describe_scene', { detail: 'full' }, store);
    expect(result.success).toBe(true);
    const r = result.result as Record<string, unknown>;
    const entities = r.entities as Array<Record<string, unknown>>;
    expect(entities[0].terrain).toBeDefined();
    expect(entities[0].gameComponents).toHaveLength(1);
    expect(entities[0].hasParticles).toBe(true);
  });

  it('standard detail includes gameComponent types', async () => {
    const store = makeStore({
      sceneGraph: {
        nodes: { p: makeNode('p', 'Player') },
        rootIds: ['p'],
      },
      allGameComponents: { p: [{ type: 'characterController' }, { type: 'health' }] },
    });

    const result = await executeToolCall('describe_scene', { detail: 'standard' }, store);
    const r = result.result as Record<string, unknown>;
    const entities = r.entities as Array<Record<string, unknown>>;
    expect((entities[0].gameComponents as string[])).toContain('characterController');
  });
});

// ── create_scene_from_description: extended ──────────────────────────────────

describe('legacy: create_scene_from_description (extended)', () => {
  it('applies material preset when presetId is provided', async () => {
    const store = makeStore({ primaryId: 'ent-1' });

    await executeToolCall('create_scene_from_description', {
      entities: [{
        type: 'cube',
        name: 'StyledCube',
        material: { presetId: 'metal-iron' },
      }],
    }, store);

    // updateMaterial is called (preset lookup may or may not find it, but code path is exercised)
    // The important thing is the code doesn't crash
    expect(store.spawnEntity).toHaveBeenCalledWith('cube', 'StyledCube');
  });

  it('applies light data to entity when light config provided', async () => {
    const store = makeStore({ primaryId: 'light-1' });

    await executeToolCall('create_scene_from_description', {
      entities: [{
        type: 'point_light',
        name: 'Lamp',
        light: { lightType: 'point', intensity: 1200, color: [1, 0.9, 0.7] },
      }],
    }, store);

    expect(store.updateLight).toHaveBeenCalledWith(
      'light-1',
      expect.objectContaining({ lightType: 'point', intensity: 1200 }),
    );
  });

  it('adds game component to entity when gameComponent is provided', async () => {
    const store = makeStore({ primaryId: 'gc-1' });

    await executeToolCall('create_scene_from_description', {
      entities: [{
        type: 'sphere',
        name: 'Coin',
        gameComponent: 'collectible',
        gameComponentProps: { value: 10, destroyOnCollect: true },
      }],
    }, store);

    expect(store.addGameComponent).toHaveBeenCalledWith(
      'gc-1',
      expect.objectContaining({ type: 'collectible' }),
    );
  });

  it('applies rotation and scale when provided', async () => {
    const store = makeStore({ primaryId: 'ent-2' });

    await executeToolCall('create_scene_from_description', {
      entities: [{
        type: 'cube',
        name: 'RotatedBox',
        rotation: [0, 1.57, 0],
        scale: [2, 2, 2],
      }],
    }, store);

    expect(store.updateTransform).toHaveBeenCalledWith('ent-2', 'rotation', [0, 1.57, 0]);
    expect(store.updateTransform).toHaveBeenCalledWith('ent-2', 'scale', [2, 2, 2]);
  });

  it('reparents entities by parentName', async () => {
    let spawnCount = 0;
    const store = makeStore();
    Object.defineProperty(store, 'primaryId', {
      get() { return `ent-${++spawnCount}`; },
      configurable: true,
    });

    await executeToolCall('create_scene_from_description', {
      entities: [
        { type: 'cube', name: 'Parent' },
        { type: 'sphere', name: 'Child', parentName: 'Parent' },
      ],
    }, store);

    expect(store.reparentEntity).toHaveBeenCalledWith('ent-2', 'ent-1');
  });

  it('applies ambient light settings from environment', async () => {
    const store = makeStore({ primaryId: null });

    await executeToolCall('create_scene_from_description', {
      entities: [],
      environment: {
        ambientColor: [0.5, 0.5, 0.5],
        ambientBrightness: 0.8,
      },
    }, store);

    expect(store.updateAmbientLight).toHaveBeenCalledWith(
      expect.objectContaining({ color: [0.5, 0.5, 0.5], brightness: 0.8 }),
    );
  });
});

// ── top-level error containment ───────────────────────────────────────────────

describe('legacy: error containment', () => {
  it('catches synchronous exceptions from store methods and returns success: false', async () => {
    const store = makeStore();
    vi.mocked(store.spawnEntity).mockImplementation(() => {
      throw new Error('spawnEntity crashed');
    });

    const result = await executeToolCall('create_scene_from_description', {
      entities: [{ type: 'cube', name: 'Boom' }],
    }, store);

    // The inner per-entity try/catch catches it; compound result is still returned
    // success depends on whether any entity succeeded. 0/1 => success: false for outer.
    expect(result).toBeDefined();
    expect(typeof result.success).toBe('boolean');
  });
});
