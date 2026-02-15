/**
 * Unit tests for the tilemapEditorStore Zustand store.
 *
 * Tests cover tilemap editor state: tools, selected tiles, layers,
 * grid/collision visibility toggles.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useTilemapEditorStore, type SelectedTiles } from '../tilemapEditorStore';

describe('tilemapEditorStore', () => {
  beforeEach(() => {
    // Reset store to initial state
    useTilemapEditorStore.setState({
      activeTool: 'paint',
      selectedTilesetId: null,
      selectedTiles: null,
      activeLayerIndex: 0,
      showGrid: true,
      showCollision: false,
    });
  });

  describe('Initial State', () => {
    it('should initialize with paint tool', () => {
      const state = useTilemapEditorStore.getState();
      expect(state.activeTool).toBe('paint');
    });

    it('should initialize with no tileset selected', () => {
      const state = useTilemapEditorStore.getState();
      expect(state.selectedTilesetId).toBeNull();
    });

    it('should initialize with no tiles selected', () => {
      const state = useTilemapEditorStore.getState();
      expect(state.selectedTiles).toBeNull();
    });

    it('should initialize with layer 0 active', () => {
      const state = useTilemapEditorStore.getState();
      expect(state.activeLayerIndex).toBe(0);
    });

    it('should initialize with grid visible', () => {
      const state = useTilemapEditorStore.getState();
      expect(state.showGrid).toBe(true);
    });

    it('should initialize with collision hidden', () => {
      const state = useTilemapEditorStore.getState();
      expect(state.showCollision).toBe(false);
    });
  });

  describe('Tool Selection', () => {
    it('should set paint tool', () => {
      const { setActiveTool } = useTilemapEditorStore.getState();
      setActiveTool('paint');
      expect(useTilemapEditorStore.getState().activeTool).toBe('paint');
    });

    it('should set erase tool', () => {
      const { setActiveTool } = useTilemapEditorStore.getState();
      setActiveTool('erase');
      expect(useTilemapEditorStore.getState().activeTool).toBe('erase');
    });

    it('should set fill tool', () => {
      const { setActiveTool } = useTilemapEditorStore.getState();
      setActiveTool('fill');
      expect(useTilemapEditorStore.getState().activeTool).toBe('fill');
    });

    it('should set rectangle tool', () => {
      const { setActiveTool } = useTilemapEditorStore.getState();
      setActiveTool('rectangle');
      expect(useTilemapEditorStore.getState().activeTool).toBe('rectangle');
    });

    it('should set picker tool', () => {
      const { setActiveTool } = useTilemapEditorStore.getState();
      setActiveTool('picker');
      expect(useTilemapEditorStore.getState().activeTool).toBe('picker');
    });
  });

  describe('Tileset Selection', () => {
    it('should set selected tileset', () => {
      const { setSelectedTilesetId } = useTilemapEditorStore.getState();
      setSelectedTilesetId('tileset-1');
      expect(useTilemapEditorStore.getState().selectedTilesetId).toBe('tileset-1');
    });

    it('should clear selected tileset', () => {
      useTilemapEditorStore.setState({ selectedTilesetId: 'tileset-1' });
      const { setSelectedTilesetId } = useTilemapEditorStore.getState();
      setSelectedTilesetId(null);
      expect(useTilemapEditorStore.getState().selectedTilesetId).toBeNull();
    });
  });

  describe('Tile Selection', () => {
    it('should set selected tiles', () => {
      const tiles: SelectedTiles = {
        tilesetId: 'tileset-1',
        origin: [0, 0],
        size: [2, 2],
        tileIds: [1, 2, 3, 4],
      };

      const { setSelectedTiles } = useTilemapEditorStore.getState();
      setSelectedTiles(tiles);

      const state = useTilemapEditorStore.getState();
      expect(state.selectedTiles).toEqual(tiles);
    });

    it('should handle single tile selection', () => {
      const tiles: SelectedTiles = {
        tilesetId: 'tileset-1',
        origin: [5, 3],
        size: [1, 1],
        tileIds: [42],
      };

      const { setSelectedTiles } = useTilemapEditorStore.getState();
      setSelectedTiles(tiles);

      const state = useTilemapEditorStore.getState();
      expect(state.selectedTiles?.tileIds).toHaveLength(1);
      expect(state.selectedTiles?.tileIds[0]).toBe(42);
    });

    it('should handle multi-tile selection', () => {
      const tiles: SelectedTiles = {
        tilesetId: 'tileset-1',
        origin: [0, 0],
        size: [3, 3],
        tileIds: [1, 2, 3, 4, 5, 6, 7, 8, 9],
      };

      const { setSelectedTiles } = useTilemapEditorStore.getState();
      setSelectedTiles(tiles);

      const state = useTilemapEditorStore.getState();
      expect(state.selectedTiles?.tileIds).toHaveLength(9);
    });

    it('should clear selected tiles', () => {
      useTilemapEditorStore.setState({
        selectedTiles: {
          tilesetId: 'tileset-1',
          origin: [0, 0],
          size: [1, 1],
          tileIds: [1],
        },
      });

      const { setSelectedTiles } = useTilemapEditorStore.getState();
      setSelectedTiles(null);

      expect(useTilemapEditorStore.getState().selectedTiles).toBeNull();
    });
  });

  describe('Layer Management', () => {
    it('should set active layer index', () => {
      const { setActiveLayerIndex } = useTilemapEditorStore.getState();
      setActiveLayerIndex(2);
      expect(useTilemapEditorStore.getState().activeLayerIndex).toBe(2);
    });

    it('should handle layer 0', () => {
      useTilemapEditorStore.setState({ activeLayerIndex: 5 });
      const { setActiveLayerIndex } = useTilemapEditorStore.getState();
      setActiveLayerIndex(0);
      expect(useTilemapEditorStore.getState().activeLayerIndex).toBe(0);
    });

    it('should handle high layer indices', () => {
      const { setActiveLayerIndex } = useTilemapEditorStore.getState();
      setActiveLayerIndex(99);
      expect(useTilemapEditorStore.getState().activeLayerIndex).toBe(99);
    });
  });

  describe('Visibility Toggles', () => {
    it('should toggle grid visibility on', () => {
      useTilemapEditorStore.setState({ showGrid: false });
      const { toggleGrid } = useTilemapEditorStore.getState();
      toggleGrid();
      expect(useTilemapEditorStore.getState().showGrid).toBe(true);
    });

    it('should toggle grid visibility off', () => {
      useTilemapEditorStore.setState({ showGrid: true });
      const { toggleGrid } = useTilemapEditorStore.getState();
      toggleGrid();
      expect(useTilemapEditorStore.getState().showGrid).toBe(false);
    });

    it('should toggle collision visibility on', () => {
      useTilemapEditorStore.setState({ showCollision: false });
      const { toggleCollision } = useTilemapEditorStore.getState();
      toggleCollision();
      expect(useTilemapEditorStore.getState().showCollision).toBe(true);
    });

    it('should toggle collision visibility off', () => {
      useTilemapEditorStore.setState({ showCollision: true });
      const { toggleCollision } = useTilemapEditorStore.getState();
      toggleCollision();
      expect(useTilemapEditorStore.getState().showCollision).toBe(false);
    });

    it('should toggle both independently', () => {
      const { toggleGrid, toggleCollision } = useTilemapEditorStore.getState();

      toggleGrid();
      expect(useTilemapEditorStore.getState().showGrid).toBe(false);
      expect(useTilemapEditorStore.getState().showCollision).toBe(false);

      toggleCollision();
      expect(useTilemapEditorStore.getState().showGrid).toBe(false);
      expect(useTilemapEditorStore.getState().showCollision).toBe(true);

      toggleGrid();
      expect(useTilemapEditorStore.getState().showGrid).toBe(true);
      expect(useTilemapEditorStore.getState().showCollision).toBe(true);
    });
  });

  describe('State Consistency', () => {
    it('should maintain independent state updates', () => {
      const {
        setActiveTool,
        setSelectedTilesetId,
        setActiveLayerIndex,
        toggleGrid,
      } = useTilemapEditorStore.getState();

      setActiveTool('fill');
      setSelectedTilesetId('tileset-123');
      setActiveLayerIndex(3);
      toggleGrid();

      const state = useTilemapEditorStore.getState();
      expect(state.activeTool).toBe('fill');
      expect(state.selectedTilesetId).toBe('tileset-123');
      expect(state.activeLayerIndex).toBe(3);
      expect(state.showGrid).toBe(false);
      expect(state.showCollision).toBe(false);
    });
  });
});
