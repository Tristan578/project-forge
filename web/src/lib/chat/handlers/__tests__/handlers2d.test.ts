// @vitest-environment jsdom
/**
 * Dedicated tests for handlers2d: sprite CRUD, tilemap, skeleton2d, physics2d.
 * Extends coverage beyond exportAsset2dHandlers.test.ts with edge cases.
 */
import { describe, it, expect, vi } from 'vitest';
import { createMockStore } from './handlerTestUtils';
import { handlers2d } from '../handlers2d';
import type { ToolCallContext, ExecutionResult } from '../types';

// ---------------------------------------------------------------------------
// Helper: invoke handler with context
// ---------------------------------------------------------------------------
async function invoke(
  name: string,
  args: Record<string, unknown> = {},
  storeOverrides: Record<string, unknown> = {},
): Promise<{ result: ExecutionResult; store: ToolCallContext['store']; dispatch: ReturnType<typeof vi.fn> }> {
  const store = createMockStore({
    // 2D-specific mock methods
    setSpriteData: vi.fn(),
    setProjectType: vi.fn(),
    setCamera2dData: vi.fn(),
    setSortingLayers: vi.fn(),
    setGrid2d: vi.fn(),
    setSpriteSheet: vi.fn(),
    setSpriteAnimator: vi.fn(),
    setAnimationStateMachine: vi.fn(),
    setTilemapData: vi.fn(),
    setTileset: vi.fn(),
    setPhysics2d: vi.fn(),
    removePhysics2d: vi.fn(),
    setGravity2d: vi.fn(),
    setDebugPhysics2d: vi.fn(),
    togglePhysics2d: vi.fn(),
    setSkeleton2d: vi.fn(),
    setSkeletalAnimations2d: vi.fn(),
    spriteSheets: {},
    spriteAnimators: {},
    animationStateMachines: {},
    camera2dData: null,
    skeletalAnimations2d: {},
    ...storeOverrides,
  });
  const dispatch = vi.fn();
  const result = await handlers2d[name](args, { store, dispatchCommand: dispatch });
  return { result, store, dispatch };
}

// ===========================================================================
// SPRITE COMMANDS — EDGE CASES
// ===========================================================================

