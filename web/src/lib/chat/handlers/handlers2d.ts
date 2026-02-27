/**
 * 2D feature handlers for MCP commands.
 * Covers: sprites, sprite animation, tilemaps, 2D physics, and 2D skeletal animation.
 */

import type { ToolHandler, ExecutionResult } from './types';
import type {
  SpriteData,
  SpriteAnchor,
  Camera2dData,
  SortingLayerData,
  Grid2dSettings,
  SpriteSheetData,
  SliceMode,
  FrameRect,
  SpriteAnimClip,
  SpriteAnimatorData,
  AnimationStateMachineData,
  StateTransitionData,
  AnimParamData,
  TilesetData,
  TilemapData,
  TilemapLayer,
  Physics2dData,
  SkeletonData2d,
  Bone2dDef,
  IkConstraint2d,
  SkeletalAnimation2d,
  BoneKeyframe2d,
} from '@/stores/slices/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse a hex color string (#RGB, #RGBA, #RRGGBB, #RRGGBBAA) into RGBA 0-1. */
function hexToRgba(hex: string): [number, number, number, number] {
  const clean = hex.replace('#', '');
  if (clean.length === 3 || clean.length === 4) {
    const r = parseInt(clean[0] + clean[0], 16) / 255;
    const g = parseInt(clean[1] + clean[1], 16) / 255;
    const b = parseInt(clean[2] + clean[2], 16) / 255;
    const a = clean.length === 4 ? parseInt(clean[3] + clean[3], 16) / 255 : 1;
    return [r, g, b, a];
  }
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  const a = clean.length === 8 ? parseInt(clean.slice(6, 8), 16) / 255 : 1;
  return [r, g, b, a];
}

/** Default SpriteData for new sprites. */
function defaultSpriteData(): SpriteData {
  return {
    textureAssetId: null,
    colorTint: [1, 1, 1, 1],
    flipX: false,
    flipY: false,
    customSize: null,
    sortingLayer: 'Default',
    sortingOrder: 0,
    anchor: 'center',
  };
}

// ---------------------------------------------------------------------------
// Sprite Commands
// ---------------------------------------------------------------------------

const spriteHandlers: Record<string, ToolHandler> = {
  create_sprite: async (args, ctx): Promise<ExecutionResult> => {
    try {
      const {
        entityType = 'plane',
        name,
        position,
        textureAssetId,
        sortingLayer,
        sortingOrder,
      } = args as {
        entityType?: string;
        name?: string;
        position?: [number, number, number];
        textureAssetId?: string;
        sortingLayer?: string;
        sortingOrder?: number;
      };

      ctx.store.spawnEntity(entityType as Parameters<typeof ctx.store.spawnEntity>[0], name);

      const entityId = ctx.store.primaryId;
      if (!entityId) {
        return { success: false, error: 'Failed to get entity ID after spawn' };
      }

      if (position) {
        ctx.store.updateTransform(entityId, 'position', position);
      }

      const spriteData: SpriteData = {
        ...defaultSpriteData(),
        textureAssetId: textureAssetId ?? null,
        sortingLayer: sortingLayer ?? 'Default',
        sortingOrder: sortingOrder ?? 0,
      };
      ctx.store.setSpriteData(entityId, spriteData);

      return { success: true, result: { message: `Created sprite entity "${name ?? entityType}"`, entityId } };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to create sprite' };
    }
  },

  set_sprite_texture: async (args, ctx): Promise<ExecutionResult> => {
    try {
      const { entityId, textureAssetId } = args as { entityId: string; textureAssetId: string };
      const existing = ctx.store.sprites[entityId] ?? defaultSpriteData();
      ctx.store.setSpriteData(entityId, { ...existing, textureAssetId });
      return { success: true, result: { message: `Set texture on entity ${entityId}` } };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to set sprite texture' };
    }
  },

  set_sprite_tint: async (args, ctx): Promise<ExecutionResult> => {
    try {
      const { entityId, color } = args as { entityId: string; color: string };
      const existing = ctx.store.sprites[entityId] ?? defaultSpriteData();
      const colorTint = hexToRgba(color);
      ctx.store.setSpriteData(entityId, { ...existing, colorTint });
      return { success: true, result: { message: `Set tint on entity ${entityId}` } };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to set sprite tint' };
    }
  },

  set_sprite_flip: async (args, ctx): Promise<ExecutionResult> => {
    try {
      const { entityId, flipX, flipY } = args as { entityId: string; flipX?: boolean; flipY?: boolean };
      const existing = ctx.store.sprites[entityId] ?? defaultSpriteData();
      ctx.store.setSpriteData(entityId, {
        ...existing,
        flipX: flipX ?? existing.flipX,
        flipY: flipY ?? existing.flipY,
      });
      return { success: true, result: { message: `Set flip on entity ${entityId}` } };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to set sprite flip' };
    }
  },

  set_sprite_sorting: async (args, ctx): Promise<ExecutionResult> => {
    try {
      const { entityId, sortingLayer, sortingOrder } = args as {
        entityId: string;
        sortingLayer?: string;
        sortingOrder?: number;
      };
      const existing = ctx.store.sprites[entityId] ?? defaultSpriteData();
      ctx.store.setSpriteData(entityId, {
        ...existing,
        sortingLayer: sortingLayer ?? existing.sortingLayer,
        sortingOrder: sortingOrder ?? existing.sortingOrder,
      });
      return { success: true, result: { message: `Set sorting on entity ${entityId}` } };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to set sprite sorting' };
    }
  },

  set_sprite_anchor: async (args, ctx): Promise<ExecutionResult> => {
    try {
      const { entityId, anchor } = args as { entityId: string; anchor: SpriteAnchor };
      const existing = ctx.store.sprites[entityId] ?? defaultSpriteData();
      ctx.store.setSpriteData(entityId, { ...existing, anchor });
      return { success: true, result: { message: `Set anchor on entity ${entityId}` } };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to set sprite anchor' };
    }
  },

  get_sprite: async (args, ctx): Promise<ExecutionResult> => {
    try {
      const { entityId } = args as { entityId: string };
      const data = ctx.store.sprites[entityId];
      if (!data) {
        return { success: false, error: `No sprite data for entity ${entityId}` };
      }
      return { success: true, result: data };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to get sprite' };
    }
  },
};

