/**
 * Tests for gameplayHandlers — game components, cameras, prefabs, export,
 * and material library commands.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invokeHandler, createMockStore } from './handlerTestUtils';
import { gameplayHandlers } from '../gameplayHandlers';

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

  it('calls store.updateGameComponent with built component', async () => {
    const { result, store } = await invokeHandler(gameplayHandlers, 'update_game_component', {
      entityId: 'ent-1',
      componentType: 'health',
      properties: { maxHp: 50 },
    });
    expect(result.success).toBe(true);
    expect(store.updateGameComponent).toHaveBeenCalledTimes(1);
    const [entityId, comp] = (store.updateGameComponent as ReturnType<typeof vi.fn>).mock.calls[0] as [string, { type: string }];
    expect(entityId).toBe('ent-1');
    expect(comp.type).toBe('health');
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
});

// ===========================================================================
// list_game_component_types
// ===========================================================================

describe('list_game_component_types', () => {
  it('returns success with all 12 component types', async () => {
    const { result } = await invokeHandler(gameplayHandlers, 'list_game_component_types', {});
    expect(result.success).toBe(true);
    const data = result.result as { types: Array<{ name: string; description: string }> };
    expect(data.types).toHaveLength(12);
  });

  it('every type entry has name and description', async () => {
    const { result } = await invokeHandler(gameplayHandlers, 'list_game_component_types', {});
    const data = result.result as { types: Array<{ name: string; description: string }> };
    for (const t of data.types) {
      expect(t.name).toBeTruthy();
      expect(t.description).toBeTruthy();
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

  it('sets third-person camera with defaults', async () => {
    const { result, store } = await invokeHandler(gameplayHandlers, 'set_game_camera', {
      entityId: 'cam-1',
      mode: 'thirdPersonFollow',
    });
    expect(result.success).toBe(true);
    expect(store.setGameCamera).toHaveBeenCalledTimes(1);
    const [entityId, camData] = (store.setGameCamera as ReturnType<typeof vi.fn>).mock.calls[0] as [string, { mode: string; targetEntity: null }];
    expect(entityId).toBe('cam-1');
    expect(camData.mode).toBe('thirdPersonFollow');
    expect(camData.targetEntity).toBeNull();
  });

  it('passes targetEntity when provided', async () => {
    const { store } = await invokeHandler(gameplayHandlers, 'set_game_camera', {
      entityId: 'cam-1',
      mode: 'thirdPersonFollow',
      targetEntity: 'player-1',
    });
    const [, camData] = (store.setGameCamera as ReturnType<typeof vi.fn>).mock.calls[0] as [string, { targetEntity: string }];
    expect(camData.targetEntity).toBe('player-1');
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
    expect(filename).toContain('TestGame');
    expect(filename).toMatch(/\.html$/);
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
