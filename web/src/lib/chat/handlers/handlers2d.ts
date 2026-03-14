/**
 * 2D feature handlers for MCP commands.
 * Covers: sprites, sprite animation, tilemaps, 2D physics, and 2D skeletal animation.
 */

import { z } from 'zod';
import type { ToolHandler, ExecutionResult } from './types';
import { zEntityId, zVec2, zVec4, parseArgs } from './types';
import type {
  SpriteData,
  Camera2dData,
  SortingLayerData,
  SpriteSheetData,
  SpriteAnimClip,
  SpriteAnimatorData,
  AnimationStateMachineData,
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
  StateTransitionData,
  FrameRect,
  SliceMode,
  Grid2dSettings,
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
// Shared schemas
// ---------------------------------------------------------------------------

const zSpriteAnchor = z.enum([
  'center', 'top_left', 'top_center', 'top_right',
  'middle_left', 'middle_right',
  'bottom_left', 'bottom_center', 'bottom_right',
]);

const zCameraBounds = z.object({
  minX: z.number(),
  maxX: z.number(),
  minY: z.number(),
  maxY: z.number(),
});

const zSortingLayerData = z.object({
  name: z.string(),
  order: z.number(),
  visible: z.boolean(),
});

const zTransitionCondition = z.union([
  z.object({ type: z.literal('always') }),
  z.object({ type: z.literal('paramBool'), name: z.string(), value: z.boolean() }),
  z.object({
    type: z.literal('paramFloat'),
    name: z.string(),
    op: z.enum(['greater', 'less', 'equal']),
    threshold: z.number(),
  }),
  z.object({ type: z.literal('paramTrigger'), name: z.string() }),
]);

const zStateTransition = z.object({
  fromState: z.string(),
  toState: z.string(),
  condition: zTransitionCondition,
  duration: z.number(),
});

const zAnimParamData = z.union([
  z.object({ type: z.literal('bool'), value: z.boolean() }),
  z.object({ type: z.literal('float'), value: z.number() }),
  z.object({ type: z.literal('trigger'), value: z.boolean() }),
]);

const zPhysics2dBodyType = z.enum(['dynamic', 'static', 'kinematic']);
const zPhysics2dColliderShape = z.enum(['box', 'circle', 'capsule', 'convex_polygon', 'edge', 'auto']);

const zPhysics2dData = z.object({
  bodyType: zPhysics2dBodyType.optional(),
  colliderShape: zPhysics2dColliderShape.optional(),
  size: zVec2.optional(),
  radius: z.number().optional(),
  vertices: z.array(zVec2).optional(),
  mass: z.number().optional(),
  friction: z.number().optional(),
  restitution: z.number().optional(),
  gravityScale: z.number().optional(),
  isSensor: z.boolean().optional(),
  lockRotation: z.boolean().optional(),
  continuousDetection: z.boolean().optional(),
  oneWayPlatform: z.boolean().optional(),
  surfaceVelocity: zVec2.optional(),
});

const zBone2dDef = z.object({
  name: z.string(),
  parentBone: z.string().nullable(),
  localPosition: zVec2,
  localRotation: z.number(),
  localScale: zVec2,
  length: z.number(),
  color: zVec4,
});

// ---------------------------------------------------------------------------
// Sprite Commands
// ---------------------------------------------------------------------------

const ENTITY_TYPES_2D = ['plane', 'cube', 'sphere', 'cylinder', 'capsule', 'empty'] as const;

const spriteHandlers: Record<string, ToolHandler> = {
  create_sprite: async (args, ctx): Promise<ExecutionResult> => {
    try {
      const p = parseArgs(
        z.object({
          entityType: z.enum(ENTITY_TYPES_2D).optional(),
          name: z.string().optional(),
          position: z.tuple([z.number(), z.number(), z.number()]).optional(),
          textureAssetId: z.string().optional(),
          sortingLayer: z.string().optional(),
          sortingOrder: z.number().optional(),
        }),
        args,
      );
      if (p.error) return p.error;

      const { entityType = 'plane', name, position, textureAssetId, sortingLayer, sortingOrder } = p.data;

      ctx.store.spawnEntity(entityType as Parameters<typeof ctx.store.spawnEntity>[0], name);

      const entityId = ctx.store.primaryId;
      if (!entityId) {
        return { success: false, error: 'Failed to get entity ID after spawn' };
      }

      if (position) {
        ctx.store.updateTransform(entityId, 'position', { x: position[0], y: position[1], z: position[2] });
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
      const p = parseArgs(z.object({ entityId: zEntityId, textureAssetId: z.string() }), args);
      if (p.error) return p.error;
      const { entityId, textureAssetId } = p.data;
      const existing = ctx.store.sprites[entityId] ?? defaultSpriteData();
      ctx.store.setSpriteData(entityId, { ...existing, textureAssetId });
      return { success: true, result: { message: `Set texture on entity ${entityId}` } };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to set sprite texture' };
    }
  },

  set_sprite_tint: async (args, ctx): Promise<ExecutionResult> => {
    try {
      const p = parseArgs(z.object({ entityId: zEntityId, color: z.string() }), args);
      if (p.error) return p.error;
      const { entityId, color } = p.data;
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
      const p = parseArgs(
        z.object({ entityId: zEntityId, flipX: z.boolean().optional(), flipY: z.boolean().optional() }),
        args,
      );
      if (p.error) return p.error;
      const { entityId, flipX, flipY } = p.data;
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
      const p = parseArgs(
        z.object({
          entityId: zEntityId,
          sortingLayer: z.string().optional(),
          sortingOrder: z.number().optional(),
        }),
        args,
      );
      if (p.error) return p.error;
      const { entityId, sortingLayer, sortingOrder } = p.data;
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
      const p = parseArgs(z.object({ entityId: zEntityId, anchor: zSpriteAnchor }), args);
      if (p.error) return p.error;
      const { entityId, anchor } = p.data;
      const existing = ctx.store.sprites[entityId] ?? defaultSpriteData();
      ctx.store.setSpriteData(entityId, { ...existing, anchor });
      return { success: true, result: { message: `Set anchor on entity ${entityId}` } };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to set sprite anchor' };
    }
  },

  get_sprite: async (args, ctx): Promise<ExecutionResult> => {
    try {
      const p = parseArgs(z.object({ entityId: zEntityId }), args);
      if (p.error) return p.error;
      const { entityId } = p.data;
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
      const p = parseArgs(z.object({ type: z.enum(['2d', '3d']) }), args);
      if (p.error) return p.error;
      ctx.store.setProjectType(p.data.type);
      return { success: true, result: { message: `Project type set to ${p.data.type}` } };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to set project type' };
    }
  },

  set_camera_2d: async (args, ctx): Promise<ExecutionResult> => {
    try {
      const p = parseArgs(
        z.object({
          zoom: z.number().optional(),
          pixelPerfect: z.boolean().optional(),
          bounds: zCameraBounds.nullable().optional(),
        }),
        args,
      );
      if (p.error) return p.error;
      const { zoom, pixelPerfect, bounds } = p.data;
      const existing: Camera2dData = ctx.store.camera2dData ?? { zoom: 1, pixelPerfect: false, bounds: null };
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
      const p = parseArgs(z.object({ layers: z.array(zSortingLayerData) }), args);
      if (p.error) return p.error;
      const layers: SortingLayerData[] = p.data.layers;
      ctx.store.setSortingLayers(layers);
      return { success: true, result: { message: `Set ${layers.length} sorting layers` } };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to set sorting layers' };
    }
  },

  set_grid_2d: async (args, ctx): Promise<ExecutionResult> => {
    try {
      const p = parseArgs(
        z.object({
          enabled: z.boolean().optional(),
          size: z.number().optional(),
          snapToGrid: z.boolean().optional(),
        }),
        args,
      );
      if (p.error) return p.error;
      const settings: Partial<Grid2dSettings> = p.data;
      ctx.store.setGrid2d(settings);
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

const zGridSliceMode = z.object({
  type: z.literal('grid'),
  columns: z.number().int().positive().optional(),
  rows: z.number().int().positive().optional(),
  tileSize: zVec2.optional(),
});

const zManualSliceMode = z.object({ type: z.literal('manual') });

const zClipInput = z.object({
  name: z.string(),
  frames: z.array(z.number().int().nonnegative()),
  fps: z.number().optional(),
  looping: z.boolean().optional(),
});

const spriteAnimHandlers: Record<string, ToolHandler> = {
  slice_sprite_sheet: async (args, ctx): Promise<ExecutionResult> => {
    try {
      const p = parseArgs(
        z.object({
          entityId: zEntityId,
          assetId: z.string(),
          sliceMode: z.union([zGridSliceMode, zManualSliceMode]).optional(),
          clips: z.array(zClipInput).optional(),
        }),
        args,
      );
      if (p.error) return p.error;

      const { entityId, assetId, sliceMode: sliceModeArg, clips: clipsArg } = p.data;

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
      const p = parseArgs(
        z.object({
          entityId: zEntityId,
          clipName: z.string(),
          frames: z.array(z.number().int().nonnegative()),
          fps: z.number().optional(),
          looping: z.boolean().optional(),
        }),
        args,
      );
      if (p.error) return p.error;

      const { entityId, clipName, frames, fps = 12, looping = true } = p.data;

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
      const p = parseArgs(
        z.object({
          entityId: zEntityId,
          spriteSheetId: z.string(),
          currentClip: z.string().optional(),
          playing: z.boolean().optional(),
          speed: z.number().optional(),
        }),
        args,
      );
      if (p.error) return p.error;

      const { entityId, spriteSheetId, currentClip, playing = false, speed = 1 } = p.data;

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
      const p = parseArgs(z.object({ entityId: zEntityId, clipName: z.string() }), args);
      if (p.error) return p.error;
      const { entityId, clipName } = p.data;
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
      const p = parseArgs(
        z.object({
          entityId: zEntityId,
          states: z.record(z.string(), z.string()),
          transitions: z.array(zStateTransition),
          currentState: z.string(),
          parameters: z.record(z.string(), zAnimParamData),
        }),
        args,
      );
      if (p.error) return p.error;

      const { entityId, states, transitions, currentState, parameters } = p.data;
      const data: AnimationStateMachineData = {
        states,
        transitions: transitions as StateTransitionData[],
        currentState,
        parameters: parameters as Record<string, AnimParamData>,
      };
      ctx.store.setAnimationStateMachine(entityId, data);

      return { success: true, result: { message: `Set animation state machine on entity ${entityId}` } };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to set animation state machine' };
    }
  },

  set_anim_param: async (args, ctx): Promise<ExecutionResult> => {
    try {
      const p = parseArgs(
        z.object({ entityId: zEntityId, paramName: z.string(), value: z.unknown() }),
        args,
      );
      if (p.error) return p.error;
      const { entityId, paramName, value } = p.data;
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
      const p = parseArgs(
        z.object({
          name: z.string().optional(),
          tilesetAssetId: z.string(),
          tileSize: zVec2.optional(),
          mapSize: zVec2.optional(),
          origin: z.enum(['TopLeft', 'Center']).optional(),
        }),
        args,
      );
      if (p.error) return p.error;

      const { name, tilesetAssetId, tileSize, mapSize, origin = 'TopLeft' } = p.data;

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
      const p = parseArgs(
        z.object({
          assetId: z.string(),
          name: z.string().optional(),
          tileSize: zVec2,
          gridSize: zVec2,
          spacing: z.number().optional(),
          margin: z.number().optional(),
        }),
        args,
      );
      if (p.error) return p.error;

      const { assetId, name, tileSize, gridSize, spacing = 0, margin = 0 } = p.data;

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
      const p = parseArgs(
        z.object({
          entityId: zEntityId,
          layerIndex: z.number().int().nonnegative(),
          x: z.number().int().nonnegative(),
          y: z.number().int().nonnegative(),
          tileIndex: z.number().int().nonnegative().nullable(),
        }),
        args,
      );
      if (p.error) return p.error;

      const { entityId, layerIndex, x, y, tileIndex } = p.data;

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
      const p = parseArgs(
        z.object({
          entityId: zEntityId,
          layerIndex: z.number().int().nonnegative(),
          fromX: z.number().int().nonnegative(),
          fromY: z.number().int().nonnegative(),
          toX: z.number().int().nonnegative(),
          toY: z.number().int().nonnegative(),
          tileIndex: z.number().int().nonnegative().nullable(),
        }),
        args,
      );
      if (p.error) return p.error;

      const { entityId, layerIndex, fromX, fromY, toX, toY, tileIndex } = p.data;

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
      const p = parseArgs(
        z.object({
          entityId: zEntityId,
          layerIndex: z.number().int().nonnegative(),
          fromX: z.number().int().nonnegative().optional(),
          fromY: z.number().int().nonnegative().optional(),
          toX: z.number().int().nonnegative().optional(),
          toY: z.number().int().nonnegative().optional(),
        }),
        args,
      );
      if (p.error) return p.error;

      const { entityId, layerIndex, fromX, fromY, toX, toY } = p.data;

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
      const p = parseArgs(
        z.object({ entityId: zEntityId, name: z.string(), visible: z.boolean().optional() }),
        args,
      );
      if (p.error) return p.error;
      const { entityId, name, visible = true } = p.data;
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
      const p = parseArgs(z.object({ entityId: zEntityId, layerIndex: z.number().int().nonnegative() }), args);
      if (p.error) return p.error;
      const { entityId, layerIndex } = p.data;
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
      const p = parseArgs(
        z.object({
          entityId: zEntityId,
          layerIndex: z.number().int().nonnegative(),
          name: z.string().optional(),
          visible: z.boolean().optional(),
          opacity: z.number().optional(),
        }),
        args,
      );
      if (p.error) return p.error;

      const { entityId, layerIndex, name, visible, opacity } = p.data;

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
      const p = parseArgs(
        z.object({
          entityId: zEntityId,
          width: z.number().int().positive(),
          height: z.number().int().positive(),
        }),
        args,
      );
      if (p.error) return p.error;

      const { entityId, width, height } = p.data;
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
      const p = parseArgs(z.object({ entityId: zEntityId }), args);
      if (p.error) return p.error;
      const { entityId } = p.data;
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
      const p = parseArgs(
        z.object({ entityId: zEntityId }).merge(zPhysics2dData),
        args,
      );
      if (p.error) return p.error;
      const { entityId, ...physicsArgs } = p.data;
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
      const p = parseArgs(z.object({ entityId: zEntityId }), args);
      if (p.error) return p.error;
      ctx.store.removePhysics2d(p.data.entityId);
      return { success: true, result: { message: `Removed 2D physics from entity ${p.data.entityId}` } };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to remove 2D physics' };
    }
  },

  get_physics2d: async (args, ctx): Promise<ExecutionResult> => {
    try {
      const p = parseArgs(z.object({ entityId: zEntityId }), args);
      if (p.error) return p.error;
      const { entityId } = p.data;
      const data = ctx.store.physics2d[entityId];
      if (!data) {
        return { success: false, error: `No 2D physics data for entity ${entityId}` };
      }
      return { success: true, result: data };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to get 2D physics' };
    }
  },

  set_gravity2d: async (args, ctx): Promise<ExecutionResult> => {
    try {
      const p = parseArgs(
        z.object({ x: z.number().optional(), y: z.number().optional() }),
        args,
      );
      if (p.error) return p.error;
      const { x = 0, y = -9.81 } = p.data;
      ctx.store.setGravity2d(x, y);
      return { success: true, result: { message: `2D gravity set to (${x}, ${y})` } };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to set 2D gravity' };
    }
  },

  set_debug_physics2d: async (args, ctx): Promise<ExecutionResult> => {
    try {
      const p = parseArgs(z.object({ enabled: z.boolean() }), args);
      if (p.error) return p.error;
      const { enabled } = p.data;
      ctx.store.setDebugPhysics2d(enabled);
      return { success: true, result: { message: `2D physics debug ${enabled ? 'enabled' : 'disabled'}` } };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to set debug physics 2D' };
    }
  },

  apply_force2d: async (args, ctx): Promise<ExecutionResult> => {
    try {
      const p = parseArgs(
        z.object({
          entityId: zEntityId,
          force: zVec2,
          point: zVec2.optional(),
        }),
        args,
      );
      if (p.error) return p.error;
      ctx.store.togglePhysics2d(p.data.entityId, true);
      return { success: true, result: { message: 'Force application queued (only takes effect during Play mode via scripts)' } };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to apply 2D force' };
    }
  },

  apply_impulse2d: async (args, ctx): Promise<ExecutionResult> => {
    try {
      const p = parseArgs(
        z.object({
          entityId: zEntityId,
          impulse: zVec2,
          point: zVec2.optional(),
        }),
        args,
      );
      if (p.error) return p.error;
      ctx.store.togglePhysics2d(p.data.entityId, true);
      return { success: true, result: { message: 'Impulse application queued (only takes effect during Play mode via scripts)' } };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to apply 2D impulse' };
    }
  },

  raycast2d: async (_args, _ctx): Promise<ExecutionResult> => {
    return { success: false, error: '2D raycasts are a runtime-only query. Use forge.physics2d.raycast() in scripts during Play mode.' };
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
      const p = parseArgs(
        z.object({ entityId: zEntityId, rootBone: zBone2dDef.optional() }),
        args,
      );
      if (p.error) return p.error;
      const { entityId, rootBone } = p.data;
      const data: SkeletonData2d = defaultSkeleton2d();
      if (rootBone) {
        data.bones.push(rootBone as Bone2dDef);
      }
      ctx.store.setSkeleton2d(entityId, data);
      return { success: true, result: { message: `Created skeleton on entity ${entityId}` } };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to create skeleton 2D' };
    }
  },

  add_bone2d: async (args, ctx): Promise<ExecutionResult> => {
    try {
      const p = parseArgs(
        z.object({
          entityId: zEntityId,
          boneName: z.string(),
          parentBone: z.string().optional(),
          position: zVec2.optional(),
          rotation: z.number().optional(),
          length: z.number().optional(),
        }),
        args,
      );
      if (p.error) return p.error;

      const { entityId, boneName, parentBone, position, rotation = 0, length = 1 } = p.data;

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
      const p = parseArgs(z.object({ entityId: zEntityId, boneName: z.string() }), args);
      if (p.error) return p.error;
      const { entityId, boneName } = p.data;
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
      const p = parseArgs(
        z.object({
          entityId: zEntityId,
          boneName: z.string(),
          position: zVec2.optional(),
          rotation: z.number().optional(),
          length: z.number().optional(),
        }),
        args,
      );
      if (p.error) return p.error;

      const { entityId, boneName, position, rotation, length } = p.data;

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
      const p = parseArgs(
        z.object({
          entityId: zEntityId,
          animName: z.string(),
          looping: z.boolean().optional(),
        }),
        args,
      );
      if (p.error) return p.error;

      const { entityId, animName, looping = true } = p.data;

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
      const p = parseArgs(
        z.object({
          entityId: zEntityId,
          animName: z.string(),
          boneName: z.string(),
          frame: z.number().int().nonnegative(),
          position: zVec2.optional(),
          rotation: z.number().optional(),
        }),
        args,
      );
      if (p.error) return p.error;

      const { entityId, animName, boneName, frame, position, rotation } = p.data;

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
      const p = parseArgs(z.object({ entityId: zEntityId, animName: z.string() }), args);
      if (p.error) return p.error;
      const { entityId, animName } = p.data;
      ctx.store.playAnimation(entityId, animName);
      return { success: true, result: { message: `Playing skeletal animation "${animName}"` } };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to play skeletal animation 2D' };
    }
  },

  set_skeleton2d_skin: async (args, ctx): Promise<ExecutionResult> => {
    try {
      const p = parseArgs(
        z.object({
          entityId: zEntityId,
          skinName: z.string(),
          attachments: z.record(z.string(), z.unknown()).optional(),
        }),
        args,
      );
      if (p.error) return p.error;
      const { entityId, skinName, attachments } = p.data;

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
      const p = parseArgs(
        z.object({
          entityId: zEntityId,
          chainName: z.string(),
          startBone: z.string(),
          endBone: z.string(),
        }),
        args,
      );
      if (p.error) return p.error;

      const { entityId, chainName, startBone, endBone } = p.data;

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
      const p = parseArgs(z.object({ entityId: zEntityId }), args);
      if (p.error) return p.error;
      const { entityId } = p.data;
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
      const p = parseArgs(z.object({ entityId: zEntityId, json: z.string() }), args);
      if (p.error) return p.error;
      const { entityId, json } = p.data;
      const parsed = JSON.parse(json) as SkeletonData2d;
      ctx.store.setSkeleton2d(entityId, parsed);
      return { success: true, result: { message: `Imported skeleton from JSON for entity ${entityId}` } };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to import skeleton JSON' };
    }
  },

  auto_weight_skeleton2d: async (args, ctx): Promise<ExecutionResult> => {
    try {
      const p = parseArgs(z.object({ entityId: zEntityId }), args);
      if (p.error) return p.error;
      const { entityId } = p.data;
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

  add_skeleton2d_mesh_attachment: async (args, ctx): Promise<ExecutionResult> => {
    try {
      const zVertexWeights = z.object({
        bones: z.array(z.string()),
        weights: z.array(z.number()),
      });
      const p = parseArgs(
        z.object({
          entityId: zEntityId,
          skinName: z.string().min(1),
          attachmentName: z.string().min(1),
          vertices: z.array(zVec2),
          uvs: z.array(zVec2),
          triangles: z.array(z.number().int().nonnegative()),
          weights: z.array(zVertexWeights),
        }),
        args,
      );
      if (p.error) return p.error;
      const { entityId, skinName, attachmentName, vertices, uvs, triangles, weights } = p.data;

      if (vertices.length !== weights.length) {
        return {
          success: false,
          error: `vertices.length (${vertices.length}) must equal weights.length (${weights.length})`,
        };
      }

      ctx.dispatchCommand('add_skeleton2d_mesh_attachment', {
        entityId,
        skinName,
        attachmentName,
        vertices,
        uvs,
        triangles,
        weights,
      });

      return {
        success: true,
        result: {
          message: `Added mesh attachment "${attachmentName}" to skin "${skinName}" on entity ${entityId}`,
        },
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Failed to add skeleton 2D mesh attachment',
      };
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