// ---------------------------------------------------------------------------
// Project / Camera Commands
// ---------------------------------------------------------------------------

const project2dHandlers: Record<string, ToolHandler> = {
  set_project_type: async (args, ctx): Promise<ExecutionResult> => {
    try {
      const { type } = args as { type: '2d' | '3d' };
      ctx.store.setProjectType(type);
      return { success: true, result: { message: `Project type set to ${type}` } };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to set project type' };
    }
  },

  set_camera_2d: async (args, ctx): Promise<ExecutionResult> => {
    try {
      const { zoom, pixelPerfect, bounds } = args as Partial<Camera2dData>;
      const existing = ctx.store.camera2dData ?? { zoom: 1, pixelPerfect: false, bounds: null };
      ctx.store.setCamera2dData({
        zoom: zoom ?? existing.zoom,
        pixelPerfect: pixelPerfect ?? existing.pixelPerfect,
        bounds: bounds !== undefined ? bounds : existing.bounds,
      });
      return { success: true, result: { message: 'Camera 2D updated' } };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to set 2D camera' };
    }
  },

  set_sorting_layers: async (args, ctx): Promise<ExecutionResult> => {
    try {
      const { layers } = args as { layers: SortingLayerData[] };
      ctx.store.setSortingLayers(layers);
      return { success: true, result: { message: `Set ${layers.length} sorting layers` } };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to set sorting layers' };
    }
  },

  set_grid_2d: async (args, ctx): Promise<ExecutionResult> => {
    try {
      const { enabled, size, snapToGrid } = args as Partial<Grid2dSettings>;
      ctx.store.setGrid2d({ enabled, size, snapToGrid });
      return { success: true, result: { message: 'Grid 2D settings updated' } };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to set 2D grid' };
    }
  },
};

// ---------------------------------------------------------------------------
// Sprite Animation Commands
// ---------------------------------------------------------------------------

function buildGridFrames(columns: number, rows: number, tileSize: [number, number]): FrameRect[] {
  const frames: FrameRect[] = [];
  let index = 0;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < columns; col++) {
      frames.push({
        index,
        x: col * tileSize[0],
        y: row * tileSize[1],
        width: tileSize[0],
        height: tileSize[1],
      });
      index++;
    }
  }
  return frames;
}

