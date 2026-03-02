import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createSliceStore, createMockDispatch } from './sliceTestTemplate';
import { createSpriteSlice, setSpriteDispatcher, type SpriteSlice } from '../spriteSlice';
import type { SpriteData, Camera2dData, SortingLayerData, SpriteSheetData, SpriteAnimatorData, AnimationStateMachineData, TilesetData, TilemapData } from '../types';

let store: ReturnType<typeof createSliceStore<SpriteSlice>>;
let mockDispatch: ReturnType<typeof createMockDispatch>;

beforeEach(() => {
  store = createSliceStore(createSpriteSlice);
  mockDispatch = createMockDispatch();
  setSpriteDispatcher(mockDispatch);
});

afterEach(() => {
  setSpriteDispatcher(null as unknown as (command: string, payload: unknown) => void);
});

describe('spriteSlice', () => {
  describe('initial state', () => {
    it('should have projectType "3d"', () => {
      expect(store.getState().projectType).toBe('3d');
    });

    it('should have empty sprites', () => {
      expect(store.getState().sprites).toEqual({});
    });

    it('should have null camera2dData', () => {
      expect(store.getState().camera2dData).toBeNull();
    });

    it('should have default sorting layers', () => {
      expect(store.getState().sortingLayers).toEqual([
        { name: 'Background', order: 0, visible: true },
        { name: 'Default', order: 1, visible: true },
        { name: 'Foreground', order: 2, visible: true },
        { name: 'UI', order: 3, visible: true },
      ]);
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

    it('should have empty spriteSheets', () => {
      expect(store.getState().spriteSheets).toEqual({});
    });

    it('should have empty spriteAnimators', () => {
      expect(store.getState().spriteAnimators).toEqual({});
    });

    it('should have empty animationStateMachines', () => {
      expect(store.getState().animationStateMachines).toEqual({});
    });

    it('should have empty tilesets', () => {
      expect(store.getState().tilesets).toEqual({});
    });

    it('should have empty tilemaps', () => {
      expect(store.getState().tilemaps).toEqual({});
    });

    it('should have null activeTilesetId', () => {
      expect(store.getState().activeTilesetId).toBeNull();
    });

    it('should have null tilemapActiveTool', () => {
      expect(store.getState().tilemapActiveTool).toBeNull();
    });

    it('should have null tilemapActiveLayerIndex', () => {
      expect(store.getState().tilemapActiveLayerIndex).toBeNull();
    });
  });

  describe('setProjectType', () => {
    it('should update projectType and dispatch', () => {
      store.getState().setProjectType('2d' as unknown as SpriteSlice['projectType']);

      expect(store.getState().projectType).toBe('2d');
      expect(mockDispatch).toHaveBeenCalledWith('set_project_type', { projectType: '2d' });
    });
  });

  describe('setSpriteData', () => {
    it('should add sprite data and dispatch', () => {
      const data: SpriteData = { texture: 'hero.png', width: 64, height: 64 } as unknown as SpriteData;
      store.getState().setSpriteData('entity1', data);

      expect(store.getState().sprites.entity1).toEqual(data);
      expect(mockDispatch).toHaveBeenCalledWith('set_sprite_data', {
        entityId: 'entity1',
        ...data,
      });
    });

    it('should overwrite existing sprite data', () => {
      const data1: SpriteData = { texture: 'hero.png' } as unknown as SpriteData;
      const data2: SpriteData = { texture: 'enemy.png' } as unknown as SpriteData;
      store.getState().setSpriteData('entity1', data1);
      store.getState().setSpriteData('entity1', data2);

      expect(store.getState().sprites.entity1).toEqual(data2);
    });
  });

  describe('removeSpriteData', () => {
    it('should remove sprite data and dispatch', () => {
      const data: SpriteData = { texture: 'hero.png' } as unknown as SpriteData;
      store.getState().setSpriteData('entity1', data);

      store.getState().removeSpriteData('entity1');

      expect(store.getState().sprites.entity1).toBeUndefined();
      expect(mockDispatch).toHaveBeenCalledWith('remove_sprite_data', {
        entityId: 'entity1',
      });
    });
  });

  describe('setCamera2dData', () => {
    it('should set camera data and dispatch', () => {
      const data: Camera2dData = { zoom: 1.5, x: 100, y: 200 } as unknown as Camera2dData;
      store.getState().setCamera2dData(data);

      expect(store.getState().camera2dData).toEqual(data);
      expect(mockDispatch).toHaveBeenCalledWith('set_camera_2d_data', data);
    });
  });

  describe('sorting layer operations', () => {
    describe('setSortingLayers', () => {
      it('should replace all sorting layers (state only)', () => {
        const layers: SortingLayerData[] = [
          { name: 'Custom', order: 0, visible: true },
        ] as unknown as SortingLayerData[];
        store.getState().setSortingLayers(layers);

        expect(store.getState().sortingLayers).toEqual(layers);
        expect(mockDispatch).not.toHaveBeenCalled();
      });
    });

    describe('addSortingLayer', () => {
      it('should add a layer with order = max + 1', () => {
        store.getState().addSortingLayer('Effects');

        const layers = store.getState().sortingLayers;
        expect(layers).toHaveLength(5);
        const added = layers[4];
        expect(added.name).toBe('Effects');
        expect(added.order).toBe(4);
        expect(added.visible).toBe(true);
        expect(mockDispatch).not.toHaveBeenCalled();
      });

      it('should compute order correctly after layers are replaced', () => {
        store.getState().setSortingLayers([
          { name: 'A', order: 10, visible: true } as unknown as SortingLayerData,
        ]);
        store.getState().addSortingLayer('B');

        const layers = store.getState().sortingLayers;
        expect(layers).toHaveLength(2);
        expect(layers[1].order).toBe(11);
      });
    });

    describe('removeSortingLayer', () => {
      it('should remove a layer by name', () => {
        store.getState().removeSortingLayer('Default');

        const layers = store.getState().sortingLayers;
        expect(layers).toHaveLength(3);
        expect(layers.find(l => l.name === 'Default')).toBeUndefined();
        expect(mockDispatch).not.toHaveBeenCalled();
      });
    });

    describe('toggleLayerVisibility', () => {
      it('should toggle visible from true to false', () => {
        store.getState().toggleLayerVisibility('Background');

        const layer = store.getState().sortingLayers.find(l => l.name === 'Background');
        expect(layer?.visible).toBe(false);
        expect(mockDispatch).not.toHaveBeenCalled();
      });

      it('should toggle visible from false back to true', () => {
        store.getState().toggleLayerVisibility('Background');
        store.getState().toggleLayerVisibility('Background');

        const layer = store.getState().sortingLayers.find(l => l.name === 'Background');
        expect(layer?.visible).toBe(true);
      });

      it('should only toggle the specified layer', () => {
        store.getState().toggleLayerVisibility('UI');

        const layers = store.getState().sortingLayers;
        expect(layers.find(l => l.name === 'Background')?.visible).toBe(true);
        expect(layers.find(l => l.name === 'Default')?.visible).toBe(true);
        expect(layers.find(l => l.name === 'Foreground')?.visible).toBe(true);
        expect(layers.find(l => l.name === 'UI')?.visible).toBe(false);
      });
    });
  });

  describe('setGrid2d', () => {
    it('should merge partial settings into existing grid2d', () => {
      store.getState().setGrid2d({ enabled: true, size: 64 });

      expect(store.getState().grid2d).toEqual({
        enabled: true,
        size: 64,
        color: '#ffffff',
        opacity: 0.2,
        snapToGrid: false,
      });
      expect(mockDispatch).not.toHaveBeenCalled();
    });

    it('should allow updating a single property', () => {
      store.getState().setGrid2d({ snapToGrid: true });

      expect(store.getState().grid2d.snapToGrid).toBe(true);
      expect(store.getState().grid2d.enabled).toBe(false);
    });
  });

  describe('sprite sheet CRUD', () => {
    describe('setSpriteSheet', () => {
      it('should set sprite sheet and dispatch', () => {
        const data: SpriteSheetData = { frameWidth: 32, frameHeight: 32 } as unknown as SpriteSheetData;
        store.getState().setSpriteSheet('entity1', data);

        expect(store.getState().spriteSheets.entity1).toEqual(data);
        expect(mockDispatch).toHaveBeenCalledWith('set_sprite_sheet', {
          entityId: 'entity1',
          ...data,
        });
      });
    });

    describe('removeSpriteSheet', () => {
      it('should remove sprite sheet and dispatch', () => {
        const data: SpriteSheetData = { frameWidth: 32, frameHeight: 32 } as unknown as SpriteSheetData;
        store.getState().setSpriteSheet('entity1', data);

        store.getState().removeSpriteSheet('entity1');

        expect(store.getState().spriteSheets.entity1).toBeUndefined();
        expect(mockDispatch).toHaveBeenCalledWith('remove_sprite_sheet', {
          entityId: 'entity1',
        });
      });
    });
  });

  describe('sprite animator CRUD', () => {
    describe('setSpriteAnimator', () => {
      it('should set sprite animator and dispatch', () => {
        const data: SpriteAnimatorData = { clips: [], currentClip: 0 } as unknown as SpriteAnimatorData;
        store.getState().setSpriteAnimator('entity1', data);

        expect(store.getState().spriteAnimators.entity1).toEqual(data);
        expect(mockDispatch).toHaveBeenCalledWith('set_sprite_animator', {
          entityId: 'entity1',
          ...data,
        });
      });
    });

    describe('removeSpriteAnimator', () => {
      it('should remove sprite animator and dispatch', () => {
        const data: SpriteAnimatorData = { clips: [] } as unknown as SpriteAnimatorData;
        store.getState().setSpriteAnimator('entity1', data);

        store.getState().removeSpriteAnimator('entity1');

        expect(store.getState().spriteAnimators.entity1).toBeUndefined();
        expect(mockDispatch).toHaveBeenCalledWith('remove_sprite_animator', {
          entityId: 'entity1',
        });
      });
    });
  });

  describe('animation state machine CRUD', () => {
    describe('setAnimationStateMachine', () => {
      it('should set animation state machine and dispatch', () => {
        const data: AnimationStateMachineData = { states: [], transitions: [] } as unknown as AnimationStateMachineData;
        store.getState().setAnimationStateMachine('entity1', data);

        expect(store.getState().animationStateMachines.entity1).toEqual(data);
        expect(mockDispatch).toHaveBeenCalledWith('set_animation_state_machine', {
          entityId: 'entity1',
          ...data,
        });
      });
    });

    describe('removeAnimationStateMachine', () => {
      it('should remove animation state machine and dispatch', () => {
        const data: AnimationStateMachineData = { states: [] } as unknown as AnimationStateMachineData;
        store.getState().setAnimationStateMachine('entity1', data);

        store.getState().removeAnimationStateMachine('entity1');

        expect(store.getState().animationStateMachines.entity1).toBeUndefined();
        expect(mockDispatch).toHaveBeenCalledWith('remove_animation_state_machine', {
          entityId: 'entity1',
        });
      });
    });
  });

  describe('tileset CRUD', () => {
    describe('setTileset', () => {
      it('should set tileset and dispatch with assetId in payload', () => {
        const data: TilesetData = { tileWidth: 16, tileHeight: 16 } as unknown as TilesetData;
        store.getState().setTileset('asset1', data);

        expect(store.getState().tilesets.asset1).toEqual(data);
        expect(mockDispatch).toHaveBeenCalledWith('set_tileset', {
          ...data,
          assetId: 'asset1',
        });
      });
    });

    describe('removeTileset', () => {
      it('should remove tileset and dispatch', () => {
        const data: TilesetData = { tileWidth: 16, tileHeight: 16 } as unknown as TilesetData;
        store.getState().setTileset('asset1', data);

        store.getState().removeTileset('asset1');

        expect(store.getState().tilesets.asset1).toBeUndefined();
        expect(mockDispatch).toHaveBeenCalledWith('remove_tileset', {
          assetId: 'asset1',
        });
      });
    });
  });

  describe('tilemap CRUD', () => {
    describe('setTilemapData', () => {
      it('should set tilemap data and dispatch', () => {
        const data: TilemapData = { width: 100, height: 100, layers: [] } as unknown as TilemapData;
        store.getState().setTilemapData('entity1', data);

        expect(store.getState().tilemaps.entity1).toEqual(data);
        expect(mockDispatch).toHaveBeenCalledWith('set_tilemap_data', {
          entityId: 'entity1',
          ...data,
        });
      });
    });

    describe('removeTilemapData', () => {
      it('should remove tilemap data and dispatch', () => {
        const data: TilemapData = { width: 100, height: 100 } as unknown as TilemapData;
        store.getState().setTilemapData('entity1', data);

        store.getState().removeTilemapData('entity1');

        expect(store.getState().tilemaps.entity1).toBeUndefined();
        expect(mockDispatch).toHaveBeenCalledWith('remove_tilemap_data', {
          entityId: 'entity1',
        });
      });
    });
  });

  describe('tilemap UI state', () => {
    describe('setActiveTileset', () => {
      it('should set activeTilesetId (state only)', () => {
        store.getState().setActiveTileset('asset1');

        expect(store.getState().activeTilesetId).toBe('asset1');
        expect(mockDispatch).not.toHaveBeenCalled();
      });

      it('should allow setting to null', () => {
        store.getState().setActiveTileset('asset1');
        store.getState().setActiveTileset(null);

        expect(store.getState().activeTilesetId).toBeNull();
      });
    });

    describe('setTilemapActiveTool', () => {
      it('should set tilemapActiveTool (state only)', () => {
        store.getState().setTilemapActiveTool('paint');

        expect(store.getState().tilemapActiveTool).toBe('paint');
        expect(mockDispatch).not.toHaveBeenCalled();
      });

      it('should support all tool types', () => {
        const tools: Array<'paint' | 'erase' | 'fill' | 'rectangle' | 'picker'> = [
          'paint', 'erase', 'fill', 'rectangle', 'picker',
        ];
        for (const tool of tools) {
          store.getState().setTilemapActiveTool(tool);
          expect(store.getState().tilemapActiveTool).toBe(tool);
        }
      });

      it('should allow setting to null', () => {
        store.getState().setTilemapActiveTool('paint');
        store.getState().setTilemapActiveTool(null);

        expect(store.getState().tilemapActiveTool).toBeNull();
      });
    });

    describe('setTilemapActiveLayerIndex', () => {
      it('should set tilemapActiveLayerIndex (state only)', () => {
        store.getState().setTilemapActiveLayerIndex(2);

        expect(store.getState().tilemapActiveLayerIndex).toBe(2);
        expect(mockDispatch).not.toHaveBeenCalled();
      });

      it('should allow setting to null', () => {
        store.getState().setTilemapActiveLayerIndex(2);
        store.getState().setTilemapActiveLayerIndex(null);

        expect(store.getState().tilemapActiveLayerIndex).toBeNull();
      });
    });
  });
});
