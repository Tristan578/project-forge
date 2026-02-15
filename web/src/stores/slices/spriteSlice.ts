/**
 * Sprite slice - manages 2D sprites, tilemaps, sprite animations, and sorting layers.
 * TODO: Extract full implementation from editorStore.ts
 */

import { StateCreator } from 'zustand';
import type { ProjectType, SpriteData, Camera2dData, SortingLayerData, Grid2dSettings, SpriteSheetData, SpriteAnimatorData, AnimationStateMachineData, TilesetData, TilemapData } from './types';

export interface SpriteSlice {
  projectType: ProjectType;
  sprites: Record<string, SpriteData>;
  camera2dData: Camera2dData | null;
  sortingLayers: SortingLayerData[];
  grid2d: Grid2dSettings;
  spriteSheets: Record<string, SpriteSheetData>;
  spriteAnimators: Record<string, SpriteAnimatorData>;
  animationStateMachines: Record<string, AnimationStateMachineData>;
  tilesets: Record<string, TilesetData>;
  tilemaps: Record<string, TilemapData>;
  activeTilesetId: string | null;
  tilemapActiveTool: 'paint' | 'erase' | 'fill' | 'rectangle' | 'picker' | null;
  tilemapActiveLayerIndex: number | null;

  setProjectType: (type: ProjectType) => void;
  setSpriteData: (entityId: string, data: SpriteData) => void;
  removeSpriteData: (entityId: string) => void;
  setCamera2dData: (data: Camera2dData) => void;
  setSortingLayers: (layers: SortingLayerData[]) => void;
  addSortingLayer: (name: string) => void;
  removeSortingLayer: (name: string) => void;
  toggleLayerVisibility: (name: string) => void;
  setGrid2d: (settings: Partial<Grid2dSettings>) => void;
  setSpriteSheet: (entityId: string, data: SpriteSheetData) => void;
  removeSpriteSheet: (entityId: string) => void;
  setSpriteAnimator: (entityId: string, data: SpriteAnimatorData) => void;
  removeSpriteAnimator: (entityId: string) => void;
  setAnimationStateMachine: (entityId: string, data: AnimationStateMachineData) => void;
  removeAnimationStateMachine: (entityId: string) => void;
  setTileset: (assetId: string, data: TilesetData) => void;
  removeTileset: (assetId: string) => void;
  setTilemapData: (entityId: string, data: TilemapData) => void;
  removeTilemapData: (entityId: string) => void;
  setActiveTileset: (assetId: string | null) => void;
  setTilemapActiveTool: (tool: 'paint' | 'erase' | 'fill' | 'rectangle' | 'picker' | null) => void;
  setTilemapActiveLayerIndex: (index: number | null) => void;
}

let dispatchCommand: ((command: string, payload: unknown) => void) | null = null;

export function setSpriteDispatcher(dispatcher: (command: string, payload: unknown) => void): void {
  dispatchCommand = dispatcher;
}