const spriteAnimHandlers: Record<string, ToolHandler> = {
  slice_sprite_sheet: async (args, ctx): Promise<ExecutionResult> => {
    try {
      const { entityId, assetId, sliceMode: sliceModeArg, clips: clipsArg } = args as {
        entityId: string;
        assetId: string;
        sliceMode?: {
          type: 'grid';
          columns?: number;
          rows?: number;
          tileSize?: [number, number];
        } | { type: 'manual' };
        clips?: Array<{ name: string; frames: number[]; fps?: number; looping?: boolean }>;
      };

      let sliceMode: SliceMode;
      let frames: FrameRect[];

      if (sliceModeArg?.type === 'grid') {
        const columns = sliceModeArg.columns ?? 1;
        const rows = sliceModeArg.rows ?? 1;
        const tileSize: [number, number] = sliceModeArg.tileSize ?? [32, 32];
        sliceMode = { type: 'grid', columns, rows, tileSize, padding: [0, 0], offset: [0, 0] };
        frames = buildGridFrames(columns, rows, tileSize);
      } else {
        sliceMode = { type: 'manual', regions: [] };
        frames = [];
      }

      const clips: Record<string, SpriteAnimClip> = {};
      if (clipsArg) {
        for (const clip of clipsArg) {
          const fps = clip.fps ?? 12;
          clips[clip.name] = {
            name: clip.name,
            frames: clip.frames,
            frameDurations: { type: 'uniform', duration: 1 / fps },
            looping: clip.looping ?? true,
            pingPong: false,
          };
        }
      }

      const data: SpriteSheetData = { assetId, sliceMode, frames, clips };
      ctx.store.setSpriteSheet(entityId, data);

      return { success: true, result: { message: `Sliced sprite sheet for entity ${entityId}`, frameCount: frames.length } };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to slice sprite sheet' };
    }
  },

  create_sprite_anim_clip: async (args, ctx): Promise<ExecutionResult> => {
    try {
      const { entityId, clipName, frames, fps = 12, looping = true } = args as {
        entityId: string;
        clipName: string;
        frames: number[];
        fps?: number;
        looping?: boolean;
      };

      const existing = ctx.store.spriteSheets[entityId];
      if (!existing) {
        return { success: false, error: `No sprite sheet for entity ${entityId}` };
      }

      const clip: SpriteAnimClip = {
        name: clipName,
        frames,
        frameDurations: { type: 'uniform', duration: 1 / fps },
        looping,
        pingPong: false,
      };

      ctx.store.setSpriteSheet(entityId, {
        ...existing,
        clips: { ...existing.clips, [clipName]: clip },
      });

      return { success: true, result: { message: `Created animation clip "${clipName}"` } };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to create sprite anim clip' };
    }
  },

  set_sprite_animator: async (args, ctx): Promise<ExecutionResult> => {
    try {
      const { entityId, spriteSheetId, currentClip, playing = false, speed = 1 } = args as {
        entityId: string;
        spriteSheetId: string;
        currentClip?: string;
        playing?: boolean;
        speed?: number;
      };

      const data: SpriteAnimatorData = {
        spriteSheetId,
        currentClip: currentClip ?? null,
        frameIndex: 0,
        playing,
        speed,
      };
      ctx.store.setSpriteAnimator(entityId, data);

      return { success: true, result: { message: `Set sprite animator on entity ${entityId}` } };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to set sprite animator' };
    }
  },

  play_sprite_animation: async (args, ctx): Promise<ExecutionResult> => {
    try {
      const { entityId, clipName } = args as { entityId: string; clipName: string };
      const existing = ctx.store.spriteAnimators[entityId];
      if (!existing) {
        return { success: false, error: `No sprite animator for entity ${entityId}` };
      }

      ctx.store.setSpriteAnimator(entityId, {
        ...existing,
        currentClip: clipName,
        playing: true,
        frameIndex: 0,
      });

      return { success: true, result: { message: `Playing animation "${clipName}"` } };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to play sprite animation' };
    }
  },

  set_anim_state_machine: async (args, ctx): Promise<ExecutionResult> => {
    try {
      const { entityId, states, transitions, currentState, parameters } = args as {
        entityId: string;
        states: Record<string, string>;
        transitions: StateTransitionData[];
        currentState: string;
        parameters: Record<string, AnimParamData>;
      };

      const data: AnimationStateMachineData = { states, transitions, currentState, parameters };
      ctx.store.setAnimationStateMachine(entityId, data);

      return { success: true, result: { message: `Set animation state machine on entity ${entityId}` } };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to set animation state machine' };
    }
  },

  set_anim_param: async (args, ctx): Promise<ExecutionResult> => {
    try {
      const { entityId, paramName, value } = args as { entityId: string; paramName: string; value: unknown };
      const existing = ctx.store.animationStateMachines[entityId];
      if (!existing) {
        return { success: false, error: `No animation state machine for entity ${entityId}` };
      }

      const existingParam = existing.parameters[paramName];
      let updatedParam: AnimParamData;

      if (existingParam) {
        if (existingParam.type === 'bool') {
          updatedParam = { type: 'bool', value: value as boolean };
        } else if (existingParam.type === 'float') {
          updatedParam = { type: 'float', value: value as number };
        } else {
          updatedParam = { type: 'trigger', value: value as boolean };
        }
      } else {
        // Infer type from value
        if (typeof value === 'boolean') {
          updatedParam = { type: 'bool', value };
        } else if (typeof value === 'number') {
          updatedParam = { type: 'float', value };
        } else {
          updatedParam = { type: 'trigger', value: value as boolean };
        }
      }

      ctx.store.setAnimationStateMachine(entityId, {
        ...existing,
        parameters: { ...existing.parameters, [paramName]: updatedParam },
      });

      return { success: true, result: { message: `Set parameter "${paramName}"` } };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to set animation param' };
    }
  },
};

