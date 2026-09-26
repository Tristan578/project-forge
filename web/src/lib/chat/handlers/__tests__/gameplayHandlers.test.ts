/**
 * Tests for gameplayHandlers — game components, cameras, prefabs, export,
 * and material library commands.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invokeHandler, createMockStore } from './handlerTestUtils';
import { gameplayHandlers } from '../gameplayHandlers';
import { buildStoreComponent } from '@/lib/engine/gameComponentWire';

// ---------------------------------------------------------------------------
// Material preset mocks
// ---------------------------------------------------------------------------

const mockGetPresetsByCategory = vi.fn();
const mockSaveCustomMaterial = vi.fn();
const mockDeleteCustomMaterial = vi.fn();
const mockLoadCustomMaterials = vi.fn();

const FAKE_PRESETS = [
  { id: 'metal_brushed', name: 'Brushed Metal', category: 'metal', description: 'Brushed finish' },
  { id: 'wood_oak', name: 'Oak Wood', category: 'wood', description: 'Oak grain' },
];

vi.mock('@/lib/materialPresets', () => ({
  get MATERIAL_PRESETS() { return FAKE_PRESETS; },
  getPresetsByCategory: (...args: unknown[]) => mockGetPresetsByCategory(...args),
  saveCustomMaterial: (...args: unknown[]) => mockSaveCustomMaterial(...args),
  deleteCustomMaterial: (...args: unknown[]) => mockDeleteCustomMaterial(...args),
  loadCustomMaterials: (...args: unknown[]) => mockLoadCustomMaterials(...args),
}));

// ---------------------------------------------------------------------------
// Prefab store mock
// ---------------------------------------------------------------------------

const mockSavePrefab = vi.fn();
const mockGetPrefab = vi.fn();
const mockListAllPrefabs = vi.fn();
const mockGetPrefabsByCategory = vi.fn();
const mockDeletePrefab = vi.fn();

vi.mock('@/lib/prefabs/prefabStore', () => ({
  savePrefab: (...args: unknown[]) => mockSavePrefab(...args),
  getPrefab: (...args: unknown[]) => mockGetPrefab(...args),
  listAllPrefabs: (...args: unknown[]) => mockListAllPrefabs(...args),
  getPrefabsByCategory: (...args: unknown[]) => mockGetPrefabsByCategory(...args),
  deletePrefab: (...args: unknown[]) => mockDeletePrefab(...args),
}));

// ---------------------------------------------------------------------------
// Export engine mock
// ---------------------------------------------------------------------------

const mockExportGame = vi.fn();
const mockDownloadBlob = vi.fn();

vi.mock('@/lib/export/exportEngine', () => ({
  exportGame: (...args: unknown[]) => mockExportGame(...args),
  downloadBlob: (...args: unknown[]) => mockDownloadBlob(...args),
}));

// ---------------------------------------------------------------------------
// Reset before each test
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();

  mockGetPresetsByCategory.mockReturnValue([]);
  mockLoadCustomMaterials.mockReturnValue([]);
  mockSaveCustomMaterial.mockReturnValue({ id: 'custom_1', name: 'My Material' });
  mockListAllPrefabs.mockReturnValue([]);
  mockGetPrefabsByCategory.mockReturnValue([]);
  mockDeletePrefab.mockReturnValue(true);
  mockSavePrefab.mockReturnValue({ id: 'prefab_1', name: 'MyPrefab' });
  mockExportGame.mockResolvedValue(new Blob(['<html/>']));
});

// ===========================================================================
// add_game_component
// ===========================================================================

describe('add_game_component', () => {
  it('returns error when entityId is missing', async () => {
    const { result } = await invokeHandler(gameplayHandlers, 'add_game_component', {
      componentType: 'health',
    });
    expect(result.success).toBe(false);
  });

  it('returns error when componentType is missing', async () => {
    const { result } = await invokeHandler(gameplayHandlers, 'add_game_component', {
      entityId: 'ent-1',
    });
    expect(result.success).toBe(false);
  });

  it('returns error for unknown componentType', async () => {
    const { result } = await invokeHandler(gameplayHandlers, 'add_game_component', {
      entityId: 'ent-1',
      componentType: 'unknown_type',
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Unknown component type');
    expect(result.error).toContain('unknown_type');
  });

  it('adds character_controller with defaults', async () => {
    const { result, store } = await invokeHandler(gameplayHandlers, 'add_game_component', {
      entityId: 'ent-1',
      componentType: 'character_controller',
    });
    expect(result.success).toBe(true);
    expect(store.addGameComponent).toHaveBeenCalledTimes(1);
    const [entityId, comp] = (store.addGameComponent as ReturnType<typeof vi.fn>).mock.calls[0] as [string, { type: string; characterController: { speed: number } }];
    expect(entityId).toBe('ent-1');
    expect(comp.type).toBe('characterController');
    expect(comp.characterController.speed).toBe(5);
  });

  it('adds health component with custom maxHealth', async () => {
    const { result, store } = await invokeHandler(gameplayHandlers, 'add_game_component', {
      entityId: 'ent-2',
      componentType: 'health',
      properties: { maxHealth: 200 },
    });
    expect(result.success).toBe(true);
    const [, comp] = (store.addGameComponent as ReturnType<typeof vi.fn>).mock.calls[0] as [string, { health: { maxHp: number } }];
    expect(comp.health.maxHp).toBe(200);
  });

  it('adds collectible component', async () => {
    const { result, store } = await invokeHandler(gameplayHandlers, 'add_game_component', {
      entityId: 'ent-3',
      componentType: 'collectible',
      properties: { value: 5 },
    });
    expect(result.success).toBe(true);
    const [, comp] = (store.addGameComponent as ReturnType<typeof vi.fn>).mock.calls[0] as [string, { collectible: { value: number } }];
    expect(comp.collectible.value).toBe(5);
  });

  it('adds damage_zone component', async () => {
    const { result, store } = await invokeHandler(gameplayHandlers, 'add_game_component', {
      entityId: 'ent-4',
      componentType: 'damage_zone',
      properties: { damagePerSecond: 50 },
    });
    expect(result.success).toBe(true);
    const [, comp] = (store.addGameComponent as ReturnType<typeof vi.fn>).mock.calls[0] as [string, { damageZone: { damagePerSecond: number } }];
    expect(comp.damageZone.damagePerSecond).toBe(50);
  });

  it('adds checkpoint component', async () => {
    const { result, store } = await invokeHandler(gameplayHandlers, 'add_game_component', {
      entityId: 'ent-5',
      componentType: 'checkpoint',
    });
    expect(result.success).toBe(true);
    const [, comp] = (store.addGameComponent as ReturnType<typeof vi.fn>).mock.calls[0] as [string, { checkpoint: { autoSave: boolean } }];
    expect(comp.checkpoint.autoSave).toBe(true);
  });

  it('adds teleporter component', async () => {
    const { result, store } = await invokeHandler(gameplayHandlers, 'add_game_component', {
      entityId: 'ent-6',
      componentType: 'teleporter',
      properties: { cooldownSecs: 2 },
    });
    expect(result.success).toBe(true);
    const [, comp] = (store.addGameComponent as ReturnType<typeof vi.fn>).mock.calls[0] as [string, { teleporter: { cooldownSecs: number } }];
    expect(comp.teleporter.cooldownSecs).toBe(2);
  });

  it('adds moving_platform component', async () => {
    const { result, store } = await invokeHandler(gameplayHandlers, 'add_game_component', {
      entityId: 'ent-7',
      componentType: 'moving_platform',
    });
    expect(result.success).toBe(true);
    const [, comp] = (store.addGameComponent as ReturnType<typeof vi.fn>).mock.calls[0] as [string, { type: string }];
    expect(comp.type).toBe('movingPlatform');
  });

  it('adds trigger_zone component', async () => {
    const { result, store } = await invokeHandler(gameplayHandlers, 'add_game_component', {
      entityId: 'ent-8',
      componentType: 'trigger_zone',
      properties: { eventName: 'door_open' },
    });
    expect(result.success).toBe(true);
    const [, comp] = (store.addGameComponent as ReturnType<typeof vi.fn>).mock.calls[0] as [string, { triggerZone: { eventName: string } }];
    expect(comp.triggerZone.eventName).toBe('door_open');
  });

  it('adds spawner component', async () => {
    const { result, store } = await invokeHandler(gameplayHandlers, 'add_game_component', {
      entityId: 'ent-9',
      componentType: 'spawner',
    });
    expect(result.success).toBe(true);
    const [, comp] = (store.addGameComponent as ReturnType<typeof vi.fn>).mock.calls[0] as [string, { spawner: { intervalSecs: number } }];
    expect(comp.spawner.intervalSecs).toBe(3);
  });

  it('adds follower component', async () => {
    const { result, store } = await invokeHandler(gameplayHandlers, 'add_game_component', {
      entityId: 'ent-10',
      componentType: 'follower',
      properties: { speed: 5, stopDistance: 2 },
    });
    expect(result.success).toBe(true);
    const [, comp] = (store.addGameComponent as ReturnType<typeof vi.fn>).mock.calls[0] as [string, { follower: { speed: number; stopDistance: number } }];
    expect(comp.follower.speed).toBe(5);
    expect(comp.follower.stopDistance).toBe(2);
  });

  it('adds projectile component', async () => {
    const { result, store } = await invokeHandler(gameplayHandlers, 'add_game_component', {
      entityId: 'ent-11',
      componentType: 'projectile',
      properties: { damage: 25, speed: 20 },
    });
    expect(result.success).toBe(true);
    const [, comp] = (store.addGameComponent as ReturnType<typeof vi.fn>).mock.calls[0] as [string, { projectile: { damage: number; speed: number } }];
    expect(comp.projectile.damage).toBe(25);
    expect(comp.projectile.speed).toBe(20);
  });

  it('adds win_condition component', async () => {
    const { result, store } = await invokeHandler(gameplayHandlers, 'add_game_component', {
      entityId: 'ent-12',
      componentType: 'win_condition',
      properties: { conditionType: 'score', targetScore: 100 },
    });
    expect(result.success).toBe(true);
    const [, comp] = (store.addGameComponent as ReturnType<typeof vi.fn>).mock.calls[0] as [string, { winCondition: { targetScore: number } }];
    expect(comp.winCondition.targetScore).toBe(100);
  });

  it('result message includes componentType', async () => {
    const { result } = await invokeHandler(gameplayHandlers, 'add_game_component', {
      entityId: 'ent-1',
      componentType: 'health',
    });
    const data = result.result as { message: string };
    expect(data.message).toContain('health');
  });

  // PF-1148: the chat turn (and the MCP reply, which carries the same result)
  // reports what it changed from what was asked, in the author's terms.
  describe('reporting adjusted values', () => {
    const route = (n: number) => Array.from({ length: n }, (_, i) => [i, 0, 0]);

    it('returns the structured corrections and says them in the message', async () => {
      const { result } = await invokeHandler(gameplayHandlers, 'add_game_component', {
        entityId: 'ent-1',
        componentType: 'moving_platform',
        properties: { speed: 99999, waypoints: route(300) },
      });
      expect(result.success).toBe(true);
      const data = result.result as { message: string; corrections: unknown[] };
      expect(data.corrections).toEqual([
        { component: 'movingPlatform', field: 'speed', requested: 99999, applied: 1000, reason: 'clamped' },
        {
          component: 'movingPlatform', field: 'waypoints', requested: 300, applied: 64, reason: 'truncated', unit: 'points',
          appliedPoints: route(64),
        },
      ]);
      expect(data.message).toBe(
        'Added moving_platform. 2 values were adjusted to fit the engine’s limits: '
        + 'Moving Platform speed: you asked for 99999, it was capped at 1000. '
        + 'Moving Platform waypoints: you gave 300 points; only the first 64 points were kept, the most the engine supports.',
      );
    });

    it('hands the store the report captured at the first coercion', async () => {
      // The handler coerces BEFORE the store does, so a report taken at the store
      // would see an already-valid component and nothing to report.
      const { store } = await invokeHandler(gameplayHandlers, 'add_game_component', {
        entityId: 'ent-1',
        componentType: 'moving_platform',
        properties: { speed: 99999 },
      });
      const [entityId, comp, report] = (store.addGameComponent as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(entityId).toBe('ent-1');
      expect(comp).toEqual({
        type: 'movingPlatform',
        movingPlatform: { speed: 1000, waypoints: [[0, 0, 0], [0, 3, 0]], pauseDuration: 0.5, loopMode: 'pingPong' },
      });
      expect(report.corrections).toEqual([
        { component: 'movingPlatform', field: 'speed', requested: 99999, applied: 1000, reason: 'clamped' },
      ]);
      expect(report.supplied).toEqual(['speed']);
    });

    it('reports nothing, and says nothing about adjusting, when every value was used as given', async () => {
      const { result } = await invokeHandler(gameplayHandlers, 'add_game_component', {
        entityId: 'ent-1',
        componentType: 'moving_platform',
        properties: { speed: 6, waypoints: route(3), loopMode: 'once' },
      });
      const data = result.result as { message: string; corrections: unknown[] };
      expect(data.corrections).toEqual([]);
      expect(data.message).toBe('Added moving_platform');
    });

    it('reports nothing for a component added with no properties at all', async () => {
      const { result } = await invokeHandler(gameplayHandlers, 'add_game_component', {
        entityId: 'ent-1',
        componentType: 'health',
      });
      const data = result.result as { message: string; corrections: unknown[] };
      expect(data.corrections).toEqual([]);
      expect(data.message).toBe('Added health');
    });

    it('uses the singular for one adjusted value', async () => {
      const { result } = await invokeHandler(gameplayHandlers, 'add_game_component', {
        entityId: 'ent-1',
        componentType: 'spawner',
        properties: { maxCount: 2.6 },
      });
      expect((result.result as { message: string }).message).toBe(
        'Added spawner. 1 value was adjusted to fit the engine’s limits: '
        + 'Spawner max count: you asked for 2.6, it was rounded to the whole number 3.',
      );
    });
  });
});

// ===========================================================================
// update_game_component
// ===========================================================================

describe('update_game_component', () => {
  it('returns error for unknown componentType', async () => {
    const { result } = await invokeHandler(gameplayHandlers, 'update_game_component', {
      entityId: 'ent-1',
      componentType: 'not_a_type',
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Unknown component type');
  });

  // A six-point route, a non-default loop mode and a non-default pause: every
  // field an update that names only `speed` must leave alone (#10144).
  const platformRoute: [number, number, number][] = [[0, 0, 0], [2, 0, 0], [4, 1, 0], [6, 1, 0], [8, 2, 0], [10, 2, 0]];
  const platform = {
    type: 'movingPlatform' as const,
    movingPlatform: { waypoints: platformRoute, speed: 2, loopMode: 'once' as const, pauseDuration: 3 },
  };

  it('keeps every field the caller did not name (partial update, #10144)', async () => {
    const { result, store } = await invokeHandler(gameplayHandlers, 'update_game_component', {
      entityId: 'ent-1',
      componentType: 'moving_platform',
      properties: { speed: 5 },
    }, { allGameComponents: { 'ent-1': [platform] } });
    expect(result.success).toBe(true);
    expect(store.updateGameComponent).toHaveBeenCalledTimes(1);
    // The FULL component, so the engine's whole-replace receives the merged
    // values and not the defaults `expect.objectContaining` would hide.
    expect((store.updateGameComponent as ReturnType<typeof vi.fn>).mock.calls[0]).toEqual([
      'ent-1',
      {
        type: 'movingPlatform',
        movingPlatform: { waypoints: platformRoute, speed: 5, loopMode: 'once', pauseDuration: 3 },
      },
      // The report names what the caller WROTE: the carried fields are not
      // supplied, or a stale marker on the route would be cleared by a speed edit.
      expect.objectContaining({ corrections: [], supplied: ['speed'] }),
    ]);
  });

  it('merges onto the component of the named type, not a sibling on the same entity', async () => {
    const health = { type: 'health' as const, health: { maxHp: 250, currentHp: 40, invincibilitySecs: 2, respawnOnDeath: false, respawnPoint: [1, 2, 3] as [number, number, number], despawnOnDeath: false } };
    const { result, store } = await invokeHandler(gameplayHandlers, 'update_game_component', {
      entityId: 'ent-1',
      componentType: 'health',
      properties: { maxHp: 300 },
    }, { allGameComponents: { 'ent-1': [platform, health] } });
    expect(result.success).toBe(true);
    expect((store.updateGameComponent as ReturnType<typeof vi.fn>).mock.calls[0]).toEqual([
      'ent-1',
      { type: 'health', health: { ...health.health, maxHp: 300 } },
      expect.objectContaining({ corrections: [], supplied: ['maxHp'] }),
    ]);
  });

  it('reports a missing component instead of success', async () => {
    const { result, store } = await invokeHandler(gameplayHandlers, 'update_game_component', {
      entityId: 'ent-1',
      componentType: 'moving_platform',
      properties: { speed: 5 },
    }, { allGameComponents: { 'ent-1': [{ type: 'health', health: { maxHp: 100, currentHp: 100, invincibilitySecs: 0.5, respawnOnDeath: true, respawnPoint: [0, 1, 0], despawnOnDeath: true } }] } });
    expect(result.success).toBe(false);
    expect(result.error).toContain('has no moving_platform component');
    expect(result.error).toContain('add_game_component');
    expect(store.updateGameComponent).not.toHaveBeenCalled();
  });

  it('does not treat a prototype key as a stored entity', async () => {
    const { result, store } = await invokeHandler(gameplayHandlers, 'update_game_component', {
      entityId: 'constructor',
      componentType: 'health',
      properties: { maxHp: 5 },
    });
    expect(result.success).toBe(false);
    expect(store.updateGameComponent).not.toHaveBeenCalled();
  });

  // A stored projectile for the two report cases: an update is a partial write
  // onto a component that exists (#10144).
  const projectile = buildStoreComponent('projectile', {});
  if (!projectile) throw new Error('fixture: projectile did not build');

  it('reports the values it adjusted and hands the store the same report', async () => {
    const { result, store } = await invokeHandler(gameplayHandlers, 'update_game_component', {
      entityId: 'ent-1',
      componentType: 'projectile',
      properties: { speed: 50_000, damage: 25 },
    }, { allGameComponents: { 'ent-1': [projectile] } });
    expect(result.success).toBe(true);
    const data = result.result as { message: string; corrections: unknown[] };
    const expected = [
      { component: 'projectile', field: 'speed', requested: 50_000, applied: 10_000, reason: 'clamped' },
    ];
    expect(data.corrections).toEqual(expected);
    expect(data.message).toBe(
      'Updated projectile. 1 value was adjusted to fit the engine’s limits: '
      + 'Projectile speed: you asked for 50000, it was capped at 10000.',
    );
    const [, , report] = (store.updateGameComponent as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(report.corrections).toEqual(expected);
    expect([...report.supplied].sort()).toEqual(['damage', 'speed']);
  });

  it('reports nothing when the update is in range', async () => {
    const { result } = await invokeHandler(gameplayHandlers, 'update_game_component', {
      entityId: 'ent-1',
      componentType: 'projectile',
      properties: { speed: 40, damage: 25 },
    }, { allGameComponents: { 'ent-1': [projectile] } });
    expect(result.result).toEqual({ message: 'Updated projectile', corrections: [] });
  });
});

// ===========================================================================
// remove_game_component
// ===========================================================================

describe('remove_game_component', () => {
  it('returns error when entityId is missing', async () => {
    const { result } = await invokeHandler(gameplayHandlers, 'remove_game_component', {
      componentName: 'health',
    });
    expect(result.success).toBe(false);
  });

  it('returns error when componentName is missing', async () => {
    const { result } = await invokeHandler(gameplayHandlers, 'remove_game_component', {
      entityId: 'ent-1',
    });
    expect(result.success).toBe(false);
  });

  it('calls store.removeGameComponent with correct args', async () => {
    const { result, store } = await invokeHandler(gameplayHandlers, 'remove_game_component', {
      entityId: 'ent-1',
      componentName: 'health',
    });
    expect(result.success).toBe(true);
    expect(store.removeGameComponent).toHaveBeenCalledWith('ent-1', 'health');
  });
});

// ===========================================================================
// get_game_components
// ===========================================================================

describe('get_game_components', () => {
  it('returns empty array when entity has no components', async () => {
    const { result } = await invokeHandler(gameplayHandlers, 'get_game_components', {
      entityId: 'ent-1',
    });
    expect(result.success).toBe(true);
    const data = result.result as { components: unknown[]; count: number };
    expect(data.components).toEqual([]);
    expect(data.count).toBe(0);
  });

  it('returns components registered in store', async () => {
    const components = [{ type: 'health' }, { type: 'collectible' }];
    const { result } = await invokeHandler(gameplayHandlers, 'get_game_components', {
      entityId: 'ent-1',
    }, { allGameComponents: { 'ent-1': components as unknown[] } });
    expect(result.success).toBe(true);
    const data = result.result as { components: unknown[]; count: number };
    expect(data.components).toHaveLength(2);
    expect(data.count).toBe(2);
  });

  it('does not expose inherited components, while preserving an own prototype-named entity', async () => {
    const components = [{ type: 'health' }];
    const inherited = await invokeHandler(gameplayHandlers, 'get_game_components', {
      entityId: 'toString',
    }, { allGameComponents: Object.create({ toString: components }) });
    expect(inherited.result).toEqual({ success: true, result: { components: [], count: 0 } });
    expect(inherited.dispatchCommand).not.toHaveBeenCalled();
    expect(inherited.store.addGameComponent).not.toHaveBeenCalled();

    const own = await invokeHandler(gameplayHandlers, 'get_game_components', {
      entityId: 'toString',
    }, { allGameComponents: { toString: components } });
    expect(own.result).toEqual({ success: true, result: { components, count: 1 } });
  });
});

// ===========================================================================
// save_as_prefab
// ===========================================================================

describe('save_as_prefab', () => {
  it('does not serialize inherited scene or audio records, while preserving own records', async () => {
    const audio = { volume: 0.75 };
    const lightNode = { components: ['PointLight'] };
    const inherited = await invokeHandler(gameplayHandlers, 'save_as_prefab', {
      entityId: 'ghost', name: 'Ghost prefab',
    }, {
      sceneGraph: { nodes: Object.create({ ghost: lightNode }), rootIds: [] },
      entityAudio: Object.create({ ghost: audio }),
      primaryLight: { lightType: 'point' },
    });
    expect(inherited.result.success).toBe(true);
    expect(mockSavePrefab).toHaveBeenCalledWith('Ghost prefab', 'uncategorized', '', expect.objectContaining({
      entityType: 'cube', audio: undefined,
    }));
    expect(inherited.dispatchCommand).not.toHaveBeenCalled();
    expect(inherited.store.updateMaterial).not.toHaveBeenCalled();

    mockSavePrefab.mockClear();
    const own = await invokeHandler(gameplayHandlers, 'save_as_prefab', {
      entityId: 'ghost', name: 'Own prefab',
    }, {
      sceneGraph: { nodes: { ghost: lightNode }, rootIds: [] },
      entityAudio: { ghost: audio },
      primaryLight: { lightType: 'point' },
    });
    expect(own.result.success).toBe(true);
    expect(mockSavePrefab).toHaveBeenCalledWith('Own prefab', 'uncategorized', '', expect.objectContaining({
      entityType: 'point_light', audio,
    }));
  });
});

// ===========================================================================
// list_game_component_types
// ===========================================================================

describe('list_game_component_types', () => {
  it('returns success with all 13 component types', async () => {
    const { result } = await invokeHandler(gameplayHandlers, 'list_game_component_types', {});
    expect(result.success).toBe(true);
    const data = result.result as { types: Array<{ name: string; description: string }> };
    expect(data.types).toHaveLength(13);
  });

  it('lists dialogue_trigger, which the hand-written list used to omit', async () => {
    const { result } = await invokeHandler(gameplayHandlers, 'list_game_component_types', {});
    const data = result.result as { types: Array<{ name: string; description: string }> };
    expect(data.types.map((t) => t.name)).toContain('dialogue_trigger');
  });

  it('every type entry has name and description', async () => {
    const { result } = await invokeHandler(gameplayHandlers, 'list_game_component_types', {});
    const data = result.result as { types: Array<{ name: string; description: string }> };
    for (const t of data.types) {
      expect(t.name).not.toBe('');
      expect(t.description).not.toBe('');
    }
  });
});

// ===========================================================================
// set_game_camera
// ===========================================================================

describe('set_game_camera', () => {
  it('returns error when entityId is missing', async () => {
    const { result } = await invokeHandler(gameplayHandlers, 'set_game_camera', {
      mode: 'thirdPersonFollow',
    });
    expect(result.success).toBe(false);
  });

  it('returns error when mode is invalid', async () => {
    const { result } = await invokeHandler(gameplayHandlers, 'set_game_camera', {
      entityId: 'cam-1',
      mode: 'invalidMode',
    });
    expect(result.success).toBe(false);
  });

  // A validation error, not a silent drop: the engine HARD-REJECTS a negative
  // follow rate, and `set_game_camera` is full-replace, so passing one through
  // would lose mode/targetEntity/offset with it. Rejecting here names the field
  // for the model instead of leaving it to guess why nothing moved (PF-1166).
  it('rejects a negative followSmoothing instead of dispatching it', async () => {
    const { result, store } = await invokeHandler(gameplayHandlers, 'set_game_camera', {
      entityId: 'cam-1',
      mode: 'thirdPersonFollow',
      followSmoothing: -3,
    });
    expect(result.success).toBe(false);
    expect(store.setGameCamera).not.toHaveBeenCalled();
  });

  it('accepts a followSmoothing of zero, which freezes the camera on purpose', async () => {
    const { result, store } = await invokeHandler(gameplayHandlers, 'set_game_camera', {
      entityId: 'cam-1',
      mode: 'thirdPersonFollow',
      followSmoothing: 0,
    });
    expect(result.success).toBe(true);
    expect(store.setGameCamera).toHaveBeenCalledWith('cam-1', {
      mode: 'thirdPersonFollow',
      targetEntity: null,
      followSmoothing: 0,
    });
  });

  // The store object is asserted in FULL (an object literal, not
  // `expect.objectContaining`): a key the AI invented and this handler passed
  // through would sit invisibly alongside a partial assertion, then be dropped
  // by the engine with no error — the exact failure this handler was fixed for.

  it('sets third-person camera with defaults', async () => {
    const { result, store } = await invokeHandler(gameplayHandlers, 'set_game_camera', {
      entityId: 'cam-1',
      mode: 'thirdPersonFollow',
    });
    expect(result.success).toBe(true);
    expect(store.setGameCamera).toHaveBeenCalledTimes(1);
    expect(store.setGameCamera).toHaveBeenCalledWith('cam-1', {
      mode: 'thirdPersonFollow',
      targetEntity: null,
    });
  });

  it('passes targetEntity when provided', async () => {
    const { store } = await invokeHandler(gameplayHandlers, 'set_game_camera', {
      entityId: 'cam-1',
      mode: 'thirdPersonFollow',
      targetEntity: 'player-1',
    });
    expect(store.setGameCamera).toHaveBeenCalledWith('cam-1', {
      mode: 'thirdPersonFollow',
      targetEntity: 'player-1',
    });
  });

  // `set_game_camera` is an UPDATE verb on an existing camera, so it must not
  // discard engine-owned wire params it has no vocabulary for. Dropping them
  // silently reverts those params to `from_flat`'s defaults, and because
  // `GameCameraData` is persisted in `EntitySnapshot` and scene export, the
  // loss is written into the `.forge` file. Chat is the primary authoring
  // surface here, so this is the likelier of the two paths (the inspector's
  // is already covered).
  it('carries engineParams forward when updating an existing camera', async () => {
    const { store } = await invokeHandler(gameplayHandlers, 'set_game_camera', {
      entityId: 'cam-1',
      mode: 'firstPerson',
      firstPersonHeight: 1.8,
    }, {
      allGameCameras: {
        'cam-1': {
          mode: 'firstPerson',
          targetEntity: null,
          engineParams: { fov: 100, near: 0.05 },
        },
      },
    });
    expect(store.setGameCamera).toHaveBeenCalledWith('cam-1', {
      mode: 'firstPerson',
      targetEntity: null,
      firstPersonHeight: 1.8,
      engineParams: { fov: 100, near: 0.05 },
    });
  });

  // The follow target is the one field whose loss stops the camera moving at
  // all: five of the six modes are inert without it, and the engine skips its
  // whole update arm when `target_entity` is `None`. An LLM asked to "raise the
  // camera" restates only the height, so without carry-forward the camera
  // detaches from the player and the running game shows a motionless camera.
  it('keeps the existing follow target when the update does not restate it', async () => {
    const { store } = await invokeHandler(gameplayHandlers, 'set_game_camera', {
      entityId: 'cam-1',
      mode: 'thirdPersonFollow',
      followHeight: 4,
    }, {
      allGameCameras: {
        'cam-1': {
          mode: 'thirdPersonFollow',
          targetEntity: 'player-1',
        },
      },
    });
    expect(store.setGameCamera).toHaveBeenCalledWith('cam-1', {
      mode: 'thirdPersonFollow',
      targetEntity: 'player-1',
      followHeight: 4,
    });
  });

  it('lets an explicit targetEntity override the existing one', async () => {
    const { store } = await invokeHandler(gameplayHandlers, 'set_game_camera', {
      entityId: 'cam-1',
      mode: 'thirdPersonFollow',
      targetEntity: 'boss-1',
    }, {
      allGameCameras: {
        'cam-1': { mode: 'thirdPersonFollow', targetEntity: 'player-1' },
      },
    });
    expect(store.setGameCamera).toHaveBeenCalledWith('cam-1', {
      mode: 'thirdPersonFollow',
      targetEntity: 'boss-1',
    });
  });

  // `''` is truthy-but-unresolvable to every consumer, which is why
  // `parseGameCameraWire` normalizes it back to `null` on the way in. Rejecting
  // it here keeps it out of the store rather than letting it detach the camera.
  it('rejects an empty targetEntity rather than storing it', async () => {
    const { result, store } = await invokeHandler(gameplayHandlers, 'set_game_camera', {
      entityId: 'cam-1',
      mode: 'thirdPersonFollow',
      targetEntity: '',
    });
    expect(result.success).toBe(false);
    expect(store.setGameCamera).not.toHaveBeenCalled();
  });

  it('omits engineParams when the entity has no existing camera', async () => {
    const { store } = await invokeHandler(gameplayHandlers, 'set_game_camera', {
      entityId: 'cam-new',
      mode: 'topDown',
    });
    expect(store.setGameCamera).toHaveBeenCalledWith('cam-new', {
      mode: 'topDown',
      targetEntity: null,
    });
  });

  // `entityId` is LLM-chosen, so an inherited `Object.prototype` key must not
  // be mistaken for a stored camera and have its properties read off.
  it('does not read engineParams off Object.prototype for a prototype-chain entityId', async () => {
    const { store } = await invokeHandler(gameplayHandlers, 'set_game_camera', {
      entityId: 'constructor',
      mode: 'topDown',
    });
    expect(store.setGameCamera).toHaveBeenCalledWith('constructor', {
      mode: 'topDown',
      targetEntity: null,
    });
  });

  // The authoring numerics need the same carry-forward as `engineParams` above,
  // for the same reason: this verb replaces the whole `GameCameraData`, so a field
  // the caller left out came back as the engine's default. `followOffsetX` makes
  // it concrete — no schema key and no inspector control can restate it, so
  // dropping it here is the only outcome and it is permanent.
  it('carries existing authoring parameters forward, and explicit arguments win', async () => {
    const { store } = await invokeHandler(gameplayHandlers, 'set_game_camera', {
      entityId: 'cam-1',
      mode: 'thirdPersonFollow',
      followHeight: 4,
    }, {
      allGameCameras: {
        'cam-1': {
          mode: 'thirdPersonFollow',
          targetEntity: null,
          followDistance: 8,
          followHeight: 3,
          followOffsetX: 1.5,
          followSmoothing: 6,
        },
      },
    });
    expect(store.setGameCamera).toHaveBeenCalledWith('cam-1', {
      mode: 'thirdPersonFollow',
      targetEntity: null,
      followDistance: 8,
      // The one field this call names is the one field that changes.
      followHeight: 4,
      followOffsetX: 1.5,
      followSmoothing: 6,
    });
  });

  it('ignores a non-finite stored parameter rather than carrying NaN into the engine', async () => {
    const { store } = await invokeHandler(gameplayHandlers, 'set_game_camera', {
      entityId: 'cam-1',
      mode: 'thirdPersonFollow',
    }, {
      allGameCameras: {
        'cam-1': {
          mode: 'thirdPersonFollow',
          targetEntity: null,
          followDistance: Number.NaN,
          followHeight: 3,
        },
      },
    });
    expect(store.setGameCamera).toHaveBeenCalledWith('cam-1', {
      mode: 'thirdPersonFollow',
      targetEntity: null,
      followHeight: 3,
    });
  });

  it('forwards every supported authoring parameter', async () => {
    const { store } = await invokeHandler(gameplayHandlers, 'set_game_camera', {
      entityId: 'cam-1',
      mode: 'thirdPersonFollow',
      targetEntity: 'player-1',
      followDistance: 8,
      followHeight: 3,
      followSmoothing: 4,
      firstPersonHeight: 1.8,
      firstPersonMouseSensitivity: 0.2,
      sideScrollerDistance: 12,
      topDownHeight: 25,
      orbitalDistance: 9,
      orbitalAutoRotateSpeed: 15,
    });
    expect(store.setGameCamera).toHaveBeenCalledWith('cam-1', {
      mode: 'thirdPersonFollow',
      targetEntity: 'player-1',
      followDistance: 8,
      followHeight: 3,
      followSmoothing: 4,
      firstPersonHeight: 1.8,
      firstPersonMouseSensitivity: 0.2,
      sideScrollerDistance: 12,
      topDownHeight: 25,
      orbitalDistance: 9,
      orbitalAutoRotateSpeed: 15,
    });
  });

  it('drops parameters no engine camera variant has', async () => {
    // `followLookAhead`, `sideScrollerHeight` and `topDownAngle` were advertised
    // to the model by this handler's own schema but exist in no engine variant.
    const { result, store } = await invokeHandler(gameplayHandlers, 'set_game_camera', {
      entityId: 'cam-1',
      mode: 'topDown',
      topDownHeight: 20,
      followLookAhead: 2,
      sideScrollerHeight: 6,
      topDownAngle: 45,
    });
    expect(result.success).toBe(true);
    expect(store.setGameCamera).toHaveBeenCalledWith('cam-1', {
      mode: 'topDown',
      targetEntity: null,
      topDownHeight: 20,
    });
  });

  it('result message includes mode and entityId', async () => {
    const { result } = await invokeHandler(gameplayHandlers, 'set_game_camera', {
      entityId: 'cam-1',
      mode: 'firstPerson',
    });
    const data = result.result as { message: string };
    expect(data.message).toContain('firstPerson');
    expect(data.message).toContain('cam-1');
  });

  it('all valid camera modes are accepted', async () => {
    const modes = ['thirdPersonFollow', 'firstPerson', 'sideScroller', 'topDown', 'fixed', 'orbital'];
    for (const mode of modes) {
      const { result } = await invokeHandler(gameplayHandlers, 'set_game_camera', {
        entityId: 'cam-1',
        mode,
      });
      expect(result.success).toBe(true);
    }
  });
});

// ===========================================================================
// set_active_game_camera
// ===========================================================================

describe('set_active_game_camera', () => {
  it('returns error when entityId is missing', async () => {
    const { result } = await invokeHandler(gameplayHandlers, 'set_active_game_camera', {});
    expect(result.success).toBe(false);
  });

  it('calls store.setActiveGameCamera', async () => {
    const { result, store } = await invokeHandler(gameplayHandlers, 'set_active_game_camera', {
      entityId: 'cam-1',
    });
    expect(result.success).toBe(true);
    expect(store.setActiveGameCamera).toHaveBeenCalledWith('cam-1');
  });
});

// ===========================================================================
// camera_shake
// ===========================================================================

describe('camera_shake', () => {
  it('returns error when entityId is missing', async () => {
    const { result } = await invokeHandler(gameplayHandlers, 'camera_shake', {
      intensity: 1.0,
      duration: 0.5,
    });
    expect(result.success).toBe(false);
  });

  it('returns error when intensity is missing', async () => {
    const { result } = await invokeHandler(gameplayHandlers, 'camera_shake', {
      entityId: 'cam-1',
      duration: 0.5,
    });
    expect(result.success).toBe(false);
  });

  it('calls store.cameraShake with correct args', async () => {
    const { result, store } = await invokeHandler(gameplayHandlers, 'camera_shake', {
      entityId: 'cam-1',
      intensity: 2.0,
      duration: 0.3,
    });
    expect(result.success).toBe(true);
    expect(store.cameraShake).toHaveBeenCalledWith('cam-1', 2.0, 0.3);
  });

  it('result message includes intensity and duration', async () => {
    const { result } = await invokeHandler(gameplayHandlers, 'camera_shake', {
      entityId: 'cam-1',
      intensity: 1.5,
      duration: 0.4,
    });
    const data = result.result as { message: string };
    expect(data.message).toContain('1.5');
    expect(data.message).toContain('0.4');
  });
});

// ===========================================================================
// get_game_camera
// ===========================================================================

describe('get_game_camera', () => {
  it('returns null camera when entity has no camera', async () => {
    const { result } = await invokeHandler(gameplayHandlers, 'get_game_camera', {
      entityId: 'ent-1',
    });
    expect(result.success).toBe(true);
    const data = result.result as { camera: null; isActive: boolean };
    expect(data.camera).toBeNull();
  });

  it('returns camera data and isActive=true when entity is active camera', async () => {
    const camData = { mode: 'thirdPersonFollow', targetEntity: 'player' };
    const { result } = await invokeHandler(gameplayHandlers, 'get_game_camera', {
      entityId: 'cam-1',
    }, {
      allGameCameras: { 'cam-1': camData },
      activeGameCameraId: 'cam-1',
    });
    expect(result.success).toBe(true);
    const data = result.result as { camera: unknown; isActive: boolean };
    expect(data.camera).toEqual(camData);
    expect(data.isActive).toBe(true);
  });

  it('returns isActive=false when entity is not active camera', async () => {
    const { result } = await invokeHandler(gameplayHandlers, 'get_game_camera', {
      entityId: 'cam-1',
    }, { activeGameCameraId: 'cam-other' });
    const data = result.result as { isActive: boolean };
    expect(data.isActive).toBe(false);
  });

  // `entityId` is model-chosen and `zEntityId` is `z.string().min(1)`, so any
  // `Object.prototype` key reaches the lookup. A bare `allGameCameras[entityId]`
  // returns the inherited FUNCTION for these, and the handler would report it as
  // the entity's camera. The other cases in this block use ids that miss as own
  // keys AND miss on the prototype, so they pass with or without the guard —
  // this is the one that distinguishes them.
  it.each(['constructor', 'toString', '__proto__', 'hasOwnProperty'])(
    'reports no camera for the inherited key %s',
    async (entityId) => {
      const { result } = await invokeHandler(gameplayHandlers, 'get_game_camera', { entityId });
      expect(result.success).toBe(true);
      expect(result.result).toEqual({ camera: null, isActive: false });
    },
  );
});

// ===========================================================================
// list_prefabs
// ===========================================================================

describe('list_prefabs', () => {
  it('returns all prefabs when no category specified', async () => {
    const prefabs = [
      { id: 'p1', name: 'Box', category: 'props', description: 'A box' },
      { id: 'p2', name: 'Tree', category: 'nature', description: 'A tree' },
    ];
    mockListAllPrefabs.mockReturnValue(prefabs);
    const { result } = await invokeHandler(gameplayHandlers, 'list_prefabs', {});
    expect(result.success).toBe(true);
    const data = result.result as { prefabs: Array<{ id: string }> };
    expect(data.prefabs).toHaveLength(2);
    expect(mockListAllPrefabs).toHaveBeenCalledTimes(1);
    expect(mockGetPrefabsByCategory).not.toHaveBeenCalled();
  });

  it('filters by category when provided', async () => {
    const prefabs = [{ id: 'p1', name: 'Oak', category: 'nature', description: 'An oak' }];
    mockGetPrefabsByCategory.mockReturnValue(prefabs);
    const { result } = await invokeHandler(gameplayHandlers, 'list_prefabs', { category: 'nature' });
    expect(result.success).toBe(true);
    expect(mockGetPrefabsByCategory).toHaveBeenCalledWith('nature');
    expect(mockListAllPrefabs).not.toHaveBeenCalled();
  });

  it('prefab entries include id, name, category, description only', async () => {
    mockListAllPrefabs.mockReturnValue([
      { id: 'p1', name: 'Box', category: 'props', description: 'A box', snapshot: { secret: true } },
    ]);
    const { result } = await invokeHandler(gameplayHandlers, 'list_prefabs', {});
    const data = result.result as { prefabs: Array<Record<string, unknown>> };
    expect(Object.keys(data.prefabs[0])).toEqual(['id', 'name', 'category', 'description']);
  });
});

// ===========================================================================
// delete_prefab
// ===========================================================================

describe('delete_prefab', () => {
  it('returns error when prefabId is missing', async () => {
    const { result } = await invokeHandler(gameplayHandlers, 'delete_prefab', {});
    expect(result.success).toBe(false);
  });

  it('returns success when prefab is deleted', async () => {
    mockDeletePrefab.mockReturnValue(true);
    const { result } = await invokeHandler(gameplayHandlers, 'delete_prefab', { prefabId: 'p1' });
    expect(result.success).toBe(true);
    const data = result.result as { message: string };
    expect(data.message).toBe('Prefab deleted');
  });

  it('returns error when prefab not found', async () => {
    mockDeletePrefab.mockReturnValue(false);
    const { result } = await invokeHandler(gameplayHandlers, 'delete_prefab', { prefabId: 'nope' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('Prefab not found');
  });
});

// ===========================================================================
// get_prefab
// ===========================================================================

describe('get_prefab', () => {
  it('returns prefab data when found', async () => {
    const prefab = { id: 'p1', name: 'Box', category: 'props', snapshot: {} };
    mockGetPrefab.mockReturnValue(prefab);
    const { result } = await invokeHandler(gameplayHandlers, 'get_prefab', { prefabId: 'p1' });
    expect(result.success).toBe(true);
    expect(result.result).toEqual(prefab);
  });

  it('returns error when prefab not found', async () => {
    mockGetPrefab.mockReturnValue(null);
    const { result } = await invokeHandler(gameplayHandlers, 'get_prefab', { prefabId: 'nope' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('Prefab not found');
  });
});

// ===========================================================================
// get_export_status
// ===========================================================================

describe('get_export_status', () => {
  it('returns current export status and engine mode', async () => {
    const { result } = await invokeHandler(gameplayHandlers, 'get_export_status', {}, {
      isExporting: false,
      engineMode: 'edit',
    });
    expect(result.success).toBe(true);
    const data = result.result as { isExporting: boolean; engineMode: string };
    expect(data.isExporting).toBe(false);
    expect(data.engineMode).toBe('edit');
  });

  it('returns isExporting=true when store is exporting', async () => {
    const { result } = await invokeHandler(gameplayHandlers, 'get_export_status', {}, {
      isExporting: true,
      engineMode: 'edit',
    });
    const data = result.result as { isExporting: boolean };
    expect(data.isExporting).toBe(true);
  });
});

// ===========================================================================
// export_game
// ===========================================================================

describe('export_game', () => {
  it('exports with defaults and calls setExporting', async () => {
    const { result, store } = await invokeHandler(gameplayHandlers, 'export_game', {}, {
      sceneName: 'MyGame',
    });
    expect(result.success).toBe(true);
    expect(mockExportGame).toHaveBeenCalledTimes(1);
    expect(store.setExporting).toHaveBeenCalledWith(true);
    expect(store.setExporting).toHaveBeenCalledWith(false);
  });

  it('uses custom title when provided', async () => {
    await invokeHandler(gameplayHandlers, 'export_game', { title: 'MyAwesomeGame' }, {
      sceneName: 'DefaultName',
    });
    const [opts] = mockExportGame.mock.calls[0] as [{ title: string }];
    expect(opts.title).toBe('MyAwesomeGame');
  });

  it('falls back to sceneName when title not provided', async () => {
    await invokeHandler(gameplayHandlers, 'export_game', {}, {
      sceneName: 'FallbackScene',
    });
    const [opts] = mockExportGame.mock.calls[0] as [{ title: string }];
    expect(opts.title).toBe('FallbackScene');
  });

  it('uses single-html mode by default', async () => {
    await invokeHandler(gameplayHandlers, 'export_game', {}, { sceneName: 'Game' });
    const [opts] = mockExportGame.mock.calls[0] as [{ mode: string }];
    expect(opts.mode).toBe('single-html');
  });

  it('accepts zip mode', async () => {
    await invokeHandler(gameplayHandlers, 'export_game', { mode: 'zip' }, { sceneName: 'Game' });
    const [opts] = mockExportGame.mock.calls[0] as [{ mode: string }];
    expect(opts.mode).toBe('zip');
  });

  it('calls downloadBlob after successful export', async () => {
    await invokeHandler(gameplayHandlers, 'export_game', { title: 'TestGame' }, { sceneName: 'G' });
    expect(mockDownloadBlob).toHaveBeenCalledTimes(1);
    const [, filename] = mockDownloadBlob.mock.calls[0] as [Blob, string];
    expect(filename).toBe('TestGame.html');
  });

  // exportGame returns a zip archive in zip mode, so the download and the name
  // reported back to the chat must say .zip, not .html.
  it('names a zip-mode export .zip, in the download and in the result', async () => {
    const { result } = await invokeHandler(gameplayHandlers, 'export_game', { title: 'TestGame', mode: 'zip' }, { sceneName: 'G' });
    const [, filename] = mockDownloadBlob.mock.calls[0] as [Blob, string];
    expect(filename).toBe('TestGame.zip');
    expect((result.result as { filename: string }).filename).toBe('TestGame.zip');
  });

  it('resets isExporting=false even on export failure', async () => {
    mockExportGame.mockRejectedValue(new Error('Export failed'));
    const store = createMockStore({ sceneName: 'G' });
    try {
      await gameplayHandlers.export_game({}, { store, dispatchCommand: vi.fn() });
    } catch {
      // expected to throw
    }
    // setExporting(true) called at start, setExporting(false) called in finally
    expect(store.setExporting).toHaveBeenCalledWith(true);
    expect(store.setExporting).toHaveBeenCalledWith(false);
  });
});

// ===========================================================================
// list_material_presets
// ===========================================================================

describe('list_material_presets', () => {
  it('returns all presets when no category given', async () => {
    const { result } = await invokeHandler(gameplayHandlers, 'list_material_presets', {});
    expect(result.success).toBe(true);
    const presets = result.result as Array<{ id: string }>;
    expect(presets).toHaveLength(FAKE_PRESETS.length);
    expect(mockGetPresetsByCategory).not.toHaveBeenCalled();
  });

  it('filters by category when provided', async () => {
    const metalPreset = [{ id: 'metal_brushed', name: 'Brushed Metal', category: 'metal', description: 'x' }];
    mockGetPresetsByCategory.mockReturnValue(metalPreset);
    const { result } = await invokeHandler(gameplayHandlers, 'list_material_presets', {
      category: 'metal',
    });
    expect(result.success).toBe(true);
    expect(mockGetPresetsByCategory).toHaveBeenCalledWith('metal');
    const presets = result.result as Array<{ id: string }>;
    expect(presets).toHaveLength(1);
  });

  it('preset entries expose id, name, category, description', async () => {
    const { result } = await invokeHandler(gameplayHandlers, 'list_material_presets', {});
    const presets = result.result as Array<Record<string, unknown>>;
    expect(Object.keys(presets[0])).toEqual(['id', 'name', 'category', 'description']);
  });
});

// ===========================================================================
// save_material_to_library
// ===========================================================================

describe('save_material_to_library', () => {
  it('returns error when name is missing', async () => {
    const { result } = await invokeHandler(gameplayHandlers, 'save_material_to_library', {});
    expect(result.success).toBe(false);
  });

  it('returns error when no entity is selected and no entityId given', async () => {
    const { result } = await invokeHandler(
      gameplayHandlers,
      'save_material_to_library',
      { name: 'My Material' },
      { primaryId: null },
    );
    expect(result.success).toBe(false);
    expect(result.error).toBe('No entity selected');
  });

  it('returns error when selected entity has no material', async () => {
    const { result } = await invokeHandler(
      gameplayHandlers,
      'save_material_to_library',
      { name: 'My Material' },
      { primaryId: 'ent-1', primaryMaterial: null },
    );
    expect(result.success).toBe(false);
    expect(result.error).toBe('Selected entity has no material');
  });

  it('saves material and returns id and name', async () => {
    const mat = { baseColor: [1, 0, 0, 1] };
    mockSaveCustomMaterial.mockReturnValue({ id: 'custom_red', name: 'Red Material' });
    const { result } = await invokeHandler(
      gameplayHandlers,
      'save_material_to_library',
      { name: 'Red Material' },
      { primaryId: 'ent-1', primaryMaterial: mat },
    );
    expect(result.success).toBe(true);
    const data = result.result as { id: string; name: string };
    expect(data.id).toBe('custom_red');
    expect(data.name).toBe('Red Material');
    expect(mockSaveCustomMaterial).toHaveBeenCalledWith('Red Material', mat);
  });

  it('treats a blank entityId from the model as not given and saves the selected entity (#9565)', async () => {
    const mat = { baseColor: [0, 1, 0, 1] };
    mockSaveCustomMaterial.mockReturnValue({ id: 'custom_green', name: 'Green' });
    const { result } = await invokeHandler(
      gameplayHandlers,
      'save_material_to_library',
      { name: 'Green', entityId: '' },
      { primaryId: 'ent-1', primaryMaterial: mat },
    );
    expect(result.success).toBe(true);
    expect(mockSaveCustomMaterial).toHaveBeenCalledWith('Green', mat);
  });
});

// ===========================================================================
// delete_library_material
// ===========================================================================

describe('delete_library_material', () => {
  it('returns error when materialId is missing', async () => {
    const { result } = await invokeHandler(gameplayHandlers, 'delete_library_material', {});
    expect(result.success).toBe(false);
  });

  it('calls deleteCustomMaterial and returns success', async () => {
    const { result } = await invokeHandler(gameplayHandlers, 'delete_library_material', {
      materialId: 'custom_1',
    });
    expect(result.success).toBe(true);
    expect(mockDeleteCustomMaterial).toHaveBeenCalledWith('custom_1');
  });
});

// ===========================================================================
// list_custom_materials
// ===========================================================================

describe('list_custom_materials', () => {
  it('returns empty list when no custom materials', async () => {
    mockLoadCustomMaterials.mockReturnValue([]);
    const { result } = await invokeHandler(gameplayHandlers, 'list_custom_materials', {});
    expect(result.success).toBe(true);
    const data = result.result as Array<unknown>;
    expect(data).toHaveLength(0);
  });

  it('returns id and name only for each custom material', async () => {
    mockLoadCustomMaterials.mockReturnValue([
      { id: 'm1', name: 'Red', data: { color: 'red' } },
      { id: 'm2', name: 'Blue', data: { color: 'blue' } },
    ]);
    const { result } = await invokeHandler(gameplayHandlers, 'list_custom_materials', {});
    const data = result.result as Array<{ id: string; name: string }>;
    expect(data).toHaveLength(2);
    expect(data[0]).toEqual({ id: 'm1', name: 'Red' });
    expect(Object.keys(data[0])).toEqual(['id', 'name']);
  });
});
