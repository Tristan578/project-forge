/**
 * Zustand store for tilemap editor state (editor-only, not synced with engine).
 */

import { create } from 'zustand';

export interface SelectedTiles {
  tilesetId: string;
  origin: [number, number];
  size: [number, number];
  tileIds: number[];
}

export interface TilemapEditorState {
  activeTool: 'paint' | 'erase' | 'fill' | 'rectangle' | 'picker';
  selectedTilesetId: string | null;
  selectedTiles: SelectedTiles | null;
  activeLayerIndex: number;
  showGrid: boolean;
  showCollision: boolean;

  setActiveTool: (tool: TilemapEditorState['activeTool']) => void;
  setSelectedTilesetId: (id: string | null) => void;
  setSelectedTiles: (tiles: SelectedTiles | null) => void;
  setActiveLayerIndex: (index: number) => void;
  toggleGrid: () => void;
  toggleCollision: () => void;
}

export const useTilemapEditorStore = create<TilemapEditorState>((set) => ({
  // Initial state
  activeTool: 'paint',
  selectedTilesetId: null,
  selectedTiles: null,
  activeLayerIndex: 0,
  showGrid: true,
  showCollision: false,

  // Actions
  setActiveTool: (tool) => set({ activeTool: tool }),
  setSelectedTilesetId: (id) => set({ selectedTilesetId: id }),
  setSelectedTiles: (tiles) => set({ selectedTiles: tiles }),
  setActiveLayerIndex: (index) => set({ activeLayerIndex: index }),
  toggleGrid: () => set((s) => ({ showGrid: !s.showGrid })),
  toggleCollision: () => set((s) => ({ showCollision: !s.showCollision })),
}));