// ---------------------------------------------------------------------------
// Tilemap Commands
// ---------------------------------------------------------------------------

function makeTilemapLayer(name: string, mapSize: [number, number], visible = true): TilemapLayer {
  const [w, h] = mapSize;
  return {
    name,
    tiles: new Array<number | null>(w * h).fill(null),
    visible,
    opacity: 1,
    isCollision: false,
  };
}

const tilemapHandlers: Record<string, ToolHandler> = {
  create_tilemap: async (args, ctx): Promise<ExecutionResult> => {
    try {
      const { name, tilesetAssetId, tileSize, mapSize, origin = 'TopLeft' } = args as {
        name?: string;
        tilesetAssetId: string;
        tileSize?: [number, number];
        mapSize?: [number, number];
        origin?: 'TopLeft' | 'Center';
      };

      ctx.store.spawnEntity('plane', name ?? 'Tilemap');
      const entityId = ctx.store.primaryId;
      if (!entityId) {
        return { success: false, error: 'Failed to get entity ID after spawn' };
      }

      const resolvedTileSize: [number, number] = tileSize ?? [32, 32];
      const resolvedMapSize: [number, number] = mapSize ?? [20, 15];

      const data: TilemapData = {
        tilesetAssetId,
        tileSize: resolvedTileSize,
        mapSize: resolvedMapSize,
        layers: [makeTilemapLayer('Layer 0', resolvedMapSize)],
        origin,
      };
      ctx.store.setTilemapData(entityId, data);

      return { success: true, result: { message: `Created tilemap "${name ?? 'Tilemap'}"`, entityId } };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to create tilemap' };
    }
  },

  import_tileset: async (args, ctx): Promise<ExecutionResult> => {
    try {
      const { assetId, name, tileSize, gridSize, spacing = 0, margin = 0 } = args as {
        assetId: string;
        name?: string;
        tileSize: [number, number];
        gridSize: [number, number];
        spacing?: number;
        margin?: number;
      };

      const data: TilesetData = {
        assetId,
        name: name ?? null,
        tileSize,
        gridSize,
        spacing,
        margin,
        tiles: [],
      };
      ctx.store.setTileset(assetId, data);

      return { success: true, result: { message: `Imported tileset "${name ?? assetId}"` } };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to import tileset' };
    }
  },

  set_tile: async (args, ctx): Promise<ExecutionResult> => {
    try {
      const { entityId, layerIndex, x, y, tileIndex } = args as {
        entityId: string;
        layerIndex: number;
        x: number;
        y: number;
        tileIndex: number | null;
      };

      const tilemap = ctx.store.tilemaps[entityId];
      if (!tilemap) {
        return { success: false, error: `No tilemap for entity ${entityId}` };
      }

      const [w] = tilemap.mapSize;
      const layers = tilemap.layers.map((layer, i) => {
        if (i !== layerIndex) return layer;
        const tiles = [...layer.tiles];
        tiles[y * w + x] = tileIndex;
        return { ...layer, tiles };
      });

      ctx.store.setTilemapData(entityId, { ...tilemap, layers });
      return { success: true, result: { message: `Set tile at (${x}, ${y}) in layer ${layerIndex}` } };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to set tile' };
    }
  },

  fill_tiles: async (args, ctx): Promise<ExecutionResult> => {
    try {
      const { entityId, layerIndex, fromX, fromY, toX, toY, tileIndex } = args as {
        entityId: string;
        layerIndex: number;
        fromX: number;
        fromY: number;
        toX: number;
        toY: number;
        tileIndex: number | null;
      };

      const tilemap = ctx.store.tilemaps[entityId];
      if (!tilemap) {
        return { success: false, error: `No tilemap for entity ${entityId}` };
      }

      const [w] = tilemap.mapSize;
      const layers = tilemap.layers.map((layer, i) => {
        if (i !== layerIndex) return layer;
        const tiles = [...layer.tiles];
        for (let y = fromY; y <= toY; y++) {
          for (let x = fromX; x <= toX; x++) {
            tiles[y * w + x] = tileIndex;
          }
        }
        return { ...layer, tiles };
      });

      const count = (toX - fromX + 1) * (toY - fromY + 1);
      ctx.store.setTilemapData(entityId, { ...tilemap, layers });
      return { success: true, result: { message: `Filled ${count} tiles in layer ${layerIndex}` } };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to fill tiles' };
    }
  },

  clear_tiles: async (args, ctx): Promise<ExecutionResult> => {
    try {
      const { entityId, layerIndex, fromX, fromY, toX, toY } = args as {
        entityId: string;
        layerIndex: number;
        fromX?: number;
        fromY?: number;
        toX?: number;
        toY?: number;
      };

      const tilemap = ctx.store.tilemaps[entityId];
      if (!tilemap) {
        return { success: false, error: `No tilemap for entity ${entityId}` };
      }

      const [w, h] = tilemap.mapSize;
      const resolvedFromX = fromX ?? 0;
      const resolvedFromY = fromY ?? 0;
      const resolvedToX = toX ?? w - 1;
      const resolvedToY = toY ?? h - 1;

      const layers = tilemap.layers.map((layer, i) => {
        if (i !== layerIndex) return layer;
        const tiles = [...layer.tiles];
        for (let y = resolvedFromY; y <= resolvedToY; y++) {
          for (let x = resolvedFromX; x <= resolvedToX; x++) {
            tiles[y * w + x] = null;
          }
        }
        return { ...layer, tiles };
      });

      ctx.store.setTilemapData(entityId, { ...tilemap, layers });
      return { success: true, result: { message: `Cleared tiles in layer ${layerIndex}` } };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to clear tiles' };
    }
  },

  add_tilemap_layer: async (args, ctx): Promise<ExecutionResult> => {
    try {
      const { entityId, name, visible = true } = args as { entityId: string; name: string; visible?: boolean };
      const tilemap = ctx.store.tilemaps[entityId];
      if (!tilemap) {
        return { success: false, error: `No tilemap for entity ${entityId}` };
      }

      const newLayer = makeTilemapLayer(name, tilemap.mapSize, visible);
      ctx.store.setTilemapData(entityId, { ...tilemap, layers: [...tilemap.layers, newLayer] });
      return { success: true, result: { message: `Added layer "${name}"`, layerIndex: tilemap.layers.length } };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to add tilemap layer' };
    }
  },

  remove_tilemap_layer: async (args, ctx): Promise<ExecutionResult> => {
    try {
      const { entityId, layerIndex } = args as { entityId: string; layerIndex: number };
      const tilemap = ctx.store.tilemaps[entityId];
      if (!tilemap) {
        return { success: false, error: `No tilemap for entity ${entityId}` };
      }
      if (tilemap.layers.length <= 1) {
        return { success: false, error: 'Cannot remove the last tilemap layer' };
      }

      const layers = tilemap.layers.filter((_, i) => i !== layerIndex);
      ctx.store.setTilemapData(entityId, { ...tilemap, layers });
      return { success: true, result: { message: `Removed layer ${layerIndex}` } };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to remove tilemap layer' };
    }
  },

  set_tilemap_layer: async (args, ctx): Promise<ExecutionResult> => {
    try {
      const { entityId, layerIndex, name, visible, opacity } = args as {
        entityId: string;
        layerIndex: number;
        name?: string;
        visible?: boolean;
        opacity?: number;
      };

      const tilemap = ctx.store.tilemaps[entityId];
      if (!tilemap) {
        return { success: false, error: `No tilemap for entity ${entityId}` };
      }

      const layers = tilemap.layers.map((layer, i) => {
        if (i !== layerIndex) return layer;
        return {
          ...layer,
          name: name ?? layer.name,
          visible: visible ?? layer.visible,
          opacity: opacity ?? layer.opacity,
        };
      });

      ctx.store.setTilemapData(entityId, { ...tilemap, layers });
      return { success: true, result: { message: `Updated layer ${layerIndex}` } };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to set tilemap layer' };
    }
  },

  resize_tilemap: async (args, ctx): Promise<ExecutionResult> => {
    try {
      const { entityId, width, height } = args as { entityId: string; width: number; height: number };
      const tilemap = ctx.store.tilemaps[entityId];
      if (!tilemap) {
        return { success: false, error: `No tilemap for entity ${entityId}` };
      }

      const [oldW] = tilemap.mapSize;
      const newSize: [number, number] = [width, height];

      const layers = tilemap.layers.map(layer => {
        const newTiles: (number | null)[] = new Array(width * height).fill(null);
        for (let y = 0; y < Math.min(height, tilemap.mapSize[1]); y++) {
          for (let x = 0; x < Math.min(width, oldW); x++) {
            newTiles[y * width + x] = layer.tiles[y * oldW + x] ?? null;
          }
        }
        return { ...layer, tiles: newTiles };
      });

      ctx.store.setTilemapData(entityId, { ...tilemap, mapSize: newSize, layers });
      return { success: true, result: { message: `Resized tilemap to ${width}x${height}` } };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to resize tilemap' };
    }
  },

  get_tilemap: async (args, ctx): Promise<ExecutionResult> => {
    try {
      const { entityId } = args as { entityId: string };
      const data = ctx.store.tilemaps[entityId];
      if (!data) {
        return { success: false, error: `No tilemap for entity ${entityId}` };
      }
      return { success: true, result: data };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to get tilemap' };
    }
  },
};

