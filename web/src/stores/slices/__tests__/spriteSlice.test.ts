import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createSliceStore, createMockDispatch } from './sliceTestTemplate';
import { createSpriteSlice, setSpriteDispatcher, type SpriteSlice } from '../spriteSlice';
import type {
  SpriteData,
  Camera2dData,
  SortingLayerData,
  SpriteSheetData,
  SpriteAnimatorData,
  AnimationStateMachineData,
  TilesetData,
  TilemapData,
  Grid2dSettings,
} from '../types';

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
    it('should update projectType and dispatch when switching to 2d', () => {
      store.getState().setProjectType('2d');

      expect(store.getState().projectType).toBe('2d');
      expect(mockDispatch).toHaveBeenCalledWith('set_project_type', { projectType: '2d' });
    });

    it('should dispatch when switching back to 3d', () => {
      store.getState().setProjectType('2d');
      store.getState().setProjectType('3d');

      expect(store.getState().projectType).toBe('3d');
      expect(mockDispatch).toHaveBeenLastCalledWith('set_project_type', { projectType: '3d' });
    });

    it('should not dispatch when no dispatcher is set', () => {
      setSpriteDispatcher(null as unknown as (command: string, payload: unknown) => void);
      store.getState().setProjectType('2d');

      expect(store.getState().projectType).toBe('2d');
      expect(mockDispatch).not.toHaveBeenCalled();
    });
  });

  describe('setSpriteData', () => {
    it('should add sprite data and dispatch', () => {
      const data: SpriteData = {
        textureAssetId: 'hero.png',
        colorTint: [1, 1, 1, 1],
        flipX: false,
        flipY: false,
        customSize: null,
        sortingLayer: 'Default',
        sortingOrder: 0,
        anchor: 'center',
      };
      store.getState().setSpriteData('entity1', data);

      expect(store.getState().sprites.entity1).toEqual(data);
      expect(mockDispatch).toHaveBeenCalledWith('set_sprite_data', {
        entityId: 'entity1',
        ...data,
      });
    });

    it('should overwrite existing sprite data for the same entity', () => {
      const data1: SpriteData = { textureAssetId: 'hero.png' } as unknown as SpriteData;
      const data2: SpriteData = { textureAssetId: 'enemy.png' } as unknown as SpriteData;
      store.getState().setSpriteData('entity1', data1);
      store.getState().setSpriteData('entity1', data2);

      expect(store.getState().sprites.entity1).toEqual(data2);
    });

    it('should store data for multiple entities independently', () => {
      const data1: SpriteData = { textureAssetId: 'hero.png' } as unknown as SpriteData;
      const data2: SpriteData = { textureAssetId: 'enemy.png' } as unknown as SpriteData;
      store.getState().setSpriteData('entity1', data1);
      store.getState().setSpriteData('entity2', data2);

      expect(store.getState().sprites.entity1).toEqual(data1);
      expect(store.getState().sprites.entity2).toEqual(data2);
    });

    it('should not dispatch when no dispatcher is set', () => {
      setSpriteDispatcher(null as unknown as (command: string, payload: unknown) => void);
      store.getState().setSpriteData('entity1', { textureAssetId: null } as unknown as SpriteData);

      expect(mockDispatch).not.toHaveBeenCalled();
    });
  });

  describe('removeSpriteData', () => {
    it('should remove sprite data and dispatch', () => {
      const data: SpriteData = { textureAssetId: 'hero.png' } as unknown as SpriteData;
      store.getState().setSpriteData('entity1', data);

      store.getState().removeSpriteData('entity1');

      expect(store.getState().sprites.entity1).toBeUndefined();
      expect(mockDispatch).toHaveBeenCalledWith('remove_sprite_data', {
        entityId: 'entity1',
      });
    });

    it('should not affect other entities when removing one', () => {
      const data1: SpriteData = { textureAssetId: 'hero.png' } as unknown as SpriteData;
      const data2: SpriteData = { textureAssetId: 'enemy.png' } as unknown as SpriteData;
      store.getState().setSpriteData('entity1', data1);
      store.getState().setSpriteData('entity2', data2);

      store.getState().removeSpriteData('entity1');

      expect(store.getState().sprites.entity1).toBeUndefined();
      expect(store.getState().sprites.entity2).toEqual(data2);
    });

    it('should not dispatch when no dispatcher is set', () => {
      setSpriteDispatcher(null as unknown as (command: string, payload: unknown) => void);
      store.getState().removeSpriteData('entity1');

      expect(mockDispatch).not.toHaveBeenCalled();
    });
  });

  describe('spawnSprite', () => {
    it('should dispatch spawn_sprite with all options', () => {
      store.getState().spawnSprite({
        name: 'Hero',
        textureAssetId: 'hero.png',
        position: [1, 2, 3],
        sortingLayer: 'Foreground',
        sortingOrder: 5,
      });

      expect(mockDispatch).toHaveBeenCalledWith('spawn_sprite', {
        name: 'Hero',
        textureAssetId: 'hero.png',
        position: [1, 2, 3],
        sortingLayer: 'Foreground',
        sortingOrder: 5,
      });
    });

    it('should dispatch spawn_sprite with no options', () => {
      store.getState().spawnSprite();

      expect(mockDispatch).toHaveBeenCalledWith('spawn_sprite', {
        name: undefined,
        textureAssetId: undefined,
        position: undefined,
        sortingLayer: undefined,
        sortingOrder: undefined,
      });
    });

    it('should dispatch spawn_sprite with partial options', () => {
      store.getState().spawnSprite({ name: 'BG' });

      expect(mockDispatch).toHaveBeenCalledWith('spawn_sprite', {
        name: 'BG',
        textureAssetId: undefined,
        position: undefined,
        sortingLayer: undefined,
        sortingOrder: undefined,
      });
    });

    it('should normalize 2D position [x, y] to [x, y, 0]', () => {
      store.getState().spawnSprite({
        name: 'Sprite2D',
        position: [10, 20],
      });

      expect(mockDispatch).toHaveBeenCalledWith('spawn_sprite', {
        name: 'Sprite2D',
        textureAssetId: undefined,
        position: [10, 20, 0],
        sortingLayer: undefined,
        sortingOrder: undefined,
      });
    });

    it('should not dispatch when no dispatcher is set', () => {
      setSpriteDispatcher(null as unknown as (command: string, payload: unknown) => void);
      store.getState().spawnSprite({ name: 'Test' });

      expect(mockDispatch).not.toHaveBeenCalled();
    });
  });

  describe('setCamera2dData', () => {
    it('should set camera data and dispatch', () => {
      const data: Camera2dData = { zoom: 1.5, pixelPerfect: false, bounds: null };
      store.getState().setCamera2dData(data);

      expect(store.getState().camera2dData).toEqual(data);
      expect(mockDispatch).toHaveBeenCalledWith('set_camera_2d_data', data);
    });

    it('should overwrite previous camera data', () => {
      const data1: Camera2dData = { zoom: 1.0, pixelPerfect: false, bounds: null };
      const data2: Camera2dData = { zoom: 2.0, pixelPerfect: true, bounds: null };
      store.getState().setCamera2dData(data1);
      store.getState().setCamera2dData(data2);

      expect(store.getState().camera2dData).toEqual(data2);
    });

    it('should support camera bounds', () => {
      const data: Camera2dData = {
        zoom: 1.0,
        pixelPerfect: false,
        bounds: { minX: -100, maxX: 100, minY: -50, maxY: 50 },
      };
      store.getState().setCamera2dData(data);

      expect(store.getState().camera2dData?.bounds).toEqual({ minX: -100, maxX: 100, minY: -50, maxY: 50 });
    });

    it('should not dispatch when no dispatcher is set', () => {
      setSpriteDispatcher(null as unknown as (command: string, payload: unknown) => void);
      store.getState().setCamera2dData({ zoom: 1.0, pixelPerfect: false, bounds: null });

      expect(mockDispatch).not.toHaveBeenCalled();
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

      it('should add with order 0 when starting from empty list', () => {
        store.getState().setSortingLayers([]);
        store.getState().addSortingLayer('OnlyLayer');

        const layers = store.getState().sortingLayers;
        expect(layers).toHaveLength(1);
        expect(layers[0].order).toBe(0);
        expect(layers[0].name).toBe('OnlyLayer');
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

      it('should not affect other layers when removing one', () => {
        store.getState().removeSortingLayer('Foreground');

        const layers = store.getState().sortingLayers;
        expect(layers.find(l => l.name === 'Background')).toEqual({ name: 'Background', order: 0, visible: true });
        expect(layers.find(l => l.name === 'Default')).toEqual({ name: 'Default', order: 1, visible: true });
        expect(layers.find(l => l.name === 'UI')).toEqual({ name: 'UI', order: 3, visible: true });
      });

      it('should be a no-op when removing a nonexistent layer', () => {
        store.getState().removeSortingLayer('Nonexistent');

        expect(store.getState().sortingLayers).toHaveLength(4);
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

    it('should allow changing the grid color', () => {
      store.getState().setGrid2d({ color: '#ff0000' });

      expect(store.getState().grid2d.color).toBe('#ff0000');
    });

    it('should allow replacing the full grid settings object', () => {
      const full: Grid2dSettings = {
        enabled: true,
        size: 16,
        color: '#00ff00',
        opacity: 0.5,
        snapToGrid: true,
      };
      store.getState().setGrid2d(full);

      expect(store.getState().grid2d).toEqual(full);
    });
  });

  describe('sprite sheet CRUD', () => {
    describe('setSpriteSheet', () => {
      it('should set sprite sheet and dispatch', () => {
        const data: SpriteSheetData = {
          assetId: 'player-sheet',
          sliceMode: { type: 'grid', columns: 4, rows: 2, tileSize: [32, 32], padding: [0, 0], offset: [0, 0] },
          frames: [],
          clips: {},
        };
        store.getState().setSpriteSheet('entity1', data);

        expect(store.getState().spriteSheets.entity1).toEqual(data);
        expect(mockDispatch).toHaveBeenCalledWith('set_sprite_sheet', {
          entityId: 'entity1',
          ...data,
        });
      });

      it('should store sprite sheets for multiple entities independently', () => {
        const data1: SpriteSheetData = { assetId: 'sheet1' } as unknown as SpriteSheetData;
        const data2: SpriteSheetData = { assetId: 'sheet2' } as unknown as SpriteSheetData;
        store.getState().setSpriteSheet('entity1', data1);
        store.getState().setSpriteSheet('entity2', data2);

        expect(store.getState().spriteSheets.entity1).toEqual(data1);
        expect(store.getState().spriteSheets.entity2).toEqual(data2);
      });
    });

    describe('removeSpriteSheet', () => {
      it('should remove sprite sheet and dispatch', () => {
        const data: SpriteSheetData = { assetId: 'sheet1' } as unknown as SpriteSheetData;
        store.getState().setSpriteSheet('entity1', data);

        store.getState().removeSpriteSheet('entity1');

        expect(store.getState().spriteSheets.entity1).toBeUndefined();
        expect(mockDispatch).toHaveBeenCalledWith('remove_sprite_sheet', {
          entityId: 'entity1',
        });
      });

      it('should not affect other entities when removing a sprite sheet', () => {
        const data1: SpriteSheetData = { assetId: 'sheet1' } as unknown as SpriteSheetData;
        const data2: SpriteSheetData = { assetId: 'sheet2' } as unknown as SpriteSheetData;
        store.getState().setSpriteSheet('entity1', data1);
        store.getState().setSpriteSheet('entity2', data2);

        store.getState().removeSpriteSheet('entity1');

        expect(store.getState().spriteSheets.entity2).toEqual(data2);
      });
    });
  });

  describe('sprite animator CRUD', () => {
    describe('setSpriteAnimator', () => {
      it('should set sprite animator and dispatch', () => {
        const data: SpriteAnimatorData = {
          spriteSheetId: 'player-sheet',
          currentClip: 'idle',
          frameIndex: 0,
          playing: true,
          speed: 1.0,
        };
        store.getState().setSpriteAnimator('entity1', data);

        expect(store.getState().spriteAnimators.entity1).toEqual(data);
        expect(mockDispatch).toHaveBeenCalledWith('set_sprite_animator', {
          entityId: 'entity1',
          ...data,
        });
      });

      it('should handle null currentClip', () => {
        const data: SpriteAnimatorData = {
          spriteSheetId: 'player-sheet',
          currentClip: null,
          frameIndex: 0,
          playing: false,
          speed: 1.0,
        };
        store.getState().setSpriteAnimator('entity1', data);

        expect(store.getState().spriteAnimators.entity1?.currentClip).toBeNull();
      });

      it('should store animators for multiple entities independently', () => {
        const data1: SpriteAnimatorData = { spriteSheetId: 'sheet1' } as unknown as SpriteAnimatorData;
        const data2: SpriteAnimatorData = { spriteSheetId: 'sheet2' } as unknown as SpriteAnimatorData;
        store.getState().setSpriteAnimator('entity1', data1);
        store.getState().setSpriteAnimator('entity2', data2);

        expect(store.getState().spriteAnimators.entity1).toEqual(data1);
        expect(store.getState().spriteAnimators.entity2).toEqual(data2);
      });
    });

    describe('removeSpriteAnimator', () => {
      it('should remove sprite animator and dispatch', () => {
        const data: SpriteAnimatorData = { spriteSheetId: 'sheet1' } as unknown as SpriteAnimatorData;
        store.getState().setSpriteAnimator('entity1', data);

        store.getState().removeSpriteAnimator('entity1');

        expect(store.getState().spriteAnimators.entity1).toBeUndefined();
        expect(mockDispatch).toHaveBeenCalledWith('remove_sprite_animator', {
          entityId: 'entity1',
        });
      });

      it('should not affect other entities when removing an animator', () => {
        const data1: SpriteAnimatorData = { spriteSheetId: 'sheet1' } as unknown as SpriteAnimatorData;
        const data2: SpriteAnimatorData = { spriteSheetId: 'sheet2' } as unknown as SpriteAnimatorData;
        store.getState().setSpriteAnimator('entity1', data1);
        store.getState().setSpriteAnimator('entity2', data2);

        store.getState().removeSpriteAnimator('entity1');

        expect(store.getState().spriteAnimators.entity2).toEqual(data2);
      });
    });
  });

  describe('animation state machine CRUD', () => {
    describe('setAnimationStateMachine', () => {
      it('should set animation state machine and dispatch', () => {
        const data: AnimationStateMachineData = {
          states: { idle: 'idle_clip', walk: 'walk_clip' },
          transitions: [],
          currentState: 'idle',
          parameters: {},
        };
        store.getState().setAnimationStateMachine('entity1', data);

        expect(store.getState().animationStateMachines.entity1).toEqual(data);
        expect(mockDispatch).toHaveBeenCalledWith('set_animation_state_machine', {
          entityId: 'entity1',
          ...data,
        });
      });

      it('should store state machines for multiple entities independently', () => {
        const data1: AnimationStateMachineData = { states: { idle: 'idle' } } as unknown as AnimationStateMachineData;
        const data2: AnimationStateMachineData = { states: { run: 'run' } } as unknown as AnimationStateMachineData;
        store.getState().setAnimationStateMachine('entity1', data1);
        store.getState().setAnimationStateMachine('entity2', data2);

        expect(store.getState().animationStateMachines.entity1).toEqual(data1);
        expect(store.getState().animationStateMachines.entity2).toEqual(data2);
      });
    });

    describe('removeAnimationStateMachine', () => {
      it('should remove animation state machine and dispatch', () => {
        const data: AnimationStateMachineData = { states: {} } as unknown as AnimationStateMachineData;
        store.getState().setAnimationStateMachine('entity1', data);

        store.getState().removeAnimationStateMachine('entity1');

        expect(store.getState().animationStateMachines.entity1).toBeUndefined();
        expect(mockDispatch).toHaveBeenCalledWith('remove_animation_state_machine', {
          entityId: 'entity1',
        });
      });

      it('should not affect other entities when removing a state machine', () => {
        const data1: AnimationStateMachineData = { currentState: 'idle' } as unknown as AnimationStateMachineData;
        const data2: AnimationStateMachineData = { currentState: 'walk' } as unknown as AnimationStateMachineData;
        store.getState().setAnimationStateMachine('entity1', data1);
        store.getState().setAnimationStateMachine('entity2', data2);

        store.getState().removeAnimationStateMachine('entity1');

        expect(store.getState().animationStateMachines.entity2).toEqual(data2);
      });
    });
  });

  describe('tileset CRUD', () => {
    describe('setTileset', () => {
      it('should set tileset and dispatch with assetId in payload', () => {
        const data: TilesetData = {
          assetId: 'dungeon-tiles',
          name: 'Dungeon',
          tileSize: [16, 16],
          gridSize: [20, 15],
          spacing: 0,
          margin: 0,
          tiles: [],
        };
        store.getState().setTileset('asset1', data);

        expect(store.getState().tilesets.asset1).toEqual(data);
        expect(mockDispatch).toHaveBeenCalledWith('set_tileset', {
          ...data,
          assetId: 'asset1',
        });
      });

      it('should store tilesets for multiple asset IDs independently', () => {
        const data1: TilesetData = { assetId: 'dungeon' } as unknown as TilesetData;
        const data2: TilesetData = { assetId: 'overworld' } as unknown as TilesetData;
        store.getState().setTileset('asset1', data1);
        store.getState().setTileset('asset2', data2);

        expect(store.getState().tilesets.asset1).toEqual(data1);
        expect(store.getState().tilesets.asset2).toEqual(data2);
      });
    });

    describe('removeTileset', () => {
      it('should remove tileset and dispatch', () => {
        const data: TilesetData = { assetId: 'dungeon' } as unknown as TilesetData;
        store.getState().setTileset('asset1', data);

        store.getState().removeTileset('asset1');

        expect(store.getState().tilesets.asset1).toBeUndefined();
        expect(mockDispatch).toHaveBeenCalledWith('remove_tileset', {
          assetId: 'asset1',
        });
      });

      it('should not affect other tilesets when removing one', () => {
        const data1: TilesetData = { assetId: 'dungeon' } as unknown as TilesetData;
        const data2: TilesetData = { assetId: 'overworld' } as unknown as TilesetData;
        store.getState().setTileset('asset1', data1);
        store.getState().setTileset('asset2', data2);

        store.getState().removeTileset('asset1');

        expect(store.getState().tilesets.asset2).toEqual(data2);
      });
    });
  });

  describe('tilemap CRUD', () => {
    describe('setTilemapData', () => {
      it('should set tilemap data and dispatch', () => {
        const data: TilemapData = {
          tilesetAssetId: 'dungeon-tiles',
          tileSize: [16, 16],
          mapSize: [20, 15],
          layers: [{ name: 'Ground', tiles: [], visible: true, opacity: 1.0, isCollision: false }],
          origin: 'TopLeft',
        };
        store.getState().setTilemapData('entity1', data);

        expect(store.getState().tilemaps.entity1).toEqual(data);
        expect(mockDispatch).toHaveBeenCalledWith('set_tilemap_data', {
          entityId: 'entity1',
          ...data,
        });
      });

      it('should store tilemaps for multiple entities independently', () => {
        const data1: TilemapData = { tilesetAssetId: 'dungeon' } as unknown as TilemapData;
        const data2: TilemapData = { tilesetAssetId: 'overworld' } as unknown as TilemapData;
        store.getState().setTilemapData('entity1', data1);
        store.getState().setTilemapData('entity2', data2);

        expect(store.getState().tilemaps.entity1).toEqual(data1);
        expect(store.getState().tilemaps.entity2).toEqual(data2);
      });
    });

    describe('removeTilemapData', () => {
      it('should remove tilemap data and dispatch', () => {
        const data: TilemapData = { tilesetAssetId: 'dungeon' } as unknown as TilemapData;
        store.getState().setTilemapData('entity1', data);

        store.getState().removeTilemapData('entity1');

        expect(store.getState().tilemaps.entity1).toBeUndefined();
        expect(mockDispatch).toHaveBeenCalledWith('remove_tilemap_data', {
          entityId: 'entity1',
        });
      });

      it('should not affect other entities when removing tilemap data', () => {
        const data1: TilemapData = { tilesetAssetId: 'dungeon' } as unknown as TilemapData;
        const data2: TilemapData = { tilesetAssetId: 'overworld' } as unknown as TilemapData;
        store.getState().setTilemapData('entity1', data1);
        store.getState().setTilemapData('entity2', data2);

        store.getState().removeTilemapData('entity1');

        expect(store.getState().tilemaps.entity2).toEqual(data2);
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
