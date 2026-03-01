import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createSliceStore, createMockDispatch } from './sliceTestTemplate';
import { createSpriteSlice, setSpriteDispatcher, type SpriteSlice } from '../spriteSlice';

describe('spriteSlice', () => {
  let store: ReturnType<typeof createSliceStore<SpriteSlice>>;
  let mockDispatch: ReturnType<typeof createMockDispatch>;

  beforeEach(() => {
    mockDispatch = createMockDispatch();
    setSpriteDispatcher(mockDispatch);
    store = createSliceStore(createSpriteSlice);
  });

  afterEach(() => {
    setSpriteDispatcher(null as unknown as (command: string, payload: unknown) => void);
  });

  describe('Initial state', () => {
    it('should start with 3D project type and empty collections', () => {
      expect(store.getState().projectType).toBe('3d');
      expect(store.getState().sprites).toEqual({});
      expect(store.getState().camera2dData).toBeNull();
      expect(store.getState().spriteSheets).toEqual({});
      expect(store.getState().spriteAnimators).toEqual({});
      expect(store.getState().animationStateMachines).toEqual({});
      expect(store.getState().tilesets).toEqual({});
      expect(store.getState().tilemaps).toEqual({});
      expect(store.getState().activeTilesetId).toBeNull();
      expect(store.getState().tilemapActiveTool).toBeNull();
      expect(store.getState().tilemapActiveLayerIndex).toBeNull();
    });

    it('should have 4 default sorting layers', () => {
      const layers = store.getState().sortingLayers;
      expect(layers).toHaveLength(4);
      expect(layers.map(l => l.name)).toEqual(['Background', 'Default', 'Foreground', 'UI']);
      expect(layers.every(l => l.visible)).toBe(true);
    });

    it('should have default grid2d settings', () => {
      expect(store.getState().grid2d).toEqual({
        enabled: false,
        size: 32,
        color: '#ffffff',
        opacity: 0.2,
        snapToGrid: false,
      });
    });
  });

  describe('setProjectType', () => {
    it('should change project type', () => {
      store.getState().setProjectType('2d');
      expect(store.getState().projectType).toBe('2d');
    });

    it('should dispatch set_project_type', () => {
      store.getState().setProjectType('2d');
      expect(mockDispatch).toHaveBeenCalledWith('set_project_type', { projectType: '2d' });
    });
  });

  describe('sprite data CRUD', () => {
    it('should set sprite data', () => {
      const data = { atlas: 'player', frame: 0 };
      store.getState().setSpriteData('ent-1', data as never);
      expect(store.getState().sprites['ent-1']).toEqual(data);
    });

    it('should dispatch set_sprite_data', () => {
      store.getState().setSpriteData('ent-1', { atlas: 'player' } as never);
      expect(mockDispatch).toHaveBeenCalledWith('set_sprite_data', expect.objectContaining({ entityId: 'ent-1' }));
    });

    it('should remove sprite data', () => {
      store.getState().setSpriteData('ent-1', { atlas: 'x' } as never);
      store.getState().removeSpriteData('ent-1');
      expect(store.getState().sprites['ent-1']).toBeUndefined();
    });

    it('should not affect other sprites on remove', () => {
      store.getState().setSpriteData('ent-1', { atlas: 'a' } as never);
      store.getState().setSpriteData('ent-2', { atlas: 'b' } as never);
      store.getState().removeSpriteData('ent-1');
      expect(store.getState().sprites['ent-2']).toBeDefined();
    });

    it('should dispatch remove_sprite_data', () => {
      store.getState().removeSpriteData('ent-1');
      expect(mockDispatch).toHaveBeenCalledWith('remove_sprite_data', { entityId: 'ent-1' });
    });
  });

  describe('camera2d', () => {
    it('should set camera 2D data', () => {
      const cam = { zoom: 2.0, position: [0, 0] };
      store.getState().setCamera2dData(cam as never);
      expect(store.getState().camera2dData).toEqual(cam);
    });

    it('should dispatch set_camera_2d_data', () => {
      store.getState().setCamera2dData({ zoom: 1 } as never);
      expect(mockDispatch).toHaveBeenCalledWith('set_camera_2d_data', { zoom: 1 });
    });
  });

  describe('sorting layers', () => {
    it('should set sorting layers', () => {
      const layers = [{ name: 'Custom', order: 0, visible: true }];
      store.getState().setSortingLayers(layers);
      expect(store.getState().sortingLayers).toEqual(layers);
    });

    it('should add a sorting layer with next order', () => {
      store.getState().addSortingLayer('Particles');
      const layers = store.getState().sortingLayers;
      expect(layers).toHaveLength(5);
      expect(layers[4].name).toBe('Particles');
      expect(layers[4].order).toBe(4); // max existing is 3 (UI)
      expect(layers[4].visible).toBe(true);
    });

    it('should remove a sorting layer by name', () => {
      store.getState().removeSortingLayer('Foreground');
      const names = store.getState().sortingLayers.map(l => l.name);
      expect(names).not.toContain('Foreground');
      expect(names).toHaveLength(3);
    });

    it('should toggle layer visibility', () => {
      store.getState().toggleLayerVisibility('Default');
      const layer = store.getState().sortingLayers.find(l => l.name === 'Default');
      expect(layer?.visible).toBe(false);
    });

    it('should toggle visibility back on', () => {
      store.getState().toggleLayerVisibility('Default');
      store.getState().toggleLayerVisibility('Default');
      const layer = store.getState().sortingLayers.find(l => l.name === 'Default');
      expect(layer?.visible).toBe(true);
    });
  });

  describe('grid2d', () => {
    it('should merge grid settings', () => {
      store.getState().setGrid2d({ enabled: true, snapToGrid: true });
      expect(store.getState().grid2d.enabled).toBe(true);
      expect(store.getState().grid2d.snapToGrid).toBe(true);
      expect(store.getState().grid2d.size).toBe(32); // unchanged
    });
  });

  describe('sprite sheets', () => {
    it('should set sprite sheet data', () => {
      const data = { columns: 4, rows: 4, frameCount: 16 };
      store.getState().setSpriteSheet('ent-1', data as never);
      expect(store.getState().spriteSheets['ent-1']).toEqual(data);
    });

    it('should dispatch set_sprite_sheet', () => {
      store.getState().setSpriteSheet('ent-1', { columns: 4 } as never);
      expect(mockDispatch).toHaveBeenCalledWith('set_sprite_sheet', expect.objectContaining({ entityId: 'ent-1' }));
    });

    it('should remove sprite sheet', () => {
      store.getState().setSpriteSheet('ent-1', { columns: 4 } as never);
      store.getState().removeSpriteSheet('ent-1');
      expect(store.getState().spriteSheets['ent-1']).toBeUndefined();
    });
  });

  describe('sprite animators', () => {
    it('should set sprite animator', () => {
      const data = { clips: ['walk', 'run'] };
      store.getState().setSpriteAnimator('ent-1', data as never);
      expect(store.getState().spriteAnimators['ent-1']).toEqual(data);
    });

    it('should remove sprite animator', () => {
      store.getState().setSpriteAnimator('ent-1', {} as never);
      store.getState().removeSpriteAnimator('ent-1');
      expect(store.getState().spriteAnimators['ent-1']).toBeUndefined();
    });
  });

  describe('animation state machines', () => {
    it('should set animation state machine', () => {
      const data = { states: ['idle', 'walk'], transitions: [] };
      store.getState().setAnimationStateMachine('ent-1', data as never);
      expect(store.getState().animationStateMachines['ent-1']).toEqual(data);
    });

    it('should remove animation state machine', () => {
      store.getState().setAnimationStateMachine('ent-1', {} as never);
      store.getState().removeAnimationStateMachine('ent-1');
      expect(store.getState().animationStateMachines['ent-1']).toBeUndefined();
    });
  });

  describe('tilesets', () => {
    it('should set tileset data', () => {
      const data = { tileSize: 16, columns: 10 };
      store.getState().setTileset('asset-1', data as never);
      expect(store.getState().tilesets['asset-1']).toEqual(data);
    });

    it('should dispatch set_tileset', () => {
      store.getState().setTileset('asset-1', { tileSize: 16 } as never);
      expect(mockDispatch).toHaveBeenCalledWith('set_tileset', expect.objectContaining({ assetId: 'asset-1' }));
    });

    it('should remove tileset', () => {
      store.getState().setTileset('asset-1', {} as never);
      store.getState().removeTileset('asset-1');
      expect(store.getState().tilesets['asset-1']).toBeUndefined();
    });
  });

  describe('tilemaps', () => {
    it('should set tilemap data', () => {
      const data = { width: 100, height: 100 };
      store.getState().setTilemapData('ent-1', data as never);
      expect(store.getState().tilemaps['ent-1']).toEqual(data);
    });

    it('should remove tilemap data', () => {
      store.getState().setTilemapData('ent-1', {} as never);
      store.getState().removeTilemapData('ent-1');
      expect(store.getState().tilemaps['ent-1']).toBeUndefined();
    });

    it('should dispatch set_tilemap_data', () => {
      store.getState().setTilemapData('ent-1', { width: 50 } as never);
      expect(mockDispatch).toHaveBeenCalledWith('set_tilemap_data', expect.objectContaining({ entityId: 'ent-1' }));
    });
  });

  describe('tilemap editing state', () => {
    it('should set active tileset', () => {
      store.getState().setActiveTileset('asset-1');
      expect(store.getState().activeTilesetId).toBe('asset-1');
    });

    it('should clear active tileset', () => {
      store.getState().setActiveTileset('asset-1');
      store.getState().setActiveTileset(null);
      expect(store.getState().activeTilesetId).toBeNull();
    });

    it('should set tilemap active tool', () => {
      store.getState().setTilemapActiveTool('paint');
      expect(store.getState().tilemapActiveTool).toBe('paint');
    });

    it('should set tilemap active layer index', () => {
      store.getState().setTilemapActiveLayerIndex(2);
      expect(store.getState().tilemapActiveLayerIndex).toBe(2);
    });

    it('should clear tilemap active layer index', () => {
      store.getState().setTilemapActiveLayerIndex(2);
      store.getState().setTilemapActiveLayerIndex(null);
      expect(store.getState().tilemapActiveLayerIndex).toBeNull();
    });
  });
});