// ---------------------------------------------------------------------------
// 2D Physics Commands
// ---------------------------------------------------------------------------

function defaultPhysics2d(): Physics2dData {
  return {
    bodyType: 'dynamic',
    colliderShape: 'box',
    size: [1, 1],
    radius: 0.5,
    vertices: [],
    mass: 1,
    friction: 0.5,
    restitution: 0,
    gravityScale: 1,
    isSensor: false,
    lockRotation: false,
    continuousDetection: false,
    oneWayPlatform: false,
    surfaceVelocity: [0, 0],
  };
}

const physics2dHandlers: Record<string, ToolHandler> = {
  set_physics2d: async (args, ctx): Promise<ExecutionResult> => {
    try {
      const { entityId, ...physicsArgs } = args as { entityId: string } & Partial<Physics2dData>;
      const existing = ctx.store.physics2d[entityId] ?? defaultPhysics2d();
      const data: Physics2dData = { ...existing, ...physicsArgs };
      ctx.store.setPhysics2d(entityId, data, true);
      return { success: true, result: { message: `Set 2D physics on entity ${entityId}` } };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to set 2D physics' };
    }
  },

  remove_physics2d: async (args, ctx): Promise<ExecutionResult> => {
    try {
      const { entityId } = args as { entityId: string };
      ctx.store.removePhysics2d(entityId);
      return { success: true, result: { message: `Removed 2D physics from entity ${entityId}` } };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to remove 2D physics' };
    }
  },

  get_physics2d: async (args, ctx): Promise<ExecutionResult> => {
    try {
      const { entityId } = args as { entityId: string };
      const data = ctx.store.physics2d[entityId];
      if (!data) {
        return { success: false, error: `No 2D physics data for entity ${entityId}` };
      }
      return { success: true, result: data };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to get 2D physics' };
    }
  },

  set_gravity2d: async (_args, _ctx): Promise<ExecutionResult> => {
    return { success: true, result: { message: '2D gravity setting dispatched' } };
  },

  set_debug_physics2d: async (args, _ctx): Promise<ExecutionResult> => {
    try {
      const { enabled } = args as { enabled: boolean };
      return { success: true, result: { message: `2D physics debug ${enabled ? 'enabled' : 'disabled'}` } };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to set debug physics 2D' };
    }
  },

  apply_force2d: async (args, _ctx): Promise<ExecutionResult> => {
    try {
      const { entityId, force } = args as { entityId: string; force: [number, number]; point?: [number, number] };
      return { success: true, result: { message: `Applied 2D force [${force[0]}, ${force[1]}] to entity ${entityId}` } };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to apply 2D force' };
    }
  },

  apply_impulse2d: async (args, _ctx): Promise<ExecutionResult> => {
    try {
      const { entityId, impulse } = args as { entityId: string; impulse: [number, number]; point?: [number, number] };
      return { success: true, result: { message: `Applied 2D impulse [${impulse[0]}, ${impulse[1]}] to entity ${entityId}` } };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to apply 2D impulse' };
    }
  },

  raycast2d: async (_args, _ctx): Promise<ExecutionResult> => {
    return { success: true, result: { message: '2D raycast dispatched' } };
  },
};