describe('handlers2d sprite edge cases', () => {
  describe('create_sprite', () => {
    it('creates with default entity type when none specified', async () => {
      const { result, store } = await invoke('create_sprite', {}, { primaryId: 'ent-1' });
      expect(result.success).toBe(true);
      expect(store.spawnEntity).toHaveBeenCalled();
      expect(store.setSpriteData).toHaveBeenCalledWith(
        'ent-1',
        expect.objectContaining({ sortingLayer: 'Default', sortingOrder: 0 }),
      );
    });

    it('creates with all optional params', async () => {
      const { result, store } = await invoke(
        'create_sprite',
        {
          entityType: 'sphere',
          name: 'MySprite',
          position: [1, 2, 3],
          textureAssetId: 'tex-abc',
          sortingLayer: 'Foreground',
          sortingOrder: 5,
        },
        { primaryId: 'ent-2' },
      );
      expect(result.success).toBe(true);
      expect(store.spawnEntity).toHaveBeenCalledWith('sphere', 'MySprite');
      expect(store.updateTransform).toHaveBeenCalledWith('ent-2', 'position', { x: 1, y: 2, z: 3 });
      expect(store.setSpriteData).toHaveBeenCalledWith(
        'ent-2',
        expect.objectContaining({
          textureAssetId: 'tex-abc',
          sortingLayer: 'Foreground',
          sortingOrder: 5,
        }),
      );
    });

    it('fails when primaryId is null after spawn', async () => {
      const { result } = await invoke('create_sprite', {}, { primaryId: null });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to get entity ID');
    });

    it('rejects invalid entityType', async () => {
      const { result } = await invoke('create_sprite', { entityType: 'invalid_thing' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid arguments');
    });
  });

  describe('set_sprite_texture', () => {
    it('sets texture on entity', async () => {
      const { result, store } = await invoke(
        'set_sprite_texture',
        { entityId: 'e1', textureAssetId: 'tex-123' },
        { sprites: { e1: { textureAssetId: null, colorTint: [1, 1, 1, 1], flipX: false, flipY: false, customSize: null, sortingLayer: 'Default', sortingOrder: 0, anchor: 'center' } } },
      );
      expect(result.success).toBe(true);
      expect(store.setSpriteData).toHaveBeenCalledWith('e1', expect.objectContaining({ textureAssetId: 'tex-123' }));
    });

    it('fails without entityId', async () => {
      const { result } = await invoke('set_sprite_texture', { textureAssetId: 'tex-123' });
      expect(result.success).toBe(false);
    });

    it('fails without textureAssetId', async () => {
      const { result } = await invoke('set_sprite_texture', { entityId: 'e1' });
      expect(result.success).toBe(false);
    });
  });

  describe('set_sprite_tint', () => {
    it('sets tint from hex color', async () => {
      const { result, store } = await invoke(
        'set_sprite_tint',
        { entityId: 'e1', color: '#ff0000' },
        { sprites: { e1: { textureAssetId: null, colorTint: [1, 1, 1, 1], flipX: false, flipY: false, customSize: null, sortingLayer: 'Default', sortingOrder: 0, anchor: 'center' } } },
      );
      expect(result.success).toBe(true);
      expect(store.setSpriteData).toHaveBeenCalledWith(
        'e1',
        expect.objectContaining({ colorTint: [1, 0, 0, 1] }),
      );
    });

    it('fails without color', async () => {
      const { result } = await invoke('set_sprite_tint', { entityId: 'e1' });
      expect(result.success).toBe(false);
    });
  });

  describe('set_sprite_flip', () => {
    it('sets flip values', async () => {
      const { result, store } = await invoke(
        'set_sprite_flip',
        { entityId: 'e1', flipX: true, flipY: false },
        { sprites: { e1: { textureAssetId: null, colorTint: [1, 1, 1, 1], flipX: false, flipY: false, customSize: null, sortingLayer: 'Default', sortingOrder: 0, anchor: 'center' } } },
      );
      expect(result.success).toBe(true);
      expect(store.setSpriteData).toHaveBeenCalledWith(
        'e1',
        expect.objectContaining({ flipX: true, flipY: false }),
      );
    });

    it('fails without entityId', async () => {
      const { result } = await invoke('set_sprite_flip', {});
      expect(result.success).toBe(false);
    });
  });

  describe('set_sprite_anchor', () => {
    it('sets anchor to valid value', async () => {
      const { result, store } = await invoke(
        'set_sprite_anchor',
        { entityId: 'e1', anchor: 'top_left' },
        { sprites: { e1: { textureAssetId: null, colorTint: [1, 1, 1, 1], flipX: false, flipY: false, customSize: null, sortingLayer: 'Default', sortingOrder: 0, anchor: 'center' } } },
      );
      expect(result.success).toBe(true);
      expect(store.setSpriteData).toHaveBeenCalledWith(
        'e1',
        expect.objectContaining({ anchor: 'top_left' }),
      );
    });

    it('rejects invalid anchor', async () => {
      const { result } = await invoke('set_sprite_anchor', { entityId: 'e1', anchor: 'nowhere' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid arguments');
    });
  });

  describe('get_sprite', () => {
    it('returns sprite data for entity', async () => {
      const spriteData = { textureAssetId: 'tex-1', colorTint: [1, 0, 0, 1], flipX: true, flipY: false, customSize: null, sortingLayer: 'Default', sortingOrder: 0, anchor: 'center' };
      const { result } = await invoke(
        'get_sprite',
        { entityId: 'e1' },
        { sprites: { e1: spriteData } },
      );
      expect(result.success).toBe(true);
      expect(result.result).toEqual(spriteData);
    });

    it('returns error for missing entity', async () => {
      const { result } = await invoke('get_sprite', { entityId: 'nonexistent' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('No sprite');
    });
  });
});

// ===========================================================================
// PROJECT & CAMERA 2D
// ===========================================================================

describe('handlers2d project2d edge cases', () => {
  describe('set_project_type', () => {
    it('sets 2D project type', async () => {
      const { result, store } = await invoke('set_project_type', { type: '2d' });
      expect(result.success).toBe(true);
      expect(store.setProjectType).toHaveBeenCalledWith('2d');
    });

    it('sets 3D project type', async () => {
      const { result, store } = await invoke('set_project_type', { type: '3d' });
      expect(result.success).toBe(true);
      expect(store.setProjectType).toHaveBeenCalledWith('3d');
    });

    it('rejects invalid type', async () => {
      const { result } = await invoke('set_project_type', { type: 'vr' });
      expect(result.success).toBe(false);
    });
  });

  describe('set_camera_2d', () => {
    it('sets camera with all params', async () => {
      const { result, store } = await invoke('set_camera_2d', {
        zoom: 2.5,
        pixelPerfect: true,
        bounds: { minX: -10, maxX: 10, minY: -5, maxY: 5 },
      });
      expect(result.success).toBe(true);
      expect(store.setCamera2dData).toHaveBeenCalledWith(
        expect.objectContaining({ zoom: 2.5, pixelPerfect: true }),
      );
    });

    it('merges with existing camera data', async () => {
      const { result, store } = await invoke(
        'set_camera_2d',
        { zoom: 3.0 },
        { camera2dData: { zoom: 1, pixelPerfect: false, bounds: null } },
      );
      expect(result.success).toBe(true);
      expect(store.setCamera2dData).toHaveBeenCalledWith(
        expect.objectContaining({ zoom: 3.0, pixelPerfect: false }),
      );
    });
  });

  describe('set_sorting_layers', () => {
    it('sets sorting layers array', async () => {
      const layers = [
        { name: 'Background', order: 0, visible: true },
        { name: 'Default', order: 1, visible: true },
      ];
      const { result, store } = await invoke('set_sorting_layers', { layers });
      expect(result.success).toBe(true);
      expect(store.setSortingLayers).toHaveBeenCalledWith(layers);
    });

    it('rejects invalid layer data', async () => {
      const { result } = await invoke('set_sorting_layers', { layers: [{ name: 123 }] });
      expect(result.success).toBe(false);
    });
  });
});

// ===========================================================================
// TILEMAP
// ===========================================================================

describe('handlers2d tilemap edge cases', () => {
  // Proper TilemapData matching the actual schema used by handlers
  const baseTilemap = {
    tilesetAssetId: 'ts-1',
    tileSize: [16, 16] as [number, number],
    mapSize: [10, 10] as [number, number],
    layers: [
      {
        name: 'Layer 0',
        tiles: new Array(100).fill(null) as (number | null)[],
        visible: true,
        opacity: 1,
        isCollision: false,
      },
    ],
    origin: 'TopLeft',
  };

  describe('create_tilemap', () => {
    it('creates tilemap with required params', async () => {
      const { result, store } = await invoke(
        'create_tilemap',
        { tilesetAssetId: 'ts-1' },
        { primaryId: 'tm-1' },
      );
      expect(result.success).toBe(true);
      expect(store.spawnEntity).toHaveBeenCalledWith('plane', expect.any(String));
      expect(store.setTilemapData).toHaveBeenCalledWith(
        'tm-1',
        expect.objectContaining({ tilesetAssetId: 'ts-1' }),
      );
    });

    it('creates with custom tile/map sizes', async () => {
      const { result, store } = await invoke(
        'create_tilemap',
        { tilesetAssetId: 'ts-1', tileSize: [16, 16], mapSize: [30, 20], name: 'Ground' },
        { primaryId: 'tm-2' },
      );
      expect(result.success).toBe(true);
      expect(store.setTilemapData).toHaveBeenCalledWith(
        'tm-2',
        expect.objectContaining({ tileSize: [16, 16], mapSize: [30, 20] }),
      );
    });

    it('fails when primaryId is null', async () => {
      const { result } = await invoke(
        'create_tilemap',
        { tilesetAssetId: 'ts-1' },
        { primaryId: null },
      );
      expect(result.success).toBe(false);
    });

    it('fails without tilesetAssetId', async () => {
      const { result } = await invoke('create_tilemap', {});
      expect(result.success).toBe(false);
    });
  });

  describe('set_tile', () => {
    it('sets tile at valid position', async () => {
      const { result, store } = await invoke(
        'set_tile',
        { entityId: 'e1', layerIndex: 0, x: 3, y: 4, tileIndex: 42 },
        { tilemaps: { e1: baseTilemap } },
      );
      expect(result.success).toBe(true);
      expect(store.setTilemapData).toHaveBeenCalled();
    });

    it('fails with missing tilemap', async () => {
      const { result } = await invoke(
        'set_tile',
        { entityId: 'e1', layerIndex: 0, x: 0, y: 0, tileIndex: 1 },
        { tilemaps: {} },
      );
      expect(result.success).toBe(false);
    });

    it('clears tile with null tileIndex', async () => {
      const { result, store } = await invoke(
        'set_tile',
        { entityId: 'e1', layerIndex: 0, x: 0, y: 0, tileIndex: null },
        { tilemaps: { e1: baseTilemap } },
      );
      expect(result.success).toBe(true);
      expect(store.setTilemapData).toHaveBeenCalled();
    });
  });

  describe('add_tilemap_layer', () => {
    it('adds layer to existing tilemap', async () => {
      const { result, store } = await invoke(
        'add_tilemap_layer',
        { entityId: 'e1', name: 'Trees' },
        { tilemaps: { e1: baseTilemap } },
      );
      expect(result.success).toBe(true);
      expect(store.setTilemapData).toHaveBeenCalled();
    });

    it('fails without tilemap', async () => {
      const { result } = await invoke(
        'add_tilemap_layer',
        { entityId: 'e1', name: 'Trees' },
        { tilemaps: {} },
      );
      expect(result.success).toBe(false);
    });
  });

  describe('remove_tilemap_layer', () => {
    it('removes layer by index', async () => {
      const twoLayerTilemap = {
        ...baseTilemap,
        layers: [
          baseTilemap.layers[0],
          { name: 'Layer 1', tiles: new Array(100).fill(null), visible: true, opacity: 1, isCollision: false },
        ],
      };
      const { result, store } = await invoke(
        'remove_tilemap_layer',
        { entityId: 'e1', layerIndex: 1 },
        { tilemaps: { e1: twoLayerTilemap } },
      );
      expect(result.success).toBe(true);
      expect(store.setTilemapData).toHaveBeenCalled();
    });

    it('fails when trying to remove last layer', async () => {
      const { result } = await invoke(
        'remove_tilemap_layer',
        { entityId: 'e1', layerIndex: 0 },
        { tilemaps: { e1: baseTilemap } },
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('Cannot remove the last');
    });
  });

  describe('get_tilemap', () => {
    it('returns tilemap data', async () => {
      const { result } = await invoke(
        'get_tilemap',
        { entityId: 'e1' },
        { tilemaps: { e1: baseTilemap } },
      );
      expect(result.success).toBe(true);
      expect(result.result).toEqual(baseTilemap);
    });

    it('fails for missing tilemap', async () => {
      const { result } = await invoke('get_tilemap', { entityId: 'missing' });
      expect(result.success).toBe(false);
    });
  });

  describe('resize_tilemap', () => {
    it('resizes tilemap', async () => {
      const { result, store } = await invoke(
        'resize_tilemap',
        { entityId: 'e1', width: 20, height: 20 },
        { tilemaps: { e1: baseTilemap } },
      );
      expect(result.success).toBe(true);
      expect(store.setTilemapData).toHaveBeenCalledWith(
        'e1',
        expect.objectContaining({ mapSize: [20, 20] }),
      );
    });

    it('fails for missing tilemap', async () => {
      const { result } = await invoke('resize_tilemap', { entityId: 'missing', width: 10, height: 10 });
      expect(result.success).toBe(false);
    });
  });
});

// ===========================================================================
// PHYSICS 2D
// ===========================================================================

describe('handlers2d physics2d edge cases', () => {
  describe('set_physics2d', () => {
    it('sets physics with all params', async () => {
      const { result, store } = await invoke('set_physics2d', {
        entityId: 'e1',
        bodyType: 'dynamic',
        colliderShape: 'circle',
        radius: 0.5,
        mass: 2.0,
        friction: 0.3,
        restitution: 0.8,
        gravityScale: 1.0,
        isSensor: false,
        lockRotation: true,
      });
      expect(result.success).toBe(true);
      expect(store.setPhysics2d).toHaveBeenCalledWith('e1', expect.any(Object), true);
    });

    it('rejects invalid body type', async () => {
      const { result } = await invoke('set_physics2d', {
        entityId: 'e1',
        bodyType: 'antigravity',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('remove_physics2d', () => {
    it('removes physics from entity', async () => {
      const { result, store } = await invoke('remove_physics2d', { entityId: 'e1' });
      expect(result.success).toBe(true);
      expect(store.removePhysics2d).toHaveBeenCalledWith('e1');
    });

    it('fails without entityId', async () => {
      const { result } = await invoke('remove_physics2d', {});
      expect(result.success).toBe(false);
    });
  });

  describe('get_physics2d', () => {
    it('returns physics data', async () => {
      const physData = { bodyType: 'dynamic', colliderShape: 'box', size: [1, 1] };
      const { result } = await invoke(
        'get_physics2d',
        { entityId: 'e1' },
        { physics2d: { e1: physData } },
      );
      expect(result.success).toBe(true);
      expect(result.result).toEqual(physData);
    });

    it('fails for missing entity', async () => {
      const { result } = await invoke('get_physics2d', { entityId: 'missing' });
      expect(result.success).toBe(false);
    });
  });

  describe('set_gravity2d', () => {
    it('sets gravity vector', async () => {
      const { result, store } = await invoke('set_gravity2d', { x: 0, y: -20 });
      expect(result.success).toBe(true);
      expect(store.setGravity2d).toHaveBeenCalledWith(0, -20);
    });
  });

  describe('set_debug_physics2d', () => {
    it('enables debug rendering', async () => {
      const { result, store } = await invoke('set_debug_physics2d', { enabled: true });
      expect(result.success).toBe(true);
      expect(store.setDebugPhysics2d).toHaveBeenCalledWith(true);
    });
  });

  describe('apply_force2d', () => {
    it('applies force to entity', async () => {
      const { result } = await invoke('apply_force2d', {
        entityId: 'e1',
        force: [10, 5],
      });
      expect(result.success).toBe(true);
    });

    it('fails without force', async () => {
      const { result } = await invoke('apply_force2d', { entityId: 'e1' });
      expect(result.success).toBe(false);
    });
  });

  describe('apply_impulse2d', () => {
    it('applies impulse to entity', async () => {
      const { result } = await invoke('apply_impulse2d', {
        entityId: 'e1',
        impulse: [0, 15],
      });
      expect(result.success).toBe(true);
    });
  });
});

// ===========================================================================
// SKELETON 2D
// ===========================================================================

describe('handlers2d skeleton2d edge cases', () => {
  describe('create_skeleton2d', () => {
    it('creates skeleton without root bone', async () => {
      const { result, store } = await invoke('create_skeleton2d', { entityId: 'e1' });
      expect(result.success).toBe(true);
      expect(store.setSkeleton2d).toHaveBeenCalledWith('e1', expect.objectContaining({ bones: expect.any(Array) }));
    });

    it('creates skeleton with root bone', async () => {
      const { result, store } = await invoke('create_skeleton2d', {
        entityId: 'e1',
        rootBone: { name: 'hip', parentBone: null, localPosition: [0, 0], localRotation: 0, localScale: [1, 1], length: 1, color: [1, 1, 1, 1] },
      });
      expect(result.success).toBe(true);
      expect(store.setSkeleton2d).toHaveBeenCalled();
    });

    it('fails without entityId', async () => {
      const { result } = await invoke('create_skeleton2d', {});
      expect(result.success).toBe(false);
    });
  });

  describe('add_bone2d', () => {
    it('adds bone to existing skeleton', async () => {
      const baseSkeleton = { bones: [{ name: 'root', parentBone: null, localPosition: [0, 0], localRotation: 0, localScale: [1, 1], length: 1, color: [1, 1, 1, 1] }], skins: {}, ikConstraints: [], activeSkin: null };
      const { result, store } = await invoke(
        'add_bone2d',
        { entityId: 'e1', boneName: 'arm', parentBone: 'root', position: [1, 0], length: 0.5 },
        { skeletons2d: { e1: baseSkeleton } },
      );
      expect(result.success).toBe(true);
      expect(store.setSkeleton2d).toHaveBeenCalled();
    });

    it('creates default skeleton if none exists', async () => {
      const { result, store } = await invoke('add_bone2d', {
        entityId: 'e1',
        boneName: 'root',
      });
      expect(result.success).toBe(true);
      expect(store.setSkeleton2d).toHaveBeenCalled();
    });
  });

  describe('remove_bone2d', () => {
    it('removes bone by name', async () => {
      const skeleton = {
        bones: [
          { name: 'root', parentBone: null, localPosition: [0, 0], localRotation: 0, localScale: [1, 1], length: 1, color: [1, 1, 1, 1] },
          { name: 'arm', parentBone: 'root', localPosition: [1, 0], localRotation: 0, localScale: [1, 1], length: 0.5, color: [1, 1, 1, 1] },
        ],
        skins: {},
        ikConstraints: [],
        activeSkin: null,
      };
      const { result, store } = await invoke(
        'remove_bone2d',
        { entityId: 'e1', boneName: 'arm' },
        { skeletons2d: { e1: skeleton } },
      );
      expect(result.success).toBe(true);
      expect(store.setSkeleton2d).toHaveBeenCalled();
    });

    it('fails without skeleton', async () => {
      const { result } = await invoke('remove_bone2d', { entityId: 'e1', boneName: 'arm' });
      expect(result.success).toBe(false);
    });
  });

  describe('get_skeleton2d', () => {
    it('returns skeleton data', async () => {
      const skel = { bones: [], skins: {}, ikConstraints: [], activeSkin: null };
      const { result } = await invoke(
        'get_skeleton2d',
        { entityId: 'e1' },
        { skeletons2d: { e1: skel } },
      );
      expect(result.success).toBe(true);
      expect(result.result).toEqual(skel);
    });

    it('fails for missing entity', async () => {
      const { result } = await invoke('get_skeleton2d', { entityId: 'missing' });
      expect(result.success).toBe(false);
    });
  });

  describe('create_skeletal_animation2d', () => {
    it('creates animation', async () => {
      const { result, store } = await invoke('create_skeletal_animation2d', {
        entityId: 'e1',
        animName: 'walk',
        looping: true,
      });
      expect(result.success).toBe(true);
      expect(store.setSkeletalAnimations2d).toHaveBeenCalled();
    });

    it('appends to existing animations', async () => {
      const existing = [{ name: 'idle', duration: 1, looping: true, tracks: {} }];
      const { result, store } = await invoke(
        'create_skeletal_animation2d',
        { entityId: 'e1', animName: 'run' },
        { skeletalAnimations2d: { e1: existing } },
      );
      expect(result.success).toBe(true);
      expect(store.setSkeletalAnimations2d).toHaveBeenCalledWith('e1', expect.arrayContaining([
        expect.objectContaining({ name: 'idle' }),
        expect.objectContaining({ name: 'run' }),
      ]));
    });
  });

  describe('play_skeletal_animation2d', () => {
    it('plays animation by name', async () => {
      const { result, store } = await invoke('play_skeletal_animation2d', {
        entityId: 'e1',
        animName: 'walk',
      });
      expect(result.success).toBe(true);
      expect(store.playAnimation).toHaveBeenCalledWith('e1', 'walk');
    });
  });

  describe('auto_weight_skeleton2d', () => {
    it('triggers auto-weight on entity', async () => {
      const skel = { bones: [{ name: 'root', parentBone: null, localPosition: [0, 0], localRotation: 0, localScale: [1, 1], length: 1, color: [1, 1, 1, 1] }], skins: {}, ikConstraints: [], activeSkin: null };
      const { result, store } = await invoke(
        'auto_weight_skeleton2d',
        { entityId: 'e1' },
        { skeletons2d: { e1: skel } },
      );
      expect(result.success).toBe(true);
      expect(store.setSkeleton2d).toHaveBeenCalled();
    });
  });
});

// ===========================================================================
// SPRITE ANIMATION
// ===========================================================================

describe('handlers2d sprite animation edge cases', () => {
  describe('slice_sprite_sheet', () => {
    it('creates sprite sheet with grid slice mode', async () => {
      const { result, store } = await invoke('slice_sprite_sheet', {
        entityId: 'e1',
        assetId: 'tex-1',
        sliceMode: { type: 'grid', columns: 4, rows: 4, tileSize: [32, 32] },
      });
      expect(result.success).toBe(true);
      expect(store.setSpriteSheet).toHaveBeenCalled();
    });

    it('creates sprite sheet without slice mode (defaults to manual)', async () => {
      const { result, store } = await invoke('slice_sprite_sheet', {
        entityId: 'e1',
        assetId: 'tex-1',
      });
      expect(result.success).toBe(true);
      expect(store.setSpriteSheet).toHaveBeenCalled();
    });

    it('creates with clips', async () => {
      const { result, store } = await invoke('slice_sprite_sheet', {
        entityId: 'e1',
        assetId: 'tex-1',
        sliceMode: { type: 'grid', columns: 4, rows: 1 },
        clips: [
          { name: 'walk', frames: [0, 1, 2, 3], fps: 12 },
        ],
      });
      expect(result.success).toBe(true);
      expect(store.setSpriteSheet).toHaveBeenCalled();
    });

    it('fails without assetId', async () => {
      const { result } = await invoke('slice_sprite_sheet', { entityId: 'e1' });
      expect(result.success).toBe(false);
    });
  });

  describe('create_sprite_anim_clip', () => {
    it('creates animation clip on existing sheet', async () => {
      const sheet = { assetId: 'tex-1', sliceMode: { type: 'grid' as const }, frames: [], clips: {} };
      const { result, store } = await invoke(
        'create_sprite_anim_clip',
        { entityId: 'e1', clipName: 'idle', frames: [0, 1, 2, 3], fps: 12, looping: true },
        { spriteSheets: { e1: sheet } },
      );
      expect(result.success).toBe(true);
      expect(store.setSpriteSheet).toHaveBeenCalled();
    });

    it('fails without sprite sheet', async () => {
      const { result } = await invoke('create_sprite_anim_clip', {
        entityId: 'e1',
        clipName: 'idle',
        frames: [0, 1, 2, 3],
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('No sprite sheet');
    });
  });

  describe('set_sprite_animator', () => {
    it('sets animator with spriteSheetId', async () => {
      const { result, store } = await invoke('set_sprite_animator', {
        entityId: 'e1',
        spriteSheetId: 'sheet-1',
        currentClip: 'idle',
        playing: true,
        speed: 1.0,
      });
      expect(result.success).toBe(true);
      expect(store.setSpriteAnimator).toHaveBeenCalled();
    });

    it('fails without spriteSheetId', async () => {
      const { result } = await invoke('set_sprite_animator', { entityId: 'e1' });
      expect(result.success).toBe(false);
    });
  });

  describe('set_anim_state_machine', () => {
    it('sets state machine with proper schema', async () => {
      const { result, store } = await invoke('set_anim_state_machine', {
        entityId: 'e1',
        currentState: 'idle',
        states: { idle: 'idle_clip', walk: 'walk_clip' },
        transitions: [
          { fromState: 'idle', toState: 'walk', condition: { type: 'always' }, duration: 0.2 },
        ],
        parameters: { speed: { type: 'float', value: 0.0 } },
      });
      expect(result.success).toBe(true);
      expect(store.setAnimationStateMachine).toHaveBeenCalled();
    });

    it('fails without required fields', async () => {
      const { result } = await invoke('set_anim_state_machine', { entityId: 'e1' });
      expect(result.success).toBe(false);
    });
  });
});

// ===========================================================================
// add_skeleton2d_mesh_attachment
// ===========================================================================

/** Minimal valid payload for add_skeleton2d_mesh_attachment. */
const minimalMeshAttachmentArgs = {
  entityId: 'skel-1',
  skinName: 'default',
  attachmentName: 'body_mesh',
  vertices: [[0, 0], [10, 0], [5, 10]] as [number, number][],
  uvs: [[0, 0], [1, 0], [0.5, 1]] as [number, number][],
  triangles: [0, 1, 2],
  weights: [
    { bones: ['root'], weights: [1.0] },
    { bones: ['root'], weights: [1.0] },
    { bones: ['root'], weights: [1.0] },
  ],
};

describe('handlers2d add_skeleton2d_mesh_attachment', () => {
  it('dispatches the command with all required fields', async () => {
    const { result, dispatch } = await invoke('add_skeleton2d_mesh_attachment', minimalMeshAttachmentArgs);
    expect(result.success).toBe(true);
    expect(dispatch).toHaveBeenCalledWith('add_skeleton2d_mesh_attachment', expect.objectContaining({
      entityId: 'skel-1',
      skinName: 'default',
      attachmentName: 'body_mesh',
    }));
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it('passes vertices, uvs, triangles, and weights verbatim to dispatch', async () => {
    const { dispatch } = await invoke('add_skeleton2d_mesh_attachment', minimalMeshAttachmentArgs);
    const payload = dispatch.mock.calls[0][1] as Record<string, unknown>;
    expect(payload.vertices).toEqual([[0, 0], [10, 0], [5, 10]]);
    expect(payload.uvs).toEqual([[0, 0], [1, 0], [0.5, 1]]);
    expect(payload.triangles).toEqual([0, 1, 2]);
    expect(payload.weights).toEqual([
      { bones: ['root'], weights: [1.0] },
      { bones: ['root'], weights: [1.0] },
      { bones: ['root'], weights: [1.0] },
    ]);
  });

  it('returns success message containing entity/skin/attachment names', async () => {
    const { result } = await invoke('add_skeleton2d_mesh_attachment', minimalMeshAttachmentArgs);
    expect(result.success).toBe(true);
    const msg = (result.result as { message: string }).message;
    expect(msg).toContain('skel-1');
    expect(msg).toContain('default');
    expect(msg).toContain('body_mesh');
  });

  it('fails when vertices.length !== weights.length', async () => {
    const { result } = await invoke('add_skeleton2d_mesh_attachment', {
      ...minimalMeshAttachmentArgs,
      weights: [{ bones: ['root'], weights: [1.0] }], // only 1 entry vs 3 vertices
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('vertices.length');
    expect(result.error).toContain('weights.length');
  });

  it('fails when entityId is missing', async () => {
    const { entityId: _, ...withoutEntity } = minimalMeshAttachmentArgs;
    const { result } = await invoke('add_skeleton2d_mesh_attachment', withoutEntity);
    expect(result.success).toBe(false);
  });

  it('fails when skinName is missing', async () => {
    const { skinName: _, ...withoutSkin } = minimalMeshAttachmentArgs;
    const { result } = await invoke('add_skeleton2d_mesh_attachment', withoutSkin);
    expect(result.success).toBe(false);
  });

  it('fails when attachmentName is missing', async () => {
    const { attachmentName: _, ...withoutAttachment } = minimalMeshAttachmentArgs;
    const { result } = await invoke('add_skeleton2d_mesh_attachment', withoutAttachment);
    expect(result.success).toBe(false);
  });

  it('fails when vertices are missing', async () => {
    const { vertices: _, ...withoutVertices } = minimalMeshAttachmentArgs;
    const { result } = await invoke('add_skeleton2d_mesh_attachment', withoutVertices);
    expect(result.success).toBe(false);
  });

  it('fails when uvs are missing', async () => {
    const { uvs: _, ...withoutUvs } = minimalMeshAttachmentArgs;
    const { result } = await invoke('add_skeleton2d_mesh_attachment', withoutUvs);
    expect(result.success).toBe(false);
  });

  it('fails when triangles are missing', async () => {
    const { triangles: _, ...withoutTriangles } = minimalMeshAttachmentArgs;
    const { result } = await invoke('add_skeleton2d_mesh_attachment', withoutTriangles);
    expect(result.success).toBe(false);
  });

  it('fails when weights are missing', async () => {
    const { weights: _, ...withoutWeights } = minimalMeshAttachmentArgs;
    const { result } = await invoke('add_skeleton2d_mesh_attachment', withoutWeights);
    expect(result.success).toBe(false);
  });

  it('supports multi-bone weights per vertex', async () => {
    const { dispatch } = await invoke('add_skeleton2d_mesh_attachment', {
      ...minimalMeshAttachmentArgs,
      weights: [
        { bones: ['root', 'arm'], weights: [0.6, 0.4] },
        { bones: ['root', 'arm'], weights: [0.3, 0.7] },
        { bones: ['root'], weights: [1.0] },
      ],
    });
    expect(dispatch).toHaveBeenCalledWith('add_skeleton2d_mesh_attachment', expect.objectContaining({
      weights: expect.arrayContaining([
        expect.objectContaining({ bones: ['root', 'arm'], weights: [0.6, 0.4] }),
      ]),
    }));
  });

  it('does not call setSkeleton2d on the store', async () => {
    const { store } = await invoke('add_skeleton2d_mesh_attachment', minimalMeshAttachmentArgs);
    expect(store.setSkeleton2d).not.toHaveBeenCalled();
  });
});
