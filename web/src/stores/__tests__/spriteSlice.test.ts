/**
 * Unit tests for the spriteSlice — 2D sprite, tilemap, and animation state.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createSpriteSlice, setSpriteDispatcher, type SpriteSlice } from '../slices/spriteSlice';
import type { SpriteData, SpriteSheetData, SpriteAnimatorData, AnimationStateMachineData, TilesetData, TilemapData } from '../slices/types';

function createTestStore() {
  const store = { state: null as unknown as SpriteSlice };
  const set = (partial: Partial<SpriteSlice> | ((s: SpriteSlice) => Partial<SpriteSlice>)) => {
    if (typeof partial === 'function') {
      Object.assign(store.state, partial(store.state));
    } else {
      Object.assign(store.state, partial);
    }
  };
  const get = () => store.state;
  store.state = createSpriteSlice(set as never, get as never, {} as never);
  return { getState: () => store.state };
}

const sampleSprite: SpriteData = {
  textureAssetId: 'tex-001',
  colorTint: [1, 1, 1, 1],
  flipX: false,
  flipY: false,
  customSize: null,
  sortingLayer: 'Default',
  sortingOrder: 0,
  anchor: 'center',
};

const sampleSpriteSheet: SpriteSheetData = {
  assetId: 'sheet-001',
  sliceMode: { type: 'grid', columns: 4, rows: 4, tileSize: [32, 32], padding: [0, 0], offset: [0, 0] },
  frames: [
    { index: 0, x: 0, y: 0, width: 32, height: 32 },
    { index: 1, x: 32, y: 0, width: 32, height: 32 },
  ],
  clips: {
    idle: { name: 'idle', frames: [0, 1], frameDurations: { type: 'uniform', duration: 200 }, looping: true, pingPong: false },
  },
};

const sampleAnimator: SpriteAnimatorData = {
  spriteSheetId: 'sheet-001',
  currentClip: 'idle',
  frameIndex: 0,
  playing: true,
  speed: 1.0,
};

const sampleStateMachine: AnimationStateMachineData = {
  states: { idle: 'idle', run: 'run' },
  transitions: [{ fromState: 'idle', toState: 'run', condition: { type: 'paramBool', name: 'isRunning', value: true }, duration: 0.1 }],
  currentState: 'idle',
  parameters: { isRunning: { type: 'bool', value: false } },
};

const sampleTileset: TilesetData = {
  name: 'ground',
  assetId: 'tileset-001',
  tileSize: [16, 16],
  gridSize: [10, 10],
  spacing: 0,
  margin: 0,
  tiles: [],
};

const sampleTilemap: TilemapData = {
  tilesetAssetId: 'tileset-001',
  tileSize: [16, 16],
  mapSize: [20, 15],
  layers: [{ name: 'ground', tiles: [], visible: true, opacity: 1, isCollision: false }],
  origin: 'TopLeft',
};

describe('spriteSlice', () => {
  let store: ReturnType<typeof createTestStore>;
  let mockDispatch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockDispatch = vi.fn();
    setSpriteDispatcher(mockDispatch as (command: string, payload: unknown) => void);
    store = createTestStore();
  });

  describe('Initial state', () => {
    it('should default to 3D project type', () => {
      expect(store.getState().projectType).toBe('3d');
    });

    it('should have empty sprite/sheet/animator/tilemap maps', () => {
      expect(store.getState().sprites).toEqual({});
      expect(store.getState().spriteSheets).toEqual({});
      expect(store.getState().spriteAnimators).toEqual({});
      expect(store.getState().animationStateMachines).toEqual({});
      expect(store.getState().tilesets).toEqual({});
      expect(store.getState().tilemaps).toEqual({});
    });

    it('should have 4 default sorting layers', () => {
      expect(store.getState().sortingLayers).toHaveLength(4);
      expect(store.getState().sortingLayers.map(l => l.name)).toEqual(['Background', 'Default', 'Foreground', 'UI']);
    });

    it('should have default grid2d settings', () => {
      expect(store.getState().grid2d).toEqual({
        enabled: false, size: 32, color: '#ffffff', opacity: 0.2, snapToGrid: false,
      });
    });

    it('should have null tilemap tool state', () => {
      expect(store.getState().activeTilesetId).toBeNull();
      expect(store.getState().tilemapActiveTool).toBeNull();
      expect(store.getState().tilemapActiveLayerIndex).toBeNull();
    });
  });

  describe('Project type', () => {
    it('setProjectType changes type and dispatches', () => {
      store.getState().setProjectType('2d');
      expect(store.getState().projectType).toBe('2d');
      expect(mockDispatch).toHaveBeenCalledWith('set_project_type', { projectType: '2d' });
    });
  });

  describe('Sprite data CRUD', () => {
    it('setSpriteData adds sprite and dispatches', () => {
      store.getState().setSpriteData('ent-1', sampleSprite);
      expect(store.getState().sprites['ent-1']).toEqual(sampleSprite);
      expect(mockDispatch).toHaveBeenCalledWith('set_sprite_data', { entityId: 'ent-1', ...sampleSprite });
    });

    it('removeSpriteData removes sprite and dispatches', () => {
      store.getState().setSpriteData('ent-1', sampleSprite);
      store.getState().removeSpriteData('ent-1');
      expect(store.getState().sprites['ent-1']).toBeUndefined();
      expect(mockDispatch).toHaveBeenCalledWith('remove_sprite_data', { entityId: 'ent-1' });
    });

    it('multiple sprites coexist', () => {
      const sprite2 = { ...sampleSprite, sortingOrder: 5 };
      store.getState().setSpriteData('ent-1', sampleSprite);
      store.getState().setSpriteData('ent-2', sprite2);
      expect(Object.keys(store.getState().sprites)).toHaveLength(2);
      store.getState().removeSpriteData('ent-1');
      expect(store.getState().sprites['ent-2']).toEqual(sprite2);
    });
  });

  describe('Camera 2D', () => {
    it('setCamera2dData updates and dispatches', () => {
      const cam = { zoom: 2.0, pixelPerfect: true, bounds: null };
      store.getState().setCamera2dData(cam);
      expect(store.getState().camera2dData).toEqual(cam);
      expect(mockDispatch).toHaveBeenCalledWith('set_camera_2d_data', cam);
    });
  });

  describe('Sorting layers', () => {
    it('addSortingLayer appends with next order', () => {
      store.getState().addSortingLayer('Effects');
      const layers = store.getState().sortingLayers;
      expect(layers).toHaveLength(5);
      expect(layers[4].name).toBe('Effects');
      expect(layers[4].order).toBe(4); // max was 3 (UI)
    });

    it('removeSortingLayer filters by name', () => {
      store.getState().removeSortingLayer('UI');
      expect(store.getState().sortingLayers.map(l => l.name)).not.toContain('UI');
      expect(store.getState().sortingLayers).toHaveLength(3);
    });

    it('toggleLayerVisibility flips visibility', () => {
      expect(store.getState().sortingLayers[0].visible).toBe(true);
      store.getState().toggleLayerVisibility('Background');
      expect(store.getState().sortingLayers[0].visible).toBe(false);
      store.getState().toggleLayerVisibility('Background');
      expect(store.getState().sortingLayers[0].visible).toBe(true);
    });

    it('setSortingLayers replaces entire list', () => {
      store.getState().setSortingLayers([{ name: 'Only', order: 0, visible: true }]);
      expect(store.getState().sortingLayers).toHaveLength(1);
    });
  });

  describe('Grid 2D', () => {
    it('setGrid2d merges partial settings', () => {
      store.getState().setGrid2d({ enabled: true, size: 64 });
      expect(store.getState().grid2d.enabled).toBe(true);
      expect(store.getState().grid2d.size).toBe(64);
      expect(store.getState().grid2d.color).toBe('#ffffff'); // unchanged
    });
  });

  describe('Sprite sheets', () => {
    it('setSpriteSheet adds and dispatches', () => {
      store.getState().setSpriteSheet('ent-1', sampleSpriteSheet);
      expect(store.getState().spriteSheets['ent-1']).toEqual(sampleSpriteSheet);
      expect(mockDispatch).toHaveBeenCalledWith('set_sprite_sheet', { entityId: 'ent-1', ...sampleSpriteSheet });
    });

    it('removeSpriteSheet removes and dispatches', () => {
      store.getState().setSpriteSheet('ent-1', sampleSpriteSheet);
      store.getState().removeSpriteSheet('ent-1');
      expect(store.getState().spriteSheets['ent-1']).toBeUndefined();
    });
  });

  describe('Sprite animators', () => {
    it('setSpriteAnimator adds and dispatches', () => {
      store.getState().setSpriteAnimator('ent-1', sampleAnimator);
      expect(store.getState().spriteAnimators['ent-1']).toEqual(sampleAnimator);
      expect(mockDispatch).toHaveBeenCalledWith('set_sprite_animator', { entityId: 'ent-1', ...sampleAnimator });
    });

    it('removeSpriteAnimator removes', () => {
      store.getState().setSpriteAnimator('ent-1', sampleAnimator);
      store.getState().removeSpriteAnimator('ent-1');
      expect(store.getState().spriteAnimators['ent-1']).toBeUndefined();
    });
  });

  describe('Animation state machines', () => {
    it('setAnimationStateMachine adds with transitions', () => {
      store.getState().setAnimationStateMachine('ent-1', sampleStateMachine);
      expect(store.getState().animationStateMachines['ent-1']).toEqual(sampleStateMachine);
      expect(mockDispatch).toHaveBeenCalledWith('set_animation_state_machine', { entityId: 'ent-1', ...sampleStateMachine });
    });

    it('removeAnimationStateMachine removes', () => {
      store.getState().setAnimationStateMachine('ent-1', sampleStateMachine);
      store.getState().removeAnimationStateMachine('ent-1');
      expect(store.getState().animationStateMachines['ent-1']).toBeUndefined();
    });
  });

  describe('Tilesets', () => {
    it('setTileset adds and dispatches', () => {
      store.getState().setTileset('tileset-001', sampleTileset);
      expect(store.getState().tilesets['tileset-001']).toEqual(sampleTileset);
      expect(mockDispatch).toHaveBeenCalledWith('set_tileset', { ...sampleTileset, assetId: 'tileset-001' });
    });

    it('removeTileset removes', () => {
      store.getState().setTileset('tileset-001', sampleTileset);
      store.getState().removeTileset('tileset-001');
      expect(store.getState().tilesets['tileset-001']).toBeUndefined();
    });
  });

  describe('Tilemaps', () => {
    it('setTilemapData adds and dispatches', () => {
      store.getState().setTilemapData('ent-1', sampleTilemap);
      expect(store.getState().tilemaps['ent-1']).toEqual(sampleTilemap);
      expect(mockDispatch).toHaveBeenCalledWith('set_tilemap_data', { entityId: 'ent-1', ...sampleTilemap });
    });

    it('removeTilemapData removes', () => {
      store.getState().setTilemapData('ent-1', sampleTilemap);
      store.getState().removeTilemapData('ent-1');
      expect(store.getState().tilemaps['ent-1']).toBeUndefined();
    });
  });

  describe('Tilemap editor state', () => {
    it('setActiveTileset sets active ID', () => {
      store.getState().setActiveTileset('tileset-001');
      expect(store.getState().activeTilesetId).toBe('tileset-001');
    });

    it('setTilemapActiveTool changes tool', () => {
      store.getState().setTilemapActiveTool('paint');
      expect(store.getState().tilemapActiveTool).toBe('paint');
      store.getState().setTilemapActiveTool('erase');
      expect(store.getState().tilemapActiveTool).toBe('erase');
    });

    it('setTilemapActiveLayerIndex selects layer', () => {
      store.getState().setTilemapActiveLayerIndex(2);
      expect(store.getState().tilemapActiveLayerIndex).toBe(2);
    });

    it('can reset to null', () => {
      store.getState().setActiveTileset('tileset-001');
      store.getState().setActiveTileset(null);
      expect(store.getState().activeTilesetId).toBeNull();
    });
  });

  describe('No dispatch when dispatcher null', () => {
    it('does not throw', () => {
      setSpriteDispatcher(null as never);
      store = createTestStore();
      expect(() => store.getState().setProjectType('2d')).not.toThrow();
    });
  });
});