export const createSpriteSlice: StateCreator<SpriteSlice, [], [], SpriteSlice> = (set, get) => ({
  projectType: '3d',
  sprites: {},
  camera2dData: null,
  sortingLayers: [
    { name: 'Background', order: 0, visible: true },
    { name: 'Default', order: 1, visible: true },
    { name: 'Foreground', order: 2, visible: true },
    { name: 'UI', order: 3, visible: true },
  ],
  grid2d: { enabled: false, size: 32, color: '#ffffff', opacity: 0.2, snapToGrid: false },
  spriteSheets: {},
  spriteAnimators: {},
  animationStateMachines: {},
  tilesets: {},
  tilemaps: {},
  activeTilesetId: null,
  tilemapActiveTool: null,
  tilemapActiveLayerIndex: null,

  setProjectType: (type) => {
    set({ projectType: type });
    if (dispatchCommand) dispatchCommand('set_project_type', { projectType: type });
  },
  setSpriteData: (entityId, data) => {
    set(state => ({ sprites: { ...state.sprites, [entityId]: data } }));
    if (dispatchCommand) dispatchCommand('set_sprite_data', { entityId, ...data });
  },
  removeSpriteData: (entityId) => {
    set(state => {
      const { [entityId]: _, ...rest } = state.sprites;
      return { sprites: rest };
    });
    if (dispatchCommand) dispatchCommand('remove_sprite_data', { entityId });
  },
  setCamera2dData: (data) => {
    set({ camera2dData: data });
    if (dispatchCommand) dispatchCommand('set_camera_2d_data', data);
  },
  setSortingLayers: (layers) => set({ sortingLayers: layers }),
  addSortingLayer: (name) => {
    const state = get();
    const maxOrder = Math.max(...state.sortingLayers.map(l => l.order), -1);
    set({ sortingLayers: [...state.sortingLayers, { name, order: maxOrder + 1, visible: true }] });
  },
  removeSortingLayer: (name) => {
    const state = get();
    set({ sortingLayers: state.sortingLayers.filter(l => l.name !== name) });
  },
  toggleLayerVisibility: (name) => {
    const state = get();
    set({ sortingLayers: state.sortingLayers.map(l => l.name === name ? { ...l, visible: !l.visible } : l) });
  },
  setGrid2d: (settings) => {
    const state = get();
    set({ grid2d: { ...state.grid2d, ...settings } });
  },
  setSpriteSheet: (entityId, data) => {
    set(state => ({ spriteSheets: { ...state.spriteSheets, [entityId]: data } }));
    if (dispatchCommand) dispatchCommand('set_sprite_sheet', { entityId, ...data });
  },
  removeSpriteSheet: (entityId) => {
    set(state => {
      const { [entityId]: _, ...rest } = state.spriteSheets;
      return { spriteSheets: rest };
    });
    if (dispatchCommand) dispatchCommand('remove_sprite_sheet', { entityId });
  },
  setSpriteAnimator: (entityId, data) => {
    set(state => ({ spriteAnimators: { ...state.spriteAnimators, [entityId]: data } }));
    if (dispatchCommand) dispatchCommand('set_sprite_animator', { entityId, ...data });
  },
  removeSpriteAnimator: (entityId) => {
    set(state => {
      const { [entityId]: _, ...rest } = state.spriteAnimators;
      return { spriteAnimators: rest };
    });
    if (dispatchCommand) dispatchCommand('remove_sprite_animator', { entityId });
  },
  setAnimationStateMachine: (entityId, data) => {
    set(state => ({ animationStateMachines: { ...state.animationStateMachines, [entityId]: data } }));
    if (dispatchCommand) dispatchCommand('set_animation_state_machine', { entityId, ...data });
  },
  removeAnimationStateMachine: (entityId) => {
    set(state => {
      const { [entityId]: _, ...rest } = state.animationStateMachines;
      return { animationStateMachines: rest };
    });
    if (dispatchCommand) dispatchCommand('remove_animation_state_machine', { entityId });
  },
  setTileset: (assetId, data) => {
    set(state => ({ tilesets: { ...state.tilesets, [assetId]: data } }));
    if (dispatchCommand) dispatchCommand('set_tileset', { ...data, assetId });
  },
  removeTileset: (assetId) => {
    set(state => {
      const { [assetId]: _, ...rest } = state.tilesets;
      return { tilesets: rest };
    });
    if (dispatchCommand) dispatchCommand('remove_tileset', { assetId });
  },
  setTilemapData: (entityId, data) => {
    set(state => ({ tilemaps: { ...state.tilemaps, [entityId]: data } }));
    if (dispatchCommand) dispatchCommand('set_tilemap_data', { entityId, ...data });
  },
  removeTilemapData: (entityId) => {
    set(state => {
      const { [entityId]: _, ...rest } = state.tilemaps;
      return { tilemaps: rest };
    });
    if (dispatchCommand) dispatchCommand('remove_tilemap_data', { entityId });
  },
  setActiveTileset: (assetId) => set({ activeTilesetId: assetId }),
  setTilemapActiveTool: (tool) => set({ tilemapActiveTool: tool }),
  setTilemapActiveLayerIndex: (index) => set({ tilemapActiveLayerIndex: index }),
});