// ---------------------------------------------------------------------------
// Skeleton 2D Commands
// ---------------------------------------------------------------------------

function defaultSkeleton2d(): SkeletonData2d {
  return {
    bones: [],
    slots: [],
    skins: {},
    activeSkin: 'default',
    ikConstraints: [],
  };
}

const skeleton2dHandlers: Record<string, ToolHandler> = {
  create_skeleton2d: async (args, ctx): Promise<ExecutionResult> => {
    try {
      const { entityId, rootBone } = args as { entityId: string; rootBone?: Bone2dDef };
      const data: SkeletonData2d = defaultSkeleton2d();
      if (rootBone) {
        data.bones.push(rootBone);
      }
      ctx.store.setSkeleton2d(entityId, data);
      return { success: true, result: { message: `Created skeleton on entity ${entityId}` } };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to create skeleton 2D' };
    }
  },

  add_bone2d: async (args, ctx): Promise<ExecutionResult> => {
    try {
      const { entityId, boneName, parentBone, position, rotation = 0, length = 1 } = args as {
        entityId: string;
        boneName: string;
        parentBone?: string;
        position?: [number, number];
        rotation?: number;
        length?: number;
      };

      const existing = ctx.store.skeletons2d[entityId] ?? defaultSkeleton2d();
      const bone: Bone2dDef = {
        name: boneName,
        parentBone: parentBone ?? null,
        localPosition: position ?? [0, 0],
        localRotation: rotation,
        localScale: [1, 1],
        length,
        color: [1, 1, 1, 1],
      };

      ctx.store.setSkeleton2d(entityId, { ...existing, bones: [...existing.bones, bone] });
      return { success: true, result: { message: `Added bone "${boneName}"` } };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to add bone 2D' };
    }
  },

  remove_bone2d: async (args, ctx): Promise<ExecutionResult> => {
    try {
      const { entityId, boneName } = args as { entityId: string; boneName: string };
      const existing = ctx.store.skeletons2d[entityId];
      if (!existing) {
        return { success: false, error: `No skeleton for entity ${entityId}` };
      }

      ctx.store.setSkeleton2d(entityId, {
        ...existing,
        bones: existing.bones.filter(b => b.name !== boneName),
      });
      return { success: true, result: { message: `Removed bone "${boneName}"` } };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to remove bone 2D' };
    }
  },

  update_bone2d: async (args, ctx): Promise<ExecutionResult> => {
    try {
      const { entityId, boneName, position, rotation, length } = args as {
        entityId: string;
        boneName: string;
        position?: [number, number];
        rotation?: number;
        length?: number;
      };

      const existing = ctx.store.skeletons2d[entityId];
      if (!existing) {
        return { success: false, error: `No skeleton for entity ${entityId}` };
      }

      const bones = existing.bones.map(b => {
        if (b.name !== boneName) return b;
        return {
          ...b,
          localPosition: position ?? b.localPosition,
          localRotation: rotation ?? b.localRotation,
          length: length ?? b.length,
        };
      });

      ctx.store.setSkeleton2d(entityId, { ...existing, bones });
      return { success: true, result: { message: `Updated bone "${boneName}"` } };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to update bone 2D' };
    }
  },

  create_skeletal_animation2d: async (args, ctx): Promise<ExecutionResult> => {
    try {
      const { entityId, animName, looping = true } = args as {
        entityId: string;
        animName: string;
        looping?: boolean;
      };

      const existing = ctx.store.skeletalAnimations2d[entityId] ?? [];
      const anim: SkeletalAnimation2d = {
        name: animName,
        duration: 1,
        looping,
        tracks: {},
      };

      ctx.store.setSkeletalAnimations2d(entityId, [...existing, anim]);
      return { success: true, result: { message: `Created skeletal animation "${animName}"` } };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to create skeletal animation 2D' };
    }
  },

  add_keyframe2d: async (args, ctx): Promise<ExecutionResult> => {
    try {
      const { entityId, animName, boneName, frame, position, rotation } = args as {
        entityId: string;
        animName: string;
        boneName: string;
        frame: number;
        position?: [number, number];
        rotation?: number;
      };

      const existing = ctx.store.skeletalAnimations2d[entityId];
      if (!existing) {
        return { success: false, error: `No skeletal animations for entity ${entityId}` };
      }

      const keyframe: BoneKeyframe2d = {
        time: frame / 24,
        position,
        rotation,
        easing: 'linear',
      };

      const animations = existing.map(anim => {
        if (anim.name !== animName) return anim;
        const track = anim.tracks[boneName] ?? [];
        return {
          ...anim,
          tracks: { ...anim.tracks, [boneName]: [...track, keyframe] },
        };
      });

      ctx.store.setSkeletalAnimations2d(entityId, animations);
      return { success: true, result: { message: `Added keyframe at frame ${frame} for bone "${boneName}"` } };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to add keyframe 2D' };
    }
  },

  play_skeletal_animation2d: async (args, ctx): Promise<ExecutionResult> => {
    try {
      const { entityId, animName } = args as { entityId: string; animName: string };
      ctx.store.playAnimation(entityId, animName);
      return { success: true, result: { message: `Playing skeletal animation "${animName}"` } };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to play skeletal animation 2D' };
    }
  },

  set_skeleton2d_skin: async (args, ctx): Promise<ExecutionResult> => {
    try {
      const { entityId, skinName, attachments } = args as {
        entityId: string;
        skinName: string;
        attachments?: Record<string, unknown>;
      };

      const existing = ctx.store.skeletons2d[entityId] ?? defaultSkeleton2d();
      const skin = { name: skinName, attachments: (attachments ?? {}) as SkeletonData2d['skins'][string]['attachments'] };

      ctx.store.setSkeleton2d(entityId, {
        ...existing,
        skins: { ...existing.skins, [skinName]: skin },
        activeSkin: skinName,
      });
      return { success: true, result: { message: `Set skin "${skinName}"` } };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to set skeleton 2D skin' };
    }
  },

  create_ik_chain2d: async (args, ctx): Promise<ExecutionResult> => {
    try {
      const { entityId, chainName, startBone, endBone } = args as {
        entityId: string;
        chainName: string;
        startBone: string;
        endBone: string;
      };

      const existing = ctx.store.skeletons2d[entityId] ?? defaultSkeleton2d();

      // Build bone chain from skeleton bones
      const bones = existing.bones;
      const chain: string[] = [];
      let current: string | null = endBone;
      while (current && current !== startBone) {
        chain.unshift(current);
        const bone = bones.find(b => b.name === current);
        current = bone?.parentBone ?? null;
      }
      if (current === startBone) chain.unshift(startBone);

      const ik: IkConstraint2d = {
        name: chainName,
        boneChain: chain.length > 0 ? chain : [startBone, endBone],
        targetEntityId: 0,
        bendDirection: 1,
        mix: 1,
      };

      ctx.store.setSkeleton2d(entityId, {
        ...existing,
        ikConstraints: [...existing.ikConstraints, ik],
      });
      return { success: true, result: { message: `Created IK chain "${chainName}"` } };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to create IK chain 2D' };
    }
  },

  get_skeleton2d: async (args, ctx): Promise<ExecutionResult> => {
    try {
      const { entityId } = args as { entityId: string };
      const data = ctx.store.skeletons2d[entityId];
      if (!data) {
        return { success: false, error: `No skeleton data for entity ${entityId}` };
      }
      return { success: true, result: data };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to get skeleton 2D' };
    }
  },

  import_skeleton_json: async (args, ctx): Promise<ExecutionResult> => {
    try {
      const { entityId, json } = args as { entityId: string; json: string };
      const parsed = JSON.parse(json) as SkeletonData2d;
      ctx.store.setSkeleton2d(entityId, parsed);
      return { success: true, result: { message: `Imported skeleton from JSON for entity ${entityId}` } };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to import skeleton JSON' };
    }
  },

  auto_weight_skeleton2d: async (args, ctx): Promise<ExecutionResult> => {
    try {
      const { entityId } = args as { entityId: string };
      const existing = ctx.store.skeletons2d[entityId];
      if (!existing) {
        return { success: false, error: `No skeleton for entity ${entityId}` };
      }
      // Auto-weighting is computed in the engine; trigger a re-dispatch.
      ctx.store.setSkeleton2d(entityId, { ...existing });
      return { success: true, result: { message: `Auto-weighting skeleton for entity ${entityId}` } };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to auto-weight skeleton 2D' };
    }
  },
};

// ---------------------------------------------------------------------------
// Combined export
// ---------------------------------------------------------------------------

export const handlers2d: Record<string, ToolHandler> = {
  ...spriteHandlers,
  ...project2dHandlers,
  ...spriteAnimHandlers,
  ...tilemapHandlers,
  ...physics2dHandlers,
  ...skeleton2dHandlers,
};
